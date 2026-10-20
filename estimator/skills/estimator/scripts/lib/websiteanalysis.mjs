import { createHash } from 'node:crypto';
const MAX_ASSETS = 1000;
function assetKind(url, resourceType, contentType = '') {
    if (resourceType === 'font' || /^font\//i.test(contentType) || /\.(woff2?|ttf|otf)(?:[?#]|$)/i.test(url))
        return 'font';
    if (resourceType === 'image' || /^image\//i.test(contentType))
        return 'image';
    if (resourceType === 'stylesheet' || /text\/css/i.test(contentType))
        return 'stylesheet';
    if (resourceType === 'media' || /^(audio|video)\//i.test(contentType))
        return 'media';
}
/** Observe requests in the existing capture context; never download or retain bodies/headers. */
export function observeAssets(page) {
    const assets = new Map();
    let truncated = false;
    const record = (url, kind, fields) => {
        if (!kind)
            return;
        const old = assets.get(url);
        if (!old && assets.size >= MAX_ASSETS) {
            truncated = true;
            return;
        }
        assets.set(url, { ...old, url, kind, sources: ['network'], ...fields });
    };
    const response = (res) => record(res.url(), assetKind(res.url(), res.request().resourceType(), res.headers()['content-type']), { status: res.status() });
    const failed = (req) => record(req.url(), assetKind(req.url(), req.resourceType()), { error: req.failure()?.errorText ?? 'request failed' });
    page.on('response', response);
    page.on('requestfailed', failed);
    return {
        snapshot: () => ({ assets: [...assets.values()], warnings: truncated ? [`Asset inventory truncated at ${MAX_ASSETS} network resources`] : [] }),
        dispose: () => { page.off('response', response); page.off('requestfailed', failed); },
    };
}
/** Runs entirely in the page; keep imports/module globals out of this function. */
export function measureWebsite(input) {
    const limits = { nodes: 250, assets: 1000, cssRules: 20000, variables: 128 };
    const warnings = [];
    const properties = ['display', 'position', 'color', 'background-color', 'background-image', 'background-size', 'background-position', 'background-repeat',
        'font-family', 'font-size', 'font-weight', 'font-style', 'line-height', 'letter-spacing', 'text-align', 'text-transform',
        'width', 'height', 'min-width', 'max-width', 'min-height', 'max-height', 'box-sizing',
        'padding-top', 'padding-right', 'padding-bottom', 'padding-left', 'margin-top', 'margin-right', 'margin-bottom', 'margin-left',
        'row-gap', 'column-gap', 'flex-direction', 'flex-wrap', 'flex-grow', 'flex-shrink', 'flex-basis', 'order', 'align-items', 'align-self', 'justify-content', 'justify-self', 'grid-template-columns', 'grid-template-rows', 'grid-auto-flow',
        'border-top-width', 'border-right-width', 'border-bottom-width', 'border-left-width', 'border-top-style', 'border-right-style', 'border-bottom-style', 'border-left-style',
        'border-top-color', 'border-right-color', 'border-bottom-color', 'border-left-color', 'z-index', 'text-decoration',
        'border-radius', 'box-shadow', 'opacity', 'overflow-x', 'overflow-y', 'object-fit', 'object-position', 'transform'];
    const styleValues = (cs) => Object.fromEntries(properties.map(p => [p, cs.getPropertyValue(p)]));
    const cssUrls = (value, base = location.href) => {
        const urls = [];
        for (const match of value.matchAll(/url\(\s*(?:"([^"]*)"|'([^']*)'|([^)]*))\s*\)/g)) {
            try {
                const url = new URL((match[1] ?? match[2] ?? match[3]).trim(), base);
                if (/^https?:$/.test(url.protocol))
                    urls.push(url.href);
            }
            catch { /* unsupported URL */ }
        }
        return urls;
    };
    const assetMap = new Map();
    let assetTruncated = false;
    const addAsset = (url, kind, source) => {
        if (!/^https?:/i.test(url))
            return;
        const old = assetMap.get(url);
        if (!old && assetMap.size >= limits.assets) {
            assetTruncated = true;
            return;
        }
        if (old) {
            if (!old.sources.includes(source))
                old.sources.push(source);
        }
        else
            assetMap.set(url, { url, kind, sources: [source] });
    };
    const variableNames = new Set();
    const fontFaces = [];
    let fontFacesTruncated = false;
    const visitedSheets = new Set();
    let ruleCount = 0;
    const visitRules = (rules, base) => {
        for (const rule of Array.from(rules)) {
            if (++ruleCount > limits.cssRules)
                return;
            const styled = rule;
            if (styled.style)
                for (const prop of Array.from(styled.style))
                    if (prop.startsWith('--'))
                        variableNames.add(prop);
            if (rule.type === CSSRule.FONT_FACE_RULE) {
                const cs = rule.style;
                const urls = cssUrls(cs.getPropertyValue('src'), base);
                if (fontFaces.length < 128)
                    fontFaces.push({ family: cs.getPropertyValue('font-family'), weight: cs.getPropertyValue('font-weight'), style: cs.getPropertyValue('font-style'), source: base, urls });
                else
                    fontFacesTruncated = true;
                urls.forEach(url => addAsset(url, 'font', 'font-face'));
            }
            if (rule.type === CSSRule.IMPORT_RULE)
                visitSheet(rule.styleSheet);
            const group = rule;
            if ('cssRules' in group)
                visitRules(group.cssRules, base);
        }
    };
    const visitSheet = (sheet) => {
        if (!sheet || visitedSheets.has(sheet) || ruleCount > limits.cssRules)
            return;
        visitedSheets.add(sheet);
        const base = sheet.href || location.href;
        if (sheet.href)
            addAsset(sheet.href, 'stylesheet', 'stylesheet');
        try {
            visitRules(sheet.cssRules, base);
        }
        catch {
            warnings.push(`Stylesheet rules unavailable: ${base}`);
        }
    };
    Array.from(document.styleSheets).forEach(visitSheet);
    for (const el of [document.documentElement, document.body])
        for (const prop of Array.from(el.style))
            if (prop.startsWith('--'))
                variableNames.add(prop);
    if (ruleCount > limits.cssRules)
        warnings.push(`CSS rule inspection truncated at ${limits.cssRules}`);
    if (fontFacesTruncated)
        warnings.push('Font-face inventory truncated at 128 declarations');
    if (variableNames.size > limits.variables)
        warnings.push(`CSS variable inventory truncated at ${limits.variables}`);
    const names = [...variableNames].slice(0, limits.variables);
    let scopedVariablesTruncated = false;
    const variables = (cs, inline) => {
        // Older Chromium can read named variables but does not enumerate them in computed declarations.
        const localNames = [...new Set([...names, ...Array.from(inline ?? []).filter(prop => prop.startsWith('--')), ...Array.from(cs).filter(prop => prop.startsWith('--'))])];
        if (localNames.length > limits.variables)
            scopedVariablesTruncated = true;
        return Object.fromEntries(localNames.slice(0, limits.variables).map(name => [name, cs.getPropertyValue(name).trim()]).filter(([, value]) => value));
    };
    const rootStyle = getComputedStyle(document.documentElement);
    // Computed declarations may expose variables from stylesheets whose rules are inaccessible.
    for (const prop of Array.from(rootStyle))
        if (prop.startsWith('--') && !names.includes(prop) && names.length < limits.variables)
            names.push(prop);
    const rootVariables = variables(rootStyle);
    const unique = new Map();
    const addNode = (node, selector) => { if (node && !unique.has(node))
        unique.set(node, selector); };
    addNode(document.body, 'body');
    for (const selector of input.selectors) {
        try {
            addNode(document.querySelector(selector), selector);
        }
        catch { /* obsolete selector */ }
    }
    for (const selector of input.rects.map(r => r.s)) {
        try {
            addNode(document.querySelector(selector), selector);
        }
        catch { /* obsolete selector */ }
    }
    const box = (el) => { const r = el.getBoundingClientRect(); return { x: r.x + scrollX, y: r.y + scrollY, w: r.width, h: r.height }; };
    const nodes = [];
    let visibleCount = 0;
    for (const [el, selector] of unique) {
        const cs = getComputedStyle(el);
        const b = box(el);
        if (!b.w || !b.h || cs.display === 'none' || cs.visibility === 'hidden' || cs.opacity === '0')
            continue;
        visibleCount++;
        if (nodes.length >= limits.nodes)
            continue;
        const pseudo = {};
        for (const name of ['::before', '::after']) {
            const ps = getComputedStyle(el, name);
            if (ps.content !== 'none' && ps.content !== 'normal' && ps.display !== 'none')
                pseudo[name] = { ...styleValues(ps), content: ps.content };
        }
        nodes.push({ selector, tag: el.tagName.toLowerCase(), box: b, style: styleValues(cs), variables: variables(cs, el.style), pseudo });
        cssUrls(cs.backgroundImage).forEach(url => addAsset(url, 'image', 'background'));
        for (const ps of Object.values(pseudo))
            cssUrls(ps['background-image']).forEach(url => addAsset(url, 'image', 'pseudo-background'));
    }
    if (visibleCount > limits.nodes)
        warnings.push(`Style samples truncated at ${limits.nodes} of ${visibleCount} visible candidates`);
    const rectSelectors = new Map();
    for (const rect of input.rects) {
        try {
            const el = document.querySelector(rect.s);
            if (el)
                rectSelectors.set(el, rect.s);
        }
        catch { /* obsolete selector */ }
    }
    const images = [];
    const selectorFor = (el) => {
        const parts = [];
        let current = el;
        while (current && current !== document.documentElement) {
            const tag = current.tagName.toLowerCase();
            const parent = current.parentElement;
            const peers = parent ? Array.from(parent.children).filter(child => child.tagName === current.tagName) : [];
            parts.unshift(peers.length > 1 ? `${tag}:nth-of-type(${peers.indexOf(current) + 1})` : tag);
            current = parent;
        }
        return parts.join(' > ');
    };
    const allImages = Array.from(document.images);
    for (const img of allImages) {
        const b = box(img);
        const cs = getComputedStyle(img);
        if (!b.w || !b.h || cs.display === 'none' || cs.visibility === 'hidden' || cs.opacity === '0')
            continue;
        if (images.length >= limits.assets) {
            warnings.push(`Image inventory truncated at ${limits.assets}`);
            break;
        }
        const src = img.currentSrc || img.src;
        const broken = img.complete && img.naturalWidth === 0 && !!src;
        images.push({ selector: rectSelectors.get(img) ?? selectorFor(img), src: src.startsWith('data:') ? '[inline image]' : src,
            srcset: img.getAttribute('srcset') ?? '', naturalWidth: img.naturalWidth, naturalHeight: img.naturalHeight, box: b,
            objectFit: cs.objectFit, objectPosition: cs.objectPosition, complete: img.complete, broken });
        addAsset(src, 'image', 'currentSrc');
    }
    const broken = images.filter(i => i.broken).length;
    const pending = images.filter(i => !i.complete).length;
    if (broken)
        warnings.push(`${broken} rendered image(s) failed to load`);
    if (pending)
        warnings.push(`${pending} rendered image(s) still loading`);
    const fonts = Array.from(document.fonts);
    const documentFonts = fonts.slice(0, 128).map(font => ({ family: font.family, weight: font.weight, style: font.style, status: font.status }));
    if (fonts.length > 128)
        warnings.push('Document font inventory truncated at 128 entries');
    if (scopedVariablesTruncated)
        warnings.push(`Scoped CSS variable inventory truncated at ${limits.variables}`);
    if (documentFonts.some(f => f.status === 'error'))
        warnings.push('One or more document fonts failed to load');
    if (document.fonts.status !== 'loaded')
        warnings.push('Document fonts are still loading');
    if (assetTruncated)
        warnings.push(`DOM asset inventory truncated at ${limits.assets}`);
    return { nodes, rootVariables, fontFaces, documentFonts, images, assets: [...assetMap.values()], warnings, limits };
}
export async function collectWebsiteEvidence(page, args) {
    // Prioritize known structural components, then typography and real controls, then remaining rectangles.
    const selectors = [...args.scan.components.map(c => c.selector), ...args.rects.filter(r => /^(h[1-6]|p|a|button|input|select|textarea)$/.test(r.t)).map(r => r.s)];
    const measured = await page.evaluate(measureWebsite, { selectors, rects: args.rects });
    const styles = {};
    const signatures = new Map(args.scan.components.map(c => [c.selector, c.signature]));
    const nodes = measured.nodes.map(({ style, ...node }) => {
        const styleId = createHash('sha256').update(JSON.stringify(style)).digest('hex').slice(0, 16);
        styles[styleId] = style;
        return { ...node, styleId, structureSignature: signatures.get(node.selector) ?? null };
    });
    const assets = new Map(measured.assets.map(a => [a.url, a]));
    let truncated = false;
    for (const observed of args.network.assets) {
        const old = assets.get(observed.url);
        if (!old && assets.size >= MAX_ASSETS) {
            truncated = true;
            continue;
        }
        assets.set(observed.url, { ...old, ...observed, sources: [...new Set([...(old?.sources ?? []), ...observed.sources])] });
    }
    const failed = [...assets.values()].filter(a => a.error || (a.status !== undefined && a.status >= 400));
    const warnings = [...new Set([...measured.warnings, ...args.network.warnings, ...(args.warnings ?? []),
            ...(failed.length ? [`${failed.length} asset request(s) failed; see asset inventory`] : []),
            ...(truncated ? [`Merged asset inventory truncated at ${MAX_ASSETS}`] : [])])];
    const { nodes: _rawNodes, ...rest } = measured;
    return { ...rest, version: 1, requestedUrl: args.requestedUrl, finalUrl: page.url(), capturedAt: new Date().toISOString(),
        viewport: args.viewport, viewportSize: page.viewportSize(), deviceScaleFactor: 1, state: 'default', reducedMotion: 'reduce', consent: args.consent,
        screenshot: args.screenshot, measurement: 'observed', fontEvidence: 'declared families and FontFaceSet status; actual per-glyph font not verified',
        nodes, styles, assets: [...assets.values()], warnings,
        summary: { nodes: nodes.length, styles: Object.keys(styles).length, images: measured.images.length, fonts: measured.documentFonts.length, assets: assets.size, warnings: warnings.length } };
}

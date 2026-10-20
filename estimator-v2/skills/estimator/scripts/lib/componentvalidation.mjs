import * as cheerio from 'cheerio';
import { createCompositeAnalyzer } from './composite.mjs';

const PRIMITIVES = new Set(['a', 'button', 'img', 'picture', 'svg', 'input', 'select', 'textarea', 'label', 'p', 'span', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'blockquote', 'figcaption']);
const STRUCTURAL = new Set(['section', 'header', 'footer', 'nav', 'article', 'aside', 'form', 'dialog', 'details']);
const EMBEDS = new Set(['iframe', 'video', 'audio', 'canvas']);
const validBox = (b) => b && ['x', 'y', 'w', 'h'].every((k) => Number.isFinite(b[k])) && b.w > 0 && b.h > 0;
const area = (b) => b.w * b.h;
function overlap(a, b) {
    if (!validBox(a) || !validBox(b)) return 0;
    const v = Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x)) * Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));
    return v / (area(a) + area(b) - v);
}
function contains(a, b) {
    return validBox(a) && validBox(b) && b.x >= a.x - 2 && b.y >= a.y - 2 && b.x + b.w <= a.x + a.w + 2 && b.y + b.h <= a.y + a.h + 2;
}
function ancestor(a, b) {
    for (let p = b?.parent; p; p = p.parent) if (p === a) return true;
    return false;
}
function ancestorDistance(a, b) {
    let distance = 0;
    for (let p = b?.parent; p; p = p.parent) {
        distance++;
        if (p === a) return distance;
    }
    return Infinity;
}
const tag = (el) => el?.name?.toLowerCase() ?? '';
const widgetMarker = (el) => /(?:^|[\s_-])(gallery|carousel|slider|swiper)(?:$|[\s_-])/i.test(`${el?.attribs?.class ?? ''} ${el?.attribs?.id ?? ''}`) || /carousel|slider/i.test(el?.attribs?.['aria-roledescription'] ?? '');
const isRichText = (el) => tag(el) === 'article' || /(?:^|[\s_-])(richtext|rich-text|prose|portable-text|article-body)(?:$|[\s_-])/i.test(el?.attribs?.class ?? '');
function richTextAncestor(el) {
    for (let p = el?.parent; p; p = p.parent) {
        if (isRichText(p) || ['p', 'blockquote', 'figcaption'].includes(tag(p))) return p;
    }
    return null;
}
function standaloneCta($, el, composite) {
    const t = tag(el), node = $(el), role = el.attribs?.role;
    if (!['a', 'button'].includes(t) && role !== 'button') return false;
    // Artwork titles and accessible names alone do not establish a visible CTA label.
    const label = node.clone();
    label.find('svg,img,picture,script,style,[aria-hidden="true"]').remove();
    const text = label.text().trim();
    if (!text || composite.profile(el).linkedComposite || composite.linkedAncestor(el)) return false;
    if (node.closest('form,p,blockquote,figcaption').length || el.attribs?.form || ['submit', 'reset'].includes(el.attribs?.type?.toLowerCase())) return false;
    if (['aria-expanded', 'aria-haspopup', 'aria-controls'].some(a => el.attribs?.[a] != null)) return false;
    if (/^(close|dismiss|menu|search|next|previous|prev|back|play|pause|mute|unmute|expand|collapse|toggle)(\s+(menu|dialog|slide|search|video|audio))?$/i.test(text)) return false;
    const marker = /(?:^|[\s_-])(btn|button|cta)(?:$|[\s_-])/i.test(`${el.attribs?.class ?? ''} ${el.attribs?.id ?? ''}`);
    // Plain navigation/footer links remain fields; explicit button semantics or styling can establish a CTA there.
    return t === 'button' || role === 'button' || marker;
}
function classify($, el, composite) {
    const t = tag(el), node = $(el), role = el.attribs?.role ?? '';
    const basis = [`dom-tag:${t}`];
    const interactive = EMBEDS.has(t) || t.includes('-') || ['form', 'dialog', 'details'].includes(t) || ['dialog', 'tablist', 'listbox', 'tree', 'slider', 'application'].includes(role);
    if (interactive) return { role: 'component', reason: 'Matched an interactive or custom implementation unit.', basis: [...basis, 'interactive-boundary'] };
    const rich = richTextAncestor(el);
    const linkedComposite = composite.profile(el).linkedComposite;
    const compositePrimitive = linkedComposite || t === 'blockquote' && node.find('img,picture').length > 0 && node.find('h1,h2,h3,h4,h5,h6,p').length > 0;
    // A real widget inside article content remains an implementation boundary.
    const controls = node.find('form,iframe,video,audio,canvas,details,input,select,textarea,button,[role="tablist"],[role="slider"]');
    const images = node.find('img,picture').length;
    const slideMarker = /(?:^|[\s_-])(slide|slider-item|carousel-item|swiper-slide)(?:$|[\s_-])/i.test(el.attribs?.class ?? '') || /slide/i.test(el.attribs?.['aria-roledescription'] ?? '');
    let widgetParent = false;
    for (let p = el.parent; p; p = p.parent) if (widgetMarker(p)) { widgetParent = true; break; }
    if (slideMarker && widgetParent && (images > 0 || node.children().length > 0)) return { role: 'component', reason: 'Matched a slide implementation boundary inside a DOM-backed widget.', basis: [...basis, 'slide-widget-boundary'] };
    if (standaloneCta($, el, composite)) return { role: 'component', implementationType: 'cta', reason: 'Matched a standalone labelled CTA with DOM-backed button semantics or styling.', basis: [...basis, 'standalone-cta-boundary'] };
    if (PRIMITIVES.has(t) && !compositePrimitive) return { role: 'content', reason: 'Matched ordinary content or a primitive control.', basis: [...basis, 'primitive-element', ...(rich ? ['rich-text-ancestor'] : [])] };
    if (widgetMarker(el) && images > 0 && node.find('.swiper-slide,.carousel-item,.slider-item,[aria-roledescription="slide"]').length > 0) return { role: 'component', reason: 'Matched a widget container with an explicit slide boundary.', basis: [...basis, 'slide-container-boundary'] };
    const gallery = images >= 2 && (controls.length > 0 || /(?:^|[\s_-])(gallery|carousel|slider)(?:$|[\s_-])/i.test(el.attribs?.class ?? '') || node.attr('role') === 'region' && !!node.attr('aria-roledescription'));
    if (gallery) return { role: 'component', reason: 'Matched a multi-image gallery with widget evidence.', basis: [...basis, 'gallery-structure'] };
    if (['nav', 'header', 'footer'].includes(t) || ['navigation', 'banner', 'contentinfo'].includes(role)) return { role: 'component', reason: 'Matched a semantic navigation or page-chrome boundary.', basis: [...basis, 'structural-boundary'] };
    if (rich && !controls.length) return { role: 'content', reason: 'Matched ordinary material inside a rich-text renderer.', basis: [...basis, 'rich-text-ancestor'] };
    if (linkedComposite) return { role: 'component', reason: 'Matched one linked composite with independent media/icon and content fields.', basis: [...basis, 'linked-composite-boundary'] };
    if (composite.linkedAncestor(el)) return { role: 'content', reason: 'Matched owned content inside a linked composite.', basis: [...basis, 'linked-composite-owned-content'] };
    if (STRUCTURAL.has(t) || ['navigation', 'banner', 'contentinfo'].includes(role)) return { role: 'component', reason: 'Matched a structural implementation boundary.', basis: [...basis, 'structural-boundary'] };
    const links = node.find('a').length;
    const headings = node.find('h1,h2,h3,h4,h5,h6').length;
    const text = node.find('p,span').length;
    const siblingComposite = composite.profile(el).meaningful && (el.parent?.children ?? []).some((s) => s !== el && s.type === 'tag' && composite.shape(s) === composite.shape(el));
    if (siblingComposite) return { role: 'component', reason: 'Matched a repeated sibling item structure with multiple distinct content fields.', basis: [...basis, 'repeated-sibling-composite'] };
    const children = node.children().toArray();
    const repeated = children.length >= 2 && children.every((c) => tag(c) === tag(children[0])) && children.some((c) => $(c).children().length > 0);
    if (controls.length || links >= 2 || repeated || (images > 0 && headings + text + links > 0) || (headings > 0 && links > 0)) {
        return { role: 'component', reason: 'Matched a composite structure with distinct implementation parts.', basis: [...basis, 'composite-structure'] };
    }
    if (['figure', 'ul', 'ol'].includes(t)) return { role: 'content', reason: 'Matched an ordinary content container.', basis: [...basis, 'content-structure'] };
    if (headings + text > 0 && images === 0 && links === 0) return { role: 'content', reason: 'Matched a text-only content grouping without an independent widget boundary.', basis: [...basis, 'text-content-structure'] };
    return { role: 'uncertain', reason: 'Matched DOM does not establish an implementation boundary.', basis };
}

/** Only validated implementation units enter build and generation inventories. */
export function isImplementationComponent(component) {
    return component?.validation?.role === 'component' && component.validation.countInBuildList === true;
}

/** Pure refinement: original detections remain intact, including uncertain evidence. */
export function refineComponents(components, { rects = [], scan = [], html = '' } = {}) {
    const source = Array.isArray(components) ? components : [];
    const scans = Array.isArray(scan) ? scan : scan?.components ?? [];
    const $ = cheerio.load(typeof html === 'string' ? html : '');
    const composite = createCompositeAnalyzer($);
    const byId = new Map();
    const duplicateIds = new Set();
    source.forEach((c, i) => { if (byId.has(c.id)) duplicateIds.add(c.id); else byId.set(c.id, i); });
    const entries = source.map((c) => {
        let selector = c.domSelector ?? c.selector ?? null;
        if (!selector) {
            const candidates = [...rects.map((r) => ({ selector: r.s, box: r })), ...scans].filter((r) => r.selector && overlap(c.box, r.box) >= 0.5).sort((a, b) => overlap(c.box, b.box) - overlap(c.box, a.box));
            const matches = candidates.filter((r, i) => candidates.findIndex((p) => p.selector === r.selector) === i);
            if (matches.length && (!matches[1] || overlap(c.box, matches[0].box) > overlap(c.box, matches[1].box))) selector = matches[0].selector;
        }
        let els = [];
        try { if (selector) els = $(selector).toArray(); } catch { /* Invalid selectors stay uncertain. */ }
        const el = els.length === 1 ? els[0] : null;
        const rect = rects.find((r) => r.s === selector);
        const basis = selector ? [`selector:${selector}`] : [];
        let decision;
        if (!validBox(c.box)) decision = { role: 'uncertain', reason: 'Detection has malformed geometry.', basis: [...basis, 'invalid-geometry'] };
        else if (!c.id || duplicateIds.has(c.id)) decision = { role: 'uncertain', reason: 'Detection id is missing or duplicated.', basis: [...basis, 'invalid-id'] };
        else if (!el) decision = { role: 'uncertain', reason: 'No unique saved DOM element supports the detection.', basis: [...basis, 'missing-or-ambiguous-dom'] };
        else if (rect && (!validBox(rect) || overlap(c.box, rect) < 0.5)) decision = { role: 'uncertain', reason: 'Saved DOM geometry does not support the detection.', basis: [...basis, 'geometry-mismatch'] };
        else decision = classify($, el, composite);
        return { c, el, selector, ...decision, basis: [...new Set([...basis, ...decision.basis])], ownerId: null };
    });
    const uncertain = (e, reason, evidence) => { e.role = 'uncertain'; e.reason = reason; e.ownerId = null; e.basis.push(evidence); };
    for (const e of entries) {
        const visited = new Set([e.c.id]);
        let parent = e.c.parent;
        while (parent != null) {
            if (visited.has(parent)) { uncertain(e, 'Declared parent relationship contains a cycle.', 'parent-cycle'); break; }
            visited.add(parent);
            const p = entries[byId.get(parent)];
            if (!p) { uncertain(e, 'Declared parent is missing.', 'missing-parent'); break; }
            parent = p.c.parent;
        }
        if (e.role !== 'uncertain' && e.c.parent != null) {
            const p = entries[byId.get(e.c.parent)];
            if (!p?.el || !ancestor(p.el, e.el) || !contains(p.c.box, e.c.box)) uncertain(e, 'Declared parent is not backed by DOM and geometric containment.', 'unsupported-parent-containment');
            else e.basis.push('declared-parent-containment');
        }
    }
    // Coincident boxes alone do not establish identity; only the same DOM node does.
    for (let i = 0; i < entries.length; i++) for (let j = i + 1; j < entries.length; j++) {
        const a = entries[i], b = entries[j];
        if (a.el && a.el === b.el && overlap(a.c.box, b.c.box) >= 0.9) {
            uncertain(a, 'Multiple detections refer to the same DOM element and box.', 'duplicate-dom-detection');
            uncertain(b, 'Multiple detections refer to the same DOM element and box.', 'duplicate-dom-detection');
        }
    }
    for (const e of entries) {
        if (e.role !== 'component' || tag(e.el) !== 'div' || e.el.attribs?.role || widgetMarker(e.el) || /(?:card|grid|group|menu|nav)/i.test(e.el.attribs?.class ?? '')) continue;
        const children = $(e.el).children().toArray();
        const ownText = (e.el.children ?? []).some((n) => n.type === 'text' && n.data.trim());
        if (children.length !== 1 || ownText) continue;
        const inner = entries.find((p) => p !== e && p.role === 'component' && p.el === children[0] && overlap(e.c.box, p.c.box) >= 0.9);
        if (inner) {
            e.role = 'part';
            e.reason = 'Matched a transparent wrapper around a separately detected implementation boundary.';
            e.basis.push('transparent-wrapper', `implementation-boundary:${inner.c.id}`);
        }
    }
    for (const e of entries) {
        if (e.role === 'uncertain') continue;
        const owners = entries.filter((p) => p !== e && p.role === 'component' && ancestor(p.el, e.el) && contains(p.c.box, e.c.box)).sort((a, b) => ancestorDistance(a.el, e.el) - ancestorDistance(b.el, e.el) || area(a.c.box) - area(b.c.box));
        if (owners.length) {
            e.ownerId = owners[0].c.id;
            e.basis.push('owner-dom-and-box-containment');
            if (e.role === 'content' && !(e.basis.includes('rich-text-ancestor') && isRichText(owners[0].el))) {
                e.role = 'part';
                e.reason = 'Matched primitive or content belongs to the nearest backed implementation owner.';
            }
        }
    }
    const refined = entries.map((e) => ({ ...e.c, level: e.ownerId || e.implementationType === 'cta' || Number(e.c.level) > 1 ? 2 : 1, validation: { version: 1, role: e.role, ...(e.role === 'component' && e.implementationType ? { implementationType: e.implementationType } : {}), countInBuildList: e.role === 'component', ownerId: e.ownerId, reason: e.reason, basis: [...new Set(e.basis)] } }));
    const counts = { total: refined.length, component: 0, content: 0, part: 0, uncertain: 0, counted: 0 };
    for (const c of refined) { counts[c.validation.role]++; if (isImplementationComponent(c)) counts.counted++; }
    return { components: refined, findings: refined.map((c) => ({ id: c.id, ...c.validation })), counts };
}


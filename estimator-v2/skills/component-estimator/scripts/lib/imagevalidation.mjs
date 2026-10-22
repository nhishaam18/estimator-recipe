const area = (b) => Math.max(0, b.w) * Math.max(0, b.h);
function intersection(a, b) {
    return Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x)) * Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));
}
function overlap(a, b) { const i = intersection(a, b); return i / Math.max(1, area(a) + area(b) - i); }
/** Filter before registry, propagation and consolidation. No provider calls. */
export function validateImageComponents(components, rects) {
    const findings = [];
    const kept = components.filter(c => {
        if (!area(c.box))
            return true;
        const candidates = rects.filter(r => (r.t === 'img' || r.mediaKind === 'background') && intersection(c.box, r.mediaBox ?? r) / area(c.box) >= 0.95)
            .sort((a, b) => area(a.mediaBox ?? a) - area(b.mediaBox ?? b));
        for (const image of candidates) {
            const b = image.mediaBox ?? image;
            // A matching real DOM control/text overlay is evidence the component belongs to the page.
            const backed = rects.some(r => !['img', 'picture', 'figure'].includes(r.t) && r.s !== image.s && (r.interactive || ['button', 'input', 'select', 'textarea', 'form', 'a', 'p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6'].includes(r.t)) && overlap(c.box, r) >= 0.55);
            if (backed)
                return true;
            const whole = intersection(c.box, b) / Math.max(1, area(b)) >= 0.85;
            if (whole && /image|screenshot|figure|photo|illustration|mockup|logo|badge/i.test(c.name))
                return true;
            const uncertain = image.mediaKind === 'background' || image.mediaUncertain || whole;
            findings.push({ componentId: c.id, name: c.name, imageSelector: image.s, decision: uncertain ? 'review' : 'excluded', box: c.box,
                reason: uncertain ? 'Image overlap is ambiguous; retain for review.' : 'Box is inside raster image content without a matching HTML overlay.' });
            return !!uncertain;
        }
        return true;
    });
    const ids = new Set(kept.map(c => c.id));
    const excludedNames = new Set(findings.filter(f => f.decision === 'excluded').map(f => f.name.toLowerCase()));
    const retainedNames = new Set(kept.map(c => c.name.toLowerCase()));
    return { components: kept.map(c => ({ ...c, parent: c.parent && !ids.has(c.parent) ? null : c.parent,
            contains: rects.some(r => r.t === 'img' && overlap(c.box, r.mediaBox ?? r) >= 0.85) && /image|screenshot|photo|illustration|mockup|logo|badge/i.test(c.name) ? [] : c.contains.filter(name => !excludedNames.has(name.toLowerCase()) || retainedNames.has(name.toLowerCase())) })), findings };
}
/** Compact tile-local pixel regions. Does not change the requested model coordinate space. */
export function imageBoundaryPrompt(rects, top, height) {
    const boxes = rects.filter(r => r.t === 'img').map(r => r.mediaBox ?? r).filter(b => b.y < top + height && b.y + b.h > top)
        .map(b => [b.x, Math.max(0, b.y - top), b.w, Math.min(b.y + b.h, top + height) - Math.max(b.y, top)].map(Math.round));
    return '\nImage-content rule: identify actual website components, not controls depicted in screenshots, photographs, illustrations or device mockups. Preserve the image/figure, caption and actual HTML overlays; do not list illustrated buttons, cards, dialogs or text in contains. Raster image regions in tile-local pixels [x,y,width,height]: ' + JSON.stringify(boxes) + '. Region coordinates are pixels regardless of the response coordinate scale. No additional model call is requested.';
}

// Placeholders: {tile} {tiles} {url} {viewport} {top} {bottom} {pageWidth} {pageHeight} {known} {imageWidth} {imageHeight} {scaleInstruction} {scaleExample} {scaleSpace}
export const DEFAULT_PROMPT = `You are annotating screenshots of web pages from ONE website to build a UI component inventory.
This image is tile {tile} of {tiles} of the full-page {viewport} screenshot of {url}. The tile covers the page from y={top}px to y={bottom}px. The full page is {pageWidth}x{pageHeight}px.

Detect and annotate every occurrence of each UI block component visible in this image using exactly TWO presentation levels:
- Level 1 = "section": a main page section (announcement bar, global header, hero, statistics grid, text section, card grid, logo strip, call-to-action band, footer, and so on).
- Level 2 = "inner": an independently implemented unit inside a section, such as a Team Card in a Team Grid, a Slider Item in a Slider, a Footer Link Group in a Footer, a form, a navigation menu, a reusable standalone CTA button/link, or a custom interactive embed. Preserve the section and its actual cards and CTAs; do not box a second wrapper for the same unit. A CTA inside a card is still level 2 and its parent is that card. Never create level 3 or deeper.
- Apply this boundary rule to EVERY component: titles, subtitles, descriptions, ordinary images, captions, icons, individual plain links and decorative wrappers are content/owned fields of their nearest component. Describe them in "contains" instead of creating separate components. A banner/hero section owns its title, subtitle and media while actual cards and reusable CTAs inside it are separate inner units. An article rich-text renderer owns its paragraphs, headings, inline images, captions, lists and quotes. A genuine gallery, slider, form or custom embed inside it can be a separate implementation unit. A group of links can be a navigation component; every link is not another implementation.
- Annotate a standalone CTA only when it has a visible label and DOM-backed button/link semantics or explicit button/CTA styling. Names such as "CTA" are context, never proof by themselves. Ordinary inline prose links, plain navigation/footer links, form fields and submit controls, icon-only utility buttons, carousel controls and whole-card anchors are not extra CTAs. A whole-card anchor containing distinct media/icon and content fields is one card; its title, description and icon belong to it.
- Give compatible reusable CTA instances one canonical name such as "Primary CTA" or "Secondary CTA", even when their label text, destination URL or page differs. Copy and destination are fields, not separate component families. Preserve materially different structure/behavior as distinct families. Draw every visible CTA and every card occurrence, even when that reusable definition was already seen elsewhere.
- A repeated item needs its own layout/field structure or behavior, not merely repetition. Team Cards and Slider Items can be reusable child families, including media-led items. Different text or images alone do not establish different component types. Do not infer nested components depicted inside a raster image.
- Each repeated sibling (every card in a card grid) gets its own box and "repeated": true.
- Reusable blocks: set "reusable": true for any section or inner component that is a template likely to appear on other pages of this website with the same structure and only different content, for example a hero banner, card grid, call-to-action band, header, footer, announcement bar, logo strip, testimonial slider. Text, images and the number of items may differ; the structure is what matters. Use exactly the same name every time for the same kind of block. Names already used on other pages: {known}.

Coordinates: "box" is [ymin, xmin, ymax, xmax]. {scaleInstruction} The image sent to you is {imageWidth}x{imageHeight}px. Boxes must tightly enclose the component. If a component is cut by the top or bottom edge of the image, extend its box to that edge. Only annotate what is visible; never guess.

Also include "coordinate_space": {"width": W, "height": H} at the top level, giving the values that correspond to the right and bottom edges of the image in the scale you used. Reply with JSON only, no prose and no code fences, in exactly this shape:
{"coordinate_space":{scaleSpace},"components":[{"id":"S1","parent":null,"level":1,"name":"Announcement bar","box":{scaleExample},"reusable":true,"repeated":false,"contains":[]},{"id":"S3_I1","parent":"S3","level":2,"name":"Statistic item","box":[270,30,330,200],"reusable":false,"repeated":true,"contains":["number","label"]}]}
Section ids are S1, S2, ... in reading order. Inner component ids are S<section number>_I<number>, and "parent" is the id of its nearest actual containing implementation unit (section or inner component). Preserve that occurrence ownership even though every inner unit has level 2; do not flatten a card-owned CTA onto the section. Never create cyclic parents.`;
export const DEFAULT_SETTINGS = {
    captureConcurrency: 1,
    scanConcurrency: 1,
    urlIntervalMs: 1000,
    requestMaxInFlight: 4,
    requestStartIntervalMs: 100,
    requestQueueLimit: 128,
    navigationTimeoutMs: 25000,
    pageBudgetMs: 45000,
    maxConsecutivePageFailures: 2,
    blockKnownTracking: true,
    threshold: 0.8,
    model: 'kajoo/visual-analysis',
    tileHeight: 1800,
    tileOverlap: 150,
    prompt: DEFAULT_PROMPT,
    coordMode: 'normalized-1000',
    reportScale: 1000,
};
export function fillPrompt(template, vars) {
    return template.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? String(vars[k]) : m));
}
export function scaleInstruction(mode, w, h) {
    if (mode === 'pixels') {
        return {
            text: `Use pixel coordinates of this image (x from 0 to ${w}, y from 0 to ${h}), as integers.`,
            example: `[0,0,60,${w}]`,
            space: `{"width":${w},"height":${h}}`,
        };
    }
    if (mode === 'normalized-1') {
        return { text: 'Use values between 0 and 1 relative to this image (0,0 is the top-left corner, 1,1 the bottom-right), with up to 3 decimals.', example: '[0,0,0.02,1]', space: '{"width":1,"height":1}' };
    }
    return { text: 'Use integers on a 0-1000 scale relative to this image (0,0 is the top-left corner, 1000,1000 the bottom-right).', example: '[0,0,20,1000]', space: '{"width":1000,"height":1000}' };
}

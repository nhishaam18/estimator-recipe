const tag = n => n?.name?.toLowerCase() ?? '';
const children = n => (n?.children ?? []).filter(n => n.type === 'tag');
const OPAQUE = new Set(['svg', 'img', 'picture', 'video', 'audio', 'iframe', 'canvas']);
const OMIT_TEXT = new Set([...OPAQUE, 'script', 'style', 'template', 'noscript', 'input', 'select', 'textarea', 'button']);
const TEXT_UNIT = /^(h[1-6]|p|span|blockquote|figcaption|dt|dd|label|summary|caption|td|th)$/;
const BLOCK = /^(div|section|article|h[1-6]|p|ul|ol|li|dl|dt|dd|blockquote|figure|figcaption|table)$/;

/** Shared semantic evidence, independent of component names, selectors and hostnames.
 * SVG internals are opaque artwork; independent text branches are fields.
 * DOM recovery does not create implementation detections.
 */
export function createCompositeAnalyzer($) {
  const profiles = new WeakMap(), shapes = new WeakMap(), fields = new WeakMap();
  function textFields(n) {
    if (fields.has(n)) return fields.get(n);
    const t = tag(n), list = children(n);
    let out = [];
    if (!OMIT_TEXT.has(t)) {
      const ownText = (n.children ?? []).some(c => c.type === 'text' && c.data.trim());
      const nested = list.flatMap(textFields);
      // Paragraphs and inline formatting runs remain one field.
      if (TEXT_UNIT.test(t) && (ownText || nested.length)) out = [n];
      else if (ownText) out = [n, ...list.filter(c => BLOCK.test(tag(c))).flatMap(textFields)];
      else out = nested;
    }
    fields.set(n, out);
    return out;
  }
  function shape(n) {
    if (!shapes.has(n)) shapes.set(n, OPAQUE.has(tag(n)) ? tag(n) : `${tag(n)}(${children(n).map(shape).join(',')})`);
    return shapes.get(n);
  }
  function profile(n) {
    if (profiles.has(n)) return profiles.get(n);
    const descendants = $(n).find('*').toArray();
    const fieldNodes = textFields(n);
    const rasterMedia = descendants.some(el => ['img', 'picture', 'video', 'iframe'].includes(tag(el)));
    const icon = descendants.some(el => tag(el) === 'svg' || el.attribs?.role === 'img');
    const headings = fieldNodes.some(el => /^h[1-6]$/.test(tag(el)));
    const media = rasterMedia || icon;
    // A raster icon and one inline label has the same semantics as an SVG icon
    // action. One media/text field needs heading or paragraph evidence; otherwise
    // require multiple independent fields to establish a composite.
    const semanticText = fieldNodes.some(el => /^(h[1-6]|p|blockquote|figcaption)$/.test(tag(el)));
    const mediaComposite = rasterMedia && (fieldNodes.length >= 2 || semanticText);
    const linkedComposite = tag(n) === 'a' && n.attribs?.role !== 'button' && (mediaComposite || (icon || headings) && fieldNodes.length >= 2);
    const fieldTexts = fieldNodes.map(el => { const clean = $(el).clone(); clean.find('svg,script,style,template,noscript').remove(); return clean.text().trim(); });
    const out = { fields: fieldNodes.length, fieldNodes, fieldTexts, media, rasterMedia, icon, headings,
      meaningful: fieldNodes.length >= 2 && (headings || media) || mediaComposite,
      linkedComposite };
    profiles.set(n, out);
    return out;
  }
  function linkedAncestor(n) {
    for (let p = n?.parent; p?.type === 'tag'; p = p.parent) if (profile(p).linkedComposite) return p;
    return null;
  }
  return { profile, shape, linkedAncestor };
}

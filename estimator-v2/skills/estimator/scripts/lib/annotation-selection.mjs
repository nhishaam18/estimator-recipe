import { createHash } from 'node:crypto';
import * as cheerio from 'cheerio';
import { createCompositeAnalyzer } from './composite.mjs';

const MAX_ITEMS = 1500;
const MAX_NODES = 50000;
const validBox = b => b && ['x', 'y', 'w', 'h'].every(k => Number.isFinite(b[k])) && b.w > 0 && b.h > 0;
const copyBox = b => Object.fromEntries(['x', 'y', 'w', 'h'].map(k => [k, b[k]]));
const tag = n => n?.name?.toLowerCase() ?? '';
const children = n => (n?.children ?? []).filter(n => n.type === 'tag');
const ancestor = (a, b) => { for (let p = b?.parent; p; p = p.parent) if (p === a) return true; return false; };
const intersect = (a, b, x = true, y = true) => {
  const left = x ? Math.max(a.x, b.x) : a.x, top = y ? Math.max(a.y, b.y) : a.y;
  return { x: left, y: top, w: Math.max(0, (x ? Math.min(a.x + a.w, b.x + b.w) : a.x + a.w) - left), h: Math.max(0, (y ? Math.min(a.y + a.h, b.y + b.h) : a.y + a.h) - top) };
};
const sameBox = (a, b) => ['x', 'y', 'w', 'h'].every(k => Math.abs(a[k] - b[k]) < 1);
const richMarker = n => /(?:^|[\s_-])(richtext|rich-text|prose|portable-text|article-body)(?:$|[\s_-])/i.test(n?.attribs?.class ?? '');
const widget = n => ['form', 'details', 'dialog', 'iframe', 'video', 'audio', 'canvas'].includes(tag(n)) || ['tablist', 'slider', 'listbox', 'application', 'dialog'].includes(n?.attribs?.role) || /carousel|slider/i.test(n?.attribs?.['aria-roledescription'] ?? '') || /(?:^|[\s_-])(carousel|slider|swiper|gallery)(?:$|[\s_-])/i.test(n?.attribs?.class ?? '');
const chrome = n => ['header', 'footer', 'nav'].includes(tag(n)) || ['navigation', 'banner', 'contentinfo'].includes(n?.attribs?.role);
const explicitItem = n => ['listitem', 'article'].includes(n?.attribs?.role) || /slide/i.test(n?.attribs?.['aria-roledescription'] ?? '') || /(?:^|[\s_-])(slide|swiper-slide|carousel-item|slider-item)(?:$|[\s_-])/i.test(n?.attribs?.class ?? '') || !!n?.attribs?.itemtype;
const plainPrimitive = n => /^(?:p|span|h[1-6]|img|picture|svg|path|use|figure|figcaption|blockquote|ul|ol|dl|dt|dd|label|option|strong|em|b|i|small|br|hr)$/.test(tag(n));

/** Select screenshot annotations without changing detections or implementation-family counts.
 * Geometry is CSS-pixel geometry: capture uses screenshot scale 1. Missing saved clipping
 * evidence is reported; this offline pass cannot infer occlusion or raster image contents.
 */
export function selectAnnotations({ components = [], html = '', rects = [], width, height, evidence = null } = {}) {
  const warnings = new Set();
  const result = { version: 1, items: [], warnings: [] };
  if (!(Number.isFinite(width) && width > 0 && Number.isFinite(height) && height > 0)) {
    result.warnings.push('Annotation image dimensions are missing or invalid; no geometry was inferred.');
    return result;
  }
  const $ = cheerio.load(typeof html === 'string' ? html : '');
  const all = $('*').toArray();
  if (all.length > MAX_NODES) warnings.add(`DOM annotation recovery limited to ${MAX_NODES} of ${all.length} saved elements.`);
  const nodes = all.slice(0, MAX_NODES), order = new Map(all.map((n, i) => [n, i]));
  const paths = new Map();
  const { profile, shape, linkedAncestor } = createCompositeAnalyzer($);
  function selectorFor(n) {
    if (paths.has(n)) return paths.get(n);
    const siblings = children(n.parent).filter(s => tag(s) === tag(n));
    const part = siblings.length > 1 ? `${tag(n)}:nth-of-type(${siblings.indexOf(n) + 1})` : tag(n);
    const path = n.parent?.type === 'tag' ? `${selectorFor(n.parent)} > ${part}` : part;
    paths.set(n, path);
    return path;
  }
  const unique = s => { try { const found = typeof s === 'string' && s ? $(s).toArray() : []; return found.length === 1 ? found[0] : null; } catch { return null; } };
  const rectByNode = new Map(), styleByNode = new Map(), sampleByNode = new Map();
  for (const r of Array.isArray(rects) ? rects : []) {
    const n = unique(r.s ?? r.selector);
    if (n) { if (!rectByNode.has(n)) rectByNode.set(n, r); else warnings.add(`Multiple saved rectangles resolve to ${selectorFor(n)}; first rectangle retained.`); }
  }
  for (const sample of evidence?.nodes ?? []) {
    const n = unique(sample.selector ?? sample.s);
    if (n) { sampleByNode.set(n, sample); if (evidence?.styles?.[sample.styleId]) styleByNode.set(n, evidence.styles[sample.styleId]); }
  }
  function style(n) {
    // Inline declarations are saved evidence, not a substitute for missing computed styles.
    const inline = Object.fromEntries(String(n?.attribs?.style ?? '').split(';').map(p => { const colon = p.indexOf(':'); return colon < 0 ? [] : [p.slice(0, colon).trim().toLowerCase(), p.slice(colon + 1).trim().replace(/\s*!important\s*$/i, '')]; }).filter(p => p.length === 2));
    return { ...inline, ...styleByNode.get(n) };
  }
  function blocked(n) {
    let visibilityResolved = rectByNode.get(n)?.paintedVisible === true;
    for (let p = n; p?.type === 'tag'; p = p.parent) {
      const s = style(p);
      if (!visibilityResolved && s.visibility && s.visibility !== 'inherit') {
        visibilityResolved = true;
        if (['hidden', 'collapse'].includes(s.visibility)) return true;
      }
      if (['script', 'style', 'template', 'noscript'].includes(tag(p)) || p.attribs?.hidden !== undefined || s.display === 'none' || Number.parseFloat(s.opacity) === 0 || s['content-visibility'] === 'hidden') return true;
      if (p !== n && ['svg', 'picture', 'canvas', 'iframe', 'video', 'audio'].includes(tag(p))) return true;
    }
    return false;
  }
  const image = { x: 0, y: 0, w: width, h: height };
  function geometry(n, fallback) {
    if (blocked(n)) return null;
    const r = rectByNode.get(n), sample = sampleByNode.get(n);
    const source = r ?? fallback ?? sample?.box;
    if (!validBox(source) || r?.paintedVisible === false) return null;
    let visible = copyBox(source), status;
    if (r && Object.hasOwn(r, 'visibleBox')) {
      if (!validBox(r.visibleBox)) return null;
      visible = copyBox(r.visibleBox);
      status = r.paintedVisible === true ? 'recorded-visible-bounds' : 'recorded-bounds; painted-visibility-unknown';
      if (r.paintedVisible !== true) warnings.add('Painted visibility is unknown for saved rectangles without a paintedVisible observation.');
    } else {
      status = 'legacy-evidence; visibility-unknown';
      warnings.add('Painted visibility and complete ancestor clipping are unknown for legacy bounds; clipped to image and known saved overflow evidence.');
      for (let p = n.parent; p?.type === 'tag'; p = p.parent) {
        const s = style(p), bounds = rectByNode.get(p) ?? sampleByNode.get(p)?.box;
        const clips = v => /^(hidden|clip|scroll|auto)$/.test(v ?? '');
        const clipX = clips(s['overflow-x'] ?? s.overflow), clipY = clips(s['overflow-y'] ?? s.overflow);
        if ((clipX || clipY) && validBox(bounds)) visible = intersect(visible, bounds, clipX, clipY);
        else if (clipX || clipY) warnings.add(`Missing ancestor bounds prevent complete overflow clipping at ${selectorFor(p)}.`);
      }
    }
    visible = intersect(visible, image);
    if (!validBox(visible)) return null;
    return { box: visible, geometry: { sourceBox: copyBox(source), visibleBox: copyBox(visible), coordinateSpace: 'screenshot-css-pixels', cssScale: 1, screenshotWidth: width, screenshotHeight: height, visibility: status, ...(r?.visibilityBasis ? { visibilityBasis: structuredClone(r.visibilityBasis) } : {}) } };
  }
  // Repetition is structural, independent of hostnames, IDs or site class names.
  const candidates = new Set();
  for (const parent of nodes) {
    const buckets = new Map();
    for (const child of children(parent)) { const key = shape(child); const bucket = buckets.get(key) ?? []; bucket.push(child); buckets.set(key, bucket); }
    for (const group of buckets.values()) {
      if (group.length < 2) continue;
      for (let n of group) {
        if (plainPrimitive(n) || ['button', 'input', 'select', 'textarea'].includes(tag(n))) continue;
        if (!(profile(n).meaningful || explicitItem(n) && (profile(n).media || $(n).text().trim()))) continue;
        // Prefer the actual composite beneath a transparent single-child wrapper.
        while (children(n).length === 1 && !(n.children ?? []).some(c => c.type === 'text' && c.data.trim())) {
          const inner = children(n)[0];
          if (plainPrimitive(inner) || !profile(inner).meaningful) break;
          n = inner;
        }
        candidates.add(n);
      }
    }
  }
  function inRichText(n) {
    for (let p = n; p?.type === 'tag'; p = p.parent) {
      if (richMarker(p)) return true;
      if (p !== n && ['p', 'blockquote', 'figcaption'].includes(tag(p))) return true;
      if (tag(p) === 'article' && !candidates.has(p)) return true;
    }
    return false;
  }
  const entries = new Map();
  function labelText(n) {
    const clean = $(n).clone();
    clean.find('svg,script,style,template,noscript').remove();
    return clean.text();
  }
  function add(n, kind, detection = null, fallback = null) {
    if (!n) return null;
    const existing = entries.get(n);
    if (existing) return existing;
    const measured = geometry(n, fallback);
    if (!measured) return null;
    const r = rectByNode.get(n);
    const selector = detection?.domSelector ?? detection?.selector ?? r?.s ?? r?.selector ?? selectorFor(n);
    const canonical = selectorFor(n);
    const item = { id: `ann_${createHash('sha256').update(canonical).digest('hex').slice(0, 16)}`, kind,
      name: String(detection?.name || n.attribs?.['aria-label'] || labelText($(n).find('h1,h2,h3,h4,h5,h6').first()) || (kind === 'component' ? profile(n).fieldTexts[0] : '') || labelText(n) || ({section:'Section',component:'Nested item',group:'Link group',action:'Action'}[kind])).replace(/\s+/g,' ').trim().slice(0, 80),
      ...measured, selector, ownerId: null,
      ...(detection?.id != null ? { sourceDetectionId: detection.id } : {}), source: detection ? 'validated-detection' : 'saved-dom', annotationOnly: !detection };
    if (detection && !r) warnings.add(`Missing saved rectangle for validated detection ${String(detection.id)}; legacy model/sample bounds retained with visibility limits.`);
    const entry = { n, item };
    entries.set(n, entry);
    return entry;
  }
  const accepted = (Array.isArray(components) ? components : []).filter(c => c?.validation?.role === 'component' && c.validation.countInBuildList === true);
  // Sorting avoids input-order-dependent records when duplicated detections share a DOM node.
  for (const c of [...accepted].sort((a, b) => String(a.id).localeCompare(String(b.id)) || String(a.name).localeCompare(String(b.name)))) {
    const n = unique(c.domSelector ?? c.selector);
    if (!n) { warnings.add(`Validated detection ${String(c.id)} has no unique saved DOM selector; annotation omitted.`); continue; }
    const kind = ['section', 'header', 'footer', 'main'].includes(tag(n)) || c.level === 1 && !candidates.has(n) ? 'section' : chrome(n) ? 'group' : 'component';
    add(n, kind, c, c.box);
  }
  for (const n of candidates) {
    const linkedItems = $(n).find('a').toArray().filter(el => profile(el).linkedComposite).length;
    if (linkedItems < 2 && !inRichText(n) && !linkedAncestor(n) && !chrome(n) && !$(n).parents().toArray().some(chrome)) add(n, 'component');
  }
  for (const n of nodes) if (widget(n) && !plainPrimitive(n)) add(n, 'component');

  // Group the smallest structured sets of chrome links. A wrapper around several
  // such sets is not another group, and ordinary per-link chrome boxes are omitted.
  const groups = new Set();
  const linkBranches = new Map();
  function linkBranch(n) {
    if (linkBranches.has(n)) return linkBranches.get(n);
    let links = 0;
    if (tag(n) === 'a' && n.attribs?.href !== undefined) links = 1;
    else if (['div', 'span', 'li'].includes(tag(n)) && !(n.children ?? []).some(c => c.type === 'text' && c.data.trim())) {
      const nested = children(n).map(linkBranch);
      if (nested.length && nested.every(Boolean)) links = nested.reduce((a, b) => a + b, 0);
    }
    linkBranches.set(n, links);
    return links;
  }
  for (const n of nodes) {
    if (blocked(n) || !chrome(n) && !$(n).parents('nav,footer,header,[role="navigation"],[role="banner"],[role="contentinfo"]').length) continue;
    const direct = children(n);
    const links = direct.filter(el => linkBranch(el) > 0);
    const list = ['ul', 'ol'].includes(tag(n)) && direct.filter(el => tag(el) === 'li').length >= 2 && $(n).find('a[href]').length >= 2;
    if (links.length >= 2 || list || tag(n) === 'nav' && $(n).find('a[href]').length >= 2) groups.add(n);
  }
  const smallestGroups = [...groups].filter(n => ![...groups].some(other => other !== n && ancestor(n, other)));
  for (let n of smallestGroups) {
    // A heading plus one link list is one semantic group, including its heading.
    // Stop before chrome roots and before wrappers containing multiple link groups.
    const parent = n.parent, peers = children(parent);
    const siblingHeading = peers.some(p => p !== n && /^h[1-6]$/.test(tag(p)));
    if (parent?.type === 'tag' && !chrome(parent) && siblingHeading && smallestGroups.filter(g => ancestor(parent, g)).length === 1 && peers.every(p => p === n || /^h[1-6]$/.test(tag(p)))) n = parent;
    add(n, 'group');
  }

  function prominent(n) {
    if (tag(n) === 'button' || n.attribs?.role === 'button' || /(?:^|[\s_-])(button|btn|cta)(?:$|[\s_-])/i.test(n.attribs?.class ?? '')) return true;
    const s = style(n), bg = s['background-color'];
    return !!bg && !['transparent', 'rgba(0, 0, 0, 0)'].includes(bg) && ['padding', 'padding-top', 'padding-left'].some(k => Number.parseFloat(s[k]) > 0);
  }
  function nearestEntry(n) { for (let p = n.parent; p; p = p.parent) if (entries.has(p)) return entries.get(p); return null; }
  for (const n of nodes) {
    const t = tag(n), a = n.attribs ?? {};
    if (!(t === 'a' && a.href !== undefined || ['button', 'select', 'textarea', 'input'].includes(t) || a.role === 'button') || t === 'input' && a.type === 'hidden') continue;
    if (blocked(n)) continue;
    const owner = nearestEntry(n), own = entries.get(n);
    const card = own?.item.kind === 'component' || owner?.item.kind === 'component';
    const widgetOwner = widget(n) || $(n).parents().toArray().some(widget);
    const inChrome = chrome(n) || $(n).parents().toArray().some(chrome);
    const inline = $(n).parents('p,h1,h2,h3,h4,h5,h6,blockquote,figcaption').length > 0;
    if (t === 'a' && (inline || inRichText(n) && !card && !widgetOwner) && !prominent(n)) continue;
    if (t === 'a' && inChrome && !card && !widgetOwner && !prominent(n)) continue;
    const semantic = { selector: a.href !== undefined && own ? own.item.selector : rectByNode.get(n)?.s ?? selectorFor(n), label: String(a['aria-label'] ?? labelText(n).trim() ?? '').slice(0, 160) || a.placeholder || a.name || a.type || t, destination: a.href ?? a.formaction ?? null, control: t };
    const measured = geometry(n);
    if (!measured) continue;
    // Whole-card anchors, and coincident card-wrapper links, are one boundary
    // with retained action semantics rather than duplicate overpainted boxes.
    const coincident = own ?? (owner?.item.kind === 'component' && sameBox(owner.item.box, measured.box) ? owner : null);
    if (coincident) { (coincident.item.actions ??= []).push(semantic); continue; }
    const entry = add(n, 'action');
    if (entry) { entry.item.name = semantic.label.slice(0, 80); entry.item.actions = [semantic]; }
  }
  const ordered = [...entries.values()].sort((a, b) => order.get(a.n) - order.get(b.n));
  // Keep validated detections ahead of recovered detail if a pathological page
  // reaches the explicit drawing bound, then restore DOM order for stable IDs.
  const retained = ordered.length > MAX_ITEMS ? [...ordered.filter(e => !e.item.annotationOnly), ...ordered.filter(e => e.item.annotationOnly)].slice(0, MAX_ITEMS).sort((a, b) => order.get(a.n) - order.get(b.n)) : ordered;
  if (ordered.length > MAX_ITEMS) warnings.add(`Annotation limit ${MAX_ITEMS} reached: ${ordered.length - retained.length} DOM-backed boundaries omitted; inventory is incomplete.`);
  const kept = new Map(retained.map(e => [e.n, e]));
  const displayCounts = { section: 0, component: 0, group: 0, action: 0 };
  const displayPrefixes = { section: 'R', component: 'I', group: 'G', action: 'CTA' };
  for (const e of retained) {
    e.item.displayId = `${displayPrefixes[e.item.kind]}${String(++displayCounts[e.item.kind]).padStart(2, '0')}`;
    for (let p = e.n.parent; p; p = p.parent) if (kept.has(p)) { e.item.ownerId = kept.get(p).item.id; break; }
  }
  result.items = retained.map(e => e.item);
  result.warnings = [...warnings].sort();
  return result;
}

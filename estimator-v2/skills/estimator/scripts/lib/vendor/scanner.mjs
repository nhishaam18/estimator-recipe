// Deterministic scan of saved HTML for page-level components. No AI model.
//
// Each component gets a structural signature `<provisional-type>-<sha1(skeleton)[0:10]>`. The skeleton
// ignores text, collapses repeated siblings (3 cards == 6 cards) and unwraps single-child div wrappers.
// Class names are weak hints only and never enter the hash (Tailwind / hashed CSS makes them unreliable).
import { createHash } from 'node:crypto';
import * as cheerio from 'cheerio';

const set = (s) => new Set(s.split(/\s+/).filter(Boolean));
const SKIP = set('script style noscript template link meta head title base br wbr source track param area map svg');
const INLINE = set('span b i strong em small u mark sup sub abbr code time label cite q s del ins font bdi bdo kbd samp var data tt');
const WRAPPERS = set('div span center main body html');
const TRANSPARENT = set('div main body html center');
const LEAF_TAGS = set('video iframe select textarea canvas audio object embed');
const STRICT_SEMANTIC = set('header footer nav aside section article form dialog table');
const BLOCK_TAGS = new Set([...STRICT_SEMANTIC, ...set('figure blockquote details video iframe search')]);
const BLOCKISH = set('div section article aside header footer nav ul ol form main figure details table');
const SECTIONING = set('article section aside main');
const NON_CONTENT = set('header footer navigation breadcrumb cookie-banner modal aside search sub-header sub-footer');
const MAX_SKEL_DEPTH = 6;
export const OVERLAY_TYPES = set('modal cookie-banner');
const CONSENT_VENDORS = ['onetrust', 'cookiebot', 'cookieyes', 'usercentrics', 'trustarc', 'didomi', 'quantcast', 'osano',
  'termly', 'iubenda', 'cookiefirst', 'complianz', 'borlabs'];
const COOKIE_TOKENS = set('cookie cookies consent onetrust cookiebot gdpr');
const TOKEN_TYPES = [
  [set('cookie cookies consent onetrust cookiebot gdpr cookiebanner'), 'cookie-banner'],
  [set('modal dialog popup'), 'modal'],
  [set('breadcrumb breadcrumbs'), 'breadcrumb'],
  [set('hero masthead jumbotron'), 'hero'],
  [set('carousel swiper slick splide glide flickity embla slider'), 'carousel'],
  [set('tabs tablist'), 'tabs'],
  [set('accordion faq'), 'accordion'],
  [set('testimonial testimonials'), 'testimonial'],
  [set('gallery masonry'), 'gallery'],
  [set('pricing'), 'pricing'],
  [set('stats counters counter metrics'), 'stats'],
  [set('newsletter subscribe subscription'), 'newsletter-signup'],
  [set('cta callout'), 'cta-banner'],
];
export const HEURISTIC_TYPES = set('hero cta-banner rich-text media content-block');
const NESTED_TOKEN_SKIP = set('hero cta-banner');
const OVERLAY_TOKENS = set('modal dialog popup cookie cookies consent onetrust cookiebot gdpr');
const VIDEO_HOSTS = /youtube|youtu\.be|vimeo|wistia|dailymotion|loom\.com|brightcove|jwplatform|player\./i;
const MAP_HOSTS = /google\.[a-z.]+\/maps|openstreetmap|mapbox|maps\./i;
const ADOPTABLE = set('card-group image-group carousel accordion tabs table form video-embed gallery testimonial search map-embed');

// ------------------------------------------------------------ DOM helpers (domhandler nodes)
const isEl = (n) => !!n && (n.type === 'tag' || n.type === 'script' || n.type === 'style');
const tag = (el) => (isEl(el) ? el.name.toLowerCase() : null);
const attr = (el, k) => (el.attribs && k in el.attribs ? el.attribs[k] : undefined);
const elChildren = (el) => (el.children || []).filter(isEl);
const isHeading = (t) => /^h[1-6]$/.test(t);

function* descendants(el) {
  for (const c of elChildren(el)) {
    yield c;
    yield* descendants(c);
  }
}
const count = (el, pred) => { let n = 0; for (const d of descendants(el)) if (pred(d, tag(d))) n++; return n; };
const hasDesc = (el, pred) => { for (const d of descendants(el)) if (pred(d, tag(d))) return true; return false; };

function* ancestors(el) {
  for (let p = el.parent; p && isEl(p); p = p.parent) yield p;
}

function tokens(el) {
  const s = `${attr(el, 'class') || ''} ${attr(el, 'id') || ''}`.toLowerCase();
  return new Set(s.split(/[^a-z0-9]+/).filter(Boolean));
}
const intersects = (a, b) => { for (const x of a) if (b.has(x)) return true; return false; };

function isOverlay(el) {
  const role = (attr(el, 'role') || '').toLowerCase();
  return role === 'dialog' || role === 'alertdialog' || (attr(el, 'aria-modal') || '').toLowerCase() === 'true'
    || intersects(tokens(el), OVERLAY_TOKENS);
}

function hidden(el) {
  if (tag(el) === 'input' && (attr(el, 'type') || '').toLowerCase() === 'hidden') return true;
  const isHidden = attr(el, 'hidden') !== undefined || /display\s*:\s*none/i.test(attr(el, 'style') || '');
  return isHidden && !isOverlay(el);
}

const kids = (el) => elChildren(el).filter((c) => !SKIP.has(tag(c)) && !hidden(c));

const NON_TEXT = new Set(['script', 'style', 'noscript', 'template']);
function rawText(el) {
  let out = '';
  const walk = (n) => {
    for (const c of n.children || []) {
      if (c.type === 'text') out += c.data;
      else if (isEl(c) && !NON_TEXT.has(tag(c))) walk(c);
    }
  };
  if (!NON_TEXT.has(tag(el))) walk(el);
  return out;
}
const textOf = (el) => rawText(el).split(/\s+/).filter(Boolean).join(' ');
const textLen = (el) => textOf(el).length;

function stats(el) {
  return {
    text_len: textLen(el),
    headings: count(el, (_, t) => isHeading(t)),
    has_h1: count(el, (_, t) => t === 'h1') > 0 || tag(el) === 'h1',
    paragraphs: count(el, (_, t) => t === 'p'),
    links: count(el, (d, t) => t === 'a' && attr(d, 'href') !== undefined),
    buttons: count(el, (d, t) => t === 'button' || (t === 'input' && ['submit', 'button'].includes(attr(d, 'type')))),
    images: count(el, (_, t) => ['img', 'picture', 'svg'].includes(t)),
    media: count(el, (_, t) => ['video', 'iframe', 'audio'].includes(t)),
    inputs: count(el, (d, t) => (t === 'input' && attr(d, 'type') !== 'hidden') || t === 'select' || t === 'textarea'),
    list_items: count(el, (_, t) => t === 'li'),
  };
}

function cssPath(el) {
  const parts = [];
  let cur = el;
  while (cur && isEl(cur) && tag(cur) !== 'html') {
    const t = tag(cur);
    const id = attr(cur, 'id');
    if (id && /^[A-Za-z_][\w-]{0,40}$/.test(id) && !/\d{4,}/.test(id)) {
      parts.push(`${t}#${id}`);
      break;
    }
    const parent = cur.parent;
    if (!parent || !isEl(parent)) {
      parts.push(t);
    } else {
      const same = (parent.children || []).filter((s) => isEl(s) && tag(s) === t);
      parts.push(same.length === 1 ? t : `${t}:nth-of-type(${same.indexOf(cur) + 1})`);
    }
    cur = parent;
  }
  return parts.reverse().join(' > ');
}

function xpathOf(el) {
  const parts = [];
  for (let cur = el; cur && isEl(cur); cur = cur.parent) {
    const t = tag(cur);
    const same = (cur.parent?.children || []).filter((s) => isEl(s) && tag(s) === t);
    parts.push(`${t}[${same.indexOf(cur) + 1}]`);
  }
  return `/${parts.reverse().join('/')}`;
}

// ------------------------------------------------------------ skeleton / signature
const FLOW_RE = /^(?:(?:h|p)(?:\(a\*?\))?|t|hr|pre|(?:ul|ol)(?:\(li\*?\))?)$/;

function mergeFlow(parts) {
  const out = [];
  for (const part of parts) {
    const tok = FLOW_RE.test(part) ? 'flow' : part;
    if (tok === 'flow' && out.length && out[out.length - 1] === 'flow') continue;
    out.push(tok);
  }
  return out;
}

function collapse(parts) {
  const out = [];
  let i = 0;
  while (i < parts.length) {
    let j = i;
    while (j + 1 < parts.length && parts[j + 1] === parts[i]) j++;
    out.push(parts[i] + (j > i ? '*' : ''));
    i = j + 1;
  }
  return out;
}

export function skeleton(el, depth = 0, skip = null) {
  if (skip && skip.has(el)) return '';
  const t = tag(el);
  if (t === null) return '';
  if (t === 'svg') return 'svg';
  if (t === 'img' || t === 'picture') return 'img';
  if (t === 'input') return `input:${(attr(el, 'type') || 'text').toLowerCase()}`;
  const base = isHeading(t) ? 'h' : t;
  if (LEAF_TAGS.has(t)) return base;
  let parts = depth < MAX_SKEL_DEPTH ? kids(el).map((k) => skeleton(k, depth + 1, skip)).filter(Boolean) : [];
  parts = mergeFlow(parts);
  const hasText = parts.length === 0 ? textOf(el).length > 0 : true;
  if (INLINE.has(t)) {
    if (!parts.length) return '';
    return parts.length === 1 ? parts[0] : collapse(parts).join('+');
  }
  if (WRAPPERS.has(t) && !['main', 'body', 'html'].includes(t)) {
    if (parts.length === 1) return parts[0];
    if (!parts.length) return hasText ? 't' : '';
  }
  if (!parts.length) return base;
  return `${base}(${collapse(parts).slice(0, 40).join(',')})`;
}

const hash = (s) => createHash('sha1').update(s).digest('hex').slice(0, 10);

function mostCommon(arr) {
  const m = new Map();
  for (const x of arr) m.set(x, (m.get(x) || 0) + 1);
  let best = null;
  for (const [k, v] of m) if (best === null || v > best[1]) best = [k, v];
  return best;
}

// ------------------------------------------------------------ repeated groups
function groupInfo(el) {
  if (['main', 'body', 'html'].includes(tag(el))) return null;
  const ks = kids(el);
  if (ks.length < 3) return null;
  const skels = ks.map((k) => skeleton(k));
  const [common, n] = mostCommon(skels);
  if (n < 3 || n / ks.length < 0.8 || !common) return null;
  const items = ks.filter((_, i) => skels[i] === common);
  if (items.some((k) => ['section', 'header', 'footer', 'nav', 'form', 'aside', 'main'].includes(tag(k)))) return null;
  const avgText = items.reduce((a, k) => a + textLen(k), 0) / n;
  if (avgText > 600) return null;
  const imgCount = (k) => count(k, (_, t) => ['img', 'picture', 'svg'].includes(t));
  const imgOnly = avgText < 25 && items.every((k) => imgCount(k) > 0);
  const hasHeading = items.filter((k) => count(k, (_, t) => isHeading(t)) > 0).length >= n * 0.5;
  const hasLink = items.filter((k) => count(k, (d, t) => t === 'a' && attr(d, 'href') !== undefined) > 0).length >= n * 0.5;
  const expandable = items.filter((k) => hasDesc(k, (d, t) => (t === 'button' && attr(d, 'aria-expanded') !== undefined) || t === 'summary')).length >= n * 0.8;
  return {
    count: n,
    item_skeleton: common,
    avg_text: avgText,
    img_only: imgOnly,
    has_heading: hasHeading,
    has_link: hasLink,
    expandable,
    list_like: ['ul', 'ol'].includes(tag(el)) && !hasHeading && count(el, (_, t) => t === 'img' || t === 'picture') === 0,
  };
}

function groupType(g) {
  if (g.expandable) return 'accordion';
  if (g.img_only) return 'image-group';
  if (g.list_like) return 'list-group';
  if (g.has_heading || (g.has_link && g.avg_text > 40)) return 'card-group';
  return null;
}

// ------------------------------------------------------------ typing
function ownType(el) {
  const t = tag(el);
  const role = (attr(el, 'role') || '').toLowerCase();
  const toks = tokens(el);
  const sectioned = [...ancestors(el)].some((a) => SECTIONING.has(tag(a)));
  const src = attr(el, 'src') || attr(el, 'data-src') || '';

  if (t === 'header' || role === 'banner') return [sectioned ? 'sub-header' : 'header', 'tag'];
  if (t === 'footer' || role === 'contentinfo') return [sectioned ? 'sub-footer' : 'footer', 'tag'];
  if (t === 'nav' || role === 'navigation') {
    const label = (attr(el, 'aria-label') || '').toLowerCase();
    if (label.includes('breadcrumb') || toks.has('breadcrumb') || toks.has('breadcrumbs')) return ['breadcrumb', 'attr'];
    return ['navigation', 'tag'];
  }
  if (t === 'aside' || role === 'complementary') return ['aside', 'tag'];
  if (t === 'table' && count(el, (_, x) => x === 'tr') >= 2) return ['table', 'tag'];
  if (t === 'blockquote') return ['quote', 'tag'];
  if (t === 'video' || (t === 'iframe' && VIDEO_HOSTS.test(src))) return ['video-embed', 'tag'];
  if (t === 'iframe' && MAP_HOSTS.test(src)) return ['map-embed', 'tag'];
  if (t === 'iframe') return ['embed', 'tag'];
  if (t === 'dialog' || role === 'dialog' || role === 'alertdialog' || (attr(el, 'aria-modal') || '').toLowerCase() === 'true') {
    return [intersects(toks, COOKIE_TOKENS) ? 'cookie-banner' : 'modal', 'attr'];
  }
  if (role === 'search' || (t === 'form' && hasDesc(el, (d, x) => x === 'input' && attr(d, 'type') === 'search'))) return ['search', 'attr'];
  if (role === 'tablist') return ['tabs', 'attr'];
  if ((attr(el, 'aria-roledescription') || '').toLowerCase() === 'carousel' || attr(el, 'data-ride') === 'carousel') return ['carousel', 'attr'];
  if (t === 'form') return ['form', 'tag'];

  if (BLOCKISH.has(t)) {
    for (const [tokenSet, ttype] of TOKEN_TYPES) if (intersects(toks, tokenSet)) return [ttype, 'token'];
  }
  if (BLOCKISH.has(t)) {
    if (kids(el).filter((k) => tag(k) === 'details').length >= 2) return ['accordion', 'structure'];
    const g = groupInfo(el);
    if (g) {
      const gt = groupType(g);
      if (gt) return [gt, 'structure'];
    }
  }
  return null;
}

function nestedFeatures(block, inChrome) {
  const found = [];
  const rec = (el) => {
    for (const k of kids(el)) {
      const own = ownType(k);
      if (own && !NESTED_TOKEN_SKIP.has(own[0])
        && !(inChrome && ['header', 'footer', 'navigation', 'sub-header', 'sub-footer', 'aside'].includes(own[0]))
        && !['header', 'footer'].includes(own[0])) {
        const ftype = own[0];
        if (ftype === 'list-group' || (inChrome && ['card-group', 'image-group'].includes(ftype))) {
          rec(k);
          continue;
        }
        found.push([k, ftype, own[1]]);
        continue;
      }
      rec(k);
    }
  };
  rec(block);
  return found;
}

// ------------------------------------------------------------ block discovery
function isBlock(el) {
  const t = tag(el);
  const role = (attr(el, 'role') || '').toLowerCase();
  if (BLOCK_TAGS.has(t) || ['banner', 'contentinfo', 'navigation', 'complementary', 'search', 'dialog', 'alertdialog', 'tablist'].includes(role)) return true;
  const own = ownType(el);
  return own !== null && ['token', 'attr', 'structure'].includes(own[1]);
}

function isWrapperBlock(el) {
  if (!['section', 'article'].includes(tag(el))) return false;
  return kids(el).filter(isBlock).length >= 2;
}

const holdsBlocks = (el) => hasDesc(el, (_, t) => STRICT_SEMANTIC.has(t));

function meaningful(els) {
  for (const e of els) {
    if (textLen(e) >= 40) return true;
    if (hasDesc(e, (d, t) => ['img', 'picture', 'video', 'iframe', 'svg', 'input', 'button'].includes(t) || (t === 'a' && attr(d, 'href') !== undefined))) return true;
    if (['img', 'picture', 'video', 'iframe', 'svg', 'figure'].includes(tag(e))) return true;
  }
  return false;
}

export function findBlocks(body) {
  const out = [];
  const add = (el, why) => out.push([el, why]);
  const descend = (el, depth) => {
    if (depth > 14) { add(el, 'depth'); return; }
    if (!['body', 'main', 'html'].includes(tag(el))) {
      const g = groupInfo(el);
      if (g && groupType(g)) { add(el, 'repeated'); return; }
    }
    const ks = kids(el);
    let loose = [];
    const flush = () => {
      if (loose.length && meaningful(loose)) {
        if (loose.length === ks.length && !['body', 'html'].includes(tag(el))) add(el, 'content');
        else add(loose[0], 'loose');
      }
      loose = [];
    };
    for (const kid of ks) {
      const t = tag(kid);
      if (isBlock(kid)) {
        flush();
        if (isWrapperBlock(kid)) descend(kid, depth + 1);
        else add(kid, 'block');
      } else if (TRANSPARENT.has(t)) {
        flush();
        if (ks.length === 1 || holdsBlocks(kid)) descend(kid, depth + 1);
        else if (meaningful([kid])) add(kid, 'fanout');
      } else {
        loose.push(kid);
      }
    }
    flush();
  };
  descend(body, 0);
  const seen = new Set();
  return out.filter(([el]) => (seen.has(el) ? false : (seen.add(el), true)));
}

// ------------------------------------------------------------ classification
function classifyBlock(el, contentIndex) {
  const own = ownType(el);
  const st = stats(el);
  let chrome = false;
  let nested = [];
  let btype = null;
  let basis = '';
  if (own) {
    [btype, basis] = own;
    chrome = ['header', 'footer', 'navigation', 'sub-header', 'sub-footer'].includes(btype);
    if (!ADOPTABLE.has(btype) || btype === 'form') nested = nestedFeatures(el, chrome);
  } else {
    nested = nestedFeatures(el, false);
  }

  if (btype === null) {
    const adoptable = nested.filter((n) => ADOPTABLE.has(n[1]));
    if (adoptable.length === 1) {
      const [nel, ntype] = adoptable[0];
      const nst = stats(nel);
      const outsideOther = (st.images - nst.images) + (st.media - nst.media) + (st.inputs - nst.inputs);
      if (outsideOther === 0 && nested.length === 1) {
        btype = ntype;
        basis = 'nested';
        nested = [];
      }
    }
  }

  if (btype === null) {
    if (contentIndex === 0 && st.headings > 0 && st.paragraphs <= 3 && st.text_len < 600 && (st.images + st.media > 0 || st.links + st.buttons > 0)) {
      [btype, basis] = ['hero', 'structure'];
    } else if (contentIndex > 0 && st.headings >= 1 && st.links + st.buttons >= 1 && st.links + st.buttons <= 3
      && st.paragraphs <= 2 && st.text_len < 300 && st.list_items === 0) {
      [btype, basis] = ['cta-banner', 'structure'];
    } else if (st.text_len >= 200 && st.paragraphs + st.list_items + st.headings >= 3 && (st.paragraphs >= 2 || tag(el) === 'article')) {
      [btype, basis] = ['rich-text', 'structure'];
    } else if (st.text_len < 60 && st.images + st.media > 0) {
      [btype, basis] = ['media', 'structure'];
    } else {
      [btype, basis] = ['content-block', 'fallback'];
    }
  }

  const skel = skeleton(el, 0, new Set(nested.map((n) => n[0])));
  // Position/length heuristics may flip between pages sharing a template: such signatures use the neutral prefix.
  const prefix = HEURISTIC_TYPES.has(btype) && ['structure', 'fallback'].includes(basis) ? 'blk' : btype;
  return { type: btype, basis, skeleton: skel, signature: `${prefix}-${hash(skel)}`, stats: st, nested };
}

function vendorSignature(el, info) {
  if (info.type !== 'cookie-banner') return;
  const ident = `${attr(el, 'id') || ''} ${attr(el, 'class') || ''}`.toLowerCase();
  for (const v of CONSENT_VENDORS) {
    if (ident.includes(v)) { info.signature = `cookie-banner-${v}`; return; }
  }
}

function describe(el, info, index, nestedIn) {
  const st = info.stats;
  return {
    index,
    type: info.type,
    basis: info.basis, // tag/attr (high) > token (medium) > structure/nested (low) > fallback
    signature: info.signature,
    tag: tag(el),
    selector: cssPath(el),
    xpath: xpathOf(el),
    classes: (attr(el, 'class') || '').split(/\s+/).filter(Boolean).slice(0, 8),
    id: attr(el, 'id') || null,
    text_len: st.text_len,
    text_sample: textOf(el).slice(0, 80),
    links: st.links,
    images: st.images,
    headings: st.headings,
    skeleton: info.skeleton.slice(0, 300),
    nested_in: nestedIn,
  };
}

// ------------------------------------------------------------ public API
export function scanHtml(html, url = '') {
  const warnings = [];
  const $ = cheerio.load(html);
  const body = $('body').get(0);
  if (!body) return { url, title: '', components: [], signatures: [], counts: {}, warnings: ['no <body>'] };
  const title = ($('title').first().text() || '').trim();

  const raw = []; // [info, element, parentRawIndex|null]
  let contentIndex = 0;
  for (const [el] of findBlocks(body)) {
    const info = classifyBlock(el, contentIndex);
    if (!NON_CONTENT.has(info.type)) contentIndex++;
    vendorSignature(el, info);
    const wrapperOnly = HEURISTIC_TYPES.has(info.type) && info.skeleton === '' && info.nested.length > 0;
    let parent = null;
    if (!wrapperOnly) {
      raw.push([info, el, null]);
      parent = raw.length - 1;
    }
    for (const [nel, ntype, nbasis] of info.nested) {
      const nskel = skeleton(nel);
      const ninfo = { type: ntype, basis: nbasis, skeleton: nskel, signature: `${ntype}-${hash(nskel)}`, stats: stats(nel) };
      vendorSignature(nel, ninfo);
      raw.push([ninfo, nel, parent]);
    }
  }

  // An overlay inside another overlay is one widget.
  const overlayEls = new Set(raw.filter(([i]) => OVERLAY_TYPES.has(i.type)).map(([, el]) => el));
  const keep = [];
  raw.forEach(([info, el], i) => {
    if (OVERLAY_TYPES.has(info.type) && [...ancestors(el)].some((a) => overlayEls.has(a))) return;
    keep.push(i);
  });
  const newIndex = new Map(keep.map((old, n) => [old, n]));
  const components = keep.map((old) => {
    const [info, el, parent] = raw[old];
    return describe(el, info, newIndex.get(old), parent !== null ? newIndex.get(parent) ?? null : null);
  });

  if (!components.length) warnings.push('no components detected');
  const counts = {};
  for (const c of components) counts[c.type] = (counts[c.type] || 0) + 1;
  return { url, title, components, signatures: [...new Set(components.map((c) => c.signature))].sort(), counts, warnings };
}

// Client-side-rendering shell detection (used on rendered HTML as a sanity check).
const ROOT_IDS = ['root', 'app', '__next', '__nuxt', '___gatsby', 'svelte'];
export function looksLikeShell(html) {
  if (!html.trim()) return [true, 'empty response'];
  const $ = cheerio.load(html);
  const body = $('body').get(0);
  if (!body) return [true, 'no <body>'];
  const nScripts = $('script').length;
  for (const id of ROOT_IDS) {
    const el = $(`#${id}`).get(0);
    if (el && elChildren(el).length === 0 && !(el.children || []).some((c) => c.type === 'text' && c.data.trim())) {
      return [true, `empty #${id} container`];
    }
  }
  const text = textOf(body);
  if (text.length < 150 && nScripts >= 3) return [true, `only ${text.length} chars of text with ${nScripts} scripts`];
  return [false, ''];
}

const BLOCK_MARKERS = ['just a moment...', 'cf-browser-verification', 'attention required! | cloudflare',
  'enable javascript and cookies to continue', 'px-captcha', 'datadome', 'access denied'];
export function looksBlocked(status, html) {
  if ([401, 403, 429, 503].includes(status)) return true;
  const low = html.slice(0, 30000).toLowerCase();
  return html.length < 60000 && BLOCK_MARKERS.some((m) => low.includes(m));
}

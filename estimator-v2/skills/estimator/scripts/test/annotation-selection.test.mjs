import test from 'node:test';
import assert from 'node:assert/strict';
import { selectAnnotations } from '../lib/annotation-selection.mjs';

const box = (x = 0, y = 0, w = 100, h = 80) => ({ x, y, w, h });
const rect = (s, b = box(), extra = {}) => ({ s, ...b, visibleBox: b, paintedVisible: true, ...extra });
const component = (id, selector, b = box(), level = 1) => ({ id, name: id, domSelector: selector, box: b, level, validation: { role: 'component', countInBuildList: true } });
const select = (html, rects, components = [], extra = {}) => selectAnnotations({ html, rects, components, width: 1000, height: 1000, ...extra });

test('service tiles, their own actions and footer groups survive separately from CMS counts', () => {
  const html = `<section id="services"><div>${[1, 2, 3, 4, 5, 6].map(i => `<a id="tile${i}" href="/service/${i}"><svg><path/></svg><h3>Service ${i}</h3><p>Description</p></a>`).join('')}</div><a id="cta" href="/all">All services</a></section><footer id="footer"><div id="groups"><div id="company"><h3>Company</h3><a href="/a">About</a><a href="/b">Contact</a></div><div id="support"><h3>Support</h3><a href="/c">Help</a><a href="/d">FAQ</a></div></div><a id="login" class="button" href="/login">Login</a></footer>`;
  const components = [component('Services', '#services', box(0, 0, 1000, 400)), component('Footer', '#footer', box(0, 500, 1000, 300))];
  const rects = [rect('#services', components[0].box), rect('#footer', components[1].box), ...[1, 2, 3, 4, 5, 6].map((i) => rect(`#tile${i}`, box(i * 120, 50, 100, 100))), rect('#cta', box(20, 300)), rect('#groups', box(0, 520, 900, 200)), rect('#company', box(0, 520, 300, 200)), rect('#support', box(400, 520, 300, 200)), rect('#login', box(800, 750))];
  const before = structuredClone(components);
  const out = select(html, rects, components);
  assert.equal(out.version, 1);
  const tiles = out.items.filter(i => i.kind === 'component' && i.annotationOnly);
  assert.equal(tiles.length, 6);
  assert.equal(tiles.every(i => i.ownerId === out.items.find(i => i.sourceDetectionId === 'Services').id), true);
  assert.equal(tiles.every(i => i.actions?.[0]?.destination.startsWith('/service/')), true);
  assert.equal(out.items.filter(i => i.kind === 'action').length, 2);
  assert.equal(out.items.filter(i => i.kind === 'group').length, 2);
  assert.deepEqual(out.items.map(i => i.displayId), ['R01', 'I01', 'I02', 'I03', 'I04', 'I05', 'I06', 'CTA01', 'R02', 'G01', 'G02', 'CTA02']);
  assert.equal(new Set(out.items.map(i => i.displayId)).size, out.items.length);
  assert.equal(out.items.some(i => i.selector === '#groups'), false);
  assert.deepEqual(components, before);
  assert.deepEqual(select(html, rects, components), out);
});

test('a different article-grid structure recovers nearest item roots and owned CTA rows', () => {
  const html = `<main id="page"><ul id="news"><li><article id="story1"><img src="one.jpg"><h2>One</h2><p>Summary</p><div><a id="read1" href="/one">Read</a><button id="save1">Save</button></div></article></li><li><article id="story2"><img src="two.jpg"><h2>Two</h2><p>Summary</p><div><a id="read2" href="/two">Read</a><button id="save2">Save</button></div></article></li></ul></main>`;
  const rects = [rect('#page', box(0, 0, 1000, 700)), rect('#story1', box(10, 20, 400, 500)), rect('#story2', box(500, 20, 400, 500)), rect('#read1', box(30, 400, 100, 40)), rect('#save1', box(150, 400, 100, 40)), rect('#read2', box(520, 400, 100, 40)), rect('#save2', box(650, 400, 100, 40))];
  const out = select(html, rects, [component('Main', '#page', box(0, 0, 1000, 700))]);
  const cards = out.items.filter(i => i.kind === 'component');
  assert.equal(cards.length, 2);
  assert.equal(out.items.filter(i => i.kind === 'action').length, 4);
  for (const action of out.items.filter(i => i.kind === 'action')) assert.ok(cards.some(c => c.id === action.ownerId));
});

test('article prose, headings, inline images and raster contents do not become cards or actions', () => {
  const html = `<article id="body"><div id="para1"><h2>Heading</h2><p>Text <a id="inline" href="/x">inline link</a></p><img id="inline-image"></div><div id="para2"><h2>Heading</h2><p>Text</p><img></div><ul><li>One</li><li>Two</li></ul><img id="raster" alt="Six illustrated tiles"><form id="widget"><input id="search"><button id="submit">Search</button></form></article>`;
  const rects = ['#body', '#para1', '#para2', '#inline', '#inline-image', '#raster', '#widget', '#search', '#submit'].map((s, i) => rect(s, box(i * 10, i * 10)));
  const out = select(html, rects, [component('Article', '#body'), component('Search', '#widget', box(60, 60), 2)]);
  assert.equal(out.items.filter(i => i.kind === 'component').length, 1);
  assert.equal(out.items.some(i => ['#inline', '#inline-image', '#raster', '#para1', '#para2'].includes(i.selector)), false);
  assert.equal(out.items.filter(i => i.kind === 'action').length, 2);
});

test('recorded clipping wins over full DOM/model boxes and hidden/off-image nodes are omitted', () => {
  const html = '<section id="slider"><div><a id="one" href="/1"><img><h2>One</h2></a><a id="two" href="/2"><img><h2>Two</h2></a><a id="three" href="/3"><img><h2>Three</h2></a></div><button id="hidden">Hidden</button></section>';
  const rects = [rect('#slider', box(0, 0, 300, 200)), rect('#one', box(-50, 10, 150, 150), { visibleBox: box(0, 10, 100, 150) }), rect('#two', box(200, 10, 150, 150), { visibleBox: box(200, 10, 100, 150) }), rect('#three', box(400, 10, 150, 150), { visibleBox: box(400, 10, 0, 150), paintedVisible: false }), rect('#hidden', box(), { paintedVisible: false })];
  const out = select(html, rects, [component('Slider', '#slider', box(0, 0, 999, 999))]);
  assert.deepEqual(out.items.find(i => i.sourceDetectionId === 'Slider').box, box(0, 0, 300, 200));
  assert.deepEqual(out.items.filter(i => i.kind === 'component').map(i => i.box), [box(0, 10, 100, 150), box(200, 10, 100, 150)]);
  assert.equal(out.items.some(i => ['#three', '#hidden'].includes(i.selector)), false);
  assert.equal(out.items.every(i => i.box.x >= 0 && i.box.y >= 0 && i.box.x + i.box.w <= 1000 && i.box.y + i.box.h <= 1000), true);
});

test('legacy style evidence clips axes independently and explicitly reports unknown visibility', () => {
  const html = '<section id="frame"><div id="a"><h3>A</h3><p>Text</p></div><div id="b"><h3>B</h3><p>Text</p></div></section>';
  const rects = [{ s: '#frame', ...box(10, 20, 100, 200) }, { s: '#a', ...box(-20, -10, 100, 100) }, { s: '#b', ...box(100, 50, 100, 100) }];
  const out = select(html, rects, [], { evidence: { nodes: [{ selector: '#frame', styleId: 'clip', box: box(10, 20, 100, 200) }], styles: { clip: { 'overflow-x': 'hidden', 'overflow-y': 'visible' } } } });
  assert.deepEqual(out.items.find(i => i.selector === '#a').box, box(10, 0, 70, 90));
  assert.deepEqual(out.items.find(i => i.selector === '#b').box, box(100, 50, 10, 100));
  assert.ok(out.warnings.some(w => /visibility.*unknown/i.test(w)));
});

test('safe typed selectors, duplicate IDs, legacy bounds, nearest ownership and stable IDs', () => {
  const html = '<section id="same"><div id="same"><a href="/1"><h3>One</h3><p>Text</p></a></div><div id="same"><a href="/2"><h3>Two</h3><p>Text</p></a></div></section>';
  const root = 'html > body > section', first = `${root} > div:nth-of-type(1) > a`, second = `${root} > div:nth-of-type(2) > a`;
  const cs = [component('same', root, box(0, 0, 900, 900)), component('same', first, box(20, 20, 100, 100), 2)];
  const out = select(html, [rect(first, box(20, 20, 100, 100)), rect(second, box(200, 20, 100, 100))], cs);
  assert.equal(new Set(out.items.map(i => i.id)).size, out.items.length);
  assert.equal(out.items.length, 3);
  assert.equal(out.items.find(i => i.selector === second).ownerId, out.items.find(i => i.selector === root).id);
  assert.ok(out.warnings.some(w => /legacy|missing.*rect/i.test(w)));
  assert.deepEqual(select(html, [], [cs[0]]).items[0].box, cs[0].box);
  const reversed = select(html, [rect(second, box(200, 20, 100, 100)), rect(first, box(20, 20, 100, 100))], [...cs].reverse());
  assert.deepEqual(out.items.map(i => i.id), reversed.items.map(i => i.id));
});

test('bounded recovery emits a warning and invalid image dimensions fail closed', () => {
  const html = `<section>${Array.from({ length: 1510 }, (_, i) => `<a id="c${i}" href="/${i}"><h3>Title</h3><p>Text</p></a>`).join('')}</section>`;
  const rects = Array.from({ length: 1510 }, (_, i) => rect(`#c${i}`));
  const out = select(html, rects);
  assert.equal(out.items.length, 1500);
  assert.ok(out.warnings.some(w => /1500|limit|truncat/i.test(w)));
  const invalid = select(html, rects, [], { width: 0 });
  assert.equal(invalid.items.length, 0);
  assert.ok(invalid.warnings.length);
});

test('role-based chrome groups hide ordinary links while independent widgets retain their controls', () => {
  const html = '<div role="contentinfo" id="chrome"><div id="links"><h3>Links</h3><a id="plain" href="/a">About</a><a href="/b">Terms</a></div><form id="signup"><label>Email<input id="email"></label><button id="join">Join</button></form></div>';
  const rects = ['#chrome', '#links', '#plain', '#signup', '#email', '#join'].map((s, i) => rect(s, box(i * 10, i * 10)));
  const out = select(html, rects, [component('Footer', '#chrome')]);
  const form = out.items.find(i => i.selector === '#signup');
  assert.equal(form.kind, 'component');
  assert.equal(out.items.find(i => i.selector === '#links').kind, 'group');
  assert.equal(out.items.some(i => i.selector === '#plain'), false);
  assert.equal(out.items.filter(i => i.kind === 'action').every(i => i.ownerId === form.id), true);
});

test('coincident wrapper and anchor collapse, while a smaller CTA has its own annotation', () => {
  const html = '<section id="section"><div id="promo"><a id="whole" href="/offer"><img><h2>Offer</h2></a><a id="small" href="/terms">Terms</a></div></section>';
  const rects = [rect('#section', box(0, 0, 500, 500)), rect('#promo', box(10, 10, 300, 300)), rect('#whole', box(10, 10, 300, 300)), rect('#small', box(10, 270, 80, 20))];
  const out = select(html, rects, [component('Section', '#section', rects[0]), component('Promo', '#promo', rects[1], 2)]);
  assert.equal(out.items.length, 3);
  const promo = out.items.find(i => i.sourceDetectionId === 'Promo');
  assert.equal(promo.actions[0].destination, '/offer');
  assert.equal(out.items.find(i => i.selector === '#small').ownerId, promo.id);
});

test('saved hidden styles and impossible selectors never gain inferred boxes', () => {
  const html = '<section id="s"><div style="display:none"><button id="hidden">No</button></div><div id="paint" style="opacity:0"><button id="transparent">No</button></div><button id="off">Off-image</button><svg><a id="vectorlink" href="/raster">Embedded shape</a></svg></section>';
  const rects = ['#hidden', '#transparent', '#vectorlink'].map(s => rect(s));
  rects.push(rect('#off', box(2000, 2000)));
  const out = select(html, rects, [component('Missing', '#not-a-node'), component('Invalid', '[bad[')]);
  assert.equal(out.items.length, 0);
  assert.equal(out.warnings.filter(w => /no unique saved DOM/.test(w)).length, 2);
});

test('legacy validated bounds remain model bounds even when a style sample has different geometry', () => {
  const html = '<section id="s"><button id="b">Go</button></section>';
  const out = select(html, [], [component('Section', '#s', box(-10, 0, 200, 100))], { evidence: { nodes: [{ selector: '#s', box: box(50, 50, 300, 300), styleId: 'visible' }, { selector: '#b', box: box(10, 10, 50, 30), styleId: 'visible' }], styles: { visible: { display: 'block' } } } });
  assert.deepEqual(out.items[0].geometry.sourceBox, box(-10, 0, 200, 100));
  assert.deepEqual(out.items[0].box, box(0, 0, 190, 100));
  assert.equal(out.items[1].kind, 'action');
  assert.equal(out.items[1].ownerId, out.items[0].id);
});

test('footer headings and their single link list form one group without wrapping multiple columns', () => {
  const html = '<footer id="f"><div id="columns"><div id="a"><h3>Company</h3><ul id="list-a"><li><a href="/1">One</a></li><li><a href="/2">Two</a></li></ul></div><div id="b"><h3>Help</h3><ul id="list-b"><li><a href="/3">Three</a></li><li><a href="/4">Four</a></li></ul></div></div></footer>';
  const rects = ['#f', '#columns', '#a', '#b', '#list-a', '#list-b'].map((s, i) => rect(s, box(i * 10, i * 10)));
  const out = select(html, rects, [component('Footer', '#f')]);
  assert.deepEqual(out.items.filter(i => i.kind === 'group').map(i => i.selector), ['#a', '#b']);
});

test('identical rich-text block structures do not bypass ancestor article or prose context', () => {
  const block = (id, title) => `<div id="${id}"><h2>${title}</h2><p>Paragraph</p><img></div>`;
  for (const outer of ['article', 'div class="prose"']) {
    const html = `<${outer}>${block('one', 'One')}${block('two', 'Two')}</${outer.split(' ')[0]}>`;
    const out = select(html, [rect('#one'), rect('#two')]);
    assert.equal(out.items.length, 0, outer);
  }
});

test('footer columns allow transparent wrappers around links without losing the group', () => {
  const html = '<footer id="f"><div id="columns"><div id="company"><h3>Company</h3><div><a href="/about">About</a></div><div><a href="/contact">Contact</a></div></div><div id="help"><h3>Help</h3><div><span><a href="/faq">FAQ</a></span></div><div><span><a href="/help">Help</a></span></div></div></div></footer>';
  const rects = ['#f', '#columns', '#company', '#help'].map(s => rect(s));
  const out = select(html, rects, [component('Footer', '#f')]);
  assert.deepEqual(out.items.filter(i => i.kind === 'group').map(i => i.selector), ['#company', '#help']);
  assert.equal(out.items.filter(i => i.kind === 'action').length, 0);
});

test('visible descendants override ancestor visibility while ancestor opacity/display still suppress painting', () => {
  const html = '<div style="visibility:hidden"><button id="recorded" style="visibility:visible">Visible</button><button id="legacy" style="visibility:visible">Legacy visible</button><button id="inherited">Hidden</button></div><div style="opacity:0"><button id="opaque">Invisible</button></div><div style="display:none"><button id="none">Invisible</button></div>';
  const out = select(html, [rect('#recorded'), { s: '#legacy', ...box() }, { s: '#inherited', ...box() }, rect('#opaque'), rect('#none')]);
  assert.deepEqual(out.items.map(i => i.selector), ['#recorded', '#legacy']);
});

test('wrapped linked tiles use div text fields and ignore varying decorative SVG internals', () => {
  const tile = i => `<div><a id="tile${i}" href="/product/${i}"><div><svg><style>.icon{fill:red}</style><title>Decorative icon</title>${'<path/>'.repeat(i)}<circle/></svg></div><div id="content${i}"><div id="titlebar${i}"><div>Product ${i}</div><div><svg><path/></svg></div></div><div>Description ${i} with <strong>formatting</strong></div></div></a></div>`;
  const html = `<section id="hero"><div id="row1">${[1, 2, 3].map(tile).join('')}</div><div id="row2">${[4, 5, 6].map(tile).join('')}</div><a id="simple" href="/next"><svg><path/></svg><span>Next <strong>page</strong></span></a></section>`;
  const rects = [rect('#hero', box(0, 0, 900, 900)), rect('#row1', box(0, 40, 900, 220)), rect('#row2', box(0, 270, 900, 220)), ...[1, 2, 3, 4, 5, 6].flatMap(i => [rect(`#tile${i}`, box(i * 100, 50, 90, 200)), rect(`#content${i}`, box(i * 100, 80, 80, 160)), rect(`#titlebar${i}`, box(i * 100, 80, 80, 40))]), rect('#simple', box(10, 400, 150, 50))];
  const out = select(html, rects, [component('Hero', '#hero', box(0, 0, 900, 900))]);
  assert.deepEqual(out.items.filter(i => i.kind === 'component').map(i => i.selector), [1, 2, 3, 4, 5, 6].map(i => `#tile${i}`));
  assert.equal(out.items.filter(i => i.kind === 'action').length, 1);
  assert.equal(out.items.filter(i => i.kind === 'component').every(i => i.actions?.length === 1 && i.annotationOnly === true), true);
  assert.deepEqual(out.items.filter(i => i.kind === 'component').map(i => i.name), [1, 2, 3, 4, 5, 6].map(i => `Product ${i}`));
  assert.equal(JSON.stringify(out.items).includes('fill:red'), false);
});

test('repeated inline image-caption links inside a paragraph remain prose', () => {
  const html = '<section><p>Compare <a id="inline1" href="/one"><img><span>One</span></a> and <a id="inline2" href="/two"><img><span>Two</span></a>.</p></section>';
  assert.equal(select(html, [rect('#inline1'), rect('#inline2')]).items.length, 0);
});

test('repeated raster icon actions with a single inline label do not recover as cards', () => {
  const html = '<section><a id="one" class="btn" href="/one"><img width="16" height="16"><span>Download one</span></a><a id="two" class="btn" href="/two"><img width="16" height="16"><span>Download two</span></a></section>';
  const out = select(html, [rect('#one'), rect('#two')]);
  assert.deepEqual(out.items.map(i => i.kind), ['action', 'action']);
});


import test from 'node:test';
import assert from 'node:assert/strict';
import { refineComponents, isImplementationComponent } from '../lib/componentvalidation.mjs';

const box = (x = 0, y = 0, w = 100, h = 100) => ({ x, y, w, h });
const component = (id, selector, b = box(), parent = null, name = id) => ({ id, name, domSelector: selector, box: b, parent, level: parent ? 2 : 1, contains: ['title', 'image'], reusable: true, source: 'llm' });
const roles = (r) => r.components.map((c) => c.validation.role);
function run(html, components, extra = {}) {
    return refineComponents(components, { html, rects: components.map((c) => ({ s: c.domSelector, ...c.box })), ...extra });
}

test('team grid and independently implemented cards remain separate families', () => {
    const html = '<section id="team"><div id="card"><img><h3>Ada</h3><p>Engineer</p></div><div><img><h3>Grace</h3></div></section>';
    const r = run(html, [component('TeamGrid', '#team'), component('TeamCard', '#card', box(5, 5, 40, 80), 'TeamGrid'), component('Portrait', '#card img', box(10, 10, 20, 20), 'TeamCard')]);
    assert.deepEqual(roles(r), ['component', 'component', 'part']);
    assert.equal(r.components[2].validation.ownerId, 'TeamCard');
    assert.equal(r.counts.counted, 2);
});

test('text-only team cards count from repeated sibling structure; repeated article prose stays content', () => {
    const html = '<section id="grid"><div id="card"><h3>Ada</h3><p>Engineer</p></div><div><h3>Grace</h3><p>Engineer</p></div></section><article id="article"><div id="prose"><h3>Subheading</h3><p>Paragraph</p></div><div><h3>Subheading</h3><p>Paragraph</p></div></article>';
    const r = run(html, [component('TeamGrid', '#grid'), component('TeamCard', '#card', box(5, 5, 40, 80), 'TeamGrid'), component('Article', '#article', box(0, 110, 100, 100)), component('ParagraphWrapper', '#prose', box(5, 115, 40, 80), 'Article')]);
    assert.deepEqual(roles(r), ['component', 'component', 'component', 'content']);
    assert.equal(r.components[1].validation.basis.includes('repeated-sibling-composite'), true);
    assert.equal(r.components[3].validation.ownerId, 'Article');
    const ordinary = run('<section id="owner"><div id="prose"><h3>Title</h3><p>Paragraph</p></div></section>', [component('Owner', '#owner'), { ...component('TeamCard', '#prose', box(5, 5, 40, 80), 'Owner'), repeated: true }]);
    assert.deepEqual(roles(ordinary), ['component', 'part']);
});

test('footer link groups remain components; each plain link is an owned part', () => {
    const r = run('<footer id="footer"><div id="group"><h3>Company</h3><a id="link">About</a><a>Contact</a></div></footer>', [component('Footer', '#footer'), component('FooterLinkGroup', '#group', box(5, 5, 60, 60), 'Footer'), component('Link', '#link', box(10, 20, 30, 10), 'FooterLinkGroup')]);
    assert.deepEqual(roles(r), ['component', 'component', 'part']);
    assert.equal(r.components[2].validation.ownerId, 'FooterLinkGroup');
});

test('slider and slide composites both count', () => {
    const r = run('<section id="slider"><div id="slide"><img><h3>Slide</h3><a>Read</a></div><button>Next</button></section>', [component('Slider', '#slider'), component('SliderItem', '#slide', box(5, 5, 80, 70), 'Slider')]);
    assert.deepEqual(roles(r), ['component', 'component']);
});

test('image-only widget slides remain separate implementation families', () => {
    const html = '<section class="swiper" id="slider"><div class="swiper-slide" id="slide"><img id="image"></div><div class="swiper-slide"><img></div></section>';
    const r = run(html, [component('Slider', '#slider'), component('SliderItem', '#slide', box(5, 5, 80, 70), 'Slider'), component('Image', '#image', box(10, 10, 60, 40), 'SliderItem')]);
    assert.deepEqual(roles(r), ['component', 'component', 'part']);
    assert.equal(r.components[2].validation.ownerId, 'SliderItem');
    const singleSlide = run('<div class="swiper" id="slider"><div class="swiper-slide" id="slide"><img></div></div>', [component('Slider', '#slider'), component('SliderItem', '#slide', box(5, 5, 80, 70), 'Slider')]);
    assert.deepEqual(roles(singleSlide), ['component', 'component']);
    const linkedSlide = run('<div class="swiper" id="slider"><a class="swiper-slide" id="slide"><img></a></div>', [component('Slider', '#slider'), component('SliderItem', '#slide', box(5, 5, 80, 70), 'Slider')]);
    assert.deepEqual(roles(linkedSlide), ['component', 'component']);
});

test('coincident nested implementation boxes prefer nearest DOM owner regardless of detection order', () => {
    const html = '<section id="grid"><div class="card" id="card"><img id="portrait"><h3>Name</h3></div></section>';
    const cs = [component('Grid', '#grid'), component('Card', '#card', box(), 'Grid'), component('Portrait', '#portrait', box(10, 10, 20, 20), 'Card')];
    for (const detections of [cs, [cs[1], cs[0], cs[2]]]) {
        const r = run(html, detections);
        assert.equal(r.counts.counted, 2);
        assert.equal(r.components.find((c) => c.id === 'Portrait').validation.ownerId, 'Card');
    }
});

test('transparent wrappers count once and text-only subgroups belong to structural owner', () => {
    const html = '<section id="owner"><div id="wrapper"><div id="card"><img><h3>Card</h3><p>Body</p></div></div><div id="text"><h2>Heading</h2><p>Body</p><ul><li>Item</li></ul></div></section>';
    const r = run(html, [component('Owner', '#owner'), component('Wrapper', '#wrapper', box(5, 5, 50, 50), 'Owner'), component('Card', '#card', box(5, 5, 50, 50), 'Wrapper'), component('TextGroup', '#text', box(5, 60, 80, 30), 'Owner')]);
    assert.deepEqual(roles(r), ['component', 'part', 'component', 'part']);
    assert.equal(r.counts.counted, 2);
    assert.equal(r.components[2].validation.ownerId, 'Owner');
    assert.equal(r.components[1].parent, 'Owner');
});

test('article material belongs to its renderer, genuine gallery, form and embeds count', () => {
    const html = '<article id="article"><h1 id="title">Story</h1><figure id="figure"><img id="image"><figcaption>Caption</figcaption></figure><blockquote id="quote">Quote</blockquote><ul id="list"><li>A</li><li>B</li></ul><div class="gallery" id="gallery"><img><img></div><form id="form"><input><button>Send</button></form><iframe id="embed"></iframe></article>';
    const ids = ['title', 'figure', 'image', 'quote', 'list', 'gallery', 'form', 'embed'];
    const r = run(html, [component('Article', '#article', box(0, 0, 500, 1000)), ...ids.map((id, i) => component(id, `#${id}`, box(10, i * 100 + 10, 100, 50), 'Article'))]);
    assert.deepEqual(roles(r), ['component', 'content', 'content', 'content', 'content', 'content', 'component', 'component', 'component']);
    assert.equal(r.counts.counted, 4);
});

test('arbitrary composites are preserved regardless of name; names do not delete widgets', () => {
    const html = '<div id="thing"><img><h3>Heading</h3><p>Body</p></div><img id="plain"><div id="blank"></div>';
    const r = run(html, [component('Foo', '#thing'), component('Gallery', '#plain', box(110, 0)), component('TeamCard', '#blank', box(220, 0))]);
    assert.deepEqual(roles(r), ['component', 'content', 'uncertain']);
});

test('linked cards and composite quote slides count; ordinary links and quotes do not', () => {
    const html = '<section id="slider"><a id="card"><img><h3>Card</h3></a><blockquote id="slide"><p>Quote</p><img></blockquote><a id="plain">Plain</a><blockquote id="quote">Plain quote</blockquote></section>';
    const cs = [component('Slider', '#slider'), ...['card', 'slide', 'plain', 'quote'].map((id, i) => component(id, `#${id}`, box(5, i * 20, 40, 15), 'Slider'))];
    assert.deepEqual(roles(run(html, cs)), ['component', 'component', 'component', 'part', 'part']);
});

test('semantic navigation remains an implementation boundary inside article content', () => {
    const r = run('<article id="article"><nav id="nav"><a id="link">Previous</a><a>Next</a></nav></article>', [component('Article', '#article'), component('Navigation', '#nav', box(5, 5, 80, 50), 'Article'), component('Link', '#link', box(10, 10, 20, 10), 'Navigation')]);
    assert.deepEqual(roles(r), ['component', 'component', 'part']);
    assert.equal(r.components[2].validation.ownerId, 'Navigation');
});

test('duplicate DOM detections flagged, coincident distinct DOM nodes preserved', () => {
    const html = '<section id="one"><h2>One</h2></section><section id="two"><h2>Two</h2></section>';
    const r = run(html, [component('a', '#one'), component('b', '#one'), component('c', '#two')]);
    assert.deepEqual(roles(r), ['uncertain', 'uncertain', 'component']);
});

test('malformed, missing, cyclic and unsupported parent relationships are uncertain', () => {
    const html = '<section id="one"><div id="child"><img><p>Body</p></div></section><section id="two"></section>';
    const r = run(html, [component('bad', '#two', box(0, 0, -1)), component('missing', '#child', box(), 'absent'), component('a', '#one', box(), 'b'), component('b', '#child', box(10, 10, 50, 50), 'a'), component('outside', '#two', box(110, 0), 'a')]);
    assert.deepEqual(roles(r), ['uncertain', 'uncertain', 'uncertain', 'uncertain', 'uncertain']);
});

test('no DOM, ambiguous selector, geometry mismatch and unsupported detections stay explicit', () => {
    assert.deepEqual(roles(refineComponents([component('x', '#x')])), ['uncertain']);
    assert.deepEqual(roles(run('<section></section><section></section>', [component('x', 'section')])), ['uncertain']);
    assert.deepEqual(roles(run('<section id="x"></section>', [component('x', '#x')], { rects: [{ s: '#x', ...box(200, 200) }] })), ['uncertain']);
    assert.deepEqual(roles(run('<div id="x">Bare text</div>', [component('x', '#x')])), ['uncertain']);
});

test('rect and scan selectors back matching without an existing selector', () => {
    const c = { ...component('x', null), scan: { type: 'hero' } };
    const html = '<section id="x"><h1>Hello</h1></section>';
    assert.deepEqual(roles(refineComponents([c], { html, rects: [{ s: '#x', ...box() }] })), ['component']);
    assert.deepEqual(roles(refineComponents([c], { html, scan: [{ selector: '#x', box: box() }] })), ['component']);
    assert.deepEqual(roles(refineComponents([c], { html, rects: [{ s: '#x', ...box() }], scan: [{ selector: '#x', box: box() }] })), ['component']);
});

test('responsive geometry yields consistent semantics and smallest backed owner', () => {
    const html = '<section id="outer"><div id="inner"><img><h3 id="title">Title</h3><p>Body</p></div></section>';
    const cs = [component('outer', '#outer'), component('inner', '#inner', box(5, 5, 80, 80), 'outer'), component('title', '#title', box(10, 10, 20, 20), 'outer')];
    const desktop = run(html, cs);
    const mobile = run(html, cs.map((c) => ({ ...c, box: Object.fromEntries(Object.entries(c.box).map(([k, v]) => [k, v * 0.5])) })));
    assert.deepEqual(roles(desktop), roles(mobile));
    assert.equal(desktop.components[2].validation.ownerId, 'inner');
});

test('original evidence and inputs survive refinement; only validated units count', () => {
    const cs = [component('x', '#x')];
    cs[0].measuredStyles = { color: 'red' };
    const rects = [{ s: '#x', ...box(), t: 'section' }];
    const original = structuredClone({ cs, rects });
    const r = refineComponents(cs, { html: '<section id="x"></section>', rects });
    assert.deepEqual({ cs, rects }, original);
    const { validation, ...saved } = r.components[0];
    assert.deepEqual(saved, original.cs[0]);
    assert.equal(validation.version, 1);
    assert.equal(isImplementationComponent(r.components[0]), true);
    assert.equal(isImplementationComponent(cs[0]), false);
    assert.equal(isImplementationComponent({ validation: { role: 'uncertain', countInBuildList: true } }), false);
    assert.equal(r.findings[0].id, 'x');
    assert.equal(r.counts.total, r.counts.component + r.counts.content + r.counts.part + r.counts.uncertain);
});

test('linked icon tiles with independent div fields validate, without promoting inner wrappers or simple icon actions', () => {
    const tile = i => `<div><a id="tile${i}" href="/${i}"><div><svg>${'<path/>'.repeat(i)}</svg></div><div id="content${i}"><div id="head${i}"><div>Service ${i}</div><div><svg><path/></svg></div></div><div>Independent description</div></div></a></div>`;
    const html = `<section id="hero">${tile(1)}${tile(2)}<a id="simple" href="/next"><svg><path/></svg><span>Next <strong>page</strong></span></a><button id="button"><svg><path/></svg><span>Submit</span></button></section>`;
    const cs = [component('Hero', '#hero'), component('Tile', '#tile1', box(5, 5, 80, 80), 'Hero'), component('TileContent', '#content1', box(10, 10, 65, 65), 'Tile'), component('TileHeading', '#head1', box(10, 10, 50, 25), 'Tile'), component('Action', '#simple', box(5, 85, 60, 15), 'Hero'), component('Button', '#button', box(70, 85, 25, 15), 'Hero')];
    const out = run(html, cs);
    assert.deepEqual(roles(out), ['component', 'component', 'part', 'part', 'part', 'component']);
    assert.equal(out.components[1].validation.basis.includes('linked-composite-boundary'), true);
    assert.equal(out.components[2].validation.ownerId, 'Tile');
    assert.equal(out.counts.counted, 3);
    const omitted = run(html, [cs[0]]);
    assert.equal(omitted.components.length, 1, 'DOM recovery must not invent implementation detections');
    assert.equal(omitted.counts.counted, 1);
});

test('linked media inside an ordinary paragraph remains owned rich-text content', () => {
    const html = '<section id="owner"><p>Compare <a id="inline" href="/x"><img><span>Caption</span></a>.</p></section>';
    assert.deepEqual(roles(run(html, [component('Owner', '#owner'), component('Inline', '#inline', box(5, 5, 60, 40), 'Owner')])), ['component', 'part']);
});

test('raster icons with one inline label remain actions just like SVG icons', () => {
    const html = '<section id="owner"><a id="raster" class="btn" href="/file"><img width="16" height="16"><span>Download</span></a><a id="svg" class="btn" href="/file"><svg><path/></svg><span>Download</span></a><a id="card" href="/story"><img><h3>Story title</h3></a></section>';
    assert.deepEqual(roles(run(html, [component('Owner', '#owner'), component('Raster', '#raster', box(5, 5, 80, 20), 'Owner'), component('SVG', '#svg', box(5, 30, 80, 20), 'Owner'), component('Card', '#card', box(5, 55, 80, 40), 'Owner')])), ['component', 'component', 'component', 'component']);
});



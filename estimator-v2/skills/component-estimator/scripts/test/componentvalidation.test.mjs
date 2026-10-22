import test from 'node:test';
import assert from 'node:assert/strict';
import { refineComponents, isImplementationComponent } from '../lib/componentvalidation.mjs';
import { DEFAULT_PROMPT } from '../lib/prompt.mjs';

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

test('standalone CTA buttons and links count at level two with their real nearest owner', () => {
    const html = '<section id="hero"><h1 id="title">Welcome</h1><div class="card" id="card"><img><h3>Offer</h3><a class="btn primary" href="/start" id="cta"><svg><title>Arrow</title></svg><span>Get started</span></a></div><button type="button" id="action">Contact sales</button><a role="button" href="/more" id="role">Learn more</a></section>';
    const r = run(html, [component('Hero', '#hero'), component('Card', '#card', box(5, 5, 80, 70), 'Hero'), { ...component('Primary CTA', '#cta', box(10, 30, 30, 10), 'Card'), level: 3 }, component('Action', '#action', box(5, 80, 30, 10), 'Hero'), component('More', '#role', box(40, 80, 30, 10), 'Hero'), component('Heading', '#title', box(1, 1, 20, 2), 'Hero')]);
    assert.deepEqual(roles(r), ['component', 'component', 'component', 'component', 'component', 'part']);
    assert.deepEqual(r.components.map(c => c.level), [1, 2, 2, 2, 2, 2]);
    for (const i of [2, 3, 4]) assert.equal(r.components[i].validation.implementationType, 'cta');
    assert.equal(r.components[2].validation.ownerId, 'Card');
    assert.equal(r.components[2].parent, 'Card');
    assert.equal(r.components[1].validation.implementationType, undefined);
});

test('CTA names alone do not promote prose, navigation, forms or utility controls', () => {
    const html = '<section id="section"><p>Read <a class="btn" id="inline">more</a></p><a id="ordinary">Get started</a><button id="icon" aria-label="Open search"><svg><title>Search</title></svg></button><button id="close" type="button">Close</button><button id="menu" aria-expanded="false">Menu</button><form><button class="btn" id="submit">Join now</button><input id="input" type="submit" value="Send"></form><nav><a id="nav">Contact</a></nav><footer><a id="footer">Contact</a></footer></section>';
    const ids = ['inline', 'ordinary', 'icon', 'close', 'menu', 'submit', 'input', 'nav', 'footer'];
    const r = run(html, [component('Section', '#section'), ...ids.map((id, i) => ({ ...component(id, `#${id}`, box(5, i * 10, 20, 5), 'Section'), name: 'Primary CTA' }))]);
    assert.deepEqual(roles(r), ['component', ...ids.map(() => 'part')]);
    assert.equal(r.counts.counted, 1);
});

test('SVG and div-field whole-card anchors stay cards and own their content', () => {
    const html = '<section id="section"><a class="btn card" id="card" href="/offer"><svg><path/></svg><div id="fields"><div>Offer title</div><div>Offer details</div></div></a><a class="btn" id="cta" href="/start"><svg><path/></svg><span>Get started</span></a></section>';
    const r = run(html, [component('Section', '#section'), component('Offer card', '#card', box(5, 5, 80, 60), 'Section'), component('Fields', '#fields', box(10, 10, 60, 40), 'Offer card'), component('CTA', '#cta', box(5, 80, 30, 10), 'Section')]);
    assert.deepEqual(roles(r), ['component', 'component', 'part', 'component']);
    assert.notEqual(r.components[1].validation.implementationType, 'cta');
    assert.equal(r.components[2].validation.ownerId, 'Offer card');
    assert.equal(r.components[3].validation.implementationType, 'cta');
});

test('owned widgets normalize deep levels without flattening occurrence parents', () => {
    const r = run('<section id="s"><div class="card" id="card"><img><h3>Offer</h3><form id="form"><input></form></div></section>', [component('Section', '#s'), component('Card', '#card', box(5, 5, 80, 80), 'Section'), { ...component('Form', '#form', box(10, 30, 50, 30), 'Card'), level: 4 }]);
    assert.deepEqual(r.components.map(c => c.level), [1, 2, 2]);
    assert.equal(r.components[2].parent, 'Card');
    assert.equal(r.components[2].validation.ownerId, 'Card');
});

test('nearest DOM implementation owns a CTA even when a further ancestor has a smaller box', () => {
    const html = '<section id="section"><div class="card" id="card"><img><h3>Offer</h3><a class="btn" id="cta">Apply</a></div></section>';
    const r = run(html, [component('Section', '#section', box(10, 10, 50, 50)), component('Card', '#card', box(0, 0, 100, 100)), component('CTA', '#cta', box(20, 20, 20, 10))]);
    assert.equal(r.components[2].validation.ownerId, 'Card');
    assert.equal(r.components[2].level, 2);
});

test('prompt specifies two presentation levels and reusable CTA occurrence ownership', () => {
    assert.match(DEFAULT_PROMPT, /exactly TWO presentation levels/);
    assert.match(DEFAULT_PROMPT, /Never create level 3 or deeper/);
    assert.match(DEFAULT_PROMPT, /canonical name/);
    assert.match(DEFAULT_PROMPT, /every visible CTA and every card occurrence/);
    assert.match(DEFAULT_PROMPT, /do not flatten a card-owned CTA onto the section/);
});

test('text-only whole cards keep their complete heading and supporting-copy boundary',()=>{
 const html='<section id="s"><a id="one" href="/one"><h3>Offer one</h3><p>Supporting copy</p></a><a id="two" href="/two"><h3>Offer two</h3><p>Supporting copy</p></a></section>';
 const r=run(html,[component('Section','#s'),component('CardOne','#one',box(5,5,40,80),'Section'),component('CardTwo','#two',box(50,5,40,80),'Section')]);
 assert.equal(r.components.filter(isImplementationComponent).length,3);
 assert(r.components.slice(1).every(c=>c.level===2&&c.validation.implementationType!=='cta'));
});


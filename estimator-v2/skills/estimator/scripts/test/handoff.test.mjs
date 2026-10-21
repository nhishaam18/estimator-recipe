import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { assembleHandoff, exportHandoff, renderFamily, renderFamilyEvidence, renderOverview } from '../lib/handoff.mjs';

function fixture() {
  const component = (id, name, selector, level = 1, ownerId = null) => ({ id, name, domSelector: selector, level, box: { x: 0, y: 0, w: 400, h: 200 }, source: 'llm', contains: [], validation: { role: 'component', countInBuildList: true, ownerId, reason: 'Backed boundary' } });
  const components = [component('s', 'Hero', '#hero'), component('c', 'Card', '#card', 2, 's'), { id: 'u', name: 'Unknown', source: 'propagated', validation: { role: 'uncertain', countInBuildList: false, reason: 'No DOM support' } }];
  return {
    run: { id: 'fixture', viewports: ['desktop', 'mobile'], pages: [{ url: 'https://example.test', slug: 'home' }] },
    list: { entries: [{ id: 'C001', name: 'Hero', aliases: [], level: 1 }, { id: 'C002', name: 'Card', aliases: [], level: 2 }] },
    captures: [{ url: 'https://example.test', slug: 'home', viewport: 'desktop', status: 'ok', html: '<main><section id="hero"><h1>Exact &amp; literal</h1><p>Keep <strong>bold</strong> copy.</p><a href="/all">All</a><div id="card"><h2>Card title</h2><img src="/x.png" alt="Picture"><button>Buy</button><ul><li>One</li><li>Two</li></ul><form><label>Email<input name="email" type="email"></label></form><svg aria-label="star"></svg></div><script>ignore()</script></section></main>', components, warnings: [], rects: [{ s: '#hero', x: 0, y: 0, w: 400, h: 200 }], evidence: { nodes: [{ selector: 'h1', styleId: 'type', box: { x: 0, y: 0, w: 200, h: 40 }, pseudo: { '::after': { content: '"!"' } }, variables: { '--ink': 'red' } }], styles: { type: { 'font-size': '40px', 'font-family': 'Example', display: 'block' } }, limits: { nodes: 250 }, warnings: ['Style samples truncated at 250 of 300 visible candidates'], assets: [{ kind: 'font', url: 'https://example.test/a.woff2', status: 200 }], documentFonts: [{ family: 'Example', status: 'loaded' }] }, paths: { html: 'html/desktop/home.html', analysis: 'analysis/desktop/home.json', screenshot: 'shots/desktop/home.png', annotated: null } }],
  };
}

test('incomplete component stays in the handoff inventory and readable report with its missing parts',()=>{
 const input=fixture();input.captures[0].components.find(c=>c.id==='c').gaps=['image','icon'];
 const out=assembleHandoff(input),card=out.occurrences.find(o=>o.name==='Card');assert.deepEqual(card.gaps,['image','icon']);assert.equal(out.families.filter(f=>f.name==='Card').length,1);
 const report=renderFamily(out.families.find(f=>f.id===card.familyId),out).replaceAll('\\','');assert.match(report,/Incomplete render \(nonblocking\): Card/);assert.match(report,/image, icon/);assert.match(report,/missing appearance is unverified/);
});

test('hidden consent remnants and tracking images do not become unowned visible evidence', () => {
  const input=fixture(),c=input.captures[0];
  c.html+='<div style="display:none !important"><p>Cookie notice</p><a href="/accept">Accept all</a><img src="/pixel"></div><img style="display:none" src="/beacon"><div style="visibility:hidden"><p>Hidden copy</p><p style="visibility:visible">Visible override</p></div>';
  c.html=c.html.replace('Keep <strong>bold</strong> copy.','Keep <strong>bold</strong> copy.<span style="display:none">Hidden inline fragment</span>');
  const out=assembleHandoff(input),all=[...out.elements,...out.unassignedElements];
  assert(!all.some(e=>/Cookie notice|Accept all|Hidden copy/.test(e.observedText)));
  assert(!all.some(e=>/pixel|beacon/.test(JSON.stringify(e.media??e.attributes??{}))));
  assert(all.some(e=>e.observedText==='Visible override'));
  assert(!JSON.stringify(out.occurrences.map(o=>o.modelProposal)).includes('Hidden inline fragment'));
  assert(!all.some(e=>/Hidden inline fragment/.test(e.observedText)||/Hidden inline fragment/.test(e.ownedContent?.html??'')));
});

test('annotation-only items cannot inherit malformed detection IDs or create implementation families', () => {
  const input=fixture(),capture=input.captures[0];
  capture.components.push({name:'Malformed',validation:{role:'uncertain',countInBuildList:false}});
  capture.annotationLedger={items:[{id:'root',kind:'section',source:'validated-detection',sourceDetectionId:'s',selector:'#hero',ownerId:null,box:{x:0,y:0,w:400,h:200}},
    {id:'action',kind:'action',source:'saved-dom',annotationOnly:true,selector:'a',ownerId:'root',box:{x:0,y:0,w:80,h:30}}]};
  const out=assembleHandoff(input);
  assert.equal(out.families.length,2);
  const root=out.annotationItems.find(a=>a.localId==='root'),action=out.annotationItems.find(a=>a.localId==='action');
  assert.equal(root.sourceDetectionId,out.detections.find(d=>d.sourceId==='s').id);
  assert.equal(action.sourceDetectionId,null);
  assert.equal(action.ownerId,root.id);
});

test('proposes neutral owned fields with exact evidence and direct child anatomy before the ledger', () => {
  const out = assembleHandoff(fixture());
  const hero = out.occurrences.find(o => o.name === 'Hero');
  const card = out.occurrences.find(o => o.name === 'Card');
  const model = hero.modelProposal;
  assert.equal(model.status, 'proposal');
  assert.equal(model.fields.find(f => f.name === 'heading').observedValue, 'Exact & literal');
  const copy = model.fields.find(f => f.name === 'supportingText');
  assert.equal(copy.type, 'formatted-content');
  assert.equal(copy.observedValue.html, 'Keep <strong>bold</strong> copy.');
  assert.ok(copy.evidenceElementIds.length);
  assert.equal(model.fields.find(f => f.name === 'heading').styleEvidence[0].computedStyle['font-size'], '40px');
  assert.ok(!JSON.stringify(model.fields).includes('Card title'));
  assert.equal(model.anatomy[0].familyId, card.familyId);
  assert.deepEqual(model.anatomy[0].occurrenceIds, [card.id]);
  assert.equal(model.anatomy[0].observedCount, 1);
  assert.equal(model.anatomy[0].report, 'export/components/C02-card.md');
  assert.equal(out.families.find(f => f.name === 'Hero').report, 'export/components/C01-hero.md');
  assert.match(renderOverview(out), /\]\(components\/C01-hero\.md\)/);
  assert.match(renderFamily(out.families.find(f => f.id === hero.familyId), out), /\]\(C02-card\.md\)/);
  const children = model.fields.find(f => f.type === 'ordered-collection');
  assert.deepEqual(children.occurrenceIds, [card.id]);
  assert.equal(children.observedCount, 1);
  assert.ok(model.fields.every(f => f.status === 'proposal' && !('required' in f) && !('localized' in f)));
  const report = renderFamilyEvidence(out.families.find(f => f.name === 'Hero'), out);
  assert.ok(report.indexOf('### Component anatomy') < report.indexOf('### Proposed fields'));
  assert.ok(report.indexOf('### Proposed fields') < report.indexOf('### Elements in saved DOM order'));
  assert.match(report, /40px/);
});

test('formatted introductory copy does not absorb independent component heading and action fields', () => {
  const f = fixture();
  f.captures[0].html = '<section id="hero">Welcome <strong>back</strong><h1>Title</h1><a href="/go">Go</a><div id="card"></div></section>';
  const out = assembleHandoff(f), model = out.occurrences.find(o => o.name === 'Hero').modelProposal;
  assert.equal(model.fields.find(f => f.name === 'heading')?.observedValue, 'Title');
  assert.equal(model.fields.find(f => f.type === 'link')?.observedValue.attributes.href, '/go');
  const intro = model.fields.find(f => f.name === 'supportingText');
  assert.equal(intro.type, 'formatted-content');
  assert.match(intro.observedValue.html, /<strong>back<\/strong>/);
  assert.ok(!intro.observedValue.html.includes('<h1>'));
  assert.ok(!intro.observedValue.html.includes('href='));
});

test('owns nested rich content and action images once while retaining the full element ledger', () => {
  const f = fixture();
  f.captures[0].html = '<section id="hero"><h1>Title</h1><h2>Subtitle</h2><div>Lead <ul><li>First <img src="/inline.png" alt="Inline"></li></ul></div><a href="/go"><span>Go</span><img src="/arrow.png" alt="Arrow"></a><div id="card"><p>Child copy</p></div></section>';
  const out = assembleHandoff(f);
  const model = out.occurrences.find(o => o.name === 'Hero').modelProposal;
  assert.deepEqual(model.fields.filter(f => f.name.startsWith('heading')).map(f => f.name), ['heading', 'heading2']);
  const rich = model.fields.find(f => f.type === 'formatted-content');
  assert.match(rich.observedValue.html, /inline.png/);
  assert.ok(rich.evidenceElementIds.length >= 3);
  const action = model.fields.find(f => f.type === 'link');
  assert.equal(action.observedValue.attributes.href, '/go');
  assert.ok(action.evidenceElementIds.length >= 2);
  assert.ok(action.assets.some(a => a.references.src === '/arrow.png'));
  assert.equal(model.fields.filter(f => f.type === 'image').length, 0);
  assert.equal(out.elements.filter(e => e.role === 'image').length, 2);
  const ownedIds = model.fields.filter(f => f.type !== 'ordered-collection').flatMap(f => f.evidenceElementIds);
  assert.equal(ownedIds.length, new Set(ownedIds).size);
});

test('preserves unresolved ownership separately and carries native analysis receipts', () => {
  const f = fixture();
  f.captures[0].html += '<footer><p>Unassigned exact copy</p><img src="/footer.png" alt="Footer"></footer>';
  f.captures[0].nativeAnalysis = { inspectionStatus: 'declared' };
  const out = assembleHandoff(f);
  assert.deepEqual(out.captures[0].nativeAnalysis, f.captures[0].nativeAnalysis);
  assert.equal(out.unassignedElements.length, 2);
  assert.equal(out.captures[0].unownedMeaningfulElements, 2);
  assert.ok(out.unassignedElements.every(e => e.ownerOccurrenceId === null));
  assert.ok(!out.elements.some(e => e.observedText === 'Unassigned exact copy'));
  assert.equal(out.unassignedElements.find(e => e.tag === 'img').assets.src, '/footer.png');
  assert.match(renderOverview(out), /Unassigned exact copy/);
});

test('groups only direct child families and preserves saved DOM order across groups', () => {
  const f = fixture(), capture = f.captures[0];
  const card = capture.components.find(c => c.id === 'c');
  const child = (id, name, selector, ownerId, level = 2) => ({ ...card, id, name, domSelector: selector, level, validation: { ...card.validation, ownerId } });
  capture.components.push(child('c2', 'Card', '#card2', 's'), child('banner', 'Banner', '#banner', 's'), child('nested', 'Nested', '#nested', 'c', 3));
  capture.html = '<section id="hero"><div id="card2"><h2>Second</h2></div><aside id="banner"><p>Banner</p></aside><div id="card"><h2>First</h2><div id="nested"><p>Nested</p></div></div></section>';
  const out = assembleHandoff(f);
  const hero = out.occurrences.find(o => o.sourceId === 's');
  const sourceId = id => out.occurrences.find(o => o.id === id).sourceId;
  assert.deepEqual(hero.modelProposal.childOrder.map(sourceId), ['c2', 'banner', 'c']);
  const cards = hero.modelProposal.anatomy.find(a => a.name === 'Card');
  assert.equal(cards.observedCount, 2);
  assert.deepEqual(cards.positions, [1, 3]);
  assert.deepEqual(cards.occurrenceIds.map(sourceId), ['c2', 'c']);
  assert.ok(!hero.modelProposal.anatomy.some(a => a.name === 'Nested'));
  assert.equal(out.occurrences.find(o => o.sourceId === 'c').modelProposal.anatomy[0].name, 'Nested');
});

test('retains standalone actions and input attributes in generic copy wrappers and observed root backgrounds', () => {
  const f = fixture(), capture = f.captures[0];
  capture.html = '<section id="hero"><div> Intro <span>copy</span><a href="/go">Go<img src="/arrow.svg"></a><label>Email<input name="email" type="email" required maxlength="20"></label></div><div id="card"></div></section>';
  capture.evidence.nodes.push({ selector: '#hero', styleId: 'hero' });
  capture.evidence.styles.hero = { 'background-image': 'url("/hero.jpg")' };
  const out = assembleHandoff(f), hero = out.occurrences.find(o => o.name === 'Hero');
  const fields = hero.modelProposal.fields;
  assert.equal(fields.find(x => x.name === 'supportingText').observedValue.text, ' Intro copy');
  assert.equal(fields.find(x => x.type === 'link').observedValue.attributes.href, '/go');
  const control = fields.find(x => x.type === 'control');
  const input = control.observedValue.elements.find(e => e.attributes.name === 'email');
  assert.equal(input.attributes.type, 'email');
  assert.equal(input.attributes.required, '');
  assert.equal(input.attributes.maxlength, '20');
  const background = fields.find(x => x.name === 'backgroundImage');
  assert.equal(background.type, 'presentation-only');
  assert.equal(background.observedValue, 'url("/hero.jpg")');
  assert.deepEqual(background.evidenceOccurrenceIds, [hero.id]);
});

test('inventories every supported meaningful element under nearest implementation owner', () => {
  const out = assembleHandoff(fixture());
  assert.equal(out.schemaVersion, 1);
  assert.equal(out.families.length, 2);
  const hero = out.occurrences.find(o => o.name === 'Hero');
  const card = out.occurrences.find(o => o.name === 'Card');
  assert.equal(card.parentOccurrenceId, hero.id);
  assert.equal(out.elements.find(e => e.observedText === 'Exact & literal').ownerOccurrenceId, hero.id);
  assert.equal(out.elements.find(e => e.observedText === 'Card title').ownerOccurrenceId, card.id);
  assert.ok(out.elements.some(e => e.role === 'image' && e.assets.src === '/x.png'));
  for (const role of ['button', 'link', 'form', 'control', 'list', 'list-item', 'icon']) assert.ok(out.elements.some(e => e.role === role), role);
  assert.ok(out.elements.some(e => e.formatting?.tags.includes('strong')));
  assert.ok(!out.elements.some(e => e.observedText.includes('ignore()')));
  assert.equal(out.detections.length, 3);
  assert.equal(out.summary.uncertainDetections, 1);
  assert.ok(out.detections.find(d => d.sourceId === 'u').validation.reason.includes('No DOM'));
});

test('uses saved per-element style samples, preserves scope warnings, never invents boxes', () => {
  const out = assembleHandoff(fixture());
  const heading = out.elements.find(e => e.role === 'heading' && e.tag === 'h1');
  assert.equal(heading.computedStyle['font-size'], '40px');
  assert.equal(heading.pseudo['::after'].content, '"!"');
  assert.equal(heading.observedText, 'Exact & literal');
  assert.equal(heading.behavior.status, 'unknown');
  assert.equal(out.elements.find(e => e.role === 'button').box, null);
  assert.equal(out.elements.find(e => e.role === 'button').styleStatus, 'not-captured');
  assert.match(out.captures[0].warnings.join(' '), /truncated at 250/);
  assert.equal(out.scope.behavior, 'not-probed');
  assert.equal(out.scope.semanticCoverage, 'unreviewed-saved-dom-inventory');
  assert.equal(out.coverage.find(c => c.viewport === 'mobile').status, 'not-captured');
  assert.equal(out.coverage.find(c => c.viewport === 'desktop').status, 'captured');
  assert.equal(out.coverage.find(c => c.viewport === 'desktop').styleStatus, 'captured');
});

test('failed and uncaptured requested views remain distinct visual coverage gaps', () => {
  const f = fixture();
  f.run.pages[0].viewports = { desktop: { status: 'failed', error: 'HTTP 503', flags: ['blocked'] } };
  f.captures = [];
  const out = assembleHandoff(f);
  assert.equal(out.coverage[0].status, 'failed');
  assert.equal(out.coverage[0].error, 'HTTP 503');
  assert.deepEqual(out.coverage[0].flags, ['blocked']);
  assert.equal(out.coverage[1].status, 'not-captured');
  assert.equal(out.summary.missingCaptures, 2);
  assert.equal(out.summary.viewsWithoutStyleEvidence, 2);
});

test('output IDs are deterministic; Markdown escapes untrusted copy and exposes evidence and unknowns', () => {
  const f = fixture();
  f.captures[0].html = f.captures[0].html.replace('Card title', '<em>&lt;script&gt; [click](javascript:bad) | text</em>');
  const a = assembleHandoff(f), b = assembleHandoff(f);
  assert.deepEqual(a, b);
  assert.equal(new Set(a.elements.map(e => e.id)).size, a.elements.length);
  const report = renderFamily(a.families.find(x => x.name === 'Card'), a);
  assert.ok(!report.includes('<script>'));
  assert.ok(!report.includes('[click](javascript:bad)'));
  assert.match(report, /Observed content/);
  assert.match(report, /No saved style sample/);
  assert.ok(renderOverview(a).includes('analysis/desktop/home\\.json'));
});

test('preserves saved control values and states with explicit live-property limits and password omission', () => {
  const f = fixture();
  f.captures[0].html = f.captures[0].html.replace('<input name="email" type="email">', '<input name="email" type="email" value="Alice" required disabled><input type="checkbox" checked value="yes"><select multiple><option selected value="a">Option A</option></select><textarea>Saved text</textarea><input type="password" value="secret-never-export">');
  const out = assembleHandoff(f);
  const input = out.elements.find(e => e.observedAttributes.name === 'email');
  assert.equal(input.observedAttributes.value, 'Alice');
  assert.equal(input.observedAttributes.required, '');
  assert.equal(input.observedAttributes.disabled, '');
  assert.equal(out.elements.find(e => e.observedAttributes.type === 'checkbox').observedAttributes.checked, '');
  assert.equal(out.elements.find(e => e.tag === 'option').observedAttributes.selected, '');
  assert.equal(out.elements.find(e => e.tag === 'textarea').observedText, 'Saved text');
  const password = out.elements.find(e => e.observedAttributes.type === 'password');
  assert.equal(password.observedAttributes.value, undefined);
  assert.match(password.observationLimits.join(' '), /password/i);
  assert.ok(!JSON.stringify(out).includes('secret-never-export'));
  assert.match(input.observationLimits.join(' '), /live properties are unverified/i);
});

test('export writes deterministic offline artifacts and ignores stale analysis without a current evidence pointer', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'handoff-fixture-'));
  const previous = process.env.CEST_RUNS_DIR;
  process.env.CEST_RUNS_DIR = root;
  try {
    const run = { id: 'fixture', updatedAt: 'fixture', viewports: ['desktop'], pages: [{ url: 'https://example.test', slug: 'home', viewports: { desktop: { status: 'ok', width: 400, height: 200, shot: true } } }] };
    const base = path.join(root, run.id);
    const put = async (relative, value) => { const full = path.join(base, relative); await mkdir(path.dirname(full), { recursive: true }); await writeFile(full, typeof value === 'string' ? value : JSON.stringify(value)); };
    await put('run.json', run);
    await put('html/desktop/home.html', '<section id="hero"><h1>Literal heading</h1><a href="/go">Go</a></section>');
    await put('rects/desktop/home.json', [{ s: 'section#hero', t: 'section', x: 0, y: 0, w: 400, h: 200 }]);
    await put('llm/desktop/home.json', { warnings: [], components: [{ id: 'S1', name: 'Hero', level: 1, parent: null, box: { x: 0, y: 0, w: 400, h: 200 }, contains: [], reusable: false, repeated: false }] });
    await put('analysis/desktop/home.json', { nodes: [], styles: {}, warnings: [], assets: [{ url: 'https://stale.test/font.woff2', kind: 'font' }] });
    await put('shots/desktop/home.png', 'fixture-screenshot-bytes');
    const result = await exportHandoff('fixture');
    assert.equal(result.summary.families, 1);
    const first = await readFile(path.join(base, 'export/discovery.json'), 'utf8');
    const data = JSON.parse(first);
    assert.equal(data.captures[0].analysis, null);
    assert.equal(data.captures[0].paths.analysis, null);
    assert.equal(data.coverage[0].status, 'captured');
    assert.equal(data.coverage[0].styleStatus, 'not-captured');
    assert.equal(data.summary.capturedViews, 1);
    assert.equal(data.summary.viewsWithoutStyleEvidence, 1);
    assert.equal(data.captures[0].provenance.html.sha256.length, 64);
    assert.ok(data.elements.some(e => e.observedText === 'Literal heading'));
    assert.equal(data.detections[0].occurrenceId, data.occurrences[0].id);
    assert.ok(result.files.includes(data.families[0].evidenceReport));
    const readable = await readFile(path.join(base, data.families[0].report), 'utf8');
    assert.match(readable, /Proposed structure and fields/);
    assert.doesNotMatch(readable, /"computedStyle"|"observedAttributes"|```/);
    assert.match(readable, /Literal heading/);
    const appendix = await readFile(path.join(base, data.families[0].evidenceReport), 'utf8');
    assert.match(appendix, /Elements in saved DOM order/);
    await exportHandoff('fixture');
    assert.equal(await readFile(path.join(base, 'export/discovery.json'), 'utf8'), first);
    run.pages[0].viewports.desktop.shot = false;
    run.pages[0].viewports.desktop.evidence = { path: 'analysis/desktop/home.json' };
    await put('run.json', run);
    await exportHandoff('fixture');
    const lightweight = JSON.parse(await readFile(path.join(base, 'export/discovery.json'), 'utf8'));
    assert.equal(lightweight.captures[0].paths.screenshot, null);
    assert.equal(lightweight.captures[0].paths.analysis, null);
    assert.equal(lightweight.coverage[0].status, 'scan-only');
    assert.equal(lightweight.summary.capturedViews, 0);
    assert.equal(lightweight.summary.scanOnlyViews, 1);
    assert.equal(lightweight.summary.missingCaptures, 1);
    assert.equal(lightweight.summary.viewsWithoutStyleEvidence, 1);
  } finally {
    if (previous === undefined) delete process.env.CEST_RUNS_DIR; else process.env.CEST_RUNS_DIR = previous;
    await rm(root, { recursive: true, force: true });
  }
});


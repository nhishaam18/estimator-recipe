import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { createRun, inRun, writeJson, updateRun } from '../lib/store.mjs';
import { buildPageData } from '../lib/pagedata.mjs';
import { buildList } from '../lib/buildlist.mjs';
import { exportRun } from '../lib/report.mjs';
import { writeArtifacts } from '../lib/artifacts.mjs';
import { qualityReport } from '../lib/quality.mjs';

test('cached and propagated inventories preserve child families, content evidence and historical merge boundaries without model calls', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'cest-refinement-'));
    const previous = process.env.CEST_RUNS_DIR;
    process.env.CEST_RUNS_DIR = root;
    try {
        const urls = ['https://example.invalid/one', 'https://example.invalid/two'];
        const run = await createRun({ name: 'refinement', urls, viewports: ['desktop'] });
        const b = (x, y, w, h) => ({ x, y, w, h });
        const definitions = [
            ['S1', 'Article', 1, null, '#article', b(0, 0, 500, 600)],
            ['S1_I1', 'Inline illustration', 2, 'S1', '#image', b(10, 100, 300, 200)],
            ['S2', 'Footer', 1, null, '#footer', b(0, 700, 500, 200)],
            ['S2_I1', 'Footer Link Group', 2, 'S2', '#group', b(0, 700, 500, 200)],
            ['S2_I2', 'About link', 2, 'S2', '#link', b(10, 750, 100, 20)],
        ];
        const html = '<article id="article"><h1>Story</h1><img id="image"><p>Copy</p></article><footer id="footer"><div id="group"><h3>Company</h3><a id="link">About</a><a>Contact</a></div></footer>';
        const components = definitions.map(([id, name, level, parent, selector, box]) => ({ id, name, level, parent, box, contains: [], repeated: false, reusable: false }));
        for (const page of run.pages) {
            const file = inRun(run.id, `html/desktop/${page.slug}.html`);
            await mkdir(path.dirname(file), { recursive: true });
            await writeFile(file, html);
            await writeJson(inRun(run.id, `rects/desktop/${page.slug}.json`), definitions.map(([, , , , s, box]) => ({ s, ...box })));
            await writeJson(inRun(run.id, `scan/desktop/${page.slug}.json`), { components: definitions.map(([id, name, level, parent, selector, box], index) => ({ index, type: level === 1 ? 'section' : 'card', selector, box, signature: id, skeleton: '<div><h3></h3><a></a></div>' })) });
        }
        const rawFile = inRun(run.id, `llm/desktop/${run.pages[0].slug}.json`);
        await writeJson(rawFile, { components, warnings: [], usage: { calls: 0, costUsd: 0, promptTokens: 0, completionTokens: 0 } });
        const rawBefore = await readFile(rawFile, 'utf8');
        await updateRun(run.id, r => { for (const p of r.pages) p.viewports.desktop = { status: 'ok', width: 500, height: 1000, shot: true, evidence: { path: `evidence/desktop/${p.slug}.json` } }; });
        for (const page of run.pages) await writeJson(inRun(run.id, `evidence/desktop/${page.slug}.json`), {
            summary: { nodes: 1, images: 0, fonts: 1 }, warnings: [], images: [],
            nodes: [{ selector: '#footer', box: b(0, 700, 500, 200), styleId: 'sample' }],
            styles: { sample: { 'font-family': 'Inter', 'font-size': '18px', color: 'rgb(10, 20, 30)' } },
        });
        const cached = await buildPageData(run.id, 'desktop', urls[0]);
        const propagated = await buildPageData(run.id, 'desktop', urls[1]);
        assert.equal(propagated.source, 'propagated');
        assert.deepEqual(cached.components.map(c => c.validation.role), ['component', 'content', 'component', 'component', 'part']);
        assert.deepEqual(propagated.components.map(c => c.validation.role), cached.components.map(c => c.validation.role));
        assert.equal(cached.components[3].validation.ownerId, 'S2');
        assert.equal(propagated.components[3].validation.ownerId, 'P3');
        await writeJson(inRun(run.id, 'buildlist-consolidation.json'), { groups: [{ keys: ['1:footer', '2:footerlinkgroup'], name: 'Merged Footer', source: 'model' }] });
        const list = await buildList(run.id);
        assert.equal(list.summary.total, 3);
        assert.equal(list.validation.counts.total, 10);
        assert.equal(list.validation.counts.counted, 6);
        assert.equal(list.validation.counts.content, 2);
        assert.deepEqual(list.entries.find(e => e.name === 'Footer Link Group').hosts, ['Footer']);
        assert.deepEqual(list.entries.find(e => e.name === 'Footer').children, ['Footer Link Group']);
        assert(!list.entries.some(e => e.name === 'Merged Footer'));
        assert(list.entries.some(c => c.name === 'Footer Link Group'));
        assert(!list.entries.some(c => /illustration|About link/.test(c.name)));
        await exportRun(run.id, null, { skipImages: true });
        const reportText = await readFile(inRun(run.id, 'export/report.md'), 'utf8');
        assert.match(reportText, /### C\d+ Footer \(Section\)/);
        assert.match(reportText, /Independent child components:.*Footer Link Group/);
        assert.match(reportText, /font-family: Inter; font-size: 18px/);
        const annotations = JSON.parse(await readFile(inRun(run.id, 'export/annotations.json'), 'utf8'));
        assert.equal(annotations.pages.desktop[0].components.length, 5);
        assert.equal(annotations.pages.desktop[0].components[1].validation.role, 'content');
        const quality = await qualityReport(run.id);
        const manifest = await writeArtifacts(run.id, quality);
        assert(manifest.some(m => m.file === 'export/component-validation.json'));
        const validation = JSON.parse(await readFile(inRun(run.id, 'export/component-validation.json'), 'utf8'));
        assert.equal(validation.findings.length, 10);
        assert.equal(await readFile(rawFile, 'utf8'), rawBefore, 'raw detection evidence is never rewritten');
        // Missing HTML has an explicit uncertainty result, never an invented zero-component clean inventory.
        await writeFile(inRun(run.id, `html/desktop/${run.pages[0].slug}.html`), '');
        const uncertain = await buildPageData(run.id, 'desktop', urls[0]);
        assert.equal(uncertain.validation.counts.uncertain, 5);
        assert((await qualityReport(run.id)).flags.some(f => f.code === 'component-boundary-uncertain'));
    } finally {
        if (previous === undefined) delete process.env.CEST_RUNS_DIR; else process.env.CEST_RUNS_DIR = previous;
        await rm(root, { recursive: true, force: true });
    }
});

test('nested inner slider and slider-item families survive name rules and saved model merges', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'cest-nested-slider-'));
    const previous = process.env.CEST_RUNS_DIR;
    process.env.CEST_RUNS_DIR = root;
    try {
        const run = await createRun({ name: 'nested', urls: ['https://example.invalid/slider'], viewports: ['desktop'] });
        const slug = run.pages[0].slug;
        const defs = [
            ['I2', 'Slider Item', 2, 'I1', '#slide', {x:10,y:10,w:200,h:100}], // Child before its same-level parent.
            ['I1', 'Slider', 2, 'S1', '#slider', {x:0,y:0,w:500,h:200}],
            ['S1', 'Feature section', 1, null, '#section', {x:0,y:0,w:500,h:300}],
        ];
        const file = inRun(run.id, `html/desktop/${slug}.html`);
        await mkdir(path.dirname(file), { recursive: true });
        await writeFile(file, '<section id="section"><div id="slider" class="swiper"><div id="slide" class="swiper-slide"><img></div><div class="swiper-slide"><img></div></div></section>');
        await writeJson(inRun(run.id, `rects/desktop/${slug}.json`), defs.map(([, , , , s, box]) => ({s,...box})));
        await writeJson(inRun(run.id, `llm/desktop/${slug}.json`), { warnings: [], components: defs.map(([id,name,level,parent,selector,box]) => ({id,name,level,parent,box,contains:[],reusable:false,repeated:true})) });
        await updateRun(run.id, r => {r.pages[0].viewports.desktop={status:'ok',width:500,height:600,shot:true};});
        assert.equal((await buildList(run.id)).summary.total, 3, 'deterministic generic item-name rules cannot collapse parent and child');
        await writeJson(inRun(run.id, 'buildlist-consolidation.json'), {groups:[{keys:['2:slider','2:slideritem'],name:'Merged slider',source:'model'}]});
        const list = await buildList(run.id);
        assert.equal(list.summary.total, 3);
        assert.deepEqual(list.entries.find(e=>e.name==='Slider').children, ['Slider Item']);
        assert.deepEqual(list.entries.find(e=>e.name==='Slider Item').hosts, ['Slider']);
        assert(!list.entries.some(e=>e.name==='Merged slider'));
        assert(list.entries.some(c=>c.name==='Slider Item'));
    } finally {
        if (previous === undefined) delete process.env.CEST_RUNS_DIR; else process.env.CEST_RUNS_DIR=previous;
        await rm(root, {recursive:true,force:true});
    }
});

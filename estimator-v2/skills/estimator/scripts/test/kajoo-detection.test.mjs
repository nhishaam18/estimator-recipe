import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { prepareDetection, importDetection, loadLlm, llmFile } from '../lib/detect.mjs';
import { createRun, inRun, writeJson, updateRun } from '../lib/store.mjs';

async function fixture(t, { height = 180, viewports = ['desktop'] } = {}) {
    const root = await mkdtemp(path.join(os.tmpdir(), 'kajoo-native-'));
    const prior = process.env.CEST_RUNS_DIR;
    process.env.CEST_RUNS_DIR = root;
    t.after(async () => { if (prior === undefined) delete process.env.CEST_RUNS_DIR; else process.env.CEST_RUNS_DIR = prior; await rm(root, { recursive: true, force: true }); });
    const run = await createRun({ urls: ['https://example.test/'], viewports, settings: { tileHeight: 100, tileOverlap: 20, coordMode: 'pixels' } });
    await updateRun(run.id, r => { r.selection = Object.fromEntries(viewports.map(vp => [vp, r.urls])); });
    for (const vp of viewports) {
        const png = await sharp({ create: { width: 120, height, channels: 3, background: '#eeeeee' } }).png().toBuffer();
        // writeJson creates the parent directory without needing browser capture.
        await writeJson(inRun(run.id, `shots/${vp}/placeholder.json`), {});
        await writeFile(inRun(run.id, `shots/${vp}/${run.pages[0].slug}.png`), png);
        await writeJson(inRun(run.id, `rects/${vp}/${run.pages[0].slug}.json`), []);
    }
    return { run, root, slug: run.pages[0].slug };
}
const reply = (name = 'Hero') => ({ coordinate_space: { width: 120, height: 100 }, components: [{ id: 'S1', parent: null, name, level: 1, box: [0, 0, 100, 120], reusable: true, contains: [] }] });
async function submit(run, req, value = reply(), metadata) {
    if (typeof value !== 'string' && value.coordinate_space) {
        const full = JSON.parse(await readFile(inRun(run.id, req.requestFile)));
        value = { ...value, inspection: value.inspection ?? { imageHash: full.imageHash, viewport: full.viewport, tileIndex: full.tile.index, summary: 'Inspected the current fixture tile independently.' } };
    }
    const file = inRun(run.id, 'fixture-result.json');
    await writeFile(file, typeof value === 'string' ? value : JSON.stringify(value));
    return importDetection(run.id, req.id, file, metadata);
}

test('partial-render component imports complete normally and retain nonblocking gaps without another packet',async t=>{
 const {run,slug}=await fixture(t,{height:100});const req=(await prepareDetection(run.id)).requests[0];
 const value=reply('Identifiable banner');value.components[0].gaps=['image','icon'];value.components[0].contains=['title','image','icon'];
 const imported=await submit(run,req,value);assert.equal(imported.pageComplete,true);assert.equal(imported.reviewRequired,false);assert.equal(imported.pending,0);
 const merged=await loadLlm(run.id,'desktop',slug);assert.equal(merged.components.length,1);assert.deepEqual(merged.components[0].gaps,['image','icon']);assert.match(merged.warnings.join('\n'),/Incomplete render \(nonblocking\)/);
 assert.equal((await prepareDetection(run.id)).status,'complete');assert.equal((await prepareDetection(run.id)).requests.length,0);
});

test('native requests merge overlapping tiles independently across viewports and preserve raw results', async t => {
    const { run, slug } = await fixture(t, { viewports: ['desktop'] });
    const before = await prepareDetection(run.id);
    assert.equal(before.status, 'awaiting-analysis');
    assert.equal(before.pending, 2);
    assert.equal(before.requests.length, 2);
    assert.deepEqual(Object.keys(before.requests[0]), ['id', 'requestFile', 'image', 'promptFile']);
    const requests = await Promise.all(before.requests.map(async req => ({ ...req, full: JSON.parse(await readFile(inRun(run.id, req.requestFile))) })));
    assert.match(await readFile(inRun(run.id, requests[0].promptFile), 'utf8'), /Image-content rule/);
    assert.equal((await sharp(inRun(run.id, requests[0].image)).metadata()).format, 'jpeg');
    const first = await submit(run, requests[0], reply(), { model: 'configured-platform-model', traceId: 'trace-1' });
    assert.equal(first.pageComplete, false);
    assert.equal(first.pending, 1);
    assert.ok(!(await prepareDetection(run.id)).requests.some(r => r.id === requests[0].id));
    assert.equal(await loadLlm(run.id, 'desktop', slug), null);
    for (const req of requests.slice(1)) await submit(run, req);
    const result = await loadLlm(run.id, 'desktop', slug);
    assert.equal(result.components.length, 1);
    assert.deepEqual(result.components[0].box, { x: 0, y: 0, w: 120, h: 180 });
    assert.equal(result.usage, null);
    assert.equal(result.analysis.metadata[0].traceId, 'trace-1');

    assert.equal((await prepareDetection(run.id)).status, 'complete');
    assert.deepEqual(JSON.parse(await readFile(inRun(run.id, `analysis-results/${requests[0].id}/response.json`))).components, reply().components);
});

test('rejects unbound or wrong-viewport analysis, coordinate scales and unsupported parent geometry', async t => {
    const { run } = await fixture(t, { height: 100 });
    const req = (await prepareDetection(run.id)).requests[0];
    await assert.rejects(submit(run, req, JSON.stringify(reply())), /inspection/i);
    const full = JSON.parse(await readFile(inRun(run.id, req.requestFile)));
    await assert.rejects(submit(run, req, { ...reply(), inspection: { imageHash: full.imageHash, viewport: 'mobile', tileIndex: 0, summary: 'Looked at mobile instead of desktop.' } }), /inspection/i);
    await assert.rejects(submit(run, req, { ...reply(), coordinate_space: { width: 1000, height: 1000 } }), /coordinate space/i);
    const badParent = { ...reply(), components: [{ ...reply().components[0], box: [0, 0, 30, 120] }, { id: 'I1', parent: 'S1', level: 2, name: 'Card', box: [60, 0, 100, 120] }] };
    await assert.rejects(submit(run, req, badParent), /parent/i);
    await assert.rejects(submit(run, req, { ...reply(), components: [] }), /emptyReason/i);
});

test('corrections archive the original response and invalidate the merged page', async t => {
    const { run, slug } = await fixture(t, { height: 100 });
    const req = (await prepareDetection(run.id)).requests[0];
    await submit(run, req);
    const first = JSON.parse(await readFile(inRun(run.id, `analysis-results/${req.id}/import.json`)));
    const full = JSON.parse(await readFile(inRun(run.id, req.requestFile)));
    const file = inRun(run.id, 'correction.json');
    await writeJson(file, { ...reply('Corrected Hero'), inspection: { imageHash: full.imageHash, viewport: full.viewport, tileIndex: full.tile.index, summary: 'Re-inspected this exact tile to correct its component label.' } });
    await importDetection(run.id, req.id, file, {}, { replace: true });
    const next = JSON.parse(await readFile(inRun(run.id, `analysis-results/${req.id}/import.json`)));
    assert.equal(next.revision, 1);
    assert.equal(next.previousResults[0].resultHash, first.resultHash);
    assert.equal(JSON.parse(await readFile(inRun(run.id, next.previousResults[0].rawFile))).components[0].name, 'Hero');
    assert.equal((await loadLlm(run.id, 'desktop', slug)).components[0].name, 'Corrected Hero');
});

test('imports are idempotent; conflicting results and invalid shapes are rejected', async t => {
    const { run } = await fixture(t, { height: 100 });
    const req = (await prepareDetection(run.id)).requests[0];
    for (const invalid of ['not json', {}, { coordinate_space: { width: 120, height: 100 }, components: [{}] }, { ...reply(), components: [{ ...reply().components[0], box: [0, 0, 101, 120] }] }])
        await assert.rejects(submit(run, req, invalid), /JSON|Invalid analysis/);
    await assert.rejects(submit(run, req, ' '.repeat(4 * 1024 * 1024 + 1)), /exceeds/);
    await submit(run, req);
    const saved = await readFile(inRun(run.id, `analysis-results/${req.id}/import.json`), 'utf8');
    assert.equal((await submit(run, req)).idempotent, true);
    assert.equal(await readFile(inRun(run.id, `analysis-results/${req.id}/import.json`), 'utf8'), saved);
    await assert.rejects(submit(run, req, reply('Different')), /Conflicting result/);
});

test('changed screenshot, prompt settings and request files invalidate imports and native caches', async t => {
    const { run, slug } = await fixture(t, { height: 100 });
    const req = (await prepareDetection(run.id)).requests[0];
    await submit(run, req);
    await updateRun(run.id, r => { r.settings.prompt += '\nUse current evidence.'; });
    assert.equal(await loadLlm(run.id, 'desktop', slug), null);
    await assert.rejects(submit(run, req), /Stale or changed/);
    const next = (await prepareDetection(run.id)).requests[0];
    assert.notEqual(next.id, req.id);
    await submit(run, next);
    await sharp({ create: { width: 120, height: 100, channels: 3, background: '#111111' } }).png().toFile(inRun(run.id, `shots/desktop/${slug}.png`));
    assert.equal(await loadLlm(run.id, 'desktop', slug), null);
    await assert.rejects(submit(run, next), /Stale or changed/);
    const fresh = (await prepareDetection(run.id)).requests[0];
    const full = JSON.parse(await readFile(inRun(run.id, fresh.requestFile)));
    await writeJson(inRun(run.id, fresh.requestFile), { ...full, tile: { ...full.tile, top: 1 } });
    await assert.rejects(submit(run, fresh), /Stale or changed/);
});

test('changed prepared prompt and tile bytes are rejected', async t => {
    const { run } = await fixture(t, { height: 100 });
    let req = (await prepareDetection(run.id)).requests[0];
    await writeFile(inRun(run.id, req.promptFile), 'changed');
    await assert.rejects(submit(run, req), /image or prompt changed/);
    req = (await prepareDetection(run.id)).requests[0];
    await writeFile(inRun(run.id, req.image), 'changed');
    await assert.rejects(submit(run, req), /image or prompt changed/);
});

test('native image guard filters raster controls while legacy cache validation remains supported', async t => {
    const { run, slug } = await fixture(t, { height: 100 });
    await writeJson(inRun(run.id, `rects/desktop/${slug}.json`), [{ t: 'img', s: 'img#demo', x: 0, y: 0, w: 120, h: 100 }]);
    const req = (await prepareDetection(run.id)).requests[0];
    const value = reply('Illustrated control'); value.components[0].box = [10, 10, 40, 60];
    await submit(run, req, value);
    const native = await loadLlm(run.id, 'desktop', slug);
    assert.equal(native.components.length, 0);
    assert.equal(native.imageValidation.findings[0].decision, 'excluded');
    await writeJson(llmFile(run.id, 'desktop', slug), { components: [{ id: 'S1', name: 'Illustrated button', box: { x: 10, y: 10, w: 50, h: 30 }, contains: [] }] });
    assert.equal((await loadLlm(run.id, 'desktop', slug)).components.length, 0);
    assert.equal((await prepareDetection(run.id)).pending, 0);
});

test('empty selection or missing captures block instead of reporting complete', async t => {
    const { run, slug } = await fixture(t);
    await rm(inRun(run.id, `shots/desktop/${slug}.png`));
    await assert.rejects(prepareDetection(run.id), /Detection blocked.*capture/);
    await updateRun(run.id, r => { r.selection = {}; });
    await assert.rejects(prepareDetection(run.id), /Detection blocked/);
});

test('completed native cache rejects altered raw responses and missing response evidence', async t => {
    const { run, slug } = await fixture(t, { height: 100 });
    const req = (await prepareDetection(run.id)).requests[0];
    await submit(run, req);
    const receipt = JSON.parse(await readFile(inRun(run.id, `analysis-results/${req.id}/import.json`)));
    const rawFile = inRun(run.id, receipt.rawFile);
    const original = await readFile(rawFile);
    await writeFile(rawFile, JSON.stringify(reply('Changed raw response')));
    await assert.rejects(loadLlm(run.id, 'desktop', slug), /Stored result was changed/);
    await assert.rejects(prepareDetection(run.id), /Stored result was changed/);
    await writeFile(rawFile, original);
    await rm(rawFile);
    await assert.rejects(loadLlm(run.id, 'desktop', slug), /original imported response is missing/);
    await assert.rejects(prepareDetection(run.id), /original imported response is missing/);
});

test('completed native cache rejects altered boxes and revalidates every request proof', async t => {
    const { run, slug } = await fixture(t, { height: 100 });
    const req = (await prepareDetection(run.id)).requests[0];
    await submit(run, req);
    const cacheFile = llmFile(run.id, 'desktop', slug);
    const originalCache = await readFile(cacheFile);
    const cache = JSON.parse(originalCache); cache.components[0].box.w = 1;
    await writeJson(cacheFile, cache);
    await assert.rejects(loadLlm(run.id, 'desktop', slug), /component cache was changed/);
    await assert.rejects(prepareDetection(run.id), /component cache was changed/);
    await writeFile(cacheFile, originalCache);
    for (const rel of [req.requestFile, req.promptFile, req.image]) {
        const file = inRun(run.id, rel);
        const original = await readFile(file);
        await writeFile(file, rel === req.requestFile ? JSON.stringify({ ...JSON.parse(original), url: 'https://changed.test/' }) : 'changed');
        await assert.rejects(loadLlm(run.id, 'desktop', slug), /Stored analysis.*changed/);
        await assert.rejects(prepareDetection(run.id), /Stored analysis.*changed/);
        await writeFile(file, original);
    }
    // Missing prepared artifacts can be reconstructed from unchanged source evidence.
    await rm(inRun(run.id, req.image));
    assert.equal(await loadLlm(run.id, 'desktop', slug), null);
    assert.equal((await prepareDetection(run.id)).status, 'complete');
    assert.equal((await loadLlm(run.id, 'desktop', slug)).components.length, 1);
});



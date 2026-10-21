import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import sharp from 'sharp';
import { recoverCapture } from '../lib/capture-recovery.mjs';
import { prepareDetection, importDetection } from '../lib/detect.mjs';
import { DEFAULT_SETTINGS } from '../lib/prompt.mjs';
import { loadLazyContent } from '../lib/pageprep.mjs';
import { getRun, inRun, readJson, updateRun, writeJson } from '../lib/store.mjs';

const url = 'https://example.test/', other = 'https://example.test/good';
const inputs = { 'shots/desktop/home.png': 'original image', 'html/desktop/home.html': '<main>original</main>', 'rects/desktop/home.json': '[]', 'scan/desktop/home.json': '{}', 'analysis/desktop/home.json': '{}' };
async function fixture(t, state = { status: 'failed', error: 'popup obstructs capture', shot: true }) {
    const root = await mkdtemp(path.join(os.tmpdir(), 'capture-recovery-'));
    const previous = process.env.CEST_RUNS_DIR;
    process.env.CEST_RUNS_DIR = root;
    t.after(async () => { if (previous === undefined) delete process.env.CEST_RUNS_DIR; else process.env.CEST_RUNS_DIR = previous; await rm(root, { recursive: true, force: true }); });
    await writeJson(inRun('test', 'run.json'), { id: 'test', viewports: ['desktop'], selection: { desktop: [url, other] }, settings: {},
        pages: [{ url, slug: 'home', viewports: { desktop: state } }, { url: other, slug: 'good', viewports: { desktop: { status: 'ok', shot: true } } }] });
    for (const [rel, content] of Object.entries({ ...inputs, 'shots/desktop/good.png': 'good image', 'analysis-results/kept/import.json': '{"retained":true}', 'llm/desktop/home.json': '{"components":[]}' })) {
        await mkdir(path.dirname(inRun('test', rel)), { recursive: true }); await writeFile(inRun('test', rel), content);
    }
    await writeJson(inRun('test', 'discovery-checkpoint.json'), { completed: ['capture', 'detect', 'report'] });
    await writeJson(inRun('test', 'analysis-requests/manifest.json'), { requests: ['successful partial tile'] });
}
function candidate(changes = {}, state = { status: 'ok', shot: true, width: 1440, height: 900 }) {
    return async (run, page, prefix) => {
        assert.equal(run.id, 'test'); assert.equal(page.url, url);
        for (const [rel, content] of Object.entries({ ...inputs, ...changes })) {
            await mkdir(path.dirname(inRun('test', `${prefix}/${rel}`)), { recursive: true }); await writeFile(inRun('test', `${prefix}/${rel}`), content);
        }
        return state;
    };
}

test('changed recovery archives evidence and affects only selected representative', async t => {
    await fixture(t);
    const result = await recoverCapture('test', { url, reason: 'failed' }, { capture: candidate({ 'shots/desktop/home.png': 'recovered image' }) });
    assert.equal(result.status, 'recovered'); assert.equal(result.invalidation.scope, 'selected-page');
    assert.equal(await readFile(inRun('test', `${result.retained}/shots/desktop/home.png`), 'utf8'), 'original image');
    assert.equal(await readFile(inRun('test', `${result.retained}/llm/desktop/home.json`), 'utf8'), '{"components":[]}');
    assert.equal(await readFile(inRun('test', 'shots/desktop/home.png'), 'utf8'), 'recovered image');
    assert.equal(await readFile(inRun('test', 'shots/desktop/good.png'), 'utf8'), 'good image');
    assert.deepEqual((await getRun('test')).pages[1].viewports.desktop, { status: 'ok', shot: true });
    assert.deepEqual((await readJson(inRun('test', 'discovery-checkpoint.json'))).completed, ['capture']);
    assert.deepEqual(await readJson(inRun('test', 'analysis-results/kept/import.json')), { retained: true });
    assert.deepEqual(await readJson(inRun('test', 'analysis-requests/manifest.json')), { requests: ['successful partial tile'] });
    await assert.rejects(recoverCapture('test', { url, reason: 'obstructed', diagnosis: 'Still obstructed in candidate' }, { capture: candidate() }), /exhausted/);
});

test('unchanged source preserves partial tile imports, checkpoint and current evidence', async t => {
    await fixture(t, { status: 'ok', shot: true, flags: ['1 of 3 images did not finish loading'] });
    const result = await recoverCapture('test', { url, reason: 'lazy-incomplete' }, { capture: candidate({ 'analysis/desktop/home.json': '{"newDiagnostics":true}' }) });
    assert.equal(result.status, 'unchanged'); assert.equal(result.invalidation.changed, false);
    assert.deepEqual((await readJson(inRun('test', 'discovery-checkpoint.json'))).completed, ['capture', 'detect', 'report']);
    assert.deepEqual(await readJson(inRun('test', 'analysis/desktop/home.json')), {});
    assert.deepEqual(await readJson(inRun('test', 'analysis-results/kept/import.json')), { retained: true });
});

test('failed candidate retains original current capture and records source-specific diagnostics', async t => {
    await fixture(t);
    const result = await recoverCapture('test', { url, reason: 'failed' }, { capture: candidate({ 'shots/desktop/home.png': 'bad candidate' }, { status: 'failed', httpStatus: 429, error: 'HTTP 429' }) });
    assert.equal(result.status, 'failed'); assert.equal(result.capture.httpStatus, 429);
    assert.equal(result.invalidation.previousEvidenceCurrent, true);
    assert.equal(await readFile(inRun('test', 'shots/desktop/home.png'), 'utf8'), 'original image');
    assert.equal((await getRun('test')).pages[0].viewports.desktop.status, 'failed');
    assert.equal((await readJson(inRun('test', result.receipt))).sourceHash, result.before.sourceHash);
    await assert.rejects(recoverCapture('test', { url, reason: 'failed' }, { capture: candidate() }), /exhausted/);
});

test('successful identical capture clears failed status without invalidating tile inputs', async t => {
    await fixture(t);
    const result = await recoverCapture('test', { url, reason: 'failed' }, { capture: candidate() });
    assert.equal(result.status, 'unchanged');
    assert.equal((await getRun('test')).pages[0].viewports.desktop.status, 'ok');
    assert.equal(result.invalidation.changed, false);
});

test('changed capture without optional analysis retains old analysis only in archive', async t => {
    await fixture(t);
    const create = candidate({ 'shots/desktop/home.png': 'changed image' });
    const result = await recoverCapture('test', { url, reason: 'failed' }, { capture: async (...args) => {
        const state = await create(...args);
        await rm(inRun('test', `${args[2]}/analysis/desktop/home.json`));
        return state;
    } });
    assert.equal(result.status, 'recovered');
    await assert.rejects(readFile(inRun('test', 'analysis/desktop/home.json')), { code: 'ENOENT' });
    assert.deepEqual(await readJson(inRun('test', `${result.retained}/analysis/desktop/home.json`)), {});
});

test('browser safety stop is preserved and prevents invoking capture', async t => {
    await fixture(t); const stop = { reason: 'HTTP 429', completed: 1 };
    await writeJson(inRun('test', 'browser-stop.json'), stop);
    await assert.rejects(recoverCapture('test', { url, reason: 'failed' }, { capture: () => assert.fail('browser must stay stopped') }), /remains stopped/);
    assert.deepEqual(await readJson(inRun('test', 'browser-stop.json')), stop);
});

test('active visual batch and interrupted recovery lock prevent overlapping capture', async t => {
    await fixture(t);
    await writeJson(inRun('test', 'visual-batches/active.json'), { batchId: 'active' });
    await assert.rejects(recoverCapture('test', { url, reason: 'failed' }), /active visual batch/);
    await rm(inRun('test', 'visual-batches/active.json'));
    await writeJson(inRun('test', 'capture-recovery/recovery.lock'), { pid: 'interrupted' });
    await assert.rejects(recoverCapture('test', { url, reason: 'failed' }), /active or interrupted/);
    assert.deepEqual(await readJson(inRun('test', 'capture-recovery/recovery.lock')), { pid: 'interrupted' });
});

test('successful captures require observed issue and only selected desktop URLs are accepted', async t => {
    await fixture(t, { status: 'ok', shot: true });
    await assert.rejects(recoverCapture('test', { url, reason: 'failed' }), /Successful capture/);
    await assert.rejects(recoverCapture('test', { url, reason: 'lazy-incomplete' }), /source-specific/);
    await assert.rejects(recoverCapture('test', { url: 'https://elsewhere.test/', reason: 'failed' }), /selected representative/);
    await assert.rejects(recoverCapture('test', { url, reason: 'failed', viewport: 'mobile' }), /desktop only/);
    const result = await recoverCapture('test', { url, reason: 'obstructed', diagnosis: 'Observed newsletter covering hero on screenshot' }, { capture: candidate() });
    assert.equal(result.status, 'unchanged');
});

test('browser setup failures consume the bounded attempt and retain evidence', async t => {
    await fixture(t);
    const result = await recoverCapture('test', { url, reason: 'failed' }, { capture: async () => { throw new Error('No preinstalled browser'); } });
    assert.equal(result.status, 'failed'); assert.match(result.error, /preinstalled browser/);
    await assert.rejects(recoverCapture('test', { url, reason: 'failed' }), /exhausted/);
    assert.equal(await readFile(inRun('test', 'shots/desktop/home.png'), 'utf8'), 'original image');
});

test('lazy traversal stays bounded and reports incomplete reveals without styling content', async () => {
    let scrolls = 0;
    const page = { waitForTimeout: async () => {}, evaluate: async fn => {
        const script = String(fn);
        assert.doesNotMatch(script, /classList|style\.(?:opacity|visibility|display)|innerHTML\s*=/);
        if (script.includes('window.scrollBy')) { scrolls++; return; }
        if (script.includes('document.images')) return { images: 1, pending: 1 };
        if (script.includes('scrollHeight')) return 100000;
        if (script.includes('window.scrollY')) return 900;
    } };
    const result = await loadLazyContent(page, { maxSteps: 100000, maxDurationMs: 100000 });
    assert.equal(scrolls, 80); assert.equal(result.steps, 80); assert.equal(result.reachedEnd, false); assert.equal(result.pending, 1);
});

for (const changed of [false, true]) test(`real partial tile imports ${changed ? 'remain archived when whole source changes' : 'remain reusable when recovery source is unchanged'}`, async t => {
    await fixture(t, { status: 'ok', shot: true, flags: ['1 of 3 images did not finish loading'] });
    await updateRun('test', run => { run.urls = [url, other]; run.selection.desktop = [url]; run.settings = { ...DEFAULT_SETTINGS, tileHeight: 100, tileOverlap: 20, coordMode: 'pixels' }; });
    await rm(inRun('test', 'llm/desktop/home.json'));
    const png = await sharp({ create: { width: 120, height: 180, channels: 3, background: '#eeeeee' } }).png().toBuffer();
    await writeFile(inRun('test', 'shots/desktop/home.png'), png);
    const initial = await prepareDetection('test'), first = initial.requests[0];
    assert.equal(initial.pending, 2);
    const request = await readJson(inRun('test', first.requestFile));
    const raw = 'fixture-result.json';
    await writeJson(inRun('test', raw), { coordinate_space: { width: 120, height: 100 },
        components: [{ id: 'S1', parent: null, name: 'Hero', level: 1, box: [0, 0, 100, 120], reusable: true, contains: [] }],
        inspection: { imageHash: request.imageHash, viewport: 'desktop', tileIndex: request.tile.index, summary: 'Inspected this fixture tile independently.' } });
    await importDetection('test', first.id, inRun('test', raw));
    const imported = await readFile(inRun('test', `analysis-results/${first.id}/import.json`), 'utf8');
    const nextPng = changed ? await sharp({ create: { width: 120, height: 180, channels: 3, background: '#ffffee' } }).png().toBuffer() : png;
    const result = await recoverCapture('test', { url, reason: 'lazy-incomplete' }, { capture: candidate({ 'shots/desktop/home.png': nextPng }) });
    assert.equal(result.status, changed ? 'recovered' : 'unchanged');
    const next = await prepareDetection('test');
    assert.equal(next.pending, changed ? 2 : 1);
    assert.equal(await readFile(inRun('test', `analysis-results/${first.id}/import.json`), 'utf8'), imported);
    if (changed) assert(next.requests.every(r => !initial.requests.some(old => old.id === r.id)));
    else assert.deepEqual(next.requests.map(r => r.id), [initial.requests[1].id]);
});

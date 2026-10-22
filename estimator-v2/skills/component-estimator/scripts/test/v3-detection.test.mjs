import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { createRun, inRun, updateRun, writeJson, readJson } from '../lib/store.mjs';
import { prepareDetection, settleDetection, tileRanges } from '../lib/detect.mjs';

test('structural tile seams retain overlap and positive progress', () => {
  const ranges = tileRanges(3500, 1500, 120, [{ t: 'section', y: 1400, h: 800 }]);
  assert(ranges.length >= 3);
  assert.equal(ranges[0].top, 0);
  assert.equal(ranges[0].height, 1400);
  assert(ranges[1].top < 1400);
  assert.equal(ranges.at(-1).top + ranges.at(-1).height, 3500);
});

test('one screenshot is a barrier; completed tiles survive and exact repeat tiles reuse', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'estimator-v3-detect-'));
  process.env.CEST_RUNS_DIR = root;
  try {
    const urls = ['https://example.invalid/a', 'https://example.invalid/b'];
    const run = await createRun({ name: 'barrier', urls, viewports: ['desktop'], settings: { tileHeight: 1200, tileOverlap: 100 } });
    await updateRun(run.id, r => { r.selection = { desktop: urls }; for (const p of r.pages) p.viewports.desktop = { status: 'ok', shot: true, width: 600, height: 2400 }; });
    const png = await sharp({ create: { width: 600, height: 2400, channels: 3, background: '#1555aa' } }).png().toBuffer();
    for (const p of run.pages) {
      await (await import('node:fs/promises')).mkdir(path.dirname(inRun(run.id, `shots/desktop/${p.slug}.png`)), { recursive: true });
      await (await import('node:fs/promises')).writeFile(inRun(run.id, `shots/desktop/${p.slug}.png`), png);
      await writeJson(inRun(run.id, `rects/desktop/${p.slug}.json`), []);
    }
    const first = await prepareDetection(run.id);
    assert.equal(first.page.url, urls[0]);
    assert(first.jobs.length >= 2);
    const one = first.jobs[0];
    await writeJson(one.resultFile, { requestId: one.requestId, imageHash: one.imageHash, tileIndex: one.tileIndex, viewport: one.viewport,
      coordinate_space: { width: 1000, height: 1000 }, components: [{ id: 'S1', parent: null, level: 1, name: 'Header', box: [0, 0, 150, 1000], contains: ['logo'], reusable: true }] });
    const waiting = await settleDetection(run.id);
    assert.equal(waiting.status, 'awaiting-analysis');
    assert.equal(waiting.remaining, first.jobs.length - 1);
    assert.equal((await prepareDetection(run.id)).page.url, urls[0]);
    for (const j of first.jobs.slice(1)) await writeJson(j.resultFile, { requestId: j.requestId, imageHash: j.imageHash, tileIndex: j.tileIndex, viewport: j.viewport,
      coordinate_space: { width: 1000, height: 1000 }, components: [] });
    assert.equal((await settleDetection(run.id)).status, 'page-complete');
    assert.equal((await readJson(inRun(run.id, `llm/desktop/${run.pages[0].slug}.json`))).components.length, 1);
    const second = await prepareDetection(run.id);
    assert.equal(second.page.url, urls[1]);
    assert.equal(second.jobs.length, 0, 'identical tile pixels and DOM rectangles reuse settled analysis');
    assert.equal((await settleDetection(run.id)).next, 'complete');
  } finally { await rm(root, { recursive: true, force: true }); delete process.env.CEST_RUNS_DIR; }
});

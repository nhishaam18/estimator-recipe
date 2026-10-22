import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { exportRun, pageMarkdown } from '../lib/report.mjs';
import { createRun, inRun, readJson, writeJson } from '../lib/store.mjs';
async function fixture(fn) {
  const previous=process.env.CEST_RUNS_DIR;
  const root=await mkdtemp(path.join(tmpdir(),'cest-report-'));
  process.env.CEST_RUNS_DIR=root;
  try {await fn(root);} finally {
    if(previous===undefined)delete process.env.CEST_RUNS_DIR;else process.env.CEST_RUNS_DIR=previous;
    await rm(root,{recursive:true,force:true});
  }
}
test('report table has five columns while annotation JSON retains box and scaled geometry', async () => fixture(async () => {
  const run = await createRun({ name: 'geometry', urls: ['https://example.com/'], viewports: ['desktop'] });
  const c = { id: 'S1', name: 'Hero', level: 1, parent: null, box: { x: 20, y: 10, w: 200, h: 100 }, frac: [0.01, 0.02, 0.11, 0.22], reusable: false, repeated: false, contains: [] };
  run.pages[0].viewports.desktop = { status: 'ok', width: 1000, height: 1000 };
  await writeJson(inRun(run.id, 'run.json'), run);
  await writeJson(inRun(run.id, `llm/desktop/${run.pages[0].slug}.json`), { components: [c], warnings: [], usage: {} });
  const markdown = pageMarkdown({ url: run.urls[0], viewport: 'desktop', width: 1000, height: 1000, warnings: [], components: [c], diff: { agreed: 0, llmOnly: ['S1'], domOnly: [] } }, 1000);
  for (const line of markdown.split('\n').filter(line => line.startsWith('|'))) assert.equal(line.split('|').length - 2, 5);
  assert.doesNotMatch(markdown, /Coordinates|Pixels/);
  await exportRun(run.id, null, { skipImages: true });
  const {readFile}=await import('node:fs/promises');
  const report=await readFile(inRun(run.id,'export/report.md'),'utf8');
  assert.doesNotMatch(report,/review\.html|review\.zip/);
  assert.match(report,/Component implementation outlines/);
  assert.match(report,/Owned fields remain inside its component/);
  assert.doesNotMatch(report,/Estimator\.lite/);
  const annotations = await readJson(inRun(run.id, 'export/annotations.json'));
  const annotated = annotations.pages.desktop[0].components[0];
  assert.deepEqual(annotated.box, c.box);
  assert.equal(annotated.coords, '[10, 20, 110, 220]');
  assert.deepEqual(annotations.coordinateOrder, ['ymin', 'xmin', 'ymax', 'xmax']);
}));

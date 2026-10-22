import { test } from 'node:test';
import assert from 'node:assert/strict';
import { summarizeCoverage, coverageReport } from '../lib/coverage.mjs';
import { summarizeCosts } from '../lib/costs.mjs';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { inRun, writeJson } from '../lib/store.mjs';

test('42 annotations plus eight explicit intentional skips account for 50 views', () => {
  const entries = [...Array.from({ length: 42 }, () => ({ status: 'done' })), ...Array.from({ length: 8 }, () => ({ status: 'skipped', reason: 'not selected' }))];
  const summary = summarizeCoverage(entries);
  assert.equal(summary.complete, true);
  assert.equal(summary.done + summary.skipped, summary.total);
  entries[0] = { status: 'missing', reason: 'DOM annotation' };
  assert.equal(summarizeCoverage(entries).complete, false);
});

test('Kajoo model and orchestration cost remain unknown to scripts', () => {
  const run = { usage: { costUsd: 0.08, calls: 130 }, consolidationUsage: { costUsd: 0.02, calls: 2 }, settings: { maxCostUsd: 5 } };
  const costs = summarizeCosts(run, { at: 'legacy', usage: { costUsd: 0.01 } });
  assert.equal(costs.modelUsd, null);
  assert.equal(costs.orchestrationUsd, null);
  assert.deepEqual(summarizeCosts(run), costs);
});

test('file-based coverage requires outputs and records intentional secondary-viewport skips', async () => {
  const previous = process.env.CEST_RUNS_DIR;
  const root = await mkdtemp(path.join(tmpdir(), 'cest-coverage-'));
  process.env.CEST_RUNS_DIR = root;
  try {
    const selected = 'https://fixture.test/selected';
    const other = 'https://fixture.test/other';
    await writeJson(inRun('fixture', 'run.json'), { mode: 'compare-first', viewports: ['desktop', 'mobile'], selection: { desktop: [selected], mobile: [selected] }, pages: [
      { url: selected, slug: 'selected', viewports: { desktop: { status: 'ok', shot: true }, mobile: { status: 'ok', shot: true } } },
      { url: other, slug: 'other', viewports: { desktop: { status: 'ok', shot: false } } },
    ] });
    await writeJson(inRun('fixture', 'export/annotations.json'), { pages: { desktop: [{ url: selected, source: 'llm' }, { url: other, source: 'propagated' }], mobile: [{ url: selected, source: 'llm' }] } });
    for (const vp of ['desktop', 'mobile']) {
      await writeJson(inRun('fixture', `llm/${vp}/selected.json`), {});
      await writeJson(inRun('fixture', `shots/${vp}/selected.png`), {});
      await writeJson(inRun('fixture', `export/annotated/${vp}/selected.png`), {});
      await writeJson(inRun('fixture', `export/dom/${vp}/selected.html`), {});
    }
    await writeJson(inRun('fixture', 'export/dom/desktop/other.html'), {});
    const complete = await coverageReport('fixture', { persist: true });
    assert.equal(complete.complete, true); assert.equal(complete.done, 3); assert.equal(complete.skipped, 1);
    await rm(inRun('fixture', 'export/annotated/mobile/selected.png'));
    const gap = await coverageReport('fixture');
    assert.equal(gap.complete, false); assert.equal(gap.missing, 1);
    await writeFile(inRun('fixture', 'export/annotated/mobile/selected.png'), 'fixture');
    await writeJson(inRun('fixture', 'export/annotations.json'), { pages: {} });
    assert.equal((await coverageReport('fixture')).missing, 3);
  } finally {
    if (previous === undefined) delete process.env.CEST_RUNS_DIR; else process.env.CEST_RUNS_DIR = previous;
    await rm(root, { recursive: true, force: true });
  }
});

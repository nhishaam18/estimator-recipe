import { getRun, inRun, readJson, exists, writeJson } from './store.mjs';
import { compareViewport, hasShot } from './types.mjs';

export function summarizeCoverage(entries) {
  const skipped = entries.filter(e => e.status === 'skipped');
  const missing = entries.filter(e => e.status === 'missing');
  return { complete: missing.length === 0, total: entries.length, done: entries.filter(e => e.status === 'done').length,
    skipped: skipped.length, missing: missing.length,
    skipReasons: [...new Set(skipped.map(e => e.reason))], detailFile: 'export/coverage.json' };
}

/** Every requested page/viewport must have its required outputs or an explicit intentional skip. */
export async function coverageReport(id, { persist = false } = {}) {
  const run = await getRun(id);
  const annotations = await readJson(inRun(id, 'export/annotations.json'), { pages: {} });
  const cv = compareViewport(run.viewports);
  const entries = [];
  for (const p of run.pages) for (const vp of run.viewports) {
    const selected = (run.selection[vp] ?? []).includes(p.url);
    const state = p.viewports[vp];
    const e = { url: p.url, viewport: vp, status: 'done' };
    if (!selected && vp !== cv && !state && p.viewports[cv]?.status === 'ok' && run.mode === 'compare-first') {
      e.status = 'skipped'; e.reason = 'Non-selected viewport is intentionally not captured in compare-first mode; no annotation or DOM view is claimed.';
    } else {
      const missing = [];
      if (state?.status !== 'ok') missing.push(state?.status === 'failed' ? 'page capture failed' : 'page not scanned');
      if (!annotations.pages?.[vp]?.some(a => a.url === p.url && ['llm', 'propagated'].includes(a.source))) missing.push('component labels');
      if (selected && (!hasShot(state) || !(await exists(inRun(id, `shots/${vp}/${p.slug}.png`))))) missing.push('selected screenshot');
      if (selected && !(await exists(inRun(id, `llm/${vp}/${p.slug}.json`)))) missing.push('model result');
      if (state?.status === 'ok' && hasShot(state) && !(await exists(inRun(id, `export/annotated/${vp}/${p.slug}.png`)))) missing.push('annotated screenshot');
      if (missing.length) { e.status = 'missing'; e.reason = missing.join(', '); }
    }
    entries.push(e);
  }
  const summary = summarizeCoverage(entries);
  if (persist) await writeJson(inRun(id, summary.detailFile), { ...summary, entries });
  return summary;
}

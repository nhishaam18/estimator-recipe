// Automatic quality checks. With nobody reviewing the run, these decide what is flagged in the report.
import { buildPageData } from './pagedata.mjs';
import { getRun, inRun, exists, writeJson } from './store.mjs';
import { hasShot, compareViewport } from './types.mjs';
import { loadLlm } from './detect.mjs';
import { coverageReport } from './coverage.mjs';

const OVERLAY_TYPES = new Set(['cookie-banner', 'modal']);

export async function qualityReport(runId) {
  const run = await getRun(runId);
  const flags = [];
  const flag = (severity, code, message, extra = {}) => flags.push({ severity, code, message, ...extra });
  const path = (u) => new URL(u).pathname || '/';
  const cv = compareViewport(run.viewports);

  for (const p of run.pages) {
    for (const vp of run.viewports) {
      const st = p.viewports[vp];
      if (st?.status === 'failed') flag('medium', 'page-failed', `${path(p.url)} (${vp}) could not be captured: ${st.error ?? 'unknown error'}`, { url: p.url, viewport: vp });
      for (const f of st?.flags ?? []) if (/empty shell|bot protection/.test(f)) flag('medium', 'page-limited', `${path(p.url)} (${vp}): ${f}`, { url: p.url, viewport: vp });
      if (st?.status === 'ok' && hasShot(st) && !st.evidence) flag('low', 'missing-style-evidence', `${path(p.url)} (${vp}): measured styles are unavailable; the estimate and report carry this limitation.`, {url:p.url,viewport:vp});
      for (const f of st?.flags ?? []) if (/font.*(?:failed|timed out)|images did not finish|analysis unavailable/i.test(f)) flag('medium', 'capture-evidence-limited', `${path(p.url)} (${vp}): ${f}`, {url:p.url,viewport:vp});
    }
  }
  if (run.pages.every((p) => p.viewports[cv]?.status !== 'ok')) flag('high', 'nothing-scanned', 'No page could be scanned.');

  let withResult = 0;
  let expected = 0;
  for (const vp of run.viewports) {
    for (const url of run.selection[vp] ?? []) {
      const p = run.pages.find((x) => x.url === url);
      if (!p) continue;
      expected++;
      const llm = await loadLlm(runId, vp, p.slug);
      if (!llm) {
        flag('high', 'no-model-result', `${path(url)} (${vp}) has no model result${hasShot(p.viewports[vp]) ? '' : ' (no screenshot)'}`, { url, viewport: vp });
        continue;
      }
      withResult++;
      for (const finding of llm.imageValidation?.findings ?? []) if (finding.decision === 'review') flag('medium', 'image-overlap-review', `${path(url)} (${vp}): ${finding.name}: ${finding.reason}`, {url,viewport:vp,componentId:finding.componentId});
      if (!llm.components.length) flag('high', 'no-components', `${path(url)} (${vp}): the model returned no usable components`, { url, viewport: vp });
      const bad = llm.warnings.filter((w) => /unreadable|failed/.test(w)).length;
      if (bad) flag('medium', 'model-warnings', `${path(url)} (${vp}): ${bad} tile(s) had unreadable or failed replies`, { url, viewport: vp });
      const d = await buildPageData(runId, vp, url);
      // large page blocks in the DOM that the model did not box are the most likely misses
      const missed = d.dom.filter((b) => !b.matchedWith && !OVERLAY_TYPES.has(b.type) && b.box.w >= d.width * 0.5 && b.box.h >= 200);
      if (missed.length) flag('low', 'unboxed-blocks', `${path(url)} (${vp}): ${missed.length} large DOM block(s) were not boxed by the model`, { url, viewport: vp, count: missed.length });
    }
  }
  if (run.capped) flag('high', 'spending-cap', `The spending cap of $${run.settings.maxCostUsd} was reached; pages after that point have no model result.`);
  if (expected && withResult < expected) flag('high', 'incomplete', `${expected - withResult} of ${expected} selected page view(s) have no model result.`);
  const coverage = await coverageReport(runId, { persist: true });
  // Include propagated page results too; boundary uncertainty is independent of output-file coverage.
  for (const p of run.pages) for (const vp of run.viewports) {
    if (p.viewports[vp]?.status !== 'ok') continue;
    const data = await buildPageData(runId, vp, p.url);
    for (const c of data.components.filter(c => c.validation?.role === 'uncertain'))
      flag('medium', 'component-boundary-uncertain', `${path(p.url)} (${vp}): ${c.name}: ${c.validation.reason}. Excluded from implementation counts; inventory is provisional.`, { url: p.url, viewport: vp, componentId: c.id });
  }
  if (!coverage.complete) flag('high', 'output-incomplete', `${coverage.missing} requested page view(s) lack required labels or annotation outputs. Details: ${coverage.detailFile}`);

  const count = (s) => flags.filter((f) => f.severity === s).length;
  const result = {
    generatedAt: new Date().toISOString(),
    status: flags.some((f) => f.severity === 'high') ? 'incomplete' : flags.length ? 'flagged' : 'clean',
    counts: { high: count('high'), medium: count('medium'), low: count('low') },
    selectedPageViews: expected,
    withModelResult: withResult,
    coverage,
    flags,
  };
  await writeJson(inRun(runId, 'export/quality.json'), result);
  return result;
}

import { writeFile } from 'node:fs/promises';
import { getRun, inRun, writeJson } from './store.mjs';

const round = value => Math.round(value * 2) / 2;

/** A transparent planning rubric, not a model-generated implementation quote. */
export function estimateEntry(entry, { uncertain = false } = {}) {
  const fields = entry.contains?.length ?? 0;
  const children = entry.children?.length ?? 0;
  const isParent = entry.level === 1;
  const likely = round((isParent ? 5 : 3) + Math.min(fields, 12) * 0.75 + (entry.repeated ? 1.5 : 0) + (isParent ? Math.min(children, 6) * 0.75 : 0));
  const low = round(Math.max(1, likely * (uncertain ? 0.65 : 0.75)));
  const high = round(likely * (uncertain ? 2 : 1.5));
  return { id: entry.id, name: entry.name, level: entry.level === 1 ? 'Section' : 'Inner', lowHours: low, likelyHours: likely, highHours: high,
    rationale: `${fields} owned field(s), ${children} independent child family reference(s), ${entry.repeated ? 'repeated layout' : 'single layout'}.`,
    assumption: isParent ? 'Section hours cover layout and child integration; this excludes child implementation counted separately once.' : 'Hours cover one unique component family, not every occurrence.' };
}

export async function writeEstimates(runId, list) {
  const run = await getRun(runId);
  const targetCms = run.settings.targetCms || 'Sitecore';
  const uncertain = (list.validation?.counts?.uncertain ?? 0) > 0;
  const entries = list.entries.map(e => estimateEntry(e, { uncertain }));
  const summary = { components: entries.length, lowHours: round(entries.reduce((n, e) => n + e.lowHours, 0)),
    likelyHours: round(entries.reduce((n, e) => n + e.likelyHours, 0)), highHours: round(entries.reduce((n, e) => n + e.highHours, 0)),
    monetaryCost: null, rate: null, currency: null };
  const assumptions = [`Target CMS: ${targetCms}. CMS-specific content modeling and integrations require that CMS's guidelines.`,
    'These are preliminary implementation hours, not model usage cost or a fixed-price quote.',
    'Each unique component family is counted once across URLs and occurrences.',
    'Section composition/integration excludes independently estimated child implementation.',
    'Interactions, missing assets and unobserved responsive behavior may increase effort.',
    ...(uncertain ? ['Uncertain component boundaries widen the range.'] : [])];
  const result = { version: 1, targetCms, summary, assumptions, entries };
  await writeJson(inRun(runId, 'export/estimates.json'), result);
  const lines = ['# Component effort estimate', '', `**Target CMS:** ${targetCms}.`, '', `**Total:** ${summary.lowHours}–${summary.highHours} hours; likely ${summary.likelyHours} hours.`,
    '', 'Monetary cost: unavailable without a supplied hourly rate and currency.', '',
    '| ID | Component | Level | Low h | Likely h | High h | Basis |', '| --- | --- | --- | ---: | ---: | ---: | --- |',
    ...entries.map(e => `| ${e.id} | ${e.name.replaceAll('|', '\\|')} | ${e.level} | ${e.lowHours} | ${e.likelyHours} | ${e.highHours} | ${e.rationale} |`),
    '', '## Assumptions', '', ...assumptions.map(a => `- ${a}`), ''];
  await writeFile(inRun(runId, 'export/estimates.md'), lines.join('\n'), 'utf8');
  return result;
}

#!/usr/bin/env node
// Component Estimator command line. Results are one JSON object on stdout; progress goes to stderr.
// Exit codes: 0 done, 2 blocked (missing dependency or input; fix it and run again), 1 failed.
import { rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import path from 'node:path';
import { loadSkillSettings, SCRIPTS_DIR } from './lib/config.mjs';
import { resolveBrowserRuntime, launchBrowser } from './lib/browser.mjs';
import { persistPlan, persistSelection, readSelectedPlan, planSummary, withPlanLock, boundedJson, writePlanJson, urlGroupAccounting } from './lib/urlplanstore.mjs';

const argv = process.argv.slice(2);
const cmd = argv[0];
const args = {};
for (let i = 1; i < argv.length; i++) {
  if (!argv[i].startsWith('--')) continue;
  const key = argv[i].slice(2);
  const next = argv[i + 1];
  if (next === undefined || next.startsWith('--')) args[key] = true;
  else {
    args[key] = next;
    i++;
  }
}

const out = (obj, code = 0) => {
  process.stdout.write(`${JSON.stringify(obj)}\n`);
  process.exit(code);
};
const blocked = (reason, extra = {}) => out({ status: 'blocked', reason, ...extra }, 2);

const HELP = `Usage: node cest.mjs <command> [--run <id|folder>] [options]
  setup                          verify preinstalled Chromium and runtime dependencies (no browser installs)
  plan --url <seed> --discovery-file <json> save provisional URL groups before setup
  select --plan <folder> --quotas-file <json> save explicit quantities for every group
  init --selection <folder> [--cms <target>] use exactly the persisted selected URLs (resume safe)
  scan | group | capture        deterministic browser stages [--run <id>] [--minutes N]
  detect-prepare                prepare one desktop screenshot's visual jobs
  detect-settle                 validate all tile results and finish that screenshot
  annotate | report             draw and deliver saved evidence [--run <id>]
  all --through capture         checkpointed browser stages [--minutes N]
  status                        run counts and readiness`;

async function importOrNull(name) {
  try {
    return await import(name);
  } catch {
    return null;
  }
}

async function setup() {
  const installed = [];
  const [major,minor]=process.versions.node.split('.').map(Number);
  if (major < 20 || major===20 && minor<9) blocked('Select Node 20.9 or newer before setup.');
  let runtime;
  try { runtime = resolveBrowserRuntime(); }
  catch (e) { blocked(e.message, { ...env, installed }); }
  const run = (c, a) => spawnSync(c, a, { cwd: SCRIPTS_DIR, stdio: ['ignore', 'ignore', 'inherit'], timeout: 120000, env: { ...process.env, PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD: '1' }, shell: process.platform === 'win32' });
  const need = async () => {
    const require = createRequire(import.meta.url);
    const required = ['sharp','cheerio'];
    return required.some(name => { try { require.resolve(`${name}/package.json`); return false; } catch { return true; } });
  };
  if (await need()) {
    const hasLock = existsSync(path.join(SCRIPTS_DIR, 'package-lock.json'));
    const r = run('npm', [hasLock ? 'ci' : 'install']);
    if (r.status !== 0) blocked('Runtime dependency installation failed or exceeded 120 seconds. Provision these packages in the writable runtime before retrying; do not attempt browser repairs.', { installed });
    installed.push('npm packages');
  }
  try {
    const browser = await launchBrowser();
    await browser.close();
    const { default: sharp } = await import('sharp');
    await sharp({ create: { width: 2, height: 2, channels: 3, background: '#fff' } }).png().toBuffer();
    const { load } = await import('cheerio');
    if (load('<p>ready</p>')('p').text() !== 'ready') throw new Error('Cheerio health check failed');
  } catch {
    blocked('The preinstalled browser or image toolchain failed its health check. Verify the sandbox template and PLAYWRIGHT_BROWSERS_PATH; do not download Chromium or modify its cache.', { installed, playwrightVersion: runtime.version });
  }
  out({ status: 'ok', installed, browser: 'launch verified', playwrightVersion: runtime.version, browserSource: runtime.source, imageProcessing: 'verified' });
}

if (!cmd || cmd === 'help' || args.help) {
  process.stdout.write(`${HELP}\n`);
  process.exit(cmd ? 0 : 2);
}
if (cmd === 'setup') await setup();

let selectedInput;
// Planning and intake validation deliberately precede browser, dependency and key checks.
try {
  if (cmd === 'plan') {
    if (typeof args.url !== 'string' || typeof args['discovery-file'] !== 'string') blocked('plan requires --url and --discovery-file');
    const { plan, folder } = await persistPlan(args.url, args['discovery-file']);
    out({ status: 'awaiting-selection', planDir: folder, ...planSummary(plan) });
  }
  if (cmd === 'select') {
    if (typeof args.plan !== 'string' || typeof args['quotas-file'] !== 'string') blocked('select requires --plan and --quotas-file');
    const { plan, selection, resumed } = await persistSelection(path.resolve(args.plan), args['quotas-file']);
    out({ status: 'selected', planDir: path.resolve(args.plan), ...planSummary(plan), selected: selection.selectedUrls.length, deferred: selection.deferredCount, quotas: selection.quotas, selectionDigest: selection.selectionDigest, resumed });
  }
  if (cmd === 'init') {
    if (typeof args.selection !== 'string') blocked('--selection requires a saved planning folder');
    if (args.urls !== undefined || args['urls-file'] !== undefined) blocked('--selection cannot be combined with --urls or --urls-file');
    selectedInput = await readSelectedPlan(path.resolve(args.selection));
  }
} catch (error) { blocked(error.message); }

// everything below needs the dependencies
try { resolveBrowserRuntime(); } catch (e) { blocked(e.message); }
if (await (async () => !(await importOrNull('sharp')) || !(await importOrNull('cheerio')))()) {
  blocked('Dependencies are not installed. Run: node cest.mjs setup');
}

const store = await import('./lib/store.mjs');
const { newJob, logJob } = await import('./lib/jobs.mjs');
const types = await import('./lib/types.mjs');
const { coverageReport } = await import('./lib/coverage.mjs');
const { runCosts } = await import('./lib/costs.mjs');

function resolveRun() {
  const r = args.run;
  if (!r || r === true) blocked('--run <id or folder> is required');
  if (/[\\/]/.test(r)) {
    const abs = path.resolve(r);
    process.env.CEST_RUNS_DIR = path.dirname(abs);
    return path.basename(abs);
  }
  return r;
}

function jobFor(minutes) {
  const job = newJob();
  const m = Number(minutes ?? args.minutes);
  if (Number.isFinite(m) && m > 0) job.deadline = Date.now() + m * 60_000;
  return job;
}

const summarize = (stage, job, extra = {}) => ({ stage, done: job.done, total: job.total, timedOut: !!job.timedOut, capped: !!job.capped, ...(job.stopReason?{stopReason:job.stopReason}:{}), ...extra });

// The initial plan shows every group. Routine progress avoids repeating that table in agent context.
async function urlGroupSummary(run, options = {}) {
  const accounting = await urlGroupAccounting(run, options);
  if (!accounting) return null;
  const { groups, ...summary } = accounting;
  return { ...summary, groupCount: groups.length, file: 'export/url-groups.json' };
}

async function init() {
  const skill = loadSkillSettings();
  const { urls, invalid } = { urls: selectedInput.selection.selectedUrls, invalid: [] };
  if (!urls.length) blocked('No valid URLs in the list', { invalid });
  if (args.cms !== undefined && (typeof args.cms !== 'string' || !/^[\w .+-]{1,80}$/.test(args.cms) || !args.cms.trim())) blocked('--cms must be a short CMS name');
  const settings = {
    model: 'kajoo/visual-analysis', threshold: skill.threshold, tileHeight: skill.tileHeight, tileOverlap: skill.tileOverlap,
    captureConcurrency: skill.captureConcurrency, scanConcurrency: skill.scanConcurrency,
    coordMode: skill.coordMode, reportScale: skill.reportScale,
    targetCms: typeof args.cms === 'string' ? args.cms.trim() : 'Sitecore',
  };
  if (args.viewports && args.viewports !== 'desktop') blocked('Estimator 3.0.0 supports desktop only');
  const viewports = ['desktop'];
  const create = async () => {
    const folder = path.resolve(args.selection);
    const fresh = await readSelectedPlan(folder);
    if (fresh.selection.selectionDigest !== selectedInput.selection.selectionDigest) throw new Error('Selection changed during initialization');
    const bindingFile = path.join(folder, 'run-binding.json');
    let binding;
    try { binding = await boundedJson(bindingFile); } catch (error) { if (error.code !== 'ENOENT') throw error; }
    if (binding) {
      if (binding.selectionDigest !== fresh.selection.selectionDigest || typeof binding.runDir !== 'string') throw new Error('Stale selection run binding');
      const run = await boundedJson(path.join(binding.runDir, 'run.json'));
      if (JSON.stringify(run.urls) !== JSON.stringify(urls) || JSON.stringify(run.pages.map(p => p.url)) !== JSON.stringify(urls)) throw new Error('Bound run URLs differ from approved selection');
      process.env.CEST_RUNS_DIR = path.dirname(binding.runDir);
      let copied;
      try { copied = await boundedJson(store.inRun(run.id, 'input/url-selection.json')); }
      catch (error) { if (error.code !== 'ENOENT') throw error; }
      if (copied && JSON.stringify(copied) !== JSON.stringify(fresh.selection)) throw new Error('Bound run selection differs from approved selection');
      if (!copied) await store.writeJson(store.inRun(run.id, 'input/url-selection.json'), fresh.selection);
      if (!(await store.exists(store.inRun(run.id, 'input/url-plan.json')))) await store.writeJson(store.inRun(run.id, 'input/url-plan.json'), fresh.plan);
      await urlGroupAccounting(run, { persist: true });
      return { run, resumed: true };
    }
    const run = await store.createRun({ urls, viewports, name: typeof args.name === 'string' ? args.name : undefined, mode: skill.mode, settings });
    Object.assign(run, await store.updateRun(run.id, saved => { saved.urlPlanning = { planId: fresh.plan.id, selectionDigest: fresh.selection.selectionDigest }; }));
    // Bind immediately after run creation so a restart during input copying repairs this run.
    await writePlanJson(bindingFile, { selectionDigest: fresh.selection.selectionDigest, runDir: store.runDir(run.id) });
    await store.writeJson(store.inRun(run.id, 'input/url-plan.json'), fresh.plan);
    await store.writeJson(store.inRun(run.id, 'input/url-selection.json'), fresh.selection);
    await urlGroupAccounting(run, { persist: true });
    return { run, resumed: false };
  };
  const { run, resumed } = await withPlanLock(args.selection, create);
  return {
    status: 'ok', runId: run.id, runDir: store.runDir(run.id), pages: run.pages.length, invalid, viewports: run.viewports, mode: run.mode, resumed, urlGroups: await urlGroupSummary(run),
    model: run.settings.model,
  };
}

async function scan(id, job) {
  const { scanRun } = await import('./lib/capture.mjs');
  await scanRun(id, job);
  const run = await store.getRun(id);
  const cv = types.compareViewport(run.viewports);
  const failed = run.pages.filter((p) => p.viewports[cv]?.status === 'failed').length;
  return summarize('scan', job, { scanned: run.pages.filter((p) => p.viewports[cv]?.status === 'ok').length, failed, pages: run.pages.length });
}

async function group(id) {
  const { computeSimilarity } = await import('./lib/similarity.mjs');
  const { tileCount } = await import('./lib/pricing.mjs');
  const run = await store.getRun(id);
  const cv = types.compareViewport(run.viewports);
  const compareFirst = run.mode === 'compare-first';
  const selection = {};
  let groups = 0;
  let selectedCv = [];
  for (const vp of compareFirst ? [cv] : run.viewports) {
    const r = await computeSimilarity(run, vp, run.settings.threshold);
    if (vp === cv) {
      groups = r.groups.length;
      selectedCv = r.selected;
    }
    selection[vp] = r.selected.map((s) => s.url);
  }
  if (compareFirst) for (const vp of run.viewports) selection[vp] = selection[cv];
  await store.updateRun(id, (r) => {
    r.selection = selection;
  });
  const s = run.settings;
  const heightOf = (u, vp) => run.pages.find((p) => p.url === u)?.viewports[vp]?.height ?? run.pages.find((p) => p.url === u)?.viewports[cv]?.height ?? 0;
  const tiles = run.viewports.reduce((n, vp) => n + (selection[vp] ?? []).reduce((m, u) => m + tileCount(heightOf(u, vp), s.tileHeight, s.tileOverlap), 0), 0);
  return {
    stage: 'group', pages: run.pages.length, groups, selectedPages: selectedCv.length, newComponentPages: selectedCv.filter((x) => x.reason === 'new-components').length,
    estimatedTileJobs: tiles, modelCostUsd: null,
  };
}

async function capture(id, job) {
  const { captureRun } = await import('./lib/capture.mjs');
  const run = await store.getRun(id);
  const urls = [...new Set(Object.values(run.selection).flat())];
  if (!urls.length) blocked('Nothing is selected yet. Run group first.');
  await captureRun(id, job, urls);
  const after = await store.getRun(id);
  const shots = urls.reduce((n, u) => n + after.viewports.filter((v) => after.pages.find((p) => p.url === u)?.viewports[v]?.status === 'ok' && types.hasShot(after.pages.find((p) => p.url === u)?.viewports[v])).length, 0);
  return summarize('capture', job, { selectedPages: urls.length, screenshots: shots, expected: urls.length * after.viewports.length });
}

async function annotate(id, job) {
  const { exportRun } = await import('./lib/report.mjs');
  const run = await store.getRun(id);
  job.total = run.pages.length * run.viewports.length;
  const r = await exportRun(id, job);
  const coverage = await coverageReport(id, { persist: !job.timedOut });
  return summarize('annotate', job, { files: r.files.length, coverage });
}

async function report(id, job) {
  const { exportRun } = await import('./lib/report.mjs');
  const { buildList } = await import('./lib/buildlist.mjs');
  const { qualityReport } = await import('./lib/quality.mjs');
  const { writeArtifacts } = await import('./lib/artifacts.mjs');
  const note = [];
  await exportRun(id, job, { skipImages: true });
  const quality = await qualityReport(id);
  const list = await buildList(id);
  const { writeEstimates } = await import('./lib/effort.mjs');
  const estimates = await writeEstimates(id, list);
  const manifest = await writeArtifacts(id, quality);
  return { stage: 'report', components: list.summary, validation: { counts: list.validation.counts, units: list.validation.units, file: 'export/component-validation.json' }, urlGroups: await urlGroupSummary(await store.getRun(id), { persist: true }), quality: { status: quality.status, counts: quality.counts }, coverage: await coverageReport(id, { persist: true }), costs: await runCosts(id), estimates: estimates.summary, artifacts: manifest, notes: note };
}

async function status(id) {
  const run = await store.getRun(id);
  const cv = types.compareViewport(run.viewports);
  const { exists, inRun } = store;
  const sel = [...new Set(Object.values(run.selection).flat())];
  let results = 0;
  for (const vp of run.viewports) for (const u of run.selection[vp] ?? []) if (await exists(inRun(id, `llm/${vp}/${run.pages.find((p) => p.url === u)?.slug}.json`))) results++;
  const quality = await store.readJson(inRun(id, 'export/quality.json'), { status: 'pending', counts: {} });
  const manifest = await store.readJson(inRun(id, 'export/artifacts/manifest.json'), []);
  const required = ['export/report.md', 'export/build-list.md', 'export/build-list.json', 'export/estimates.md', 'export/estimates.json', 'export/quality.json', ...manifest.map(m => m.file)];
  const reportReady = manifest.length > 0 && (await Promise.all(required.map(f => exists(inRun(id, f))))).every(Boolean);
  return {
    runId: id, mode: run.mode, model: run.settings.model, pages: run.pages.length, scanned: run.pages.filter((p) => p.viewports[cv]?.status === 'ok').length, urlGroups: await urlGroupSummary(run, { persist: true }),
    selectedPages: sel.length, modelResults: results, expectedResults: run.viewports.reduce((n, v) => n + (run.selection[v]?.length ?? 0), 0),
    costs: await runCosts(id), coverage: await coverageReport(id), quality: { status: quality.status, counts: quality.counts }, reportReady,
  };
}

try {
  if (cmd === 'init') out(await init());
  else {
    const id = resolveRun();
    if(args['retry-browser']===true&&['all','scan','capture'].includes(cmd))await rm(store.inRun(id,'browser-stop.json'),{force:true});
    await urlGroupAccounting(await store.getRun(id));
    const stages = { scan, capture, annotate, report };
    if (cmd === 'group') out({ status: 'ok', ...(await group(id)) });
    else if (cmd === 'detect-prepare') out(await (await import('./lib/detect.mjs')).prepareDetection(id));
    else if (cmd === 'detect-settle') out(await (await import('./lib/detect.mjs')).settleDetection(id));
    else if (cmd === 'status') out({ status: 'ok', ...(await status(id)) });
    else if (stages[cmd]) {
      const job = jobFor();
      const result = await stages[cmd](id, job);
      out({ status: job.stopReason ? 'blocked' : job.timedOut || job.cancelRequested || (result.coverage && !result.coverage.complete) || job.capped ? 'partial' : 'ok', ...result },job.stopReason?2:0);
    } else if (cmd === 'all') {
      const { runPipeline } = await import('./lib/pipeline.mjs');
      const result = await runPipeline(id, { scan, group, capture }, { through: args.through || 'capture', deadline: jobFor(args.minutes ?? 4).deadline, summarize: status });
      out(result, result.status === 'blocked' ? 2 : 0);
    } else {
      process.stdout.write(`${HELP}\n`);
      process.exit(2);
    }
  }
} catch (e) {
  out({ status: 'failed', error: (e && e.message) || String(e) }, 1);
}

import { mkdir, open, writeFile, rm, rename, unlink } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { buildUrlPlan, selectUrlPlan, validateUrlPlan } from './urlplanning.mjs';

export const SAMPLE_COVERAGE = 'Coverage applies only to the selected sample at captured viewports and states. Deferred discovered URLs were not scanned; whole-site component completeness is not established.';
async function boundedText(file) {
  const handle = await open(path.resolve(file), 'r');
  try {
    const limit = 20 * 1024 * 1024;
    if ((await handle.stat()).size > limit) throw new Error('JSON input exceeds 20 MB');
    const buffer = Buffer.alloc(limit + 1);
    let length = 0;
    while (length < buffer.length) {
      const { bytesRead } = await handle.read(buffer, length, buffer.length - length, null);
      if (!bytesRead) break;
      length += bytesRead;
    }
    if (length > limit) throw new Error('JSON input exceeds 20 MB');
    return buffer.subarray(0, length).toString('utf8');
  } finally { await handle.close(); }
}
export async function boundedJson(file) {
  const text = await boundedText(file);
  try { return JSON.parse(text); } catch { throw new Error('Invalid JSON input'); }
}
async function lockRecord(file) {
  try {
    const text = await boundedText(file);
    let record;
    try { record = JSON.parse(text); } catch { record = null; }
    return typeof record === 'number' ? { pid: record } : record;
  } catch (error) { if (error.code === 'ENOENT') return null; throw error; }
}
function deadOwner(record) {
  if (!Number.isSafeInteger(record?.pid) || record.pid <= 0) throw new Error('URL plan is locked without a valid owner PID; verify no operation is active before removing its lock');
  try { process.kill(record.pid, 0); return false; }
  catch (error) { if (error.code === 'ESRCH') return true; throw error; }
}
async function recoveryGuard(lock, action) {
  const file = `${lock}.recovery`;
  const token = randomUUID();
  let guard;
  for (let attempt = 0; !guard; attempt++) {
    try { guard = await open(file, 'wx'); }
    catch (error) {
      if (error.code !== 'EEXIST') throw error;
      if (attempt >= 100) throw new Error('URL plan recovery is locked; retry, or verify no operation is active before removing the recovery guard');
      await new Promise(resolve => setTimeout(resolve, 10));
    }
  }
  try {
    await guard.writeFile(JSON.stringify({ pid: process.pid, token }));
    return await action();
  } finally {
    await guard.close();
    if ((await lockRecord(file))?.token === token) await unlink(file);
  }
}
// onStaleObserved is an optional diagnostic synchronization hook, used by concurrency tests.
export async function withPlanLock(folder, action, { onStaleObserved } = {}) {
  const lock = path.join(path.resolve(folder), '.url-plan.lock');
  const observed = await lockRecord(lock);
  if (observed && deadOwner(observed)) await onStaleObserved?.();
  const owner = { pid: process.pid, token: randomUUID() };
  const handle = await recoveryGuard(lock, async () => {
    // All acquisition and release operations use the same guard. An earlier stale
    // observation is advisory: only this fresh record can authorize reclamation.
    const current = await lockRecord(lock);
    if (current) {
      if (!deadOwner(current)) throw new Error('URL plan is locked by another operation; retry after it finishes');
      await unlink(lock);
    }
    const acquired = await open(lock, 'wx');
    try { await acquired.writeFile(JSON.stringify(owner)); }
    catch (error) { await acquired.close(); await unlink(lock); throw error; }
    return acquired;
  });
  try { return await action(); }
  finally {
    await handle.close();
    await recoveryGuard(lock, async () => {
      if ((await lockRecord(lock))?.token === owner.token) await unlink(lock);
    });
  }
}
async function atomicText(file, text) {
  const temp = `${file}.${process.pid}.${randomUUID()}.tmp`;
  try {
    await writeFile(temp, text, { encoding: 'utf8', flag: 'wx' });
    await rename(temp, file);
  } finally { await rm(temp, { force: true }); }
}
export const writePlanJson = (file, value) => atomicText(file, JSON.stringify(value, null, 2));
const save = writePlanJson;
export async function persistPlan(seed, discoveryFile) {
  const plan = buildUrlPlan(seed, await boundedJson(discoveryFile));
  const root = path.resolve(process.env.CEST_PLAN_DIR || 'estimator-config/url-plans');
  await mkdir(root, { recursive: true });
  const folder = path.join(root, `${plan.id}-${randomUUID()}`);
  await mkdir(folder);
  await save(path.join(folder, 'plan.json'), plan);
  return { plan, folder };
}
export async function readSelectedPlan(folder, allowEmpty = false) {
  const plan = validateUrlPlan(await boundedJson(path.join(folder, 'plan.json')));
  let selection;
  try { selection = await boundedJson(path.join(folder, 'selection.json')); }
  catch (error) { if (error.code === 'ENOENT') throw new Error('URL plan is awaiting selection; supply every group quantity first'); throw error; }
  const expected = selectUrlPlan(plan, selection.quotas);
  if (!isDeepStrictEqual(selection, expected)) throw new Error('Stale or tampered URL selection');
  const savedUrls = await boundedText(path.join(folder, 'selected-urls.txt'));
  if (savedUrls !== selection.selectedUrls.join('\n') + (selection.selectedUrls.length ? '\n' : '')) throw new Error('Tampered selected URL list');
  if (!allowEmpty && !selection.selectedUrls.length) throw new Error('Selection is empty; create a new plan with approved nonzero quantities');
  return { plan, selection };
}
export async function persistSelection(folder, quotasFile) {
  return withPlanLock(folder, async () => {
    const plan = validateUrlPlan(await boundedJson(path.join(folder, 'plan.json')));
    const selection = selectUrlPlan(plan, await boundedJson(quotasFile));
    let existing;
    try { existing = await boundedJson(path.join(folder, 'selection.json')); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
    if (existing) {
      if (!isDeepStrictEqual(existing, selection)) throw new Error('Selection already exists with different quantities or content; create a new explicit plan');
      await readSelectedPlan(folder, true);
      return { plan, selection, resumed: true };
    }
    await atomicText(path.join(folder, 'selected-urls.txt'), selection.selectedUrls.join('\n') + (selection.selectedUrls.length ? '\n' : ''));
    await save(path.join(folder, 'selection.json'), selection);
    return { plan, selection, resumed: false };
  });
}
export const planSummary = plan => ({ planId: plan.id, planFingerprint: plan.fingerprint, counts: plan.counts, groups: plan.groups.map(({ id, pattern, label, count, suggestedCount, examples }) => ({ id, pattern, label, count, suggestedCount, examples: examples.slice(0, 3) })), warnings: plan.warnings });

export async function urlGroupAccounting(run, { persist = false } = {}) {
  const { readJson, inRun, writeJson } = await import('./store.mjs');
  const plan = await readJson(inRun(run.id, 'input/url-plan.json'), null);
  if (!plan) {
    if (run.urlPlanning) throw new Error('Approved URL plan is missing from this run');
    return null;
  }
  const selection = await readJson(inRun(run.id, 'input/url-selection.json'));
  validateUrlPlan(plan);
  if (run.urlPlanning && (run.urlPlanning.planId !== plan.id || run.urlPlanning.selectionDigest !== selection.selectionDigest)) throw new Error('Run planning binding differs from approved selection');
  if (!isDeepStrictEqual(selectUrlPlan(plan, selection.quotas), selection)) throw new Error('Stale or tampered run URL selection');
  if (!isDeepStrictEqual(run.urls, selection.selectedUrls) || !isDeepStrictEqual(run.pages.map(p => p.url), selection.selectedUrls)) throw new Error('Run URLs differ from approved selection');
  const viewport = run.viewports.includes('desktop') ? 'desktop' : run.viewports[0];
  const groups = selection.groups.map(g => {
    const statuses = g.selectedUrls.map(url => run.pages.find(p => p.url === url)?.viewports[viewport]?.status);
    const scanned = statuses.filter(s => s === 'ok').length;
    const failed = statuses.filter(s => s === 'failed').length;
    return { id: g.id, pattern: g.pattern, discovered: g.available, eligible: g.available, selected: g.requested, deferred: g.available - g.requested, scanned, failed, pending: g.requested - scanned - failed };
  });
  const counts = { ...plan.counts, selected: selection.selectedUrls.length, deferred: selection.deferredCount, scanned: groups.reduce((n,g) => n+g.scanned,0), failed: groups.reduce((n,g) => n+g.failed,0), pending: groups.reduce((n,g) => n+g.pending,0) };
  const result = { schemaVersion: 1, planId: plan.id, selectionDigest: selection.selectionDigest, viewport, counts, groups, discoveryBasis: 'Per-family discovered counts are distinct normalized eligible URLs; raw discovery entries, exclusions, duplicates and added seed are accounted globally.', coverageStatement: SAMPLE_COVERAGE };
  if (persist) await writeJson(inRun(run.id, 'export/url-groups.json'), result);
  return result;
}

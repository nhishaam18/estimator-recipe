import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, rm, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync, fork } from 'node:child_process';
import { urlGroupAccounting, persistPlan, persistSelection, withPlanLock } from '../lib/urlplanstore.mjs';
import { createRun, writeJson, inRun } from '../lib/store.mjs';

const cli = fileURLToPath(new URL('../cest.mjs', import.meta.url));
test('planning CLI works without credentials/browser and rejects incomplete or changed approvals', async () => {
  const temp = await mkdtemp(path.join(tmpdir(), 'cest-urlcli-'));
  const env = { ...process.env, CEST_PLAN_DIR: path.join(temp, 'plans'), CEST_RUNS_DIR: path.join(temp, 'runs'), PLAYWRIGHT_BROWSERS_PATH: path.join(temp, 'no-browser') };
  const sh = (...args) => {
    const result = spawnSync(process.execPath, [cli, ...args], { env, encoding: 'utf8' });
    assert.ok(result.stdout, result.stderr);
    return { code: result.status, data: JSON.parse(result.stdout.trim()) };
  };
  const discovery = path.join(temp, 'discovery.json');
  const quotas = path.join(temp, 'quotas.json');
  try {
    await writeFile(discovery, JSON.stringify({ success: true, links: ['https://example.com/catalog/a?sort=red,blue#/view/1', 'https://example.com/catalog/b?sort=red,blue#/view/2', 'https://example.com/offered', 'https://other.com/no'] }));
    const planned = sh('plan', '--url', 'https://example.com/', '--discovery-file', discovery);
    assert.equal(planned.code, 0);
    assert.equal(planned.data.status, 'awaiting-selection');
    assert.equal(planned.data.counts.discovered, 4);
    assert.ok(planned.data.groups.every(g => g.examples.length <= 3 && !g.urls));
    const folder = planned.data.planDir;
    const second = sh('plan', '--url', 'https://example.com/', '--discovery-file', discovery);
    assert.notEqual(second.data.planDir, folder);
    assert.match(sh('init', '--selection', folder).data.reason, /awaiting selection/);
    assert.match(sh('init', '--selection', folder, '--urls', 'https://example.com/').data.reason, /cannot be combined/);
    assert.match(sh('init', '--selection', folder, '--urls-file', discovery).data.reason, /cannot be combined/);
    await writeFile(quotas, '{}');
    assert.match(sh('select', '--plan', folder, '--quotas-file', quotas).data.reason, /Missing quota/);
    const counts = Object.fromEntries(planned.data.groups.map(g => [g.id, g.pattern.includes('catalog') ? 1 : 0]));
    await writeFile(quotas, JSON.stringify(counts));
    const selected = sh('select', '--plan', folder, '--quotas-file', quotas);
    assert.equal(selected.code, 0);
    assert.equal(selected.data.selected, 1);
    const original = await readFile(path.join(folder, 'selection.json'), 'utf8');
    const retry = sh('select', '--plan', folder, '--quotas-file', quotas);
    assert.equal(retry.data.resumed, true);
    assert.equal(await readFile(path.join(folder, 'selection.json'), 'utf8'), original);
    await writeFile(path.join(folder, '.url-plan.lock'), String(process.pid));
    assert.match(sh('select', '--plan', folder, '--quotas-file', quotas).data.reason, /locked/);
    await rm(path.join(folder, '.url-plan.lock'));
    const retired = spawnSync(process.execPath, ['-e', 'process.stdout.write(String(process.pid))'], { encoding: 'utf8' });
    await writeFile(path.join(folder, '.url-plan.lock'), retired.stdout);
    assert.equal(sh('select', '--plan', folder, '--quotas-file', quotas).data.resumed, true, 'dead owner lock is recovered');
    await writeFile(quotas, JSON.stringify(Object.fromEntries(planned.data.groups.map(g => [g.id, 'all']))));
    assert.match(sh('select', '--plan', folder, '--quotas-file', quotas).data.reason, /different quantities/);
    assert.equal(await readFile(path.join(folder, 'selection.json'), 'utf8'), original);

    // Exact imported URLs survive commas, functional queries and hash routes.
    const selection = JSON.parse(original);
    assert.match(selection.selectedUrls[0], /sort=red%2Cblue#\/view\//);
    const oldRoot = process.env.CEST_RUNS_DIR;
    process.env.CEST_RUNS_DIR = env.CEST_RUNS_DIR;
    try {
      const run = await createRun({ urls: selection.selectedUrls, viewports: ['desktop'], settings: {} });
      const plan = JSON.parse(await readFile(path.join(folder, 'plan.json'), 'utf8'));
      await writeJson(inRun(run.id, 'input/url-plan.json'), plan);
      await writeJson(inRun(run.id, 'input/url-selection.json'), selection);
      let accounting = await urlGroupAccounting(run, { persist: true });
      assert.equal(accounting.counts.selected, 1);
      assert.equal(accounting.counts.deferred, 3);
      assert.equal(accounting.counts.pending, 1);
      run.pages[0].viewports.desktop = { status: 'failed' };
      accounting = await urlGroupAccounting(run);
      assert.equal(accounting.counts.failed, 1);
      assert.equal(accounting.counts.pending, 0);
      assert.match(accounting.coverageStatement, /whole-site component completeness is not established/);
      run.pages.push({ url: 'https://example.com/unchosen', viewports: {} });
      await assert.rejects(urlGroupAccounting(run), /differ from approved selection/);
    } finally { if (oldRoot === undefined) delete process.env.CEST_RUNS_DIR; else process.env.CEST_RUNS_DIR = oldRoot; }

    const tampered = JSON.parse(original);
    tampered.planFingerprint = 'stale-fingerprint';
    await writeFile(path.join(folder, 'selection.json'), JSON.stringify(tampered));
    assert.match(sh('init', '--selection', folder).data.reason, /Stale or tampered/);
    tampered.planFingerprint = JSON.parse(original).planFingerprint;
    tampered.selectedUrls.push('https://example.com/unchosen');
    await writeFile(path.join(folder, 'selection.json'), JSON.stringify(tampered));
    assert.match(sh('init', '--selection', folder).data.reason, /tampered/);
    await writeFile(path.join(folder, 'selection.json'), original);
    await writeFile(path.join(folder, 'selected-urls.txt'), 'https://example.com/unchosen\n');
    assert.match(sh('init', '--selection', folder).data.reason, /Tampered/);
    const emptyFolder = second.data.planDir;
    await writeFile(quotas, JSON.stringify(Object.fromEntries(second.data.groups.map(g => [g.id, 0]))));
    assert.equal(sh('select', '--plan', emptyFolder, '--quotas-file', quotas).code, 0);
    assert.match(sh('init', '--selection', emptyFolder).data.reason, /empty/);
    await writeFile(discovery, JSON.stringify({ success: false, links: [] }));
    assert.match(sh('plan', '--url', 'https://example.com/', '--discovery-file', discovery).data.reason, /discovery failed/);
    await writeFile(discovery, Buffer.alloc(20 * 1024 * 1024 + 1));
    assert.match(sh('plan', '--url', 'https://example.com/', '--discovery-file', discovery).data.reason, /20 MB/);
  } finally { await rm(temp, { recursive: true, force: true }); }
});

test('concurrent stale-owner claimants cannot reclaim a new live lock or overwrite frozen selection', async () => {
  const temp = await mkdtemp(path.join(tmpdir(), 'cest-lockrace-'));
  const priorRoot = process.env.CEST_PLAN_DIR;
  process.env.CEST_PLAN_DIR = temp;
  const children = [];
  try {
    const discovery = path.join(temp, 'discovery.json');
    await writeFile(discovery, JSON.stringify({ success: true, links: ['https://example.com/', 'https://example.com/about'] }));
    const { plan, folder } = await persistPlan('https://example.com/', discovery);
    const retired = spawnSync(process.execPath, ['-e', 'process.stdout.write(String(process.pid))'], { encoding: 'utf8' });
    await writeFile(path.join(folder, '.url-plan.lock'), retired.stdout);
    const storeUrl = new URL('../lib/urlplanstore.mjs', import.meta.url).href;
    const planningUrl = new URL('../lib/urlplanning.mjs', import.meta.url).href;
    const worker = path.join(temp, 'claimant.mjs');
    await writeFile(worker, `
      import { withPlanLock, boundedJson, writePlanJson } from ${JSON.stringify(storeUrl)};
      import { selectUrlPlan } from ${JSON.stringify(planningUrl)};
      import { writeFile } from 'node:fs/promises';
      import path from 'node:path';
      const [folder, quantity] = process.argv.slice(2);
      const wait = kind => new Promise(resolve => {
        const listener = message => { if (message === kind) { process.off('message', listener); resolve(); } };
        process.on('message', listener);
      });
      try {
        await withPlanLock(folder, async () => {
          const plan = await boundedJson(path.join(folder, 'plan.json'));
          const selection = selectUrlPlan(plan, Object.fromEntries(plan.groups.map(g => [g.id, Number(quantity)])));
          await writeFile(path.join(folder, 'selected-urls.txt'), selection.selectedUrls.join('\\n') + (selection.selectedUrls.length ? '\\n' : ''));
          await writePlanJson(path.join(folder, 'selection.json'), selection);
          const released = wait('release');
          process.send({ kind: 'entered', digest: selection.selectionDigest });
          await released;
        }, { onStaleObserved: async () => {
          const resumed = wait('go');
          process.send({ kind: 'observed' });
          await resumed;
        } });
        process.send({ kind: 'done', ok: true });
      } catch (error) { process.send({ kind: 'done', ok: false, error: error.message }); }
      process.disconnect();
    `);
    const claimant = quantity => {
      const child = fork(worker, [folder, String(quantity)], { silent: true });
      children.push(child);
      const messages = [];
      const waiting = new Set();
      let stderr = '';
      child.stderr.on('data', data => { stderr += data; });
      child.on('message', message => {
        messages.push(message);
        for (const check of [...waiting]) check();
      });
      const until = kind => new Promise((resolve, reject) => {
        const timer = setTimeout(() => { waiting.delete(check); reject(new Error(`No ${kind} message: ${stderr}`)); }, 10000);
        const check = () => {
          const found = messages.find(message => message.kind === kind);
          if (found) { clearTimeout(timer); waiting.delete(check); resolve(found); }
        };
        waiting.add(check); check();
      });
      return { child, messages, until };
    };
    const a = claimant(1);
    const b = claimant(0);
    await Promise.all([a.until('observed'), b.until('observed')]);
    // Both processes have seen the same dead PID. A acquires and remains inside
    // the protected writer while B resumes its stale recovery attempt.
    a.child.send('go');
    const entered = await a.until('entered');
    const frozen = await readFile(path.join(folder, 'selection.json'), 'utf8');
    b.child.send('go');
    const rejected = await b.until('done');
    assert.equal(rejected.ok, false);
    assert.match(rejected.error, /locked by another operation/);
    assert.equal(b.messages.some(message => message.kind === 'entered'), false, 'only one protected writer enters');
    assert.equal(JSON.parse(await readFile(path.join(folder, '.url-plan.lock'), 'utf8')).pid, a.child.pid, 'loser does not unlink winner lock');
    assert.equal(await readFile(path.join(folder, 'selection.json'), 'utf8'), frozen);
    a.child.send('release');
    assert.equal((await a.until('done')).ok, true);
    const quotas = path.join(temp, 'changed-quotas.json');
    await writeFile(quotas, JSON.stringify(Object.fromEntries(plan.groups.map(g => [g.id, 0]))));
    await assert.rejects(persistSelection(folder, quotas), /different quantities/);
    assert.equal(JSON.parse(await readFile(path.join(folder, 'selection.json'), 'utf8')).selectionDigest, entered.digest);

    // A release whose ownership token changed must not remove the replacement.
    const replacement = { pid: process.pid, token: 'replacement-owner' };
    await withPlanLock(folder, async () => { await writeFile(path.join(folder, '.url-plan.lock'), JSON.stringify(replacement)); });
    assert.deepEqual(JSON.parse(await readFile(path.join(folder, '.url-plan.lock'), 'utf8')), replacement);
  } finally {
    for (const child of children) child.kill();
    if (priorRoot === undefined) delete process.env.CEST_PLAN_DIR; else process.env.CEST_PLAN_DIR = priorRoot;
    await rm(temp, { recursive: true, force: true });
  }
});

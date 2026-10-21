import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { bootstrap } from '../lib/bootstrap.mjs';

async function fixture(t) {
  const root = await fs.mkdtemp(path.join(tmpdir(), 'cest-bootstrap-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const skill = path.join(root, 'skill'), workspace = path.join(root, 'workspace');
  await fs.mkdir(path.join(skill, 'scripts/lib'), { recursive: true });
  await fs.mkdir(path.join(skill, 'references'));
  await fs.writeFile(path.join(skill, 'scripts/package.json'), JSON.stringify({ version: '2.0.0', dependencies: { sharp: '0.35.5' } }));
  await fs.writeFile(path.join(skill, 'scripts/package-lock.json'), '{"lockfileVersion":3}');
  await fs.writeFile(path.join(skill, 'scripts/lib/example.mjs'), 'export const example = 1;');
  await fs.writeFile(path.join(skill, 'references/prompt.md'), 'prompt');
  await fs.writeFile(path.join(skill, '.env.production'), 'SECRET=do-not-copy');
  await fs.writeFile(path.join(skill, 'private.key'), 'do-not-copy');
  await fs.writeFile(path.join(skill, 'credentials.json'), 'do-not-copy');
  await fs.writeFile(path.join(skill, 'references/secrets.json'), 'do-not-copy');
  const moduleDir = path.join(root, 'playwright');
  await fs.mkdir(moduleDir);
  await fs.writeFile(path.join(moduleDir, 'package.json'), '{"version":"1.60.0"}');
  const executable = path.join(root, 'chromium'); await fs.writeFile(executable, 'preinstalled');
  const calls = { install: 0, verify: 0, browser: 0 };
  const options = { skill, workspace,
    async install({ scripts, log }) {
      calls.install++; await log('installation output retained\n');
      await fs.mkdir(path.join(scripts, 'node_modules/sharp'), { recursive: true });
      await fs.writeFile(path.join(scripts, 'node_modules/sharp/package.json'), '{"version":"0.35.5"}');
      await fs.writeFile(path.join(scripts, 'node_modules/.package-lock.json'), '{"lockfileVersion":3}');
    },
    async browserRuntime() { calls.browser++; return { moduleDir, version: '1.60.0', chromium: { executablePath: () => executable } }; },
    async verify({ log }) { calls.verify++; await log('probe output retained\n'); },
  };
  return { root, skill, workspace, executable, moduleDir, calls, options };
}

test('setup installs and verifies once, preserving unchanged runtime files and excluding secrets', async t => {
  const { options, calls } = await fixture(t);
  const first = await bootstrap(options);
  const file = path.join(first.runtime, 'scripts/lib/example.mjs');
  const before = await fs.stat(file);
  const second = await bootstrap(options);
  assert.deepEqual(calls, { install: 1, verify: 1, browser: 2 });
  assert.equal(second.reused, true); assert.equal(second.copied, 0); assert.equal(second.installed, false);
  assert.equal((await fs.stat(file)).mtimeMs, before.mtimeMs);
  await assert.rejects(fs.access(path.join(first.runtime, '.env.production')));
  await assert.rejects(fs.access(path.join(first.runtime, 'private.key')));
  await assert.rejects(fs.access(path.join(first.runtime, 'credentials.json')));
  await assert.rejects(fs.access(path.join(first.runtime, 'references/secrets.json')));
  assert.equal(JSON.parse(await fs.readFile(first.receiptPath)).status, 'ok');
});
test('bootstrap never refreshes runtime while capture or visual workers may own a run', async t => {
  const { options, workspace, calls } = await fixture(t);
  const folder = path.join(workspace, 'estimator', 'existing', 'visual-batches');
  await fs.mkdir(folder, { recursive: true }); await fs.writeFile(path.join(folder, 'active.json'), '{"batchId":"existing"}');
  await assert.rejects(bootstrap(options), /active or interrupted run/);
  assert.deepEqual(calls, { install: 0, verify: 0, browser: 0 });
  await assert.rejects(fs.access(path.join(workspace, 'estimator-runtime/estimator/scripts/package.json')));
  assert(await fs.stat(path.join(folder, 'active.json')));
});

test('script/reference changes invalidate verification but reuse locked dependencies; removed source files are removed', async t => {
  const { options, skill, calls } = await fixture(t);
  const first = await bootstrap(options);
  await fs.writeFile(path.join(skill, 'references/prompt.md'), 'updated prompt');
  await fs.rm(path.join(skill, 'scripts/lib/example.mjs'));
  const second = await bootstrap(options);
  assert.equal(second.reused, false); assert.equal(calls.verify, 2); assert.equal(calls.install, 1);
  await assert.rejects(fs.access(path.join(first.runtime, 'scripts/lib/example.mjs')));
  assert.equal(await fs.readFile(path.join(first.runtime, 'references/prompt.md'), 'utf8'), 'updated prompt');
});

test('changed lockfile or missing installed package reinstalls and verifies', async t => {
  const { options, skill, calls } = await fixture(t);
  const first = await bootstrap(options);
  await fs.writeFile(path.join(skill, 'scripts/package-lock.json'), '{"lockfileVersion":3,"updated":true}');
  await bootstrap(options);
  assert.equal(calls.install, 2); assert.equal(calls.verify, 2);
  await fs.rm(path.join(first.runtime, 'scripts/node_modules/sharp'), { recursive: true });
  await bootstrap(options);
  assert.equal(calls.install, 3); assert.equal(calls.verify, 3);
});

test('changed Chromium identity invalidates probe; missing binary blocks cached verification', async t => {
  const { options, executable, calls } = await fixture(t);
  const first = await bootstrap(options);
  await fs.writeFile(executable, 'different preinstalled chromium');
  assert.equal((await bootstrap(options)).reused, false);
  assert.equal(calls.verify, 2); assert.equal(calls.install, 1);
  await fs.rm(executable);
  await assert.rejects(bootstrap(options), error => {
    assert.equal(error.receipt.status, 'blocked'); assert.equal(error.receipt.phase, 'browser'); return true;
  });
  assert.equal(JSON.parse(await fs.readFile(first.verificationReceiptPath)).status, 'blocked');
});

test('failed verification preserves setup receipt, machine-readable failure, and installer output without retry', async t => {
  const { options, calls } = await fixture(t);
  options.verify = async () => { calls.verify++; throw new Error('browser launch denied'); };
  await assert.rejects(bootstrap(options), asyncError => {
    assert.equal(asyncError.receipt.phase, 'verification');
    assert.equal(asyncError.receipt.error, 'browser launch denied');
    return true;
  });
  const state = path.join(options.workspace, 'estimator-runtime/.bootstrap');
  const receipt = JSON.parse(await fs.readFile(path.join(state, 'verification.json')));
  assert.match(await fs.readFile(receipt.logPath, 'utf8'), /installation output retained/);
  assert.equal(JSON.parse(await fs.readFile(path.join(state, 'setup.json'))).status, 'ok');
  assert.equal(calls.verify, 1); assert.equal(calls.install, 1);
});

test('failed installation keeps its output and releases workspace lock', async t => {
  const { options } = await fixture(t);
  options.install = async ({ log }) => { await log('npm detailed failure\n'); throw new Error('install failed'); };
  let failure;
  try { await bootstrap(options); } catch (error) { failure = error; }
  assert.equal(failure.receipt.phase, 'install');
  assert.match(await fs.readFile(failure.logPath, 'utf8'), /npm detailed failure/);
  assert.equal(JSON.parse(await fs.readFile(failure.receiptPath)).status, 'blocked');
  await assert.rejects(fs.access(path.join(options.workspace, 'estimator-runtime/.bootstrap/lock')));
});

test('concurrent setup blocks without changing owner receipts or removing its lock', async t => {
  const { options } = await fixture(t);
  let release, entered;
  const ready = new Promise(resolve => { entered = resolve; });
  const gate = new Promise(resolve => { release = resolve; });
  const install = options.install;
  options.install = async context => { entered(); await gate; await install(context); };
  const owner = bootstrap(options); await ready;
  await assert.rejects(bootstrap(options), error => { assert.equal(error.receipt.phase, 'lock'); return true; });
  await fs.access(path.join(options.workspace, 'estimator-runtime/.bootstrap/lock'));
  release(); assert.equal((await owner).status, 'ok');
});

test('recursive destination and symlink escapes are rejected', async t => {
  const { options, skill, root } = await fixture(t);
  await assert.rejects(bootstrap({ ...options, workspace: path.join(skill, 'nested') }), /recursive copying/);
  const outside = path.join(root, 'outside'); await fs.mkdir(outside);
  // Directory junctions are available without the Windows symlink privilege.
  await fs.symlink(outside, path.join(skill, 'references/escape'), process.platform === 'win32' ? 'junction' : 'dir');
  await assert.rejects(bootstrap(options), /Symbolic links/);
  await fs.rm(path.join(skill, 'references/escape'));
  const linkedWorkspace = path.join(root, 'linked-workspace');
  await fs.mkdir(linkedWorkspace, { recursive: true });
  await fs.symlink(outside, path.join(linkedWorkspace, 'estimator-runtime'), process.platform === 'win32' ? 'junction' : 'dir');
  await assert.rejects(bootstrap({ ...options, workspace: linkedWorkspace }), /Symbolic links/);
});

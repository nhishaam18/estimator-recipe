import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { resolveBrowserRuntime } from '../lib/browser.mjs';

test('shared Playwright is resolved explicitly, with its own Chromium and version', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'cest-browser-'));
  try {
    await mkdir(path.join(root, 'playwright'));
    await writeFile(path.join(root, 'playwright/package.json'), JSON.stringify({ name: 'playwright', version: '1.60.0', main: 'index.cjs' }));
    await writeFile(path.join(root, 'playwright/index.cjs'), 'module.exports = {chromium: {executablePath: () => "matching-browser"}};');
    const runtime = resolveBrowserRuntime({ dirs: [root], local: false });
    assert.equal(runtime.version, '1.60.0');
    assert.equal(runtime.source, 'sandbox-preinstalled');
    assert.equal(runtime.chromium.executablePath(), 'matching-browser');
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('missing shared runtime blocks instead of downloading or substituting Chromium', () => {
  assert.throws(() => resolveBrowserRuntime({ dirs: [], local: false }), /Preinstalled Playwright is unavailable/);
});

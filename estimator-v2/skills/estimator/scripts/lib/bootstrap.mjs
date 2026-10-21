import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { resolveBrowserRuntime } from './browser.mjs';

const digest = value => createHash('sha256').update(value).digest('hex');
const excluded = name => ['node_modules', '.git', '.bootstrap', 'runs', 'output', 'coverage'].includes(name) || name.startsWith('.') || /(?:\.log|\.pem|\.key|\.p12|\.pfx)$/i.test(name) || /^(?:credentials?|secrets?|tokens?)(?:\.|$)/i.test(name);
const inside = (root, file) => { const rel = path.relative(root, file); return rel === '' || (!rel.startsWith(`..${path.sep}`) && rel !== '..' && !path.isAbsolute(rel)); };
async function readJson(file) { try { return JSON.parse(await fs.readFile(file, 'utf8')); } catch (error) { if (error.code === 'ENOENT' || error instanceof SyntaxError) return null; throw error; } }
async function atomic(file, value) {
  const temporary = `${file}.${randomUUID()}.tmp`;
  await fs.writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { flag: 'wx' });
  try { await fs.rename(temporary, file); } finally { await fs.rm(temporary, { force: true }); }
}

// Reject links in every ancestor as well as the copied tree. Neither reads nor writes
// may follow a skill/workspace link into another tree.
async function noLinks(file) {
  let current = path.resolve(file);
  for (;;) {
    try { if ((await fs.lstat(current)).isSymbolicLink()) throw new Error(`Symbolic links are not allowed in bootstrap paths: ${current}`); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
    const parent = path.dirname(current); if (parent === current) return; current = parent;
  }
}
async function sourceManifest(skill) {
  const files = [];
  async function visit(directory) {
    for (const item of (await fs.readdir(directory, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
      if (directory === skill && !['SKILL.md', 'settings.json', 'scripts', 'references', 'assets'].includes(item.name)) continue;
      if (excluded(item.name)) continue;
      const file = path.join(directory, item.name);
      if (item.isSymbolicLink()) throw new Error(`Symbolic links are not allowed in the skill: ${file}`);
      if (item.isDirectory()) await visit(file);
      else if (item.isFile()) files.push({ path: path.relative(skill, file).split(path.sep).join('/'), sha256: digest(await fs.readFile(file)) });
      else throw new Error(`Unsupported skill entry: ${file}`);
    }
  }
  await visit(skill); return files;
}
async function assertRunsIdle(workspace) {
  const root = path.join(workspace, 'estimator');
  let entries;
  try { entries = await fs.readdir(root, { withFileTypes: true }); } catch (error) { if (error.code === 'ENOENT') return; throw error; }
  for (const entry of entries.filter(value => value.isDirectory())) {
    for (const rel of ['discovery.lock', 'visual-batches/active.json', 'capture-recovery/recovery.lock']) {
      const marker = path.join(root, entry.name, rel);
      try { await fs.access(marker); } catch (error) { if (error.code === 'ENOENT') continue; throw error; }
      throw new Error(`Runtime refresh blocked by active or interrupted run: ${marker}. Use the saved runtime and reconcile the run first.`);
    }
  }
}
async function syncRuntime(skill, runtime, files, previous = []) {
  let copied = 0;
  const wanted = new Set(files.map(file => file.path));
  for (const file of previous) {
    if (wanted.has(file.path)) continue;
    const target = path.resolve(runtime, file.path);
    if (!inside(runtime, target)) throw new Error('Invalid previous bootstrap manifest');
    await noLinks(target); await fs.rm(target, { force: true });
  }
  for (const file of files) {
    const target = path.join(runtime, file.path);
    await noLinks(target);
    let same = false;
    try { same = digest(await fs.readFile(target)) === file.sha256; } catch (error) { if (error.code !== 'ENOENT') throw error; }
    if (same) continue;
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.copyFile(path.join(skill, file.path), target); copied++;
  }
  return copied;
}
async function dependencies(scripts, pkg) {
  const identities = [];
  for (const name of Object.keys(pkg.dependencies ?? {}).sort()) {
    const directory = path.join(scripts, 'node_modules', name);
    try {
      const manifest = await fs.readFile(path.join(directory, 'package.json'));
      identities.push({ name, path: await fs.realpath(directory), sha256: digest(manifest) });
    } catch (error) { if (error.code === 'ENOENT') return null; throw error; }
  }
  // npm's hidden lock records the actual installed dependency tree.
  try {
    const installedLock = await fs.readFile(path.join(scripts, 'node_modules/.package-lock.json'));
    for (const location of Object.keys(JSON.parse(installedLock).packages ?? {})) {
      const directory = path.resolve(scripts, location);
      if (!location.startsWith('node_modules/') || !inside(path.join(scripts, 'node_modules'), directory)) throw new Error('Invalid installed dependency lock path');
      // Optional platform-specific packages absent from the hidden npm lock do
      // not matter; every package npm recorded as installed must still exist.
      await fs.access(path.join(directory, 'package.json'));
    }
    identities.push({ lock: digest(installedLock) });
  }
  catch (error) { if (error.code === 'ENOENT') return null; throw error; }
  return identities;
}
async function npmInstall({ scripts, log }) {
  let command = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  let args = ['ci', '--ignore-scripts', '--no-audit', '--no-fund'];
  if (process.platform === 'win32') {
    const candidates = [process.env.npm_execpath, path.join(path.dirname(process.execPath), 'node_modules/npm/bin/npm-cli.js')].filter(Boolean);
    let cli;
    for (const candidate of candidates) {
      if (path.basename(candidate).toLowerCase() !== 'npm-cli.js') continue;
      try { await fs.access(candidate); cli = candidate; break; } catch { /* try the next known Node installation path */ }
    }
    if (!cli) throw new Error('Cannot locate npm-cli.js beside Node. Provide a Node installation containing npm; bootstrap never invokes a Windows command shell.');
    command = process.execPath; args = [cli, ...args];
  }
  await log(`Install: ${JSON.stringify([command, ...args])}\n`);
  await new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd: scripts, shell: false, windowsHide: true, env: { ...process.env, PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD: '1' }, stdio: ['ignore', 'pipe', 'pipe'] });
    let output = Promise.resolve(), timedOut = false, spawnError;
    const append = chunk => { output = output.then(() => log(chunk.toString())); };
    child.stdout.on('data', append); child.stderr.on('data', append);
    // Kill the npm process at a fixed deadline. Await close before releasing the
    // workspace lock so a timed-out installer cannot race a later setup.
    const deadline = setTimeout(() => {
      timedOut = true;
      append('npm ci exceeded the 120000ms install deadline; terminating the installer.\n');
      child.kill('SIGKILL');
    }, 120_000);
    child.once('error', error => { spawnError = error; });
    child.once('close', code => {
      clearTimeout(deadline);
      output.then(() => {
        if (timedOut) {
          reject(Object.assign(new Error('npm ci exceeded the 120000ms install deadline and was terminated. Inspect the bootstrap log before explicitly retrying setup.'), { code: 'CEST_INSTALL_TIMEOUT' }));
        } else if (spawnError) reject(spawnError);
        else if (code !== 0) reject(new Error(`npm ci failed with exit code ${code}`));
        else resolve();
      }, reject);
    });
  });
}
async function browserIdentity(browser) {
  const executable = browser.chromium.executablePath();
  const stat = await fs.stat(executable);
  const moduleManifest = path.join(browser.moduleDir, 'package.json');
  return { version: browser.version, moduleDir: await fs.realpath(browser.moduleDir), moduleSha256: digest(await fs.readFile(moduleManifest)), executable: await fs.realpath(executable), size: stat.size, modified: stat.mtimeMs };
}
async function verifyRuntime({ runtime, browser, log }) {
  const require = createRequire(path.join(runtime, 'scripts/package.json'));
  const sharp = require('sharp');
  await sharp({ create: { width: 2, height: 2, channels: 3, background: '#fff' } }).png().toBuffer();
  const launched = await browser.chromium.launch({ headless: true, timeout: 30000 });
  await launched.close(); await log('sharp image generation and preinstalled Chromium launch verified.\n');
}

/** Idempotent recipe setup. Test hooks never run unless explicitly supplied by callers. */
export async function bootstrap({ skill, workspace, install = npmInstall, verify = verifyRuntime, browserRuntime = resolveBrowserRuntime }) {
  if (typeof skill !== 'string' || typeof workspace !== 'string') throw new Error('bootstrap requires skill and workspace paths');
  skill = path.resolve(skill); workspace = path.resolve(workspace);
  const runtime = path.join(workspace, 'estimator-runtime', 'estimator');
  if (inside(skill, runtime) || inside(runtime, skill)) throw new Error('Choose a workspace outside the packaged skill to avoid recursive copying');
  await noLinks(skill); await noLinks(workspace); await noLinks(runtime);
  const state = path.join(workspace, 'estimator-runtime', '.bootstrap');
  await noLinks(state); await fs.mkdir(state, { recursive: true });
  const receiptPath = path.join(state, 'setup.json'), verificationReceiptPath = path.join(state, 'verification.json');
  await noLinks(receiptPath); await noLinks(verificationReceiptPath);
  const logPath = path.join(state, `setup-${Date.now()}-${randomUUID()}.log`);
  const log = text => fs.appendFile(logPath, text);
  const lock = path.join(state, 'lock');
  let locked = false, phase = 'lock';
  try {
    try { await fs.mkdir(lock); locked = true; } catch (error) {
      if (error.code === 'EEXIST') throw new Error('Another bootstrap owns the workspace lock. Inspect .bootstrap/lock before explicitly recovering an abandoned setup.');
      throw error;
    }
    await fs.writeFile(path.join(lock, 'owner.json'), JSON.stringify({ pid: process.pid, createdAt: new Date().toISOString() }));
    await log('Bootstrap started.\n');
    phase = 'node';
    const [major, minor] = process.versions.node.split('.').map(Number);
    if (major < 20 || major === 20 && minor < 9) throw new Error('Node 20.9 or newer is required');
    const node = { version: process.versions.node, executable: await fs.realpath(process.execPath), platform: process.platform, arch: process.arch };
    phase = 'copy';
    await assertRunsIdle(workspace);
    const files = await sourceManifest(skill), sourceHash = digest(JSON.stringify(files));
    const previous = await readJson(receiptPath);
    const copied = await syncRuntime(skill, runtime, files, previous?.files);
    const scripts = path.join(runtime, 'scripts');
    const pkg = JSON.parse(await fs.readFile(path.join(scripts, 'package.json'), 'utf8'));
    const lockHash = digest(await fs.readFile(path.join(scripts, 'package-lock.json')));
    const dependencyKey = digest(JSON.stringify({ lockHash, package: digest(await fs.readFile(path.join(scripts, 'package.json'))), node }));
    let installed = await dependencies(scripts, pkg), installedNow = false;
    phase = 'install';
    if (previous?.dependencyKey !== dependencyKey || !installed || JSON.stringify(previous.dependencies) !== JSON.stringify(installed)) {
      await install({ scripts, runtime, log, logPath }); installedNow = true;
      installed = await dependencies(scripts, pkg);
      if (!installed) throw new Error('Dependency installation finished without the required packages and npm lock receipt');
    }
    const setup = { schema: 1, status: 'ok', runtime, sourceHash, files, dependencyKey, dependencies: installed, node, logPath, updatedAt: new Date().toISOString() };
    await atomic(receiptPath, setup);
    phase = 'browser';
    const browser = await browserRuntime({ runtime });
    const identity = await browserIdentity(browser);
    const verificationKey = digest(JSON.stringify({ sourceHash, dependencyKey, dependencies: installed, browser: identity }));
    const priorVerification = await readJson(verificationReceiptPath);
    const reused = !installedNow && priorVerification?.status === 'ok' && priorVerification.verificationKey === verificationKey;
    phase = 'verification';
    if (!reused) {
      await verify({ runtime, browser, log, logPath });
      await atomic(verificationReceiptPath, { schema: 1, status: 'ok', verificationKey, sourceHash, node, browser: identity, logPath, verifiedAt: new Date().toISOString() });
    }
    await log(reused ? 'Existing verification receipt reused.\n' : 'Bootstrap verification completed.\n');
    return { status: 'ok', version: pkg.version, runtime, runsDir: path.join(workspace, 'estimator'), copied, installed: installedNow, reused, receiptPath, verificationReceiptPath, logPath, playwrightVersion: browser.version, modelExecution: 'kajoo-platform', modelCapability: 'The host agent must support image input; bootstrap does not exercise its model.' };
  } catch (error) {
    const receipt = { schema: 1, status: 'blocked', phase, error: error.message, ...(error.code ? { code: error.code } : {}), runtime, logPath, updatedAt: new Date().toISOString() };
    await log(`${phase}: ${error.stack ?? error.message}\n`);
    // A competing process must never overwrite the lock owner's receipts.
    const blockedPath = locked ? verificationReceiptPath : path.join(state, `blocked-${randomUUID()}.json`);
    await atomic(blockedPath, receipt);
    Object.assign(error, { receipt, receiptPath: blockedPath, logPath }); throw error;
  } finally { if (locked) await fs.rm(lock, { recursive: true, force: true }); }
}

#!/usr/bin/env node
// Dependency-free provisioning: registered skills are read-only; install only in the writable copy.
import { cp, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { SKILL_DIR } from './lib/config.mjs';

try {
  const [major,minor]=process.versions.node.split('.').map(Number);
  if (major < 20 || major===20 && minor<9) throw new Error('Select Node 20.9 or newer before bootstrap.');
  const flag = process.argv.indexOf('--workspace-root');
  const workspaceRoot = path.resolve(flag >= 0 ? process.argv[flag + 1] : '/workspace');
  const runtimeDir = path.join(workspaceRoot, 'estimator-runtime/estimator-v3');
  if (runtimeDir === SKILL_DIR || runtimeDir.startsWith(SKILL_DIR + path.sep)) throw new Error('Runtime must be outside the registered skill directory.');
  await mkdir(runtimeDir, { recursive: true });
  await cp(SKILL_DIR, runtimeDir, {
    recursive: true,
    filter: source => source === SKILL_DIR || !path.relative(SKILL_DIR, source).split(path.sep).some(segment => segment.startsWith('.') || segment === 'node_modules'),
  });
  process.stdout.write(JSON.stringify({ status: 'ok', runtimeDir, command: path.join(runtimeDir, 'scripts/cest.mjs') }) + '\n');
} catch {
  process.stdout.write(JSON.stringify({ status: 'failed', reason: 'Runtime provisioning failed. Check Node 20.9+ and workspace write permissions.' }) + '\n');
  process.exitCode = 1;
}

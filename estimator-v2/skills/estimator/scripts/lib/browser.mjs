import { createRequire } from 'node:module';
import path from 'node:path';
import { existsSync } from 'node:fs';

/** Resolve the shared sandbox package explicitly: ESM imports do not use NODE_PATH. */
export function resolveBrowserRuntime({ dirs, local = process.platform !== 'linux' } = {}) {
  const roots = dirs ?? [process.env.CEST_PLAYWRIGHT_MODULE_DIR, ...(process.env.NODE_PATH ?? '').split(path.delimiter), '/usr/local/lib/node_modules'].filter(Boolean);
  for (const root of roots) {
    const manifest = path.resolve(root, 'playwright/package.json');
    if (!existsSync(manifest)) continue;
    const require = createRequire(manifest);
    const pkg = require(manifest);
    const api = require(path.dirname(manifest));
    if (!api.chromium) throw new Error('The preinstalled Playwright package has no Chromium API.');
    return { chromium: api.chromium, version: pkg.version, moduleDir: path.dirname(manifest), source: 'sandbox-preinstalled' };
  }
  // Development machines may already have Playwright; never install it here.
  if (local) {
    const require = createRequire(import.meta.url);
    try {
      const manifest = require.resolve('playwright/package.json');
      const api = require('playwright');
      return { chromium: api.chromium, version: require(manifest).version, moduleDir: path.dirname(manifest), source: 'development-preinstalled' };
    } catch { /* use the same actionable error below */ }
  }
  throw new Error('Preinstalled Playwright is unavailable. Provision the sandbox browser toolchain or set CEST_PLAYWRIGHT_MODULE_DIR to its shared node_modules directory. Browser downloads and cache repairs are not performed by this recipe.');
}

export const launchBrowser = (options = {}) => resolveBrowserRuntime().chromium.launch({ headless: true, timeout: 30000, ...options });

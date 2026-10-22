// Run folders on disk. A run id is the folder name under the runs root (default ./estimator, override with CEST_RUNS_DIR).
import { mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { DEFAULT_SETTINGS } from './prompt.mjs';

export const runsRoot = () => path.resolve(process.env.CEST_RUNS_DIR || 'estimator');

export function runDir(id) {
  if (!/^[a-z0-9._-]+$/i.test(id) || id === '.' || id === '..') throw new Error('Invalid run id');
  return path.join(runsRoot(), id);
}

/** Resolve a path inside a run folder; throws when it escapes. */
export function inRun(id, rel) {
  const base = runDir(id);
  const full = path.resolve(base, rel);
  if (full !== base && !full.startsWith(base + path.sep)) throw new Error('Path escapes the run folder');
  return full;
}

export async function readJson(file, fallback) {
  try {
    return JSON.parse(await readFile(file, 'utf8'));
  } catch (e) {
    if (e && e.code === 'ENOENT' && fallback !== undefined) return fallback;
    throw e;
  }
}

let tmpCounter = 0;
export async function writeJson(file, data) {
  await mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.${++tmpCounter}.tmp`;
  const body = JSON.stringify(data, null, 2);
  await writeFile(tmp, body, 'utf8');
  // Windows refuses to replace a file that something has open for a moment: retry, then write in place.
  for (let attempt = 0; ; attempt++) {
    try {
      await rename(tmp, file);
      return;
    } catch (e) {
      const code = e && e.code;
      if (!['EPERM', 'EBUSY', 'EACCES'].includes(code)) throw e;
      if (attempt >= 12) {
        await writeFile(file, body, 'utf8');
        await rm(tmp, { force: true });
        return;
      }
      await new Promise((r) => setTimeout(r, 25 * (attempt + 1)));
    }
  }
}

export async function exists(file) {
  try {
    await stat(file);
    return true;
  } catch {
    return false;
  }
}

export function slugify(url) {
  const u = new URL(url);
  const raw = `${u.hostname}${u.pathname}${u.search}`.replace(/\/+$/, '');
  return raw.replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-+|-+$/g, '').toLowerCase().slice(0, 80) || 'home';
}

export function parseUrls(text) {
  const urls = [];
  const invalid = [];
  const seen = new Set();
  for (const raw of text.split(/\r?\n/)) {
    let line = raw.trim().replace(/^﻿/, '');
    if (!line || line.startsWith('#')) continue;
    line = line.split(',')[0].trim().replace(/^["']|["']$/g, '');
    if (/^(url|urls|link|links|page|pages)$/i.test(line)) continue;
    if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(line)) line = `https://${line}`;
    try {
      const u = new URL(line);
      if (!/^https?:$/.test(u.protocol)) throw new Error('protocol');
      u.hash = '';
      const href = u.toString();
      if (!seen.has(href)) {
        seen.add(href);
        urls.push(href);
      }
    } catch {
      invalid.push(raw.trim());
    }
  }
  return { urls, invalid };
}

function pagesFor(urls) {
  const used = new Set();
  return urls.map((url) => {
    let slug = slugify(url);
    let n = 2;
    while (used.has(slug)) slug = `${slugify(url)}-${n++}`;
    used.add(slug);
    return { url, slug, viewports: {} };
  });
}

// Writes to one run are serialised so parallel stages cannot clobber each other.
const queues = new Map();
export function updateRun(id, fn) {
  const prev = queues.get(id) ?? Promise.resolve();
  const next = prev.catch(() => {}).then(async () => {
    const run = await getRun(id);
    const out = fn(run) ?? run;
    out.updatedAt = new Date().toISOString();
    await writeJson(path.join(runDir(id), 'run.json'), out);
    return out;
  });
  queues.set(id, next);
  return next;
}

export async function getRun(id) {
  return readJson(path.join(runDir(id), 'run.json'));
}

/** Folder name for a site: lowercase host without www, only letters and digits ("ffbatiment.fr" becomes "ffbatimentfr"). */
export function siteName(url) {
  const host = new URL(url).hostname.toLowerCase().replace(/^www\./, '');
  return host.replace(/[^a-z0-9]/g, '') || 'site';
}

const stamp = () => new Date().toISOString().replace(/[-:]/g, '').replace(/\..+/, '').replace('T', '-');

/**
 * Creates the run folder. The first run of a site uses the plain name; a later run of the same site keeps the
 * earlier one and gets a timestamp suffix. mkdir without recursive is atomic, so two parallel runs cannot share a folder.
 */
export async function createRun(input) {
  if (!input.urls.length) throw new Error('No valid URLs');
  const base = input.name ? input.name.toLowerCase().replace(/[^a-z0-9]/g, '') || siteName(input.urls[0]) : siteName(input.urls[0]);
  await mkdir(runsRoot(), { recursive: true });
  let id = base;
  for (let attempt = 0; ; attempt++) {
    try {
      await mkdir(path.join(runsRoot(), id));
      break;
    } catch (e) {
      if (!e || e.code !== 'EEXIST') throw e;
      id = `${base}-${stamp()}${attempt ? `-${attempt + 1}` : ''}`;
    }
  }
  const now = new Date().toISOString();
  const compareFirst = (input.mode ?? 'compare-first') === 'compare-first';
  const run = {
    id,
    name: input.name?.trim() || base,
    createdAt: now,
    updatedAt: now,
    step: compareFirst ? 'compare' : 'screenshots',
    furthest: compareFirst ? 'compare' : 'screenshots',
    mode: compareFirst ? 'compare-first' : 'shots-first',
    urls: input.urls,
    viewports: input.viewports,
    pages: pagesFor(input.urls),
    settings: { ...DEFAULT_SETTINGS, ...(input.settings ?? {}) },
    selection: {},
    usage: { promptTokens: 0, completionTokens: 0, costUsd: 0, calls: 0, costMeasured: false },
  };
  await writeJson(path.join(runDir(id), 'run.json'), run);
  return run;
}

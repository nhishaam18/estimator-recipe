import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import { imageBoundaryPrompt, validateImageComponents } from './imagevalidation.mjs';
import { mergeTiles, parseTile } from './merge.mjs';
import { fillPrompt, scaleInstruction } from './prompt.mjs';
import { exists, getRun, inRun, readJson, writeJson } from './store.mjs';

export const llmFile = (runId, viewport, slug) => inRun(runId, `llm/${viewport}/${slug}.json`);
export async function loadLlm(runId, viewport, slug) {
  const file = llmFile(runId, viewport, slug);
  if (!(await exists(file))) return null;
  const result = await readJson(file);
  const rects = await readJson(inRun(runId, `rects/${viewport}/${slug}.json`), []);
  const checked = validateImageComponents(result.components, rects);
  return { ...result, components: checked.components, imageValidation: { version: 1, findings: checked.findings } };
}
const hash = value => createHash('sha256').update(value).digest('hex');

/** Choose tile seams near measured structural boundaries, retaining overlap. */
export function tileRanges(height, maxHeight, overlap, rects = []) {
  const H = Math.max(1, Math.ceil(height));
  const limit = Math.max(500, Math.floor(maxHeight));
  const seam = Math.max(0, Math.min(Math.floor(overlap), Math.floor(limit / 5)));
  const ranges = [];
  let top = 0;
  while (top < H) {
    const endLimit = Math.min(H, top + limit);
    if (endLimit === H) { ranges.push({ top, height: H - top }); break; }
    const low = top + Math.floor(limit * 0.72);
    const cuts = rects.filter(r => ['header', 'footer', 'main', 'section', 'article', 'nav', 'aside'].includes(r.t))
      .flatMap(r => [r.y, r.y + r.h]).filter(y => Number.isFinite(y) && y >= low && y <= endLimit);
    const cut = cuts.length ? cuts.sort((a, b) => Math.abs(a - endLimit) - Math.abs(b - endLimit))[0] : endLimit;
    const end = Math.max(top + Math.floor(limit * 0.65), Math.min(endLimit, Math.round(cut)));
    ranges.push({ top, height: end - top });
    top = Math.max(top + 1, end - seam);
  }
  return ranges;
}
async function blankWhite(jpeg, rects, top, height) {
  if (rects.some(r => r.y < top + height && r.y + r.h > top && r.w > 4 && r.h > 4)) return false;
  const stats = await sharp(jpeg).stats();
  return stats.channels.slice(0, 3).every(c => c.mean > 250 && c.stdev < 2);
}
export async function sliceTiles(png, tileHeight, overlap, rects = []) {
  const meta = await sharp(png).metadata();
  const width = meta.width, height = meta.height;
  const tiles = [];
  for (const range of tileRanges(height, tileHeight, overlap, rects)) {
    const jpeg = await sharp(png).extract({ left: 0, top: range.top, width, height: range.height }).jpeg({ quality: 85 }).toBuffer();
    tiles.push({ index: tiles.length, ...range, jpeg, blank: await blankWhite(jpeg, rects, range.top, range.height) });
  }
  return { width, height, tiles };
}
async function pendingPage(runId) {
  const run = await getRun(runId);
  for (const viewport of run.viewports) for (const url of run.selection[viewport] ?? []) {
    const page = run.pages.find(p => p.url === url);
    if (page && !(await exists(llmFile(runId, viewport, page.slug)))) {
      const shot = inRun(runId, `shots/${viewport}/${page.slug}.png`);
      if (!(await exists(shot))) return { status: 'blocked', reason: 'Selected page has no screenshot', url, viewport };
      return { status: 'pending', page, viewport, shot, url, run };
    }
  }
  return { status: 'complete' };
}
/** Prepare one screenshot only; agents write isolated tile files. */
export async function prepareDetection(runId) {
  const pending = await pendingPage(runId);
  if (pending.status !== 'pending') return pending;
  const { page, viewport, shot, run, url } = pending;
  const image = await readFile(shot);
  const imageHash = hash(image);
  const rects = await readJson(inRun(runId, `rects/${viewport}/${page.slug}.json`), []);
  const { width, height, tiles } = await sliceTiles(image, run.settings.tileHeight, run.settings.tileOverlap, rects);
  const folder = inRun(runId, `analysis-requests/${viewport}/${page.slug}-${imageHash.slice(0, 12)}`);
  const manifestFile = path.join(folder, 'manifest.json');
  if (await exists(manifestFile)) {
    const saved = await readJson(manifestFile);
    if (saved.imageHash !== imageHash || saved.url !== url) throw new Error('Saved screenshot packet does not match source image');
    const jobs = [];
    for (const job of saved.jobs) if (!(await exists(job.resultFile))) jobs.push(job);
    return { status: 'awaiting-analysis', runDir: inRun(runId, ''), manifestFile, page: { url, viewport, slug: page.slug }, jobs, skippedBlank: saved.skippedBlank, reused: saved.reused };
  }
  const jobs = [];
  let skippedBlank = 0, reused = 0;
  const reuseFile = inRun(runId, 'analysis-requests/reuse-index.json');
  const reuse = await readJson(reuseFile, {});
  for (const tile of tiles) {
    if (tile.blank) { skippedBlank++; continue; }
    const requestId = hash(`${imageHash}:${viewport}:${page.slug}:${tile.index}`);
    const tileFile = path.join(folder, `tile-${tile.index}.jpg`);
    const promptFile = path.join(folder, `prompt-${tile.index}.txt`);
    const resultFile = path.join(folder, `result-${tile.index}.json`);
    const tileRects = rects.filter(r => r.y < tile.top + tile.height && r.y + r.h > tile.top)
      .map(r => [r.t, Math.round(r.x), Math.round(r.y - tile.top), Math.round(r.w), Math.round(r.h)]);
    const reuseKey = hash(JSON.stringify([hash(tile.jpeg), tileRects, width, tile.height]));
    const scale = scaleInstruction(run.settings.coordMode, width, tile.height);
    const prompt = fillPrompt(run.settings.prompt, { tile: tile.index + 1, tiles: tiles.length, url, viewport, top: tile.top, bottom: tile.top + tile.height,
      pageWidth: width, pageHeight: height, known: '[]', imageWidth: width, imageHeight: tile.height,
      scaleInstruction: scale.text, scaleExample: scale.example, scaleSpace: scale.space }) + imageBoundaryPrompt(rects, tile.top, tile.height);
    await mkdir(folder, { recursive: true });
    await writeFile(tileFile, tile.jpeg);
    await writeFile(promptFile, prompt, 'utf8');
    if (reuse[reuseKey]) {
      await writeJson(resultFile, { ...reuse[reuseKey], requestId, imageHash, tileIndex: tile.index, viewport, reusedFromExactTile: true });
      reused++;
    }
    jobs.push({ requestId, tileIndex: tile.index, top: tile.top, height: tile.height, imageHash, viewport, image: tileFile, promptFile, resultFile, reuseKey });
  }
  const manifest = { version: 1, imageHash, url, viewport, slug: page.slug, width, height, tiles: tiles.length, skippedBlank, reused, jobs };
  await writeJson(manifestFile, manifest);
  return { status: 'awaiting-analysis', runDir: inRun(runId, ''), manifestFile, page: { url, viewport, slug: page.slug }, jobs: jobs.filter(j => !reuse[j.reuseKey]), skippedBlank, reused };
}
export async function settleDetection(runId) {
  const pending = await prepareDetection(runId);
  if (pending.status !== 'awaiting-analysis') return pending;
  const manifest = await readJson(pending.manifestFile);
  const run = await getRun(runId);
  const absent = [], warnings = [], results = [];
  const reuseFile = inRun(runId, 'analysis-requests/reuse-index.json');
  const reuse = await readJson(reuseFile, {});
  for (const j of manifest.jobs) {
    if (!(await exists(j.resultFile))) { absent.push(j); continue; }
    const response = await readJson(j.resultFile);
    if (response.requestId !== j.requestId || response.imageHash !== j.imageHash || response.tileIndex !== j.tileIndex || response.viewport !== manifest.viewport)
      return { status: 'blocked', reason: 'Visual result identity does not match saved packet', requestId: j.requestId, resultFile: j.resultFile };
    if (!Array.isArray(response.components) || !response.coordinate_space)
      return { status: 'blocked', reason: 'Visual result lacks components or coordinate space', requestId: j.requestId, resultFile: j.resultFile };
    const items = parseTile(response, { index: j.tileIndex, top: j.top, height: j.height, imageWidth: manifest.width, imageHeight: j.height }, run.settings.coordMode, manifest.width, warnings);
    results.push({ tile: j.tileIndex, items });
    if (!reuse[j.reuseKey]) reuse[j.reuseKey] = { coordinate_space: response.coordinate_space, components: response.components };
  }
  if (absent.length) return { status: 'awaiting-analysis', page: pending.page, remaining: absent.length, jobs: absent };
  const rects = await readJson(inRun(runId, `rects/${manifest.viewport}/${manifest.slug}.json`), []);
  const checked = validateImageComponents(mergeTiles(results, manifest.height, manifest.width), rects);
  warnings.push(...checked.findings.map(f => `Image validation (${f.decision}): ${f.name}: ${f.reason}`));
  await writeJson(llmFile(runId, manifest.viewport, manifest.slug), {
    url: manifest.url, viewport: manifest.viewport, generatedAt: new Date().toISOString(), model: 'kajoo/visual-analysis',
    imageWidth: manifest.width, imageHeight: manifest.height, tiles: manifest.tiles, components: checked.components,
    imageValidation: { version: 1, findings: checked.findings }, warnings, usage: { calls: manifest.jobs.length, costUsd: null },
  });
  await writeJson(reuseFile, reuse);
  return { status: 'page-complete', url: manifest.url, viewport: manifest.viewport, components: checked.components.length,
    tiles: manifest.tiles, analyzed: manifest.jobs.length - manifest.reused, reused: manifest.reused, skippedBlank: manifest.skippedBlank, next: (await pendingPage(runId)).status };
}

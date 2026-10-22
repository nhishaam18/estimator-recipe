import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { exists, inRun, writeJson } from './store.mjs';

/** Publication receipts point to canonical outputs; no second component inventory is produced. */
export async function writeArtifacts(runId) {
  const candidates = [
    ['export/report.md', 'Component report', 'text/markdown'],
    ['export/build-list.json', 'Canonical component build list', 'application/json'],
    ['export/build-list.md', 'Readable component build list', 'text/markdown'],
    ['export/component-validation.json', 'Component boundary validation', 'application/json'],
    ['export/annotations.json', 'Desktop annotation geometry', 'application/json'],
    ['export/website-evidence.json', 'Measured website evidence index', 'application/json'],
    ['export/estimates.json', 'Effort estimates', 'application/json'],
    ['export/estimates.md', 'Readable effort estimates', 'text/markdown'],
    ['export/quality.json', 'Quality findings', 'application/json'],
    ['export/coverage.json', 'Output coverage', 'application/json'],
    ['export/url-groups.json', 'URL group accounting', 'application/json'],
  ];
  const manifest = [];
  for (const [file, name, type] of candidates) {
    const full = inRun(runId, file);
    if (!(await exists(full))) continue;
    const body = await readFile(full);
    manifest.push({ file, name, type, bytes: body.length, sha256: createHash('sha256').update(body).digest('hex') });
  }
  await writeJson(inRun(runId, 'export/artifacts/manifest.json'), manifest);
  return manifest;
}

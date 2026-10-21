import { createHash } from 'node:crypto';
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import { imageBoundaryPrompt, validateImageComponents } from './imagevalidation.mjs';
import { mergeTiles, parseTile } from './merge.mjs';
import { fillPrompt, scaleInstruction } from './prompt.mjs';
import { exists, getRun, inRun, readJson, writeJson } from './store.mjs';
import { nativeAnalysisPrompt, validateNativeResult } from './analysis-contract.mjs';
import { saveWorkState } from './work-state.mjs';

export const registryFile = runId => inRun(runId, 'llm/registry.json');
export const llmFile = (runId, viewport, slug) => inRun(runId, `llm/${viewport}/${slug}.json`);
const manifestPath = 'analysis-requests/manifest.json';
const hash = value => createHash('sha256').update(value).digest('hex');
const jsonHash = value => hash(JSON.stringify(value));
const MAX_RESULT_BYTES = 4 * 1024 * 1024;

export async function sliceTiles(png, tileHeight, overlap) {
    if (!Number.isInteger(tileHeight) || tileHeight < 1 || !Number.isInteger(overlap) || overlap < 0 || overlap >= tileHeight)
        throw new Error('Invalid tile geometry: require tileHeight > tileOverlap >= 0');
    const { width, height } = await sharp(png).metadata();
    const count = height <= tileHeight ? 1 : 1 + Math.ceil((height - tileHeight) / (tileHeight - overlap));
    if (count > 10000) throw new Error('Too many screenshot tiles');
    const tiles = [];
    for (let index = 0; index < count; index++) {
        const top = Math.min(index * (tileHeight - overlap), Math.max(0, height - tileHeight));
        const h = Math.min(tileHeight, height - top);
        const jpeg = await sharp(png).extract({ left: 0, top, width, height: h }).jpeg({ quality: 85 }).toBuffer();
        tiles.push({ index, top, height: h, jpeg });
    }
    return { width, height, tiles };
}

// Build from current inputs on every boundary. No registry-derived prompt state: importing
// another page must not silently change requests that an agent is already analysing.
async function pageRequests(run, viewport, page) {
    const source = `shots/${viewport}/${page.slug}.png`;
    const png = await readFile(inRun(run.id, source));
    const sourceHash = hash(png);
    const rects = await readJson(inRun(run.id, `rects/${viewport}/${page.slug}.json`), []);
    const htmlPath = inRun(run.id, `html/${viewport}/${page.slug}.html`);
    const html = await exists(htmlPath) ? await readFile(htmlPath, 'utf8') : '';
    if (Buffer.byteLength(html) > 20 * 1024 * 1024) throw new Error('Saved HTML exceeds analysis hint limit; narrow the run');
    const { width, height, tiles } = await sliceTiles(png, run.settings.tileHeight, run.settings.tileOverlap);
    return tiles.map(t => {
        const scale = scaleInstruction(run.settings.coordMode, width, t.height);
        const prompt = fillPrompt(run.settings.prompt, {
            tile: t.index + 1, tiles: tiles.length, url: page.url, viewport, top: t.top, bottom: t.top + t.height,
            pageWidth: width, pageHeight: height, known: '[]', imageWidth: width, imageHeight: t.height,
            scaleInstruction: scale.text, scaleExample: scale.example, scaleSpace: scale.space,
        }) + imageBoundaryPrompt(rects, t.top, t.height) + nativeAnalysisPrompt(rects, html, t, width, viewport, hash(t.jpeg));
        const identity = {
            version: 2, execution: 'kajoo-agent', runId: run.id, url: page.url, slug: page.slug, viewport,
            source, sourceHash, rectsHash: jsonHash(rects), promptHash: hash(prompt), imageHash: hash(t.jpeg),
            coordMode: run.settings.coordMode,
            tile: { index: t.index, top: t.top, height: t.height, imageWidth: width, imageHeight: t.height },
            page: { width, height, tiles: tiles.length },
        };
        const id = jsonHash(identity);
        const base = `analysis-requests/${id}`;
        const request = { ...identity, id, requestFile: `${base}/request.json`, image: `${base}/tile.jpg`, promptFile: `${base}/prompt.txt` };
        return { request, prompt, jpeg: t.jpeg };
    });
}

export async function loadLlm(runId, viewport, slug) {
    const file = llmFile(runId, viewport, slug);
    if (!(await exists(file))) return null;
    const result = await readJson(file);
    if (result.analysis?.execution === 'kajoo-agent') {
        const run = await getRun(runId);
        const page = run.pages.find(p => p.slug === slug);
        if (!page || !(await exists(inRun(runId, `shots/${viewport}/${slug}.png`)))) return null;
        const requests = (await pageRequests(run, viewport, page)).map(x => x.request);
        if (JSON.stringify(requests.map(r => r.id)) !== JSON.stringify(result.analysis.requestIds)) return null;
        for (const request of requests) if (!(await intactRequest(runId, request))) return null;
        // A completed cache remains evidence-backed only while every original import
        // is intact. Report reads use this same boundary as detection preparation.
        const imports = await Promise.all(requests.map(r => validImport(runId, r)));
        if (imports.some(i => !i)) return null;
        if (!result.analysis.componentsHash) return null;
        if (result.analysis.componentsHash !== jsonHash(result.components))
            throw new Error(`Stored native component cache was changed for ${viewport}/${slug}`);
    }
    const rects = await readJson(inRun(runId, `rects/${viewport}/${slug}.json`), []);
    const checked = validateImageComponents(result.components, rects);
    const findings = [...new Map([...(result.imageValidation?.findings ?? []), ...checked.findings].map(f => [JSON.stringify(f), f])).values()];
    return { ...result, components: checked.components, imageValidation: { version: 1, findings }, warnings: [...new Set([...(result.warnings ?? []), ...findings.map(f => `Image validation (${f.decision}): ${f.name} [${f.componentId}] in ${f.imageSelector}: ${f.reason}`), ...(!rects.length ? ['Image validation unavailable: missing DOM rectangles; recapture this viewport.'] : [])])] };
}

async function intactRequest(runId, request) {
    const files = [request.requestFile, request.promptFile, request.image].map(rel => inRun(runId, rel));
    if ((await Promise.all(files.map(exists))).some(present => !present)) return false;
    const saved = await readJson(files[0]);
    if (jsonHash(saved) !== jsonHash(request)) throw new Error(`Stored analysis request was changed for ${request.id}`);
    if (hash(await readFile(files[1])) !== request.promptHash || hash(await readFile(files[2])) !== request.imageHash)
        throw new Error(`Stored analysis image or prompt changed for ${request.id}`);
    return true;
}

async function validImport(runId, request) {
    const file = inRun(runId, `analysis-results/${request.id}/import.json`);
    if (!(await exists(file))) return null;
    const saved = await readJson(file);
    if (saved.requestHash !== jsonHash(request)) throw new Error(`Stored import does not match request ${request.id}`);
    const rawFile = inRun(runId, saved.rawFile);
    if (!(await exists(rawFile))) throw new Error(`Detection blocked: original imported response is missing for ${request.id}`);
    if ((await stat(rawFile)).size > MAX_RESULT_BYTES) throw new Error(`Stored result exceeds 4 MiB for ${request.id}`);
    const raw = await readFile(rawFile);
    if (hash(raw) !== saved.resultHash) throw new Error(`Stored result was changed for ${request.id}`);
    validateResult(JSON.parse(raw.toString('utf8')));
    let result = JSON.parse(raw.toString('utf8'));
    if (saved.binding) {
        await verifyBinding(runId, request, saved.binding);
        result = bindInspection(result, request);
    }
    validateNativeResult(result, request);
    return { ...saved, result };
}

function bindInspection(result, request) {
    return { ...result, inspection: { ...result.inspection, imageHash: request.imageHash, viewport: request.viewport, tileIndex: request.tile.index, requestId: request.id } };
}

async function verifyBinding(runId, request, binding, resultFile) {
    if (!/^[a-f0-9-]{36}$/.test(binding.batchId ?? '') || !binding.jobId) throw new Error('Invalid packet binding: batchId/jobId required');
    const batch = await readJson(inRun(runId, `visual-batches/${binding.batchId}.json`));
    const item = batch.items.find(i => i.requestId === request.id);
    const assigned = `analysis-results/${request.id}/draft-${binding.batchId}.json`;
    if (batch.id !== binding.batchId || !item || item.jobId !== binding.jobId || item.platformStatus !== 'completed'
        || item.resultFile !== assigned || item.image !== request.image || item.promptFile !== request.promptFile
        || (resultFile && path.resolve(resultFile) !== path.resolve(inRun(runId, assigned))))
        throw new Error('Invalid packet binding: completed job and exact assigned result path must match request');
}

export async function prepareDetection(runId) {
    const run = await getRun(runId);
    const requests = [];
    const pages = [];
    const missing = [];
    for (const viewport of run.viewports) {
        for (const url of run.selection[viewport] ?? []) {
            const page = run.pages.find(p => p.url === url);
            if (!page || !(await exists(inRun(runId, `shots/${viewport}/${page.slug}.png`)))) { missing.push({ viewport, url }); continue; }
            if (await loadLlm(runId, viewport, page.slug)) continue;
            const built = await pageRequests(run, viewport, page);
            for (const { request, prompt, jpeg } of built) {
                await mkdir(path.dirname(inRun(runId, request.image)), { recursive: true });
                await writeFile(inRun(runId, request.image), jpeg);
                await writeFile(inRun(runId, request.promptFile), prompt, 'utf8');
                await writeJson(inRun(runId, request.requestFile), request);
                if (!(await validImport(runId, request))) requests.push({ id: request.id, requestFile: request.requestFile, image: request.image, promptFile: request.promptFile });
            }
            pages.push({ viewport, slug: page.slug, requestIds: built.map(x => x.request.id) });
            await finishPage(run, built.map(x => x.request));
        }
    }
    if (missing.length || (!pages.length && !Object.values(run.selection).some(x => x.length)))
        throw new Error(`Detection blocked: select and capture every requested page/viewport first${missing.length ? ` (${missing.length} missing capture(s))` : ''}`);
    const state = { version: 1, execution: 'kajoo-agent', status: requests.length ? 'awaiting-analysis' : 'complete', manifest: manifestPath, pending: requests.length, requests, pages };
    await writeJson(inRun(runId, manifestPath), state);
    return state;
}

function validateResult(result) {
    const finitePositive = n => typeof n === 'number' && Number.isFinite(n) && n > 0;
    if (!result || typeof result !== 'object' || Array.isArray(result) || !finitePositive(result.coordinate_space?.width) || !finitePositive(result.coordinate_space?.height) || !Array.isArray(result.components) || result.components.length > 10000)
        throw new Error('Invalid analysis result: expected coordinate_space and components array');
    for (const c of result.components) {
        if (!c || typeof c.name !== 'string' || !c.name.trim() || c.name.length > 500 || !Array.isArray(c.box) || c.box.length !== 4 || !c.box.every(n => typeof n === 'number' && Number.isFinite(n)) || ![1, 2].includes(c.level))
            throw new Error('Invalid analysis component: name, level and finite four-coordinate box required');
        const [y0, x0, y1, x1] = c.box;
        if (y0 < 0 || x0 < 0 || y1 <= y0 || x1 <= x0 || y1 > result.coordinate_space.height || x1 > result.coordinate_space.width)
            throw new Error('Invalid analysis component: box outside coordinate_space or empty');
        if ((c.id !== undefined && typeof c.id !== 'string') || (c.parent !== undefined && c.parent !== null && typeof c.parent !== 'string') || (c.contains !== undefined && (!Array.isArray(c.contains) || !c.contains.every(x => typeof x === 'string'))))
            throw new Error('Invalid analysis component metadata');
    }
}

async function finishPage(run, requests) {
    const imports = await Promise.all(requests.map(r => validImport(run.id, r)));
    if (imports.some(x => !x)) return false;
    const first = requests[0];
    const warnings = [];
    const parsed = requests.map((r, i) => ({ tile: r.tile.index, items: parseTile(imports[i].result, r.tile, r.coordMode, r.page.width, warnings) }));
    const rects = await readJson(inRun(run.id, `rects/${first.viewport}/${first.slug}.json`), []);
    const checked = validateImageComponents(mergeTiles(parsed, first.page.height, first.page.width), rects);
    for (const c of checked.components) c.reusableId = null;
    warnings.push(...checked.findings.map(f => `Image validation (${f.decision}): ${f.name} [${f.componentId}] in ${f.imageSelector}: ${f.reason}`));
    warnings.push(...checked.components.filter(c => c.gaps?.length).map(c => `Incomplete render (nonblocking): ${c.name} [${c.id}] — ${c.gaps.join(', ')}; component retained, missing appearance unverified.`));
    const models = [...new Set(imports.map(i => i.metadata.model ?? 'kajoo-agent-configured'))];
    await writeJson(llmFile(run.id, first.viewport, first.slug), {
        url: first.url, viewport: first.viewport, generatedAt: new Date().toISOString(), model: models.length === 1 ? models[0] : 'kajoo-agent-configured',
        imageWidth: first.page.width, imageHeight: first.page.height, tiles: requests.length,
        components: checked.components, imageValidation: { version: 1, findings: checked.findings }, warnings,
        usage: null, analysis: { execution: 'kajoo-agent', requestIds: requests.map(r => r.id), componentsHash: jsonHash(checked.components), metadata: imports.map(i => i.metadata),
            tileReviews: imports.map((i, n) => ({ requestId: requests[n].id, inspection: i.result.inspection, componentCount: i.result.components.length, emptyReason: i.result.emptyReason ?? null, revision: i.revision ?? 0 })),
            usageTracking: 'Kajoo platform; unavailable to scripts' },
    });
    return true;
}

export async function importDetection(runId, requestId, resultFile, metadata = {}, { replace = false, binding } = {}) {
    if (!/^[a-f0-9]{64}$/.test(requestId)) throw new Error('Invalid analysis request id');
    for (const field of ['model', 'traceId']) if (metadata[field] !== undefined && (typeof metadata[field] !== 'string' || !metadata[field].trim() || metadata[field].length > 500)) throw new Error(`Invalid ${field} metadata`);
    const run = await getRun(runId);
    const request = await readJson(inRun(runId, `analysis-requests/${requestId}/request.json`));
    const page = run.pages.find(p => p.slug === request.slug && p.url === request.url);
    if (!page || !run.viewports.includes(request.viewport) || !run.selection[request.viewport]?.includes(page.url)) throw new Error('Stale analysis request: page is no longer selected');
    const current = (await pageRequests(run, request.viewport, page)).map(x => x.request);
    const expected = current.find(r => r.id === requestId);
    if (!expected || jsonHash(expected) !== jsonHash(request)) throw new Error('Stale or changed analysis request: screenshot, prompt or geometry changed');
    if (hash(await readFile(inRun(runId, request.image))) !== request.imageHash || hash(await readFile(inRun(runId, request.promptFile))) !== request.promptHash) throw new Error('Analysis image or prompt changed');
    if ((await stat(resultFile)).size > MAX_RESULT_BYTES) throw new Error('Analysis result exceeds 4 MiB');
    const raw = await readFile(resultFile);
    if (raw.length > MAX_RESULT_BYTES) throw new Error('Analysis result exceeds 4 MiB');
    let result;
    try { result = JSON.parse(raw.toString('utf8')); } catch { throw new Error('Analysis result must be raw JSON'); }
    validateResult(result);
    if (binding) {
        await verifyBinding(runId, request, binding, resultFile);
        result = bindInspection(result, request);
    }
    validateNativeResult(result, request);
    const resultHash = hash(raw);
    const previous = await validImport(runId, request);
    const changed = previous && previous.resultHash !== resultHash;
    if (changed && !replace) throw new Error('Conflicting result: request already imported; re-inspect this tile and use --replace for a corrected result');
    if (!previous || changed) {
        // Immutable hash-named responses and receipt-last publication preserve all prior evidence.
        const rawFile = `analysis-results/${requestId}/${resultHash}.json`;
        await mkdir(path.dirname(inRun(runId, rawFile)), { recursive: true });
        await writeFile(inRun(runId, rawFile), raw);
        // Keep the established response.json convenience path; validity always uses rawFile.
        await writeFile(inRun(runId, `analysis-results/${requestId}/response.json`), raw);
        const previousResults = previous ? [...(previous.previousResults ?? []), { resultHash: previous.resultHash, rawFile: previous.rawFile, metadata: previous.metadata, importedAt: previous.importedAt }] : [];
        await writeJson(inRun(runId, `analysis-results/${requestId}/import.json`), { requestHash: jsonHash(request), resultHash, rawFile, ...(binding ? { binding: { batchId: binding.batchId, jobId: binding.jobId } } : {}), previousResults, revision: previousResults.length, metadata: { ...(metadata.model ? { model: metadata.model } : {}), ...(metadata.traceId ? { traceId: metadata.traceId } : {}) }, importedAt: new Date().toISOString() });
    }
    const pageComplete = await finishPage(run, current);
    const prepared = await prepareDetection(runId);
    const checkpoint = await readJson(inRun(runId, 'discovery-checkpoint.json'), { completed: [] });
    checkpoint.completed = checkpoint.completed.filter(stage => !['detect', 'report'].includes(stage));
    await writeJson(inRun(runId, 'discovery-checkpoint.json'), checkpoint);
    const state = await saveWorkState(runId, { analysis: prepared });
    return { status: prepared.status, requestId, pageComplete, pending: prepared.pending, manifest: manifestPath, componentCount: result.components.length,
        reviewRequired: result.components.length === 0, ...(result.components.length === 0 ? { warning: 'Empty tile result: inspect this tile and confirm the saved emptyReason before continuing; do not restart capture.' } : {}),
        checkpoint: 'work-state.json', next: state.next, idempotent: !!previous && !changed, corrected: !!changed };
}

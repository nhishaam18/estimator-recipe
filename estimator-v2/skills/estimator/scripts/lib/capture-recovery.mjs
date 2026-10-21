// Called by the serial Developer command while it owns discovery.lock.
// Recovery never removes a safety stop or starts another discovery/capture sweep.
import { createHash, randomUUID } from 'node:crypto';
import { copyFile, mkdir, open, readFile, unlink } from 'node:fs/promises';
import path from 'node:path';
import { launchBrowser } from './browser.mjs';
import { captureSequence } from './capture.mjs';
import { newJob } from './jobs.mjs';
import { exists, getRun, inRun, readJson, updateRun, writeJson } from './store.mjs';

const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const artifacts = slug => [`shots/desktop/${slug}.png`, `html/desktop/${slug}.html`, `rects/desktop/${slug}.json`, `scan/desktop/${slug}.json`, `analysis/desktop/${slug}.json`];
async function snapshot(id, files, prefix = '') {
    const hashes = {};
    for (const rel of files) {
        const file = inRun(id, prefix ? `${prefix}/${rel}` : rel);
        hashes[rel] = await exists(file) ? hash(await readFile(file)) : null;
    }
    // These are exactly the evidence inputs that bind detection requests. Other
    // analysis/scan metadata can change without discarding verified visual work.
    const source = Object.fromEntries(Object.entries(hashes).slice(0, 3));
    return { sourceHash: hash(JSON.stringify(source)), files: hashes };
}
async function copyEvidence(id, files, from, to) {
    for (const rel of files) {
        const source = inRun(id, from ? `${from}/${rel}` : rel);
        if (!await exists(source)) continue;
        const dest = inRun(id, to ? `${to}/${rel}` : rel);
        await mkdir(path.dirname(dest), { recursive: true });
        await copyFile(source, dest);
    }
}
async function runCapture(run, page, outputPrefix) {
    const browser = await launchBrowser();
    const job = newJob(1);
    try {
        const states = await captureSequence(browser, run, [{ p: page, v: 'desktop' }], job, {
            captureOptions: { outputPrefix, publishState: false, lazyOptions: { maxSteps: 80, maxDurationMs: 20000 } },
        });
        return states?.[0] ?? { status: 'failed', error: job.stopReason ?? 'Capture stopped before the selected URL completed' };
    } finally { await browser.close(); }
}

/** One selected representative only. dependencies is a deterministic test seam. */
export async function recoverCapture(id, { url, reason, diagnosis, viewport = 'desktop' } = {}, dependencies = {}) {
    if (viewport !== 'desktop') throw new Error('Capture recovery supports desktop only');
    if (!['failed', 'obstructed', 'lazy-incomplete'].includes(reason)) throw new Error('Recovery reason must be failed, obstructed or lazy-incomplete');
    for (const [name, value] of Object.entries({ diagnosis }))
        if (value !== undefined && (typeof value !== 'string' || !value.trim() || value.length > 2000)) throw new Error(`Invalid recovery ${name}`);
    const run = await getRun(id), page = run.pages.find(p => p.url === url);
    if (!page || !run.selection.desktop?.includes(url)) throw new Error('Recovery requires one selected representative URL');
    // Fail closed for interrupted locks/unknown worker state. The CLI owns the
    // outer discovery lock; this local lock also prevents direct API overlap.
    for (const rel of ['visual-batches/active.json', 'visual-batches/reservation.lock'])
        if (await exists(inRun(id, rel))) throw new Error('Settle the active visual batch before capture recovery');
    const stopped = await readJson(inRun(id, 'browser-stop.json'), null);
    if (stopped) throw new Error(`Browser workload remains stopped: ${stopped.reason}; inspect before explicit browser retry`);
    const oldState = page.viewports.desktop ?? { status: 'missing' };
    const files = artifacts(page.slug), before = await snapshot(id, files);
    const missing = !before.files[files[0]];
    const diagnostics = [oldState.error ?? '', ...(oldState.flags ?? [])].join('\n');
    const preparation = oldState.preparation ?? {}, lazy = preparation.lazy ?? {};
    const observed = reason === 'failed' ? missing || oldState.status === 'failed'
        : reason === 'obstructed' ? /obstruct|popup.*(?:blocked|unknown|remaining|still)|consent.*(?:unknown|blocked|still)/i.test(diagnostics)
            || ['blocked', 'unknown'].includes(preparation.consentCheck?.status) || preparation.popupCheck?.status === 'blocked'
        : /did not finish loading|lazy.*incomplete|traversal limit/i.test(diagnostics) || lazy.pending > 0 || lazy.reachedEnd === false || lazy.inspectionFailed === true;
    if (!observed && !(reason !== 'failed' && diagnosis?.trim())) throw new Error('Successful capture requires a source-specific obstruction/lazy diagnosis; do not recapture good pages');
    await mkdir(inRun(id, 'capture-recovery'), { recursive: true });
    const lock = inRun(id, 'capture-recovery/recovery.lock');
    let handle;
    try { handle = await open(lock, 'wx'); }
    catch (e) { if (e.code === 'EEXIST') throw new Error('Capture recovery active or interrupted; inspect recovery.lock before resuming'); throw e; }
    try {
        await handle.writeFile(JSON.stringify({ pid: process.pid, url, sourceHash: before.sourceHash }));
        const indexPath = inRun(id, 'capture-recovery/index.json');
        const history = await readJson(indexPath, { attempts: [] });
        const previous = history.attempts.filter(a => a.url === url && [a.sourceHash, a.resultSourceHash].includes(before.sourceHash));
        if (previous.length) throw new Error('Recovery attempt exhausted for this source; retain findings and finish partial/blocked');
        const attemptId = randomUUID(), base = `capture-recovery/${attemptId}`;
        const receiptPath = `${base}/receipt.json`, candidate = `${base}/candidate`, retained = `${base}/previous`;
        const receipt = { version: 1, attemptId, url, viewport, reason, diagnosis: diagnosis ?? null,
            sourceHash: before.sourceHash, before, previousState: oldState, status: 'running', createdAt: new Date().toISOString(),
            receipt: receiptPath, retained, candidate };
        // Archive before any browser work, including merged cache and manifest.
        // Immutable request/import directories are deliberately never deleted.
        await copyEvidence(id, [...files, `llm/desktop/${page.slug}.json`, 'analysis-requests/manifest.json', 'discovery-checkpoint.json'], '', retained);
        await writeJson(inRun(id, receiptPath), receipt);
        history.attempts.push({ attemptId, url, sourceHash: before.sourceHash, receipt: receiptPath });
        await writeJson(indexPath, history); // Reserve even if the process exits during capture.
        let publicationStarted = false;
        const previousCheckpoint = await readJson(inRun(id, 'discovery-checkpoint.json'), null);
        try {
            const state = await (dependencies.capture ?? runCapture)(run, page, candidate);
            receipt.capture = state;
            const after = await snapshot(id, files, candidate);
            receipt.after = after;
            const complete = files.slice(0, 4).every(rel => after.files[rel]);
            if (state.status !== 'ok' || !complete) {
                receipt.status = 'failed';
                receipt.error = state.error ?? 'Candidate evidence incomplete; previous capture remains current';
                receipt.invalidation = { changed: false, scope: 'none', previousEvidenceCurrent: true };
            } else {
                const changed = before.sourceHash !== after.sourceHash;
                if (changed) {
                    publicationStarted = true;
                    await copyEvidence(id, files, candidate, '');
                    // Optional analysis can fail while the required capture succeeds.
                    // Keep its old revision archived, never publish stale diagnostics.
                    for (const rel of files) if (!after.files[rel]) await unlink(inRun(id, rel)).catch(err => { if (err.code !== 'ENOENT') throw err; });
                }
                await updateRun(id, current => {
                    const target = current.pages.find(p => p.url === url);
                    target.viewports.desktop = changed ? state : { ...state, evidence: oldState.evidence ?? state.evidence, recovery: { receipt: receiptPath, status: 'unchanged' } };
                });
                if (changed) {
                    const checkpoint = await readJson(inRun(id, 'discovery-checkpoint.json'), { completed: [] });
                    checkpoint.completed = (checkpoint.completed ?? []).filter(stage => !['detect', 'report'].includes(stage));
                    await writeJson(inRun(id, 'discovery-checkpoint.json'), checkpoint);
                }
                receipt.status = changed ? 'recovered' : 'unchanged';
                receipt.invalidation = { changed, scope: changed ? 'selected-page' : 'none', url,
                    basis: changed ? 'Whole-page screenshot, HTML or rectangles changed; all affected-page tile identities must be prepared again' : 'Detection source inputs unchanged; all existing page/tile imports remain reusable',
                    retainedImports: 'analysis-requests/ and analysis-results/ are preserved; other pages remain current' };
                history.attempts.at(-1).resultSourceHash = after.sourceHash;
            }
        } catch (e) {
            receipt.status = 'failed'; receipt.error = e.message;
            let restored = true;
            if (publicationStarted) {
                try {
                    await copyEvidence(id, files, retained, '');
                    for (const rel of files) if (!before.files[rel]) await unlink(inRun(id, rel)).catch(err => { if (err.code !== 'ENOENT') throw err; });
                    await updateRun(id, current => { current.pages.find(p => p.url === url).viewports.desktop = oldState; });
                    if (previousCheckpoint) await writeJson(inRun(id, 'discovery-checkpoint.json'), previousCheckpoint);
                } catch (rollbackError) { restored = false; receipt.restoreError = rollbackError.message; }
            }
            receipt.invalidation = { changed: !restored, scope: restored ? 'none' : 'selected-page', previousEvidenceCurrent: restored,
                ...(restored ? {} : { action: 'Inspect retained and candidate revisions before resuming; publication restoration failed' }) };
        }
        receipt.finishedAt = new Date().toISOString();
        await writeJson(indexPath, history);
        await writeJson(inRun(id, receiptPath), receipt);
        return receipt;
    } finally { await handle.close(); await unlink(lock); }
}

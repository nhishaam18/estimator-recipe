import { readFile } from 'node:fs/promises';
import * as cheerio from 'cheerio';
import { refineComponents } from './componentvalidation.mjs';
import { loadLlm } from './detect.mjs';
import { elementSigs, isTrivialSkeleton } from './elementsigs.mjs';
import { iou } from './merge.mjs';
import { loadScan, loadSimilarity } from './similarity.mjs';
import { exists, getRun, inRun, readJson } from './store.mjs';
const MATCH = 0.5;
const OVERLAYS = new Set(['cookie-banner', 'modal']);
/**
 * A structure is reusable when the same (canonical) DOM signature appears on two or more pages: the content changes,
 * the structure does not. Ids are assigned in order of first appearance, so they are stable for a given page order.
 */
const reuseCache = new Map();
/**
 * Scanner-block signatures and per-element signatures (any sizeable, non-trivial element the model boxed) in one index.
 * Element signatures use exact skeleton equality; scanner signatures also merge near-identical variants.
 */
export function reusableIndex(run, viewport, canon) {
    const key = `${run.id}:${viewport}:${run.updatedAt}`;
    let p = reuseCache.get(key);
    if (!p) {
        if (reuseCache.size > 20)
            reuseCache.clear();
        p = buildReusableIndex(run, viewport, canon);
        reuseCache.set(key, p);
    }
    return p;
}
async function buildReusableIndex(run, viewport, canon) {
    const out = await scanReusableIndex(run, viewport, canon);
    // element signatures for every page
    const elemUrls = new Map();
    const sigsByPage = new Map();
    for (const p of run.pages) {
        if (p.viewports[viewport]?.status !== 'ok')
            continue;
        const sigs = await elementSigs(run.id, viewport, p.slug);
        sigsByPage.set(p.url, sigs);
        for (const sig of new Set(Object.values(sigs))) {
            const urls = elemUrls.get(sig) ?? [];
            urls.push(p.url);
            elemUrls.set(sig, urls);
        }
    }
    // ids go to the element structures the model actually boxed, in reading order, after the scanner-block ids
    let n = out.size;
    for (const p of run.pages) {
        const llm = await loadLlm(run.id, viewport, p.slug);
        const sigs = sigsByPage.get(p.url);
        if (!llm || !sigs)
            continue;
        const scan = await loadScan(run.id, viewport, p.slug);
        const scans = (scan?.components ?? []);
        const rf = inRun(run.id, `rects/${viewport}/${p.slug}.json`);
        const rects = (await exists(rf)) ? await readJson(rf) : [];
        for (const c of [...llm.components].sort((a, b) => a.box.y - b.box.y || a.level - b.level)) {
            const sm = bestScan(c.box, scans);
            if (sm && out.has(canon[sm.c.signature] ?? sm.c.signature))
                continue;
            const rect = bestRect(c.box, rects);
            const sig = rect ? sigs[rect.s] : undefined;
            const urls = sig ? elemUrls.get(sig) : undefined;
            if (sig && urls && urls.length >= 2 && !out.has(sig))
                out.set(sig, { id: `REC_${String(++n).padStart(2, '0')}`, signature: sig, urls });
        }
    }
    return out;
}
async function scanReusableIndex(run, viewport, canon) {
    const urlsBySig = new Map();
    for (const p of run.pages) {
        if (p.viewports[viewport]?.status !== 'ok')
            continue;
        const scan = await loadScan(run.id, viewport, p.slug);
        for (const c of (scan?.components ?? [])) {
            if (OVERLAYS.has(c.type) || isTrivialSkeleton(c.skeleton))
                continue;
            const sig = canon[c.signature] ?? c.signature;
            const urls = urlsBySig.get(sig) ?? [];
            if (!urls.includes(p.url))
                urls.push(p.url);
            urlsBySig.set(sig, urls);
        }
    }
    const out = new Map();
    let n = 0;
    for (const [sig, urls] of urlsBySig) {
        if (urls.length >= 2)
            out.set(sig, { id: `REC_${String(++n).padStart(2, '0')}`, signature: sig, urls });
    }
    return out;
}
function bestScan(box, scans, preferredSelector = null) {
    let best = null;
    for (const c of scans) {
        if (!c.box)
            continue;
        const v = iou(box, c.box);
        if (v >= MATCH && (!best || v > best.iou || Math.abs(v - best.iou) < 0.000001 && c.selector === preferredSelector))
            best = { c, iou: v };
    }
    return best;
}
function bestRect(box, rects, parentSelector = null, $ = null) {
    let best = null;
    let bv = 0;
    for (const r of rects) {
        const v = iou(box, { x: r.x, y: r.y, w: r.w, h: r.h });
        if (v >= MATCH && v > bv) {
            best = r;
            bv = v;
        }
    }
    if (parentSelector && $ && best) {
        // A sole child can occupy the same rectangle as its section. Use backed
        // DOM containment to avoid binding both detections to the outer node.
        const parent = $(parentSelector).get(0);
        const tied = rects.filter(r => Math.abs(iou(box, r) - bv) < 0.000001).map(r => {
            let el; try { el = $(r.s).get(0); } catch { return null; }
            let depth = 0;
            for (let p = el?.parent; p; p = p.parent) {
                depth++;
                if (p === parent) return { r, depth };
            }
            return null;
        }).filter(Boolean).sort((a, b) => a.depth - b.depth);
        if (tied.length && (!tied[1] || tied[0].depth < tied[1].depth)) best = tied[0].r;
    }
    return best;
}
/** canonical signature -> label learned from model-annotated pages of this viewport */
function bindRects(components, rects, $) {
    const byId = new Map(components.map(c => [c.id, c]));
    const bindings = new Map();
    const visiting = new Set();
    const bind = c => {
        if (bindings.has(c.id)) return bindings.get(c.id);
        if (visiting.has(c.id)) return null;
        visiting.add(c.id);
        const parent = byId.get(c.parent);
        const parentRect = parent ? bind(parent) : null;
        const rect = bestRect(c.box, rects, parentRect?.s, $);
        visiting.delete(c.id);
        bindings.set(c.id, rect);
        return rect;
    };
    for (const c of components) bind(c);
    return bindings;
}
async function learnedLabels(run, viewport, canon) {
    const votes = new Map();
    for (const p of run.pages) {
        const llm = await loadLlm(run.id, viewport, p.slug);
        if (!llm)
            continue;
        const scan = await loadScan(run.id, viewport, p.slug);
        if (!scan)
            continue;
        const rects = await readJson(inRun(run.id, `rects/${viewport}/${p.slug}.json`), []);
        const htmlFile = inRun(run.id, `html/${viewport}/${p.slug}.html`);
        const $ = cheerio.load(await exists(htmlFile) ? await readFile(htmlFile, 'utf8') : '');
        const bindings = bindRects(llm.components, rects, $);
        for (const c of llm.components) {
            const rect = bindings.get(c.id);
            const m = bestScan(c.box, scan.components, rect?.s);
            if (!m)
                continue;
            const sig = canon[m.c.signature] ?? m.c.signature;
            const byName = votes.get(sig) ?? new Map();
            const cur = byName.get(c.name) ?? { c, n: 0 };
            cur.n++;
            byName.set(c.name, cur);
            votes.set(sig, byName);
        }
    }
    const out = new Map();
    for (const [sig, byName] of votes)
        out.set(sig, [...byName.values()].sort((a, b) => b.n - a.n)[0].c);
    return out;
}
export async function buildPageData(runId, viewport, url) {
    const run = await getRun(runId);
    const entry = run.pages.find((p) => p.url === url);
    if (!entry)
        throw new Error('Unknown page');
    const st = entry.viewports[viewport];
    const base = {
        url, slug: entry.slug, viewport, width: st?.width ?? 0, height: st?.height ?? 0, source: 'none', similarTo: null,
        components: [], dom: [], diff: { llmOnly: [], domOnly: [], agreed: 0 }, warnings: [],
    };
    const scan = await loadScan(runId, viewport, entry.slug);
    const rectsFile = inRun(runId, `rects/${viewport}/${entry.slug}.json`);
    const rects = (await exists(rectsFile)) ? await readJson(rectsFile) : [];
    const htmlFile = inRun(runId, `html/${viewport}/${entry.slug}.html`);
    const html = await exists(htmlFile) ? await readFile(htmlFile, 'utf8') : '';
    const $ = cheerio.load(html);
    const scans = (scan?.components ?? []);
    const sim = await loadSimilarity(runId, viewport);
    const canon = sim?.canon ?? {};
    const llm = await loadLlm(runId, viewport, entry.slug);
    const reuse = await reusableIndex(run, viewport, canon);
    const reuseOf = (sig) => (sig ? reuse.get(canon[sig] ?? sig) : undefined);
    const pageSigs = await elementSigs(runId, viewport, entry.slug);
    if (llm) {
        base.source = 'llm';
        base.warnings = llm.warnings;
        base.usage = llm.usage;
        const bindings = bindRects(llm.components, rects, $);
        base.components = llm.components.map((c) => {
            const rect = bindings.get(c.id);
            const sm = bestScan(c.box, scans, rect?.s);
            const esig = rect ? pageSigs[rect.s] : undefined;
            const re = reuseOf(sm?.c.signature) ?? (esig ? reuse.get(esig) : undefined);
            return {
                id: c.id, name: c.name, level: c.level, parent: c.parent, box: c.box, reusable: !!re || c.reusable, reusableId: re?.id ?? null,
                reusableBasis: re ? (re.signature.startsWith('cls-') ? 'class' : c.reusable ? 'both' : 'structure') : c.reusable ? 'model' : null,
                reusablePages: re?.urls.length ?? null,
                repeated: c.repeated, contains: c.contains, frac: c.frac, source: 'llm',
                domSelector: rect?.s ?? sm?.c.selector ?? null,
                scan: sm ? { index: sm.c.index, signature: sm.c.signature, type: sm.c.type, iou: Math.round(sm.iou * 100) / 100 } : null,
            };
        });
    }
    else if (scan) {
        const labels = await learnedLabels(run, viewport, canon);
        let n = 0;
        for (const c of scans) {
            const label = labels.get(canon[c.signature] ?? c.signature);
            if (!label || !c.box)
                continue;
            n++;
            const re = reuseOf(c.signature);
            base.components.push({
                id: `P${n}`, name: label.name, level: label.level, parent: null, box: c.box, reusable: !!re || label.reusable, reusableId: re?.id ?? null,
                reusableBasis: re ? 'structure' : label.reusable ? 'model' : null, reusablePages: re?.urls.length ?? null,
                repeated: label.repeated, contains: label.contains, source: 'propagated', domSelector: c.selector,
                scan: { index: c.index, signature: c.signature, type: c.type, iou: 1 },
            });
        }
        if (n) {
            base.source = 'propagated';
            const g = sim?.groups.find((x) => x.members.includes(url));
            base.similarTo = g && g.rep !== url ? g.rep : null;
        }
    }
    for (const c of scans) {
        if (!c.box)
            continue;
        const match = base.components.filter((v) => iou(v.box, c.box) >= MATCH).sort((a, b) => iou(b.box, c.box) - iou(a.box, c.box))[0];
        base.dom.push({ index: c.index, type: c.type, signature: c.signature, selector: c.selector, box: c.box, matchedWith: match?.id ?? null });
    }
    base.diff.domOnly = base.dom.filter((d) => !d.matchedWith).map((d) => d.index);
    base.diff.llmOnly = base.components.filter((c) => !c.scan).map((c) => c.id);
    base.diff.agreed = base.components.filter((c) => c.scan).length;
    const refined = refineComponents(base.components, { rects, scan: scans, html });
    base.components = refined.components;
    base.validation = { version: 1, counts: refined.counts, findings: refined.findings };
    return base;
}

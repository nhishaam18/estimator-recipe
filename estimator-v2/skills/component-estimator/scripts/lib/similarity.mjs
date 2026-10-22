import { readJson, inRun, exists, writeJson } from './store.mjs';
import { clusterSignatures } from './vendor/selector.mjs';
const OVERLAYS = new Set(['cookie-banner', 'modal']);
export async function loadScan(runId, viewport, slug) {
    const f = inRun(runId, `scan/${viewport}/${slug}.json`);
    return (await exists(f)) ? readJson(f) : null;
}
function jaccard(a, b) {
    if (!a.size && !b.size)
        return 1;
    let inter = 0;
    for (const x of a)
        if (b.has(x))
            inter++;
    return inter / (a.size + b.size - inter);
}
/**
 * Groups pages with a similar component set and chooses what to send to the model:
 * one representative per group, plus any extra page that holds a component no chosen page has.
 */
export async function computeSimilarity(run, viewport, threshold) {
    const pages = [];
    for (const p of run.pages) {
        if (p.viewports[viewport]?.status !== 'ok')
            continue;
        const scan = await loadScan(run.id, viewport, p.slug);
        if (scan)
            pages.push({ url: p.url, slug: p.slug, scan });
    }
    // signature index for clustering near-identical component structures
    const index = {};
    for (const p of pages) {
        for (const c of p.scan.components) {
            const e = (index[c.signature] ??= { type: c.type, skeleton: c.skeleton ?? '', pages: 0, urls: [] });
            if (!e.urls.includes(p.url)) {
                e.urls.push(p.url);
                e.pages++;
            }
        }
    }
    const canon = clusterSignatures(index, 0.9);
    const typeOf = (sig) => index[sig]?.type ?? '';
    const sets = new Map();
    for (const p of pages) {
        sets.set(p.url, new Set(p.scan.signatures.map((s) => canon[s] ?? s).filter((s) => !OVERLAYS.has(typeOf(s)))));
    }
    // grouping: biggest component set first, home-like pages win ties
    const depth = (u) => new URL(u).pathname.split('/').filter(Boolean).length;
    const order = [...pages].sort((a, b) => sets.get(b.url).size - sets.get(a.url).size || depth(a.url) - depth(b.url));
    const groups = [];
    const similarity = {};
    for (const p of order) {
        const mine = sets.get(p.url);
        let best = null;
        let bestSim = 0;
        for (const g of groups) {
            const sim = jaccard(mine, sets.get(g.rep));
            if (sim >= threshold && sim > bestSim) {
                best = g;
                bestSim = sim;
            }
        }
        if (best) {
            best.members.push(p.url);
            similarity[p.url] = bestSim;
        }
        else {
            groups.push({ id: `G${groups.length + 1}`, rep: p.url, members: [p.url] });
            similarity[p.url] = 1;
        }
    }
    // selection: reps first, then pages that bring components nothing chosen has yet
    const all = new Set();
    for (const s of sets.values())
        for (const x of s)
            all.add(x);
    const covered = new Set();
    const selected = [];
    for (const g of groups) {
        selected.push({ url: g.rep, reason: 'representative', newSignatures: 0 });
        for (const x of sets.get(g.rep))
            covered.add(x);
    }
    for (;;) {
        let best = null;
        for (const p of pages) {
            if (selected.some((s) => s.url === p.url))
                continue;
            let gain = 0;
            for (const x of sets.get(p.url))
                if (!covered.has(x))
                    gain++;
            if (gain > 0 && (!best || gain > best.gain))
                best = { url: p.url, gain };
        }
        if (!best)
            break;
        selected.push({ url: best.url, reason: 'new-components', newSignatures: best.gain });
        for (const x of sets.get(best.url))
            covered.add(x);
    }
    const result = { threshold, groups, selected, coverage: { total: all.size, covered: covered.size }, similarity, canon };
    await writeJson(inRun(run.id, `similar/${viewport}.json`), result);
    return result;
}
export async function loadSimilarity(runId, viewport) {
    const f = inRun(runId, `similar/${viewport}.json`);
    return (await exists(f)) ? readJson(f) : null;
}

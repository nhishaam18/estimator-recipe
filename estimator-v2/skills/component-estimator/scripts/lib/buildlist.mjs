import { normName } from './merge.mjs';
import { isImplementationComponent } from './componentvalidation.mjs';
import { summarizeValidation } from './inventoryvalidation.mjs';
import { buildPageData, reusableIndex } from './pagedata.mjs';
import { loadSimilarity } from './similarity.mjs';
import { getRun, inRun, readJson, writeJson } from './store.mjs';
import { hasShot } from './types.mjs';
class UnionFind {
    parent = new Map();
    find(x) {
        if (!this.parent.has(x))
            this.parent.set(x, x);
        let r = x;
        while (this.parent.get(r) !== r)
            r = this.parent.get(r);
        this.parent.set(x, r);
        return r;
    }
    union(a, b) {
        const ra = this.find(a);
        const rb = this.find(b);
        if (ra !== rb)
            this.parent.set(ra, rb);
    }
}
// The model sometimes lists child ids (S4_I1) in the contents field; those are not contents.
const ID_LIKE = /^[A-Z]{1,3}\d+(_[A-Za-z]*\d+)*$/;
const BASIS_LABEL = { structure: 'same structure', class: 'same class names', both: 'same structure + model', model: 'model only' };
// Reserve the public inner CTA key for validated controls. An ordinary composite
// can legitimately be named CTA without being the same implementation unit.
export const buildFamilyKey = (level, name, implementationType) => `${level}:${implementationType === 'cta' ? 'cta' : level === 2 && normName(name) === 'cta' ? 'component-cta' : normName(name)}`;
/**
 * One row per unique component to build. Instances are merged when they share a name and level, or share a reusable id in a
 * viewport. This recipe captures desktop only; a family is counted once across URLs.
 */
async function rawEntries(runId) {
    const run = await getRun(runId);
    const uf = new UnionFind();
    const instances = [];
    const urlsByRec = new Map();
    let pagesScanned = 0;
    const validatedPages = [];
    for (const vp of run.viewports) {
        const sim = await loadSimilarity(runId, vp);
        const idx = await reusableIndex(run, vp, sim?.canon ?? {});
        for (const e of idx.values())
            urlsByRec.set(`${vp}:${e.id}`, e.urls);
        for (const p of run.pages) {
            if (p.viewports[vp]?.status !== 'ok')
                continue;
            pagesScanned++;
            const d = await buildPageData(runId, vp, p.url);
            validatedPages.push(d);
            if (d.source === 'none')
                continue;
            const byId = new Map(d.components.map((c) => [c.id, c]));
            for (const c of d.components) {
                if (!isImplementationComponent(c)) continue;
                const implementationType = c.validation?.implementationType === 'cta' ? 'cta' : null;
                const nameKey = `n:${c.level}:${implementationType ?? 'component'}:${implementationType === 'cta' ? 'cta' : normName(c.name)}`;
                // Same class names alone are weak evidence (generic utility classes), so they never merge differently named components.
                const recKey = c.reusableId && c.reusableBasis !== 'class' ? `r:${vp}:${c.reusableId}` : null;
                uf.find(nameKey);
                // A shared structure id says where the block appears, not that two differently named blocks are one component:
                // chaining ids merged unrelated blocks (a footer column with a CTA band), so names are merged by name rules and the model instead.
                instances.push({
                    vp, url: p.url, slug: p.slug, name: c.name, level: c.level, implementationType, repeated: c.repeated,
                    contains: [...new Set([...c.contains.filter((x) => !ID_LIKE.test(x)), ...d.components.filter(k => k.validation?.ownerId === c.id && !isImplementationComponent(k)).map(k => k.name)])],
                    children: d.components.filter((k) => (k.validation?.ownerId ?? k.parent) === c.id && isImplementationComponent(k)).map((k) => k.name),
                    basis: c.reusableBasis,
                    recKey, nameKey, host: (c.validation?.ownerId ?? c.parent) ? byId.get(c.validation?.ownerId ?? c.parent)?.name ?? null : null, box: c.box, area: c.box.w * c.box.h, shot: hasShot(p.viewports[vp]),
                });
            }
        }
    }
    const groups = new Map();
    for (const i of instances) {
        const root = uf.find(i.nameKey);
        (groups.get(root) ?? groups.set(root, []).get(root)).push(i);
    }
    const entries = [];
    for (const members of groups.values()) {
        const names = new Map();
        const levels = new Map();
        for (const m of members) {
            names.set(m.name, (names.get(m.name) ?? 0) + 1);
            levels.set(m.level, (levels.get(m.level) ?? 0) + 1);
        }
        const implementationType = members[0].implementationType;
        const name = implementationType === 'cta' ? 'CTA' : [...names.entries()].sort((a, b) => b[1] - a[1])[0][0];
        const level = [...levels.entries()].sort((a, b) => b[1] - a[1])[0][0];
        const pages = new Set(members.map((m) => m.url));
        const recIds = new Set();
        for (const m of members) {
            if (!m.recKey)
                continue;
            recIds.add(m.recKey.split(':').slice(2).join(':'));
            for (const u of urlsByRec.get(m.recKey.slice(2)) ?? [])
                pages.add(u);
        }
        const basis = new Set(members.map((m) => m.basis).filter((b) => !!b && b !== 'model').map((b) => BASIS_LABEL[b] ?? b));
        const reusable = recIds.size > 0 || members.some((m) => m.basis === 'model' || m.basis === 'class') || implementationType === 'cta' && members.length > 1;
        if (!basis.size && reusable)
            basis.add(BASIS_LABEL.model);
        const exemplar = [...members].sort((a, b) => (a.shot ? 0 : 1) - (b.shot ? 0 : 1) || (a.vp === 'desktop' ? 0 : 1) - (b.vp === 'desktop' ? 0 : 1) || b.area - a.area)[0];
        entries.push({
            id: '',
            key: buildFamilyKey(level, name, implementationType),
            sourceKeys: [buildFamilyKey(level, name, implementationType)],
            aliases: [...names.keys()].filter((n) => n !== name),
            name,
            level,
            ...(implementationType ? { implementationType } : {}),
            kind: reusable ? 'reusable' : 'page-specific',
            basis: [...basis],
            reusableIds: [...recIds].sort(),
            pages: [...pages],
            pagesCount: pages.size,
            instances: members.length,
            viewports: [...new Set(members.map((m) => m.vp))],
            contains: [...new Set(members.flatMap((m) => m.contains))].slice(0, 14),
            children: [...new Set(members.flatMap((m) => m.children))].slice(0, 12),
            hosts: [...new Set(members.map((m) => m.host).filter((h) => !!h))].slice(0, 8),
            repeated: members.some((m) => m.repeated),
            example: { viewport: exemplar.vp, url: exemplar.url, slug: exemplar.slug, box: exemplar.box, hasShot: exemplar.shot },
        });
    }
    // Retain a desktop eligibility guard for imported legacy data.
    const eligible = entries.filter(e => e.viewports.includes('desktop'));
    return { entries: eligible, excludedMobileOnlyCount: entries.length - eligible.length, pagesScanned, validation: summarizeValidation(validatedPages) };
}
const loadConsolidation = async () => ({ groups: [] });
// Words that say what kind of box it is, not what it is: "Author bio section", "Author bio card" and "Author bio block" are one thing.
const GENERIC = new Set(['section', 'block', 'component', 'container', 'wrapper', 'module', 'area', 'row', 'item', 'element', 'widget', 'the', 'and', 'of', 'a', 'for', 'global', 'main', 'page', 'card', 'list']);
function tokenKey(name) {
    const t = name.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean).map((w) => w.replace(/ies$/, 'y').replace(/s$/, '')).filter((w) => !GENERIC.has(w));
    return [...new Set(t)].sort().join('-');
}
function mergeEntries(members, name) {
    const sorted = [...members].sort((a, b) => b.pagesCount - a.pagesCount || b.instances - a.instances);
    const lead = sorted[0];
    const pages = new Set(members.flatMap((m) => m.pages));
    const reusable = members.some((m) => m.kind === 'reusable') || pages.size >= 2;
    const nameCount = new Map();
    for (const m of members)
        for (const n of [m.name, ...m.aliases])
            nameCount.set(n, (nameCount.get(n) ?? 0) + 1);
    const finalName = lead.implementationType === 'cta' ? 'CTA' : name || lead.name;
    const own = (n) => members.some((m) => m.name === n || m.aliases.includes(n)) || n === finalName;
    return {
        ...lead,
        id: '',
        key: lead.key,
        sourceKeys: [...new Set(members.flatMap(m => m.sourceKeys))],
        name: finalName,
        aliases: [...nameCount.keys()].filter((n) => n !== finalName),
        level: members.some((m) => m.level === 1) ? 1 : 2,
        kind: reusable ? 'reusable' : 'page-specific',
        basis: [...new Set(members.flatMap((m) => m.basis))],
        reusableIds: [...new Set(members.flatMap((m) => m.reusableIds))].sort(),
        pages: [...pages],
        pagesCount: pages.size,
        instances: members.reduce((n, m) => n + m.instances, 0),
        viewports: [...new Set(members.flatMap((m) => m.viewports))],
        contains: [...new Set(members.flatMap((m) => m.contains))].slice(0, 14),
        children: [...new Set(members.flatMap((m) => m.children))].filter((c) => !own(c)).slice(0, 12),
        hosts: [...new Set(members.flatMap((m) => m.hosts))].filter((h) => !own(h)).slice(0, 8),
        repeated: members.some((m) => m.repeated),
        example: [...sorted].sort((a, b) => (a.example.hasShot === false ? 1 : 0) - (b.example.hasShot === false ? 1 : 0) || (a.example.viewport === 'desktop' ? 0 : 1) - (b.example.viewport === 'desktop' ? 0 : 1))[0].example,
    };
}
/** Raw entries merged by deterministic name rules and by saved (model or manual) groups. */
function consolidate(raw, saved) {
    const uf = new UnionFind();
    const byKey = new Map(raw.map((e) => [e.key, e]));
    const related = (a, b) => {
        const aNames = [a.name, ...a.aliases].map(normName);
        const bNames = [b.name, ...b.aliases].map(normName);
        return a.children.some(n => bNames.includes(normName(n))) || b.children.some(n => aNames.includes(normName(n))) || a.hosts.some(n => bNames.includes(normName(n))) || b.hosts.some(n => aNames.includes(normName(n)));
    };
    const canUnion = (a, b) => {
        const left = raw.filter(e => uf.find(e.key) === uf.find(a));
        const right = raw.filter(e => uf.find(e.key) === uf.find(b));
        return left.every(x => right.every(y => x.level === y.level && x.implementationType === y.implementationType && !related(x, y)));
    };
    const allowedSaved = saved.groups.filter(g => {
        if (!g.keys.every(k => byKey.has(k))) return false;
        const entries = g.keys.map(k => byKey.get(k)).filter(Boolean);
        return entries.every((x, i) => entries.slice(i + 1).every(y => x.level === y.level && x.implementationType === y.implementationType && !related(x, y)));
    });
    const firstByToken = new Map();
    for (const e of raw) {
        uf.find(e.key);
        const token = tokenKey(e.name);
        if (!token)
            continue;
        const tk = `${e.level}:${token}`;
        const first = firstByToken.get(tk);
        if (first && canUnion(e.key, first))
            uf.union(e.key, first);
        else
            firstByToken.set(tk, e.key);
    }
    for (const g of allowedSaved) {
        const keys = g.keys.filter((k) => byKey.has(k));
        if (new Set(keys.map(k => byKey.get(k).level)).size > 1) continue;
        for (const k of keys.slice(1))
            if (canUnion(keys[0], k)) uf.union(keys[0], k);
    }
    const names = new Map();
    for (const g of allowedSaved)
        if (g.name && new Set(g.keys.filter(k => byKey.has(k)).map(k => uf.find(k))).size === 1)
            for (const k of g.keys)
                if (byKey.has(k))
                    names.set(uf.find(k), g.name);
    const groups = new Map();
    for (const e of raw) {
        const r = uf.find(e.key);
        (groups.get(r) ?? groups.set(r, []).get(r)).push(e);
    }
    return [...groups.entries()].map(([root, m]) => (m.length === 1 && !names.has(root) ? m[0] : mergeEntries(m, names.get(root))));
}
function finish(entries, pagesScanned) {
    entries.sort((a, b) => (a.kind === b.kind ? 0 : a.kind === 'reusable' ? -1 : 1) || a.level - b.level || b.pagesCount - a.pagesCount || a.name.localeCompare(b.name));
    entries.forEach((e, i) => (e.id = `C${String(i + 1).padStart(3, '0')}`));
    return {
        generatedAt: new Date().toISOString(),
        summary: {
            total: entries.length,
            reusable: entries.filter((e) => e.kind === 'reusable').length,
            pageSpecific: entries.filter((e) => e.kind === 'page-specific').length,
            sections: entries.filter((e) => e.level === 1).length,
            inner: entries.filter((e) => e.level === 2).length,
            pagesScanned,
        },
        entries,
    };
}
export async function buildList(runId) {
    const { entries: raw, pagesScanned, validation, excludedMobileOnlyCount } = await rawEntries(runId);
    const saved = await loadConsolidation(runId);
    return { ...finish(consolidate(raw, saved), pagesScanned), validation, rawTotal: raw.length,
        policy: { version: 2, levels: 2, desktopRequired: true, eligibility: 'desktop-backed', excludedMobileOnlyCount } };
}
export function buildListMarkdown(list) {
    const s = list.summary;
    const L = ['## Components to build', ''];
    if (list.policy) L.push('Desktop-only inventory: repeated occurrences share one implementation family.', '');
    if (list.validation) L.push(`Automatic boundary refinement: ${list.validation.counts.content} content detection(s), ${list.validation.counts.part} owned part(s) and ${list.validation.counts.uncertain} uncertain detection(s) excluded from implementation counts. These are page/viewport detections, not unique families. Full reasons: export/component-validation.json. Uncertain candidates mean this is a provisional inventory.`, '');
    L.push(`${s.total} unique component(s): ${s.sections} section(s) and ${s.inner} inner component(s); ${s.reusable} reusable and ${s.pageSpecific} page-specific. Built from ${s.pagesScanned} scanned page view(s). Each row is one component to implement on the new platform; the same component under different names is merged. A reusable component is built once and used on every page it appears on.`, '');
    L.push('| ID | Component | Level | Kind | Pages | Hosted in | Contains | Also named |', '| --- | --- | --- | --- | --- | --- | --- | --- |');
    for (const e of list.entries) {
        L.push(`| ${e.id} | ${e.name}${e.repeated ? ' (repeated item)' : ''} | ${e.level === 1 ? 'Section' : 'Inner'} | ${e.kind === 'reusable' ? `Reusable${e.reusableIds.length ? ` (${e.reusableIds.join(', ')})` : ''}` : 'Page-specific'} | ${e.pagesCount} | ${e.hosts.join(', ') || '-'} | ${(e.level === 1 ? e.children : e.contains).join(', ') || '-'} | ${e.aliases.join(', ') || '-'} |`);
    }
    L.push('');
    return L.join('\n');
}

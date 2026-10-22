import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import { isImplementationComponent } from './componentvalidation.mjs';
import { buildList, buildListMarkdown } from './buildlist.mjs';
import { logJob } from './jobs.mjs';
import { buildPageData, reusableIndex } from './pagedata.mjs';
import { COLORS } from './colors.mjs';
import { loadSimilarity } from './similarity.mjs';
import { getRun, inRun, writeJson, readJson } from './store.mjs';
import { hasShot } from './types.mjs';
import { runCosts } from './costs.mjs';
import { exists } from './store.mjs';
import { outOfTime } from './jobs.mjs';
import { urlGroupAccounting } from './urlplanstore.mjs';
const esc = (s) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[c]));
export async function drawAnnotated(png, comps, out, opts) {
    const meta = await sharp(png).metadata();
    const W = meta.width;
    const H = meta.height;
    const parts = [];
    for (const c of comps) {
        if ((c.level === 1 && !opts.level1) || (c.level === 2 && !opts.level2))
            continue;
        const x = Math.max(0, Math.min(c.box.x, W - 2));
        const y = Math.max(0, Math.min(c.box.y, H - 2));
        const w = Math.max(2, Math.min(c.box.w, W - x));
        const h = Math.max(2, Math.min(c.box.h, H - y));
        const color = c.reusable ? COLORS.reusable : c.level === 1 ? COLORS.l1 : COLORS.l2;
        const sw = c.level === 1 ? 4 : 2;
        parts.push(`<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="none" stroke="${color}" stroke-width="${sw}"${c.repeated ? ' stroke-dasharray="10 6"' : ''}/>`);
        if (opts.labels) {
            const text = `${c.id} ${c.name}${c.reusableId ? ` [${c.reusableId}]` : ''}`;
            const bw = Math.min(W, 14 + text.length * 7.2);
            const bx = Math.min(x, W - bw);
            const by = Math.max(0, Math.min(y, H - 22));
            parts.push(`<rect x="${bx}" y="${by}" width="${bw}" height="22" fill="${color}"/><text x="${bx + 6}" y="${by + 16}" font-family="sans-serif" font-size="13" fill="#fff">${esc(text)}</text>`);
        }
    }
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">${parts.join('')}</svg>`;
    await mkdir(path.dirname(out), { recursive: true });
    await sharp(png).composite([{ input: Buffer.from(svg), top: 0, left: 0 }]).png().toFile(out);
}
function coord(c, W, H, scale) {
    const f = c.frac ?? [c.box.y / H, c.box.x / W, (c.box.y + c.box.h) / H, (c.box.x + c.box.w) / W];
    const r = (v) => (scale <= 1 ? v.toFixed(3) : String(Math.round(v * scale)));
    return `[${r(f[0])}, ${r(f[1])}, ${r(f[2])}, ${r(f[3])}]`;
}
function typeLabel(c) {
    if (c.validation && !c.validation.countInBuildList)
        return `${c.validation.role} (excluded${c.validation.ownerId ? `; owner ${c.validation.ownerId}` : ''})`;
    if (c.reusable)
        return `Reusable${c.reusableId ? ` (${c.reusableId})` : ''}`;
    if (c.level === 1)
        return 'Section';
    return c.repeated ? 'Inner (Repeated)' : 'Inner';
}
const inline = value => String(value ?? '').replaceAll('|', '\\|').replace(/\s+/g, ' ').trim();
const overlap = (a, b) => Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x)) * Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));
async function componentDetails(runId, run, list) {
    const lines = ['## Component implementation outlines', '', 'Each entry is one unique implementation unit. Owned fields remain inside its component; independent children are estimated separately. Measured styles describe the captured desktop state, not a verified design token or responsive rule.', ''];
    for (const entry of list.entries) {
        lines.push(`### ${entry.id} ${inline(entry.name)} (${entry.level === 1 ? 'Section' : 'Inner component'})`, '');
        lines.push(`- **Purpose and occurrence:** ${entry.kind}; ${entry.instances} annotated occurrence(s) on ${entry.pagesCount} page(s). Example: ${entry.example.url}.`);
        lines.push(`- **Owned content fields:** ${entry.contains.length ? entry.contains.map(inline).join(', ') : 'No fields identified; inspect the screenshot and DOM evidence.'}`);
        if (entry.level === 1) lines.push(`- **Independent child components:** ${entry.children.length ? entry.children.map(inline).join(', ') : 'None identified.'}`);
        else lines.push(`- **Used within:** ${entry.hosts.length ? entry.hosts.map(inline).join(', ') : 'No parent section established.'}`);
        const page = run.pages.find(p => p.url === entry.example.url);
        const state = page?.viewports?.[entry.example.viewport];
        const evidence = state?.evidence?.path ? await readJson(inRun(runId, state.evidence.path), null) : null;
        const box = entry.example.box;
        const nodes = evidence?.nodes?.filter(n => n.box && overlap(box, n.box) > 0).sort((a, b) => overlap(box, b.box) - overlap(box, a.box)).slice(0, 4) ?? [];
        const styleLines = nodes.map(n => {
            const s = evidence.styles?.[n.styleId] ?? {};
            const details = ['font-family', 'font-size', 'font-weight', 'line-height', 'letter-spacing', 'color', 'background-color', 'display', 'grid-template-columns', 'padding-top', 'padding-right', 'padding-bottom', 'padding-left', 'border-radius'].filter(k => s[k] && s[k] !== 'normal' && s[k] !== 'none' && s[k] !== 'auto' && s[k] !== '0px').map(k => `${k}: ${inline(s[k])}`);
            return `  - ${inline(n.selector)}: ${details.join('; ') || 'measured node; no distinguishing values'}`;
        });
        lines.push('- **Measured styling and typography:**');
        lines.push(...(styleLines.length ? styleLines : ['  - No matching measured style sample; use the screenshot and source evidence, and mark styling uncertain.']));
        const images = evidence?.images?.filter(i => i.box && overlap(box, i.box) > 0).slice(0, 4) ?? [];
        if (images.length) lines.push(`- **Observed media:** ${images.map(i => `${inline(i.src)}${i.broken ? ' (failed to load)' : ''}`).join('; ')}`);
        lines.push(`- **Evidence:** export/annotated/${entry.example.viewport}/${entry.example.slug}.png${state?.evidence?.path ? `; ${state.evidence.path}` : '; measured website evidence unavailable'}.`, '');
    }
    return lines;
}
export function pageMarkdown(d, scale, groupNote) {
    const L = [];
    L.push(`### ${d.url} (${d.viewport}, ${d.width}x${d.height}px)`, '');
    if (d.source === 'propagated')
        L.push(`Not sent to the model. Labels were propagated from ${d.similarTo ?? 'similar pages'} by matching DOM structure.`, '');
    else if (groupNote)
        L.push(groupNote, '');
    if (d.warnings.length)
        L.push(...d.warnings.map((w) => `> Warning: ${w}`), '');
    L.push('| Section ID | Component ID | Component name | Type | Contains |');
    L.push('| --- | --- | --- | --- | --- |');
    const rows = [...d.components].sort((a, b) => a.box.y - b.box.y || a.level - b.level);
    for (const c of rows) {
        const section = c.level === 1 ? c.id : c.parent ?? '-';
        L.push(`| ${section} | ${c.id} | ${c.name} | ${typeLabel(c)} | ${c.contains.join(', ') || '-'} |`);
    }
    L.push('', `Model versus DOM: ${d.diff.agreed} component(s) agree with a DOM-detected block, ${d.diff.llmOnly.length} found only by the model, ${d.diff.domOnly.length} DOM block(s) the model did not box.`, '');
    return L.join('\n');
}
export async function exportRun(runId, job, opts = {}) {
    const run = await getRun(runId);
    const scale = run.settings.reportScale || 1000;
    const files = [];
    const all = {};
    const md = [];
    md.push(`# Component report: ${run.name}`, '');
    md.push(`Generated ${new Date().toISOString()} with ${run.settings.model}. Granularity: section and inner components.`, '');
    const urlGroups = await urlGroupAccounting(run, { persist: true });
    if (urlGroups) {
        files.push('export/url-groups.json');
        md.push('## Discovery and approved sample', '', urlGroups.coverageStatement, '', `Discovered ${urlGroups.counts.discovered}; eligible ${urlGroups.counts.eligible}; excluded ${urlGroups.counts.excluded}; duplicates ${urlGroups.counts.duplicates}; seed added ${urlGroups.counts.seedAdded}; selected ${urlGroups.counts.selected}; deferred ${urlGroups.counts.deferred}; scanned ${urlGroups.counts.scanned}; failed ${urlGroups.counts.failed}; pending ${urlGroups.counts.pending}. Scan counts use ${urlGroups.viewport}; viewport output coverage is reported separately.`, '', urlGroups.discoveryBasis, '', 'URL families are provisional; they do not establish template or component equivalence.', '', '| URL family | Discovered | Eligible | Selected | Deferred | Scanned | Failed | Pending |', '| --- | --- | --- | --- | --- | --- | --- | --- |');
        for (const g of urlGroups.groups) md.push(`| ${g.pattern.replaceAll('|', '\\|')} | ${g.discovered} | ${g.eligible} | ${g.selected} | ${g.deferred} | ${g.scanned} | ${g.failed} | ${g.pending} |`);
        md.push('');
    }
    const costs = await runCosts(runId);
    md.push(`Kajoo model and orchestration cost is unavailable to this script; inspect Kajoo traces. Script cost is unknown, not zero.`, '');
    md.push('The canonical component inventory is export/build-list.json; export/build-list.md is its readable view. Effort assumptions are in export/estimates.md.', '');
    const evidenceCaptures = [];
    md.push('## Measured website evidence', '', 'Observed at captured viewports/default state. Original font and image binaries, interactions and intermediate breakpoints are not verified.', '');
    for (const page of run.pages) for (const vp of run.viewports) {
        const state = page.viewports[vp];
        if (state?.status !== 'ok') continue;
        if (!hasShot(state)) {
            evidenceCaptures.push({url:page.url,viewport:vp,available:false,path:null,summary:null,warnings:['Lightweight comparison scan: no current full screenshot or measured styles.']});
            md.push(`- ${page.url} (${vp}): lightweight scan only; measured website evidence unavailable.`);
            continue;
        }
        const evidence = state.evidence ? await readJson(inRun(runId, state.evidence.path), null) : null;
        evidenceCaptures.push({url:page.url,viewport:vp,available:!!evidence,path:state.evidence?.path ?? null,summary:evidence?.summary ?? null,warnings:evidence?.warnings ?? ['Measured website evidence unavailable; recapture explicitly if required.']});
        if (evidence) { files.push(state.evidence.path); md.push(`- ${page.url} (${vp}): ${evidence.summary.nodes} style samples, ${evidence.summary.images} images, ${evidence.summary.fonts} font entries. Evidence: ${state.evidence.path}`); }
        else md.push(`- ${page.url} (${vp}): measured website evidence unavailable.`);
        for (const warning of evidence?.warnings ?? []) md.push(`  - Warning: ${warning}`);
    }
    md.push('');
    await writeJson(inRun(runId, 'export/website-evidence.json'), {version:1,captures:evidenceCaptures}); files.push('export/website-evidence.json');
    for (const vp of run.viewports) {
        const sim = await loadSimilarity(runId, vp);
        all[vp] = [];
        for (const p of run.pages) {
            if (job && outOfTime(job)) return { files };
            if (p.viewports[vp]?.status !== 'ok')
                continue;
            const d = await buildPageData(runId, vp, p.url);
            if (d.source === 'none')
                continue;
            all[vp].push(d);
            job && logJob(job, `Exporting ${p.url} (${vp})`);
            const comps = d.components;
            const rel = `export/annotated/${vp}/${p.slug}.png`;
            if (!opts.skipImages && hasShot(p.viewports[vp]) && !(await exists(inRun(runId, rel)))) {
                await drawAnnotated(inRun(runId, `shots/${vp}/${p.slug}.png`), comps, inRun(runId, rel), { level1: true, level2: true, labels: true });
                files.push(rel);
            }
            if (job)
                job.done++;
        }
        md.push(`## ${vp[0].toUpperCase()}${vp.slice(1)}`, '');
        if (sim) {
            md.push(`Similar-page groups (threshold ${sim.threshold}): ${sim.groups.map((g) => `${g.id}: ${g.rep}${g.members.length > 1 ? ` +${g.members.length - 1} similar` : ''}`).join('; ')}`, '');
            const sent = (run.selection[vp] ?? []).length;
            md.push(`Pages sent to the model: ${sent} of ${all[vp].length}.`, '');
        }
        for (const d of all[vp]) {
            const g = sim?.groups.find((x) => x.members.includes(d.url));
            const note = g && g.members.length > 1 && d.source === 'llm' ? `Representative of ${g.members.length} similar page(s): ${g.members.filter((m) => m !== d.url).join(', ')}.` : '';
            md.push(pageMarkdown(d, scale, note));
        }
    }
    const bl = await buildList(runId);
    await writeJson(inRun(runId, 'export/component-validation.json'), bl.validation);
    files.push('export/component-validation.json');
    md.push(buildListMarkdown(bl));
    md.push(...await componentDetails(runId, run, bl));
    await writeJson(inRun(runId, 'export/build-list.json'), bl);
    await writeFile(inRun(runId, 'export/build-list.md'), buildListMarkdown(bl), 'utf8');
    files.push('export/build-list.json', 'export/build-list.md');
    md.push('## Reusable blocks', '');
    md.push('A block is reusable when the same DOM structure appears on two or more scanned pages (content may differ). Text-only blocks with no distinguishing structure match on an identical tag and set of 3 or more class names. A block only the model flagged is listed on the page without an id.', '');
    let wroteAny = false;
    for (const vp of run.viewports) {
        const sim = await loadSimilarity(runId, vp);
        const idx = await reusableIndex(run, vp, sim?.canon ?? {});
        const rows = [];
        for (const entry of idx.values()) {
            const names = new Map();
            let basis = 'structure';
            for (const d of all[vp] ?? [])
                for (const c of d.components) {
                    if (c.reusableId !== entry.id || !isImplementationComponent(c))
                        continue;
                    names.set(c.name, (names.get(c.name) ?? 0) + 1);
                    if (c.reusableBasis === 'both')
                        basis = 'structure + model';
                    else if (c.reusableBasis === 'class')
                        basis = 'same tag and class names';
                }
            if (!names.size) continue;
            const name = [...names.entries()].sort((a, b) => b[1] - a[1])[0][0];
            rows.push(`| ${entry.id} | ${name} | ${entry.urls.length} | ${basis} | ${entry.urls.map((u) => new URL(u).pathname || '/').join(', ')} |`);
        }
        if (!rows.length)
            continue;
        wroteAny = true;
        md.push(`### ${vp}`, '', '| ID | Name | Pages | Basis | Found on |', '| --- | --- | --- | --- | --- |', ...rows, '');
    }
    if (!wroteAny)
        md.push('None found.', '');
    await writeFile(inRun(runId, 'export/report.md'), (await mkdir(inRun(runId, 'export'), { recursive: true }), md.join('\n')), 'utf8');
    files.push('export/report.md');
    await writeJson(inRun(runId, 'export/annotations.json'), {
        run: run.name,
        generatedAt: new Date().toISOString(),
        model: run.settings.model,
        coordinateScale: scale,
        coordinateOrder: ['ymin', 'xmin', 'ymax', 'xmax'],
        pages: Object.fromEntries(Object.entries(all).map(([vp, list]) => [vp, list.map((d) => ({
                url: d.url, width: d.width, height: d.height, source: d.source, validation: d.validation,
                components: d.components.map((c) => ({ id: c.id, name: c.name, level: c.level, parent: c.parent, validation: c.validation, reusable: c.reusable, reusableId: c.reusableId, repeated: c.repeated, contains: c.contains, box: c.box, coords: coord(c, d.width, d.height, scale) })),
            }))])),
    });
    files.push('export/annotations.json');
    return { files };
}

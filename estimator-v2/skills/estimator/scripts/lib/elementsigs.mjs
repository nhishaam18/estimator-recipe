import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import * as cheerio from 'cheerio';
import { exists, inRun, readJson, writeJson } from './store.mjs';
import { skeleton } from './vendor/scanner.mjs';
/** Elements this small or simple are never treated as reusable structures (a lone button, link, heading, image). */
export const MIN_AREA = 6000;
export const MIN_NODES = 4;
/** Text-only blocks have no distinguishing skeleton; they match on tag plus an identical set of at least this many classes. */
export const MIN_CLASSES = 3;
const SKIP_TAGS = new Set(['img', 'picture', 'svg', 'input', 'select', 'textarea', 'a', 'button', 'p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'span', 'br']);
/**
 * A skeleton made only of text flow and plain wrappers ("flow", "section(flow)", "div(div(flow))") says nothing about
 * layout: any text block shares it. Such structures are never treated as reusable on their own.
 */
const STRUCTURAL = /(^|[^a-z0-9])(img|svg|a|button|ul|ol|li|form|iframe|video|audio|table|tr|details|nav|figure|blockquote|select|textarea|canvas|input:[a-z]+)(?![a-z0-9])/;
export function isTrivialSkeleton(skel) {
    return !skel || !STRUCTURAL.test(skel);
}
const isEl = (n) => n.type === 'tag' || n.type === 'script' || n.type === 'style';
function countNodes(el, cap = 60) {
    let n = 0;
    const walk = (x) => {
        for (const c of x.children ?? []) {
            if (!isEl(c))
                continue;
            if (++n >= cap)
                return;
            walk(c);
        }
    };
    walk(el);
    return n;
}
/**
 * selector -> structural signature for every sizeable, non-trivial element that has a measured box.
 * Selectors use the same scheme as the DOM scanner and the in-page measurement, so they can be joined.
 */
export async function elementSigs(runId, viewport, slug) {
    const cache = inRun(runId, `fp/v4/${viewport}/${slug}.json`);
    if (await exists(cache))
        return readJson(cache);
    const rectsFile = inRun(runId, `rects/${viewport}/${slug}.json`);
    if (!(await exists(rectsFile)))
        return {};
    const rects = await readJson(rectsFile);
    const area = new Map(rects.map((r) => [r.s, r.w * r.h]));
    const $ = cheerio.load(await readFile(inRun(runId, `html/${viewport}/${slug}.html`), 'utf8'));
    const body = $('body').get(0);
    const out = {};
    if (!body)
        return out;
    const idOk = (id) => !!id && /^[A-Za-z_][\w-]{0,40}$/.test(id) && !/\d{4,}/.test(id);
    const visit = (el, path) => {
        const tag = (el.name ?? '').toLowerCase();
        const a = area.get(path);
        if (a !== undefined && a >= MIN_AREA && !SKIP_TAGS.has(tag)) {
            const nodes = countNodes(el);
            const skel = skeleton(el);
            const classes = [...new Set((el.attribs?.class ?? '').split(/\s+/).filter(Boolean))].sort();
            if (nodes >= MIN_NODES && !isTrivialSkeleton(skel))
                out[path] = `el-${createHash('sha1').update(skel).digest('hex').slice(0, 10)}`;
            else if (nodes >= 2 && classes.length >= MIN_CLASSES)
                out[path] = `cls-${createHash('sha1').update(`${tag}|${classes.join(' ')}`).digest('hex').slice(0, 10)}`;
        }
        const kids = (el.children ?? []).filter(isEl);
        for (const k of kids) {
            const kt = (k.name ?? '').toLowerCase();
            const id = k.attribs?.id;
            let p;
            if (idOk(id))
                p = `${kt}#${id}`;
            else {
                const same = kids.filter((s) => (s.name ?? '').toLowerCase() === kt);
                p = `${path} > ${same.length === 1 ? kt : `${kt}:nth-of-type(${same.indexOf(k) + 1})`}`;
            }
            visit(k, p);
        }
    };
    const bid = body.attribs?.id;
    visit(body, idOk(bid) ? `body#${bid}` : 'body');
    await writeJson(cache, out);
    return out;
}

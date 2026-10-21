export function iou(a, b) {
    const x1 = Math.max(a.x, b.x);
    const y1 = Math.max(a.y, b.y);
    const x2 = Math.min(a.x + a.w, b.x + b.w);
    const y2 = Math.min(a.y + a.h, b.y + b.h);
    const inter = Math.max(0, x2 - x1) * Math.max(0, y2 - y1);
    const union = a.w * a.h + b.w * b.h - inter;
    return union > 0 ? inter / union : 0;
}
export const normName = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '');
const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
/**
 * Converts one tile's reply into page-pixel components. The scale is never assumed: the model's own
 * coordinate_space wins, then the configured mode, and as a last resort the largest value seen.
 */
export function parseTile(resp, tile, mode, pageWidth, warnings) {
    const items = Array.isArray(resp.components) ? resp.components : [];
    const echoW = num(resp.coordinate_space?.width);
    const echoH = num(resp.coordinate_space?.height);
    const fallback = mode === 'pixels' ? { w: tile.imageWidth, h: tile.imageHeight } : mode === 'normalized-1' ? { w: 1, h: 1 } : { w: 1000, h: 1000 };
    let sw = echoW && echoW > 0 ? echoW : fallback.w;
    let sh = echoH && echoH > 0 ? echoH : fallback.h;
    const boxes = items.map((i) => (Array.isArray(i.box) && i.box.length === 4 ? i.box.map(num) : null));
    const maxX = Math.max(0, ...boxes.flatMap((b) => (b && b[1] !== null && b[3] !== null ? [b[1], b[3]] : [])));
    const maxY = Math.max(0, ...boxes.flatMap((b) => (b && b[0] !== null && b[2] !== null ? [b[0], b[2]] : [])));
    if (maxX > sw * 1.02 || maxY > sh * 1.02) {
        // Values exceed the stated scale: fall back to the larger of the plausible scales.
        const guessW = maxX <= 1000 ? 1000 : tile.imageWidth;
        const guessH = maxY <= 1000 ? 1000 : tile.imageHeight;
        warnings.push(`Tile ${tile.index + 1}: coordinates exceed the stated scale (${sw}x${sh}); assuming ${guessW}x${guessH}`);
        sw = guessW;
        sh = guessH;
    }
    const out = [];
    items.forEach((it, n) => {
        const b = boxes[n];
        if (!b || b.some((v) => v === null) || typeof it.name !== 'string') {
            warnings.push(`Tile ${tile.index + 1}: skipped a component with a missing name or invalid box`);
            return;
        }
        let [y0, x0, y1, x1] = b;
        y0 = Math.min(Math.max(y0 / sh, 0), 1);
        y1 = Math.min(Math.max(y1 / sh, 0), 1);
        x0 = Math.min(Math.max(x0 / sw, 0), 1);
        x1 = Math.min(Math.max(x1 / sw, 0), 1);
        if (y1 <= y0 || x1 <= x0) {
            warnings.push(`Tile ${tile.index + 1}: skipped "${it.name}" (empty box)`);
            return;
        }
        const py0 = tile.top + y0 * tile.height;
        const py1 = tile.top + y1 * tile.height;
        const box = { x: Math.round(x0 * pageWidth), y: Math.round(py0), w: Math.round((x1 - x0) * pageWidth), h: Math.round(py1 - py0) };
        const level = it.level === 2 || it.level === '2' ? 2 : 1;
        out.push({
            local: String(it.id ?? `T${tile.index}_${n}`),
            parent: typeof it.parent === 'string' ? it.parent : null,
            comp: {
                id: '',
                parent: null,
                level,
                name: it.name.trim().slice(0, 80),
                frac: [0, 0, 0, 0],
                box,
                reusable: it.reusable === true,
                reusableId: typeof it.reusable_id === 'string' && it.reusable_id !== 'null' ? it.reusable_id : null,
                repeated: it.repeated === true,
                contains: Array.isArray(it.contains) ? it.contains.filter((c) => typeof c === 'string').slice(0, 12) : [],
                ...(it.gaps?.length ? {gaps: [...new Set(it.gaps)]} : {}),
            },
        });
    });
    return out;
}
/** Merges duplicates (overlap region) and boxes split across tile edges. Input items carry their tile index. */
export function mergeTiles(perTile, pageHeight, pageWidth) {
    const all = [];
    const merged = [];
    const remap = new Map(); // tile-local key -> merged entry key
    for (const t of perTile) {
        for (const it of t.items) {
            const key = `${t.tile}:${it.local}`;
            const e = { key, tile: t.tile, local: it.local, parentKey: it.parent ? `${t.tile}:${it.parent}` : null, comp: it.comp };
            all.push(e);
            const target = merged.find((m) => m.tile !== t.tile && m.comp.level === e.comp.level && normName(m.comp.name) === normName(e.comp.name) && sameBlock(m.comp.box, e.comp.box));
            if (target) {
                target.comp.box = union(target.comp.box, e.comp.box);
                target.comp.reusable ||= e.comp.reusable;
                target.comp.reusableId ??= e.comp.reusableId;
                target.comp.contains = [...new Set([...target.comp.contains, ...e.comp.contains])];
                if (target.comp.gaps?.length || e.comp.gaps?.length) target.comp.gaps = [...new Set([...(target.comp.gaps ?? []), ...(e.comp.gaps ?? [])])];
                remap.set(key, target.key);
            }
            else {
                merged.push(e);
                remap.set(key, key);
            }
        }
    }
    // order: top to bottom, sections before their inner components
    const sections = merged.filter((m) => m.comp.level === 1).sort((a, b) => a.comp.box.y - b.comp.box.y || a.comp.box.x - b.comp.box.x);
    const inners = merged.filter((m) => m.comp.level === 2).sort((a, b) => a.comp.box.y - b.comp.box.y || a.comp.box.x - b.comp.box.x);
    const result = [];
    const idOf = new Map();
    sections.forEach((s, i) => {
        s.comp.id = `S${i + 1}`;
        idOf.set(s.key, s.comp.id);
    });
    const counters = new Map();
    for (const s of sections)
        result.push(s.comp);
    for (const n of inners) {
        let parentId = null;
        if (n.parentKey) {
            const pk = remap.get(n.parentKey);
            if (pk && idOf.has(pk))
                parentId = idOf.get(pk);
        }
        if (!parentId) {
            // fall back to the smallest section that contains the centre of the inner box
            const cx = n.comp.box.x + n.comp.box.w / 2;
            const cy = n.comp.box.y + n.comp.box.h / 2;
            const host = sections
                .filter((s) => cx >= s.comp.box.x && cx <= s.comp.box.x + s.comp.box.w && cy >= s.comp.box.y && cy <= s.comp.box.y + s.comp.box.h)
                .sort((a, b) => a.comp.box.w * a.comp.box.h - b.comp.box.w * b.comp.box.h)[0];
            parentId = host ? host.comp.id : null;
        }
        const c = (counters.get(parentId ?? '-') ?? 0) + 1;
        counters.set(parentId ?? '-', c);
        n.comp.id = parentId ? `${parentId}_I${c}` : `X_I${c}`;
        n.comp.parent = parentId;
        result.push(n.comp);
    }
    for (const c of result) {
        c.frac = [c.box.y / pageHeight, c.box.x / pageWidth, (c.box.y + c.box.h) / pageHeight, (c.box.x + c.box.w) / pageWidth];
    }
    return result;
}
function union(a, b) {
    const x = Math.min(a.x, b.x);
    const y = Math.min(a.y, b.y);
    return { x, y, w: Math.max(a.x + a.w, b.x + b.w) - x, h: Math.max(a.y + a.h, b.y + b.h) - y };
}
// Same block seen in two tiles: heavy overlap, or touching/overlapping vertically with the same horizontal extent.
function sameBlock(a, b) {
    if (iou(a, b) >= 0.4)
        return true;
    const xOverlap = Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x)) / Math.max(1, Math.min(a.w, b.w));
    const gap = Math.max(a.y, b.y) - Math.min(a.y + a.h, b.y + b.h);
    return xOverlap >= 0.8 && gap <= 8;
}

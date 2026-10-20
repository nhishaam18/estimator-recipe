// Original-size overview only. Annotation roles do not decide CMS implementation boundaries.
import {mkdir} from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
const COLORS={reusable:'#2563eb',l1:'#16a34a',l2:'#f97316'};
export const ANNOTATION_COLORS = { section: '#2563eb', component: '#dc2626', group: '#059669', action: '#9333ea' };
const esc = (s) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[c]));
export async function drawAnnotated(png, comps, out, opts) {
    const meta = await sharp(png).metadata();
    const W = meta.width;
    const H = meta.height;
    const parts = [];
    for (const c of comps) {
        if ((c.level === 1 && !opts.level1) || (c.level === 2 && !opts.level2))
            continue;
        if (!c.box || !['x', 'y', 'w', 'h'].every(k => Number.isFinite(c.box[k])) || c.box.w <= 0 || c.box.h <= 0) throw new Error('Cannot draw malformed annotation geometry');
        const x = Math.max(0, c.box.x), y = Math.max(0, c.box.y);
        const w = Math.min(W, c.box.x + c.box.w) - x, h = Math.min(H, c.box.y + c.box.h) - y;
        if (w <= 0 || h <= 0) continue;
        const color = ANNOTATION_COLORS[c.kind] ?? (c.reusable ? COLORS.reusable : c.level === 1 ? COLORS.l1 : COLORS.l2);
        const sw = c.kind === 'section' || !c.kind && c.level === 1 ? 3 : 2;
        const dashed = c.kind ? c.kind !== 'section' : c.repeated;
        parts.push(`<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="none" stroke="${color}" stroke-width="${sw}"${dashed ? ' stroke-dasharray="9 5"' : ''}/>`);
        if (opts.labels) {
            const label = `${c.displayId ?? c.id} ${c.name}`;
            const limit = Math.min(65, Math.max(1, Math.floor((w - 14) / 7.2)));
            const text = label.length > limit ? label.slice(0, Math.max(0, limit - 1)) + '…' : label;
            const bw = Math.min(w, 14 + text.length * 7.2);
            const bx = Math.min(x, W - bw);
            const by = Math.max(0, Math.min(c.kind === 'action' ? y - 22 : y, H - 22));
            parts.push(`<rect x="${bx}" y="${by}" width="${bw}" height="22" fill="${color}"/><text x="${bx + 6}" y="${by + 16}" font-family="sans-serif" font-size="13" fill="#fff">${esc(text)}</text>`);
        }
    }
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">${parts.join('')}</svg>`;
    await mkdir(path.dirname(out), { recursive: true });
    await sharp(png).composite([{ input: Buffer.from(svg), top: 0, left: 0 }]).png().toFile(out);
}

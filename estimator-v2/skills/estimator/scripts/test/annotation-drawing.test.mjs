import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { drawAnnotated, ANNOTATION_COLORS } from '../lib/annotations.mjs';

test('overview draws distinct annotation roles on the original canvas without a sidebar', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'annotation-draw-')); t.after(() => fs.rm(root, { recursive: true, force: true }));
  const source = path.join(root, 'source.png'), output = path.join(root, 'annotated.png');
  await sharp({ create: { width: 300, height: 400, channels: 3, background: '#fff' } }).png().toFile(source);
  const items = Object.keys(ANNOTATION_COLORS).map((kind, i) => ({ id: `N${i}`, name: kind, kind, box: { x: 20, y: 20 + i * 90, w: 220, h: 60 } }));
  await drawAnnotated(source, items, output, { level1: true, level2: true, labels: false });
  const { data, info } = await sharp(output).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  assert.equal(info.width, 300); assert.equal(info.height, 400);
  for (const hex of Object.values(ANNOTATION_COLORS)) {
    const rgb = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16)); let count = 0;
    for (let i = 0; i < data.length; i += info.channels) if (rgb.every((v, k) => data[i + k] === v)) count++;
    assert.ok(count > 20, `expected visible ${hex} boundary pixels`);
  }
  await drawAnnotated(source, [{ id: 'off', name: 'Off canvas', kind: 'action', box: { x: 500, y: 500, w: 100, h: 20 } }], output, { labels: false });
  const pixels = await sharp(output).removeAlpha().raw().toBuffer(); assert.ok(pixels.every(v => v === 255), 'off-canvas boxes do not become spurious edge borders');
});


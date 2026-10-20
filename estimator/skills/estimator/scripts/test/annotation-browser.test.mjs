import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveBrowserRuntime } from '../lib/browser.mjs';
import { collectRects } from '../lib/capture.mjs';

test('annotation capture retains full boxes and records clipped/hidden ancestor visibility separately', async () => {
  const { chromium } = resolveBrowserRuntime(), browser = await chromium.launch();
  try {
    const page = await browser.newPage({ viewport: { width: 400, height: 300 } });
    await page.setContent('<style>body{margin:0}#clip{position:relative;margin:10px;width:120px;height:80px;overflow:hidden}a{position:absolute;display:block;width:60px;height:40px}#partial{left:100px}#off{left:200px}#faded{opacity:0;position:relative;width:200px;height:80px}</style><div id="clip"><a id="partial" href="/p">Partial action</a><a id="off" href="/o">Offscreen action</a></div><div id="faded"><a id="hidden" href="/h">Hidden action</a></div>');
    const rects = await page.evaluate(collectRects);
    const partial = rects.find(r => r.s === 'a#partial');
    assert.equal(partial.w, 60, 'original geometry remains usable by implementation matching');
    assert.equal(partial.visibleBox.w, 20, 'annotation region respects the scroll-container clip');
    assert.equal(partial.visibleBox.x, 110);
    assert.equal(partial.paintedVisible, true);
    assert.equal(rects.find(r => r.s === 'a#off').paintedVisible, false);
    assert.equal(rects.find(r => r.s === 'a#off').visibleBox.w, 0);
    assert.equal(rects.find(r => r.s === 'a#hidden').paintedVisible, false);
    assert.match(partial.visibilityBasis, /occlusion.*unverified/);
    await page.setContent('<style>body{margin:0}#mask{width:100px;height:100px;overflow:hidden;visibility:hidden}a{display:block;width:80px;height:40px;visibility:visible}#fixed{position:fixed;left:150px;top:20px}#absolute{position:absolute;left:150px;top:80px}</style><div id="mask"><a id="fixed" href="/f">Fixed</a><a id="absolute" href="/a">Absolute</a><a id="override" href="/v">Visible override</a></div>');
    const positioned = await page.evaluate(collectRects);
    for (const name of ['fixed','absolute','override']) {
      const r = positioned.find(r => r.s === `a#${name}`);
      assert.equal(r.paintedVisible,true,`${name} is not hidden by inherited visibility or an escaped static clip`);
      assert.equal(r.visibleBox.w,80);
    }
  } finally { await browser.close(); }
});


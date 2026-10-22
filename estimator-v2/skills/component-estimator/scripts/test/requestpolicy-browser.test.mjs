import {test} from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {performance} from 'node:perf_hooks';
import {attachRequestPolicy} from '../lib/requestpolicy.mjs';
import {resolveBrowserRuntime} from '../lib/browser.mjs';

const listen = server => new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const url = server => `http://127.0.0.1:${server.address().port}`;
const close = server => new Promise(resolve => {server.close(resolve); server.closeAllConnections();});
const {chromium} = resolveBrowserRuntime();

test('local Chromium HTTP workload respects cap and paced admission', async () => {
 const starts = []; let active = 0, maximum = 0;
 const server = http.createServer((req, res) => {
  if (!req.url.startsWith('/api/')) {res.setHeader('content-type', 'text/html'); res.end('<html><body>fixture</body></html>'); return;}
  starts.push(performance.now()); active++; maximum = Math.max(maximum, active);
  res.on('close', () => active--);
  setTimeout(() => res.end('ok'), 230);
 });
 await listen(server); const browser = await chromium.launch();
 try {
  const context = await browser.newContext({serviceWorkers: 'block'}), page = await context.newPage();
  const policy = await attachRequestPolicy(page, {settings: {requestMaxInFlight: 3, requestStartIntervalMs: 60}});
  await page.goto(url(server), {waitUntil: 'domcontentloaded'});
  await page.evaluate(async () => {await Promise.all(Array.from({length: 12}, (_, i) => fetch('/api/' + i).then(r => r.text())));});
  assert.equal(starts.length, 12); assert(maximum <= 3, `Server maximum was ${maximum}`);
  assert(starts.slice(1).every((start, i) => start - starts[i] >= 40), 'Server arrivals should retain start pacing with scheduling tolerance');
  assert(policy.snapshot().maxActive <= 3);
  await page.close(); await policy.dispose(); assert.equal(policy.snapshot().active, 0);
  await context.close();
 } finally {await browser.close(); await close(server);}
});

test('page close cancels a saturated queue and stalled HTTP requests promptly', async () => {
 let started = 0;
 const server = http.createServer((req, res) => {
  if (req.url.startsWith('/stall/')) {started++; return;}
  res.end('<html>fixture</html>');
 });
 await listen(server); const browser = await chromium.launch();
 try {
  const context = await browser.newContext({serviceWorkers: 'block'}), page = await context.newPage();
  const policy = await attachRequestPolicy(page, {settings: {requestMaxInFlight: 2, requestStartIntervalMs: 50}});
  await page.goto(url(server));
  await page.evaluate(() => {for (let i = 0; i < 30; i++) fetch('/stall/' + i).catch(() => {});});
  await page.waitForTimeout(200); assert.equal(started, 2); assert(policy.snapshot().queued > 0);
  const before = performance.now(); await page.close(); await policy.dispose();
  assert(performance.now() - before < 2000); assert.equal(policy.snapshot().active, 0); assert.equal(policy.snapshot().queued, 0);
  assert(policy.snapshot().cancelled >= 28); await context.close();
 } finally {await browser.close(); await close(server);}
});

test('scan blocks visual assets while capture keeps CSS, images, fonts and cross-origin API', async () => {
 const seen = [];
 const api = http.createServer((req, res) => {res.setHeader('access-control-allow-origin', '*'); res.end('essential');});
 await listen(api);
 const server = http.createServer((req, res) => {
  seen.push(req.url);
  if (req.url === '/') {
   res.setHeader('content-type', 'text/html');
   res.end(`<link rel="stylesheet" href="/style.css"><img src="/picture.svg"><video preload="auto" src="/movie.mp4"></video><p>Font fixture</p><script>fetch('${url(api)}/api').then(r=>r.text()).then(text=>window.apiResult=text)</script>`);
  } else if (req.url === '/style.css') {
   res.setHeader('content-type', 'text/css'); res.end('@font-face{font-family:Fixture;src:url(/font.woff2)}p{font-family:Fixture}');
  } else if (req.url === '/picture.svg') {
   res.setHeader('content-type', 'image/svg+xml');res.end('<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"/>');
  } else res.end('fixture');
 });
 await listen(server); const browser = await chromium.launch();
 try {
  for (const shot of [false, true]) {
   seen.length = 0;
   const context = await browser.newContext({serviceWorkers: 'block'}), page = await context.newPage();
   const policy = await attachRequestPolicy(page, {shot, settings: {requestStartIntervalMs: 50}});
   await page.goto(url(server), {waitUntil: 'domcontentloaded'});
   await page.waitForFunction(() => window.apiResult === 'essential');
   await page.evaluate(() => document.fonts.ready); await page.waitForTimeout(300);
   assert(seen.includes('/style.css')); assert.equal(seen.includes('/picture.svg'), shot); assert.equal(seen.includes('/font.woff2'), shot);
   assert(!seen.includes('/movie.mp4')); assert(policy.snapshot().blockedMedia >= 1);
   await page.close(); await policy.dispose(); await context.close();
  }
 } finally {await browser.close(); await close(server); await close(api);}
});

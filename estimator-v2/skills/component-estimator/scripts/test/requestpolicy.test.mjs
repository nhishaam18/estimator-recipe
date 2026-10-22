import {test} from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {attachRequestPolicy} from '../lib/requestpolicy.mjs';

class Page extends EventEmitter {
 async route(pattern, handler) { this.handler = handler; }
 async unroute() { this.handler = null; }
 isClosed() { return this.closed === true; }
 close() { this.closed = true; this.emit('close'); }
 request(type = 'fetch', url = 'https://app.example/api') {
  const request = {resourceType: () => type, url: () => url};
  const route = {request: () => request, continue: async () => {route.started = Date.now();}, abort: async () => {route.aborted = true;}};
  route.done = this.handler(route); return route;
 }
}
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

test('bounded admission releases on finish/failure and paces starts', async () => {
 const page = new Page(), policy = await attachRequestPolicy(page, {settings: {requestMaxInFlight: 2, requestStartIntervalMs: 50}});
 const a = page.request(), b = page.request(), c = page.request();
 await delay(120); assert(a.started); assert(b.started); assert(!c.started);
 assert(b.started - a.started >= 45); assert.equal(policy.snapshot().maxActive, 2);
 page.emit('requestfinished', a.request()); await delay(60); assert(c.started);
 page.emit('requestfailed', b.request()); page.emit('requestfinished', c.request());
 assert.equal(policy.snapshot().active, 0); page.close(); await policy.dispose();
});

test('blocks only explicit resource/tracker policy and keeps main documents', async () => {
 for (const shot of [true, false]) {
  const page = new Page(), policy = await attachRequestPolicy(page, {shot});
  const media = page.request('media'), image = page.request('image'), font = page.request('font');
  const tracking = page.request('script', 'https://sub.google-analytics.com/a');
  const document = page.request('document', 'https://www.google-analytics.com/');
  await delay(350);
  assert(media.aborted); assert(tracking.aborted); assert(document.started);
  assert.equal(Boolean(image.aborted), !shot); assert.equal(Boolean(font.aborted), !shot);
  assert(!JSON.stringify(policy.snapshot()).includes('https://'));
  page.close(); await policy.dispose();
 }
});

test('clamps limits, bounds queue and clears pending routes on close', async () => {
 const page = new Page(), policy = await attachRequestPolicy(page, {settings: {requestMaxInFlight: 900, requestStartIntervalMs: 1, requestQueueLimit: 1}});
 const routes = Array.from({length: 40}, () => page.request());
 await delay(10); const before = policy.snapshot();
 assert.equal(before.limits.maxInFlight, 6); assert.equal(before.limits.startIntervalMs, 50); assert.equal(before.limits.queueLimit, 16);
 assert(before.dropped > 0); assert(before.queuedPeak <= 16);
 page.close(); await Promise.all(routes.map(route => route.done)); await policy.dispose(); await policy.dispose();
 assert.equal(policy.snapshot().active, 0); assert.equal(policy.snapshot().queued, 0);
 assert.equal(page.listenerCount('requestfinished'), 0);
});

test('continuation errors release slots and optional tracker allowance admits requests', async () => {
 const page = new Page(), policy = await attachRequestPolicy(page, {settings: {requestMaxInFlight: 1, requestStartIntervalMs: 50, blockKnownTracking: false}});
 const bad = page.request(); bad.continue = async () => {throw new Error('route already cancelled');};
 const next = page.request('script', 'https://www.googletagmanager.com/fixture.js');
 await Promise.all([bad.done, next.done, delay(80)]);
 assert(next.started); assert.equal(policy.snapshot().continueErrors, 1); assert.equal(policy.snapshot().blockedTracking, 0);
 page.emit('requestfailed', next.request()); assert.equal(policy.snapshot().active, 0);
 page.close(); await policy.dispose();
});

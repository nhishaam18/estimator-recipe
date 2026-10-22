import {performance} from 'node:perf_hooks';

const TRACKERS = ['google-analytics.com', 'doubleclick.net', 'googletagmanager.com'];
const HTTP = /^https?:\/\//i;
const bounded = (value, fallback, min, max) => Number.isFinite(Number(value)) && value !== null && value !== ''
 ? Math.max(min, Math.min(max, Math.floor(Number(value)))) : fallback;

/** Attach before navigation. Close the page before disposing to cancel admitted requests. */
export async function attachRequestPolicy(page, {shot = true, settings = {}} = {}) {
 const limits = {
  maxInFlight: bounded(settings.requestMaxInFlight, 4, 1, 6),
  startIntervalMs: bounded(settings.requestStartIntervalMs, 100, 50, 5000),
  queueLimit: bounded(settings.requestQueueLimit, 128, 16, 512),
 };
 const counts = {started: 0, finished: 0, failed: 0, blocked: 0, blockedMedia: 0, blockedImages: 0, blockedFonts: 0, blockedTracking: 0, dropped: 0, cancelled: 0, continueErrors: 0, maxActive: 0, queuedPeak: 0};
 const queue = [], active = new Set();
 let stopped = false, disposed = false, timer = null, lastStart = -Infinity;
 const warnings = [
  'Media is blocked; video/audio evidence may be incomplete.',
  'Limits apply to routed HTTP(S) requests, not TCP connections or WebSocket traffic.',
  'Playwright routing disables HTTP cache; service workers must be blocked by the owning context.',
  'Playwright does not route redirected follow-up requests; redirect hops are outside admission limits.',
  'Downloads and requests that never finish can retain admission slots until page close; the owner must bound page lifetime.',
 ];
 if (!shot) warnings.push('Scan mode blocks images and fonts; visual/font evidence requires full capture.');
 if (settings.blockKnownTracking !== false) warnings.push('Known analytics/tag hosts are blocked; tag-managed content may be absent.');
 const abort = async (entry, reason = 'blockedbyclient') => {
  try { await entry.route.abort(reason); } catch { /* Closing pages invalidate pending routes. */ }
  finally { entry.resolve(); }
 };
 const stop = () => {
  if (stopped) return;
  stopped = true;
  if (timer) clearTimeout(timer);
  timer = null;
  counts.cancelled += active.size + queue.length;
  active.clear();
  for (const entry of queue.splice(0)) void abort(entry);
 };
 const pump = () => {
  if (stopped || timer || !queue.length || active.size >= limits.maxInFlight) return;
  const wait = limits.startIntervalMs - (performance.now() - lastStart);
  if (wait > 0) {
   timer = setTimeout(() => {timer = null; pump();}, Math.ceil(wait));
   timer.unref?.();
   return;
  }
  const entry = queue.shift();
  active.add(entry.request);
  counts.started++;
  counts.maxActive = Math.max(counts.maxActive, active.size);
  lastStart = performance.now();
  Promise.resolve().then(() => entry.route.continue()).catch(() => {
   counts.continueErrors++;
   active.delete(entry.request);
  }).finally(() => {entry.resolve(); pump();});
  pump();
 };
 const release = (request, failed) => {
  if (!active.delete(request)) return;
  counts[failed ? 'failed' : 'finished']++;
  pump();
 };
 const finished = request => release(request, false), failed = request => release(request, true);
 const handler = route => new Promise(resolve => {
  const request = route.request(), type = request.resourceType();
  const entry = {route, request, resolve};
  if (stopped || page.isClosed()) {counts.cancelled++; void abort(entry); return;}
  let blocked;
  // A document must remain navigable even if its host matches a tracking domain.
  if (type !== 'document') {
   if (type === 'media') blocked = 'blockedMedia';
   else if (!shot && type === 'image') blocked = 'blockedImages';
   else if (!shot && type === 'font') blocked = 'blockedFonts';
   else if (settings.blockKnownTracking !== false) {
    try {
     const hostname = new URL(request.url()).hostname.toLowerCase();
     if (TRACKERS.some(host => hostname === host || hostname.endsWith('.' + host))) blocked = 'blockedTracking';
    } catch { /* Malformed URL is left to the browser. */ }
   }
  }
  if (blocked) {counts.blocked++; counts[blocked]++; void abort(entry); return;}
  if (queue.length >= limits.queueLimit) {
   counts.dropped++;
   if (counts.dropped === 1) warnings.push('Request queue overflow: excess requests were aborted; page evidence may be incomplete.');
   void abort(entry); return;
  }
  queue.push(entry);
  counts.queuedPeak = Math.max(counts.queuedPeak, queue.length);
  pump();
 });
 page.on('requestfinished', finished);
 page.on('requestfailed', failed);
 page.on('close', stop);
 try {await page.route(HTTP, handler);} catch (error) {
  stop(); page.off('requestfinished', finished); page.off('requestfailed', failed); page.off('close', stop); throw error;
 }
 return {
  snapshot: () => {const pendingTypes={};for(const r of [...active,...queue.map(e=>e.request)]){const kind=r.resourceType();pendingTypes[kind]=(pendingTypes[kind]??0)+1;}return {...counts, active: active.size, queued: queue.length, pendingTypes, stopped, limits: {...limits}, shot, warnings: [...warnings]};},
  async dispose() {
   if (disposed) return;
   disposed = true;
   stop();
   page.off('requestfinished', finished); page.off('requestfailed', failed); page.off('close', stop);
   try {await page.unroute(HTTP, handler);} catch (error) {if (!page.isClosed()) throw error;}
  },
 };
}

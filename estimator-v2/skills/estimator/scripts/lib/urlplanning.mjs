import { createHash, randomBytes, randomUUID } from 'node:crypto';

const hash = value => createHash('sha256').update(value).digest('hex');
const stable = value => JSON.stringify(value, (_key, entry) => entry && typeof entry === 'object' && !Array.isArray(entry)
  ? Object.fromEntries(Object.keys(entry).sort().map(key => [key, entry[key]])) : entry);
const compare = (a, b) => a < b ? -1 : a > b ? 1 : 0;
// Explicit credential names, normalized for case and common separator variants.
// Avoid suffix matching: functional pagination fields such as pageToken remain valid.
const credentialKeys = new Set([
  'key', 'token', 'apikey', 'accesskey', 'accesskeyid', 'accesssecret', 'accesstoken', 'refreshtoken', 'idtoken',
  'authtoken', 'auth', 'authorization', 'password', 'secret', 'clientsecret', 'sessionid', 'sessiontoken',
  'signature', 'sig', 'credential', 'credentials', 'keypairid', 'awsaccesskeyid', 'googleaccessid',
  'xamzsignature', 'xamzcredential', 'xamzsecuritytoken', 'xgoogsignature', 'xgoogcredential', 'xgoogsecuritytoken',
]);
const isSensitive = key => credentialKeys.has(key.toLowerCase().replace(/[-_]/g, ''));
const tracking = /^(?:utm_.+|fbclid|gclid|dclid|msclkid|mc_cid|mc_eid|_ga|_gl)$/i;
const asset = /\.(?:pdf|zip|gz|tar|rar|7z|png|jpe?g|gif|webp|svg|ico|avif|bmp|mp[34]|mov|avi|wav|ogg|woff2?|ttf|otf|eot|css|js|mjs|json|xml|txt|csv|xlsx?|docx?|pptx?|webmanifest)$/i;
const baseHost = host => host.toLowerCase().replace(/^www\./, '');

function normalize(raw, seed) {
  if (typeof raw !== 'string' || !raw.trim()) return { url: '[invalid URL]', reason: 'invalid-url' };
  let url;
  try { url = new URL(raw); } catch { return { url: '[invalid URL]', reason: 'invalid-url' }; }
  if (url.username || url.password) return { url: '[redacted credential-bearing URL]', reason: 'credentials' };
  if ([...url.searchParams.keys()].some(isSensitive)) return { url: '[redacted credential-bearing URL]', reason: 'credentials' };
  if (/^#!?\//.test(url.hash) && [...new URLSearchParams(url.hash.split('?').slice(1).join('?')).keys()].some(isSensitive)) return { url: '[redacted credential-bearing URL]', reason: 'credentials' };
  if (!['http:', 'https:'].includes(url.protocol)) return { url: '[non-http URL]', reason: 'non-http' };
  if (seed && (baseHost(url.hostname) !== baseHost(seed.hostname) || url.port !== seed.port)) return { url: url.href, reason: 'out-of-scope' };
  let pathname;
  try { pathname = decodeURIComponent(url.pathname); } catch { return { url: url.href, reason: 'invalid-path' }; }
  if (asset.test(pathname)) return { url: url.href, reason: 'non-page-asset' };
  if (seed) url.hostname = seed.hostname;
  for (const key of [...url.searchParams.keys()]) if (tracking.test(key)) url.searchParams.delete(key);
  url.searchParams.sort();
  const functionalHash = /^#!?\//.test(url.hash);
  if (!functionalHash) url.hash = '';
  else if (url.hash.includes('?')) {
    const [route, ...queryParts] = url.hash.split('?');
    const query = new URLSearchParams(queryParts.join('?'));
    for (const key of [...query.keys()]) if (tracking.test(key)) query.delete(key);
    query.sort();
    url.hash = `${route}${query.size ? `?${query}` : ''}`;
  }
  return { url: url.href, functionalHash };
}

function discoveryLinks(raw, depth = 0) {
  if (depth > 6 || !raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('Unrecognized Firecrawl Map response');
  if (raw.isError === true || (Object.hasOwn(raw, 'success') && raw.success !== true) || raw.error) throw new Error('Firecrawl Map discovery failed');
  if (Array.isArray(raw.links)) return raw.links;
  if (raw.structuredContent) return discoveryLinks(raw.structuredContent, depth + 1);
  if (raw.data && typeof raw.data === 'object') return discoveryLinks(raw.data, depth + 1);
  if (Array.isArray(raw.content)) {
    for (const item of raw.content) {
      if (item?.type !== 'text' || typeof item.text !== 'string') continue;
      let parsed;
      try { parsed = JSON.parse(item.text); } catch { continue; }
      try { return discoveryLinks(parsed, depth + 1); }
      catch (error) { if (!error.message.startsWith('Unrecognized')) throw error; }
    }
  }
  throw new Error('Unrecognized Firecrawl Map response: expected links array');
}

export function urlOnlyDiscovery(raw) {
  const links=discoveryLinks(raw).map(link=>typeof link==='string'?link:link?.url);
  if(links.some(url=>typeof url!=='string'||!url.trim()))throw new Error('Firecrawl result contains an entry without a URL; do not silently drop it');
  return {links};
}

function routePattern(pathname) {
  const dynamic = /^(?:\d+|[0-9a-f]{8,}(?:-[0-9a-f]+)*)$/i;
  const parts = pathname.split('/').filter(Boolean).map(part => dynamic.test(part) ? '*' : part);
  if (!parts.length) return '/';
  if (parts.length === 1) return `/${parts[0]}`;
  return `/${parts.slice(0, -1).join('/')}${parts.length > 1 ? '/' : ''}*`;
}

function patternFor(value) {
  const url = new URL(value);
  const queryPattern = params => [...new Set(params.keys())].map(key => `${encodeURIComponent(key)}=*`).join('&');
  const query = queryPattern(url.searchParams);
  const [hashRoute, ...hashQuery] = url.hash.replace(/^#!?/, '').split('?');
  const fragmentQuery = queryPattern(new URLSearchParams(hashQuery.join('?')));
  const fragment = url.hash ? `${url.hash.startsWith('#!') ? '#!' : '#'}${routePattern(hashRoute)}${fragmentQuery ? `?${fragmentQuery}` : ''}` : '';
  return `${routePattern(url.pathname)}${query ? `?${query}` : ''}${fragment}`;
}

const suggested = count => count <= 5 ? count : count <= 25 ? 5 : count <= 100 ? 8 : count <= 500 ? 12 : 15;
const fingerprint = plan => hash(stable(Object.fromEntries(Object.entries(plan).filter(([key]) => key !== 'fingerprint'))));

/** Normalize Map discovery into provisional URL families; performs no I/O. */
export function buildUrlPlan(seedUrl, rawDiscovery, options = {}) {
  const initial = normalize(seedUrl);
  if (initial.reason) throw new Error(`Invalid seed URL: ${initial.reason}`);
  const seed = new URL(initial.url);
  const links = discoveryLinks(rawDiscovery);
  const urls = new Set();
  const excluded = [];
  const warnings = new Set(['URL families are provisional route patterns; they do not establish DOM or component equivalence.']);
  let duplicates = 0;
  for (const link of links) {
    const result = normalize(typeof link === 'string' ? link : link?.url, seed);
    if (result.reason) { excluded.push({ url: result.url, reason: result.reason }); continue; }
    if (result.functionalHash) warnings.add('Functional hash routes are preserved and need browser verification.');
    if (urls.has(result.url)) duplicates++; else urls.add(result.url);
  }
  const seedAdded = urls.has(initial.url) ? 0 : 1;
  urls.add(initial.url);
  if (initial.functionalHash) warnings.add('Functional hash routes are preserved and need browser verification.');
  const families = new Map();
  for (const url of [...urls].sort(compare)) {
    const pattern = patternFor(url);
    if (!families.has(pattern)) families.set(pattern, []);
    families.get(pattern).push(url);
  }
  const groups = [...families].sort(([a], [b]) => compare(a, b)).map(([pattern, groupUrls]) => ({
    id: `group-${hash(pattern).slice(0, 16)}`, pattern, label: pattern === '/' ? 'Homepage' : pattern,
    count: groupUrls.length, suggestedCount: suggested(groupUrls.length), examples: groupUrls.slice(0, 3), urls: groupUrls,
  }));
  const plan = {
    schemaVersion: 1, id: options.id ?? `urlplan-${randomUUID()}`, createdAt: options.createdAt ?? new Date().toISOString(),
    seedUrl: initial.url, randomSeed: options.randomSeed ?? randomBytes(32).toString('hex'), fingerprint: '', status: 'awaiting-selection',
    counts: { discovered: links.length, eligible: urls.size, excluded: excluded.length, duplicates, seedAdded }, groups, excluded, warnings: [...warnings].sort(compare),
  };
  plan.fingerprint = fingerprint(plan);
  validateUrlPlan(plan);
  return plan;
}

/** Check saved plan integrity and structural invariants before trusting it. */
export function validateUrlPlan(plan) {
  const fail = () => { throw new Error('Malformed or tampered URL plan'); };
  if (!plan || plan.schemaVersion !== 1 || plan.status !== 'awaiting-selection' || typeof plan.id !== 'string' || !plan.id || typeof plan.createdAt !== 'string' || !Number.isFinite(Date.parse(plan.createdAt)) || typeof plan.randomSeed !== 'string' || !plan.randomSeed || typeof plan.fingerprint !== 'string') fail();
  const initial = normalize(plan.seedUrl);
  if (initial.reason || initial.url !== plan.seedUrl || !Array.isArray(plan.groups) || !plan.groups.length || !Array.isArray(plan.excluded) || !Array.isArray(plan.warnings) || plan.warnings.some(warning => typeof warning !== 'string')) fail();
  const counts = plan.counts;
  if (!counts || ['discovered', 'eligible', 'excluded', 'duplicates', 'seedAdded'].some(key => !Number.isSafeInteger(counts[key]) || counts[key] < 0) || ![0, 1].includes(counts.seedAdded)) fail();
  const seen = new Set();
  const seed = new URL(plan.seedUrl);
  let previousPattern;
  for (const group of plan.groups) {
    if (!group || typeof group.pattern !== 'string' || (previousPattern !== undefined && compare(previousPattern, group.pattern) >= 0) || group.id !== `group-${hash(group.pattern).slice(0, 16)}` || group.label !== (group.pattern === '/' ? 'Homepage' : group.pattern) || !Array.isArray(group.urls) || group.urls.length === 0 || group.count !== group.urls.length || group.suggestedCount !== suggested(group.count) || stable(group.examples) !== stable(group.urls.slice(0, 3))) fail();
    previousPattern = group.pattern;
    let previousUrl;
    for (const url of group.urls) {
      const result = normalize(url, seed);
      if (result.reason || result.url !== url || patternFor(url) !== group.pattern || seen.has(url) || (previousUrl !== undefined && compare(previousUrl, url) >= 0)) fail();
      seen.add(url); previousUrl = url;
    }
  }
  const redactedReasons = { 'invalid-url': '[invalid URL]', credentials: '[redacted credential-bearing URL]', 'non-http': '[non-http URL]' };
  for (const entry of plan.excluded) {
    if (!entry || typeof entry.url !== 'string' || !['invalid-url', 'credentials', 'non-http', 'out-of-scope', 'invalid-path', 'non-page-asset'].includes(entry.reason)) fail();
    if (Object.hasOwn(redactedReasons, entry.reason)) { if (entry.url !== redactedReasons[entry.reason]) fail(); }
    else { const result = normalize(entry.url, seed); if (result.reason !== entry.reason || result.url !== entry.url) fail(); }
  }
  if (!seen.has(plan.seedUrl) || counts.eligible !== seen.size || counts.excluded !== plan.excluded.length || counts.discovered + counts.seedAdded !== counts.eligible + counts.excluded + counts.duplicates || fingerprint(plan) !== plan.fingerprint) fail();
  return plan;
}

function shuffled(urls, seed, groupId) {
  const values = [...urls];
  let counter = 0;
  for (let i = values.length - 1; i > 0; i--) {
    const range = i + 1;
    const limit = Math.floor(0x100000000 / range) * range;
    let number;
    do { number = Number.parseInt(hash(stable([seed, groupId, counter++])).slice(0, 8), 16); } while (number >= limit);
    const j = number % range;
    [values[i], values[j]] = [values[j], values[i]];
  }
  return values;
}

/** Apply explicit quotas for every group using deterministic sampling without replacement. */
export function selectUrlPlan(plan, quotas) {
  validateUrlPlan(plan);
  if (!quotas || typeof quotas !== 'object' || Array.isArray(quotas)) throw new Error('Quotas must be an object with a quantity for every group');
  const groupIds = new Set(plan.groups.map(group => group.id));
  if (Object.keys(quotas).some(id => !groupIds.has(id))) throw new Error('Unknown group in quotas');
  const normalizedQuotas = {};
  const groups = plan.groups.map(group => {
    if (!Object.hasOwn(quotas, group.id)) throw new Error(`Missing quota for ${group.id}`);
    const requested = quotas[group.id] === 'all' ? group.count : quotas[group.id];
    if (!Number.isSafeInteger(requested) || requested < 0 || requested > group.count) throw new Error(`Quota for ${group.id} must be an integer from 0 to ${group.count}, or all`);
    normalizedQuotas[group.id] = requested;
    return { id: group.id, pattern: group.pattern, available: group.count, requested, selectedUrls: shuffled(group.urls, plan.randomSeed, group.id).slice(0, requested) };
  });
  const selectedUrls = groups.flatMap(group => group.selectedUrls);
  const selection = { schemaVersion: 1, planId: plan.id, planFingerprint: plan.fingerprint, randomSeed: plan.randomSeed, status: 'selected', groups, selectedUrls, deferredCount: plan.counts.eligible - selectedUrls.length, eligibleCount: plan.counts.eligible, selectionDigest: '', quotas: normalizedQuotas };
  selection.selectionDigest = hash(stable(Object.fromEntries(Object.entries(selection).filter(([key]) => key !== 'selectionDigest'))));
  return selection;
}

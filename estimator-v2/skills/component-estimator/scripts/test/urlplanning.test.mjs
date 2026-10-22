import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { buildUrlPlan, selectUrlPlan, validateUrlPlan } from '../lib/urlplanning.mjs';

const options = { randomSeed: 'fixture-random-seed', createdAt: '2026-10-13T00:00:00.000Z', id: 'urlplan-fixture' };
const planFor = links => buildUrlPlan('https://example.test/', { success: true, links }, options);
const allQuotas = plan => Object.fromEntries(plan.groups.map(group => [group.id, 'all']));
const byPattern = (plan, pattern) => plan.groups.find(group => group.pattern === pattern);
const recalculateFingerprint = plan => {
  const canonical = JSON.stringify(Object.fromEntries(Object.entries(plan).filter(([key]) => key !== 'fingerprint')), (_key, value) => value && typeof value === 'object' && !Array.isArray(value) ? Object.fromEntries(Object.keys(value).sort().map(key => [key, value[key]])) : value);
  plan.fingerprint = createHash('sha256').update(canonical).digest('hex');
  return plan;
};

test('recognizes Firecrawl string/object links, structured MCP and JSON text without mutating discovery', () => {
  const raw = { success: true, links: ['https://example.test/a', { url: 'https://example.test/b', title: 'B' }] };
  const before = structuredClone(raw);
  const expected = planFor(raw.links);
  assert.deepEqual(buildUrlPlan('https://example.test/', raw, options), expected);
  assert.deepEqual(buildUrlPlan('https://example.test/', { structuredContent: raw }, options), expected);
  assert.deepEqual(buildUrlPlan('https://example.test/', { content: [{ type: 'text', text: JSON.stringify(raw) }] }, options), expected);
  assert.deepEqual(buildUrlPlan('https://example.test/', { content: [{ type: 'text', text: '{"metadata":true}' }, { type: 'text', text: JSON.stringify(raw) }] }, options), expected);
  assert.deepEqual(buildUrlPlan('https://example.test/', { success: true, data: raw }, options), expected);
  assert.deepEqual(raw, before);
});

test('failed and unrecognized Map envelopes never become a seed-only successful plan', () => {
  for (const raw of [null, [], {}, { success: true }, { links: 'wrong' }, { success: false, links: [] }, { success: 'false', links: [] }, { isError: true, structuredContent: { links: [] } }, { error: 'failed', links: [] }, { structuredContent: { success: false, links: [] } }, { content: [{ type: 'text', text: '{broken' }] }]) {
    assert.throws(() => buildUrlPlan('https://example.test/', raw, options), /failed|Unrecognized/);
  }
  assert.equal(planFor([]).counts.seedAdded, 1);
});

test('normalizes www, tracking, ordinary fragments and duplicates while accounting scope and assets separately', () => {
  const plan = planFor([
    'https://www.example.test/blog/One/?utm_source=x#heading',
    { url: 'https://example.test/blog/One/' },
    'https://example.test/blog/One',
    'https://example.test/blog/one',
    'https://help.example.test/blog/a',
    'https://example.test:8443/blog/b',
    'https://other.test/',
    'https://example.test/image.PNG',
    'mailto:hello@example.test',
    { other: 'not a link' },
  ]);
  assert.deepEqual(plan.counts, { discovered: 10, eligible: 4, excluded: 6, duplicates: 1, seedAdded: 1 });
  assert.deepEqual(byPattern(plan, '/blog/*').urls, ['https://example.test/blog/One', 'https://example.test/blog/One/', 'https://example.test/blog/one']);
  assert.deepEqual(plan.excluded.map(entry => entry.reason), ['out-of-scope', 'out-of-scope', 'out-of-scope', 'non-page-asset', 'non-http', 'invalid-url']);
  assert.equal(byPattern(plan, '/').label, 'Homepage');
  assert.equal(buildUrlPlan('https://www.example.test/', { links: ['https://example.test/'] }, options).counts.seedAdded, 0);
});

test('credentials are rejected in seeds and redacted in all persisted discovery fields', () => {
  const secret = 'unique-private-secret';
  for (const seed of [`https://user:${secret}@example.test/`, `https://example.test/?api_key=${secret}`, `https://example.test/#/login?token=${secret}`, 'file:///tmp/a', 'https://example.test/a.pdf']) {
    assert.throws(() => buildUrlPlan(seed, { links: [] }, options), /Invalid seed/);
  }
  const plan = planFor([`https://user:${secret}@example.test/`, `https://example.test/?access_token=${secret}`, `https://other.test/?client_secret=${secret}`, `https://example.test/#/login?token=${secret}`]);
  assert.equal(plan.counts.excluded, 4);
  assert.ok(!JSON.stringify(plan).includes(secret));
  assert.ok(plan.excluded.every(entry => entry.reason === 'credentials'));
});

test('OAuth and signed-URL credentials are redacted before eligible, scope or asset retention', () => {
  const credentialNames = ['refresh_token', 'id_token', 'REFRESH-TOKEN', 'X-Amz-Signature', 'X-Amz-Credential', 'X-Amz-Security-Token', 'X-Goog-Signature', 'X-Goog-Credential', 'GoogleAccessId', 'AWSAccessKeyId', 'Signature', 'Key-Pair-Id', 'sig'];
  const placeholder = 'synthetic-review-placeholder';
  for (const key of credentialNames) {
    const query = `${encodeURIComponent(key)}=${placeholder}`;
    for (const seed of [`https://example.test/login?${query}`, `https://example.test/#/login?${query}`]) assert.throws(() => buildUrlPlan(seed, { links: [] }, options), /credentials/);
    const plan = planFor([
      `https://example.test/login?${query}`, `https://other.test/page?${query}`,
      `https://example.test/file.pdf?${query}`, `https://example.test/#/login?${query}`,
      `https://other.test/#/login?${query}`, `https://example.test/file.pdf#/login?${query}`,
    ]);
    assert.equal(plan.counts.excluded, 6, key);
    assert.equal(plan.counts.eligible, 1, key);
    assert.ok(plan.excluded.every(entry => entry.reason === 'credentials' && entry.url === '[redacted credential-bearing URL]'), key);
    assert.ok(!JSON.stringify(plan).includes(placeholder), key);
    assert.ok(!JSON.stringify(selectUrlPlan(plan, allQuotas(plan))).includes(placeholder), key);
  }
  const ordinaryQuery = planFor(['https://example.test/catalog?pageToken=public-page-2&sort=recent']);
  assert.ok(ordinaryQuery.groups.flatMap(group => group.urls).includes('https://example.test/catalog?pageToken=public-page-2&sort=recent'));
});

test('slash-distinct routes and a trailing slash seed remain distinct navigable URLs', () => {
  const seedUrl = 'https://example.test/docs/';
  const links = ['https://example.test/docs', 'https://example.test/docs/', 'https://example.test/docs//'];
  const plan = buildUrlPlan(seedUrl, { links }, options);
  assert.equal(plan.seedUrl, seedUrl);
  assert.deepEqual(plan.counts, { discovered: 3, eligible: 3, excluded: 0, duplicates: 0, seedAdded: 0 });
  assert.deepEqual(byPattern(plan, '/docs').urls, links);
  assert.deepEqual(new Set(selectUrlPlan(plan, allQuotas(plan)).selectedUrls), new Set(links));
  const absentSeed = buildUrlPlan(seedUrl, { links: ['https://example.test/docs'] }, options);
  assert.equal(absentSeed.counts.seedAdded, 1);
  assert.deepEqual(byPattern(absentSeed, '/docs').urls, ['https://example.test/docs', seedUrl]);
});

test('provisional families preserve locale, nested category, route case, query keys and pagination shapes', () => {
  const plan = planFor([
    'https://example.test/blog/first', 'https://example.test/blog/second',
    'https://example.test/blog/category/news', 'https://example.test/blog/category/events',
    'https://example.test/en/blog/post', 'https://example.test/fr/blog/post',
    'https://example.test/Blog/Post',
    'https://example.test/products/123/reviews/10', 'https://example.test/products/456/reviews/11',
    'https://example.test/blog/first?page=1', 'https://example.test/blog/first?page=2',
    'https://example.test/blog/first?sort=recent&filter=a', 'https://example.test/blog/first?filter=b&sort=old',
    'https://example.test/#/products/12', 'https://example.test/#/products/13',
  ]);
  assert.equal(byPattern(plan, '/blog/*').count, 2);
  assert.equal(byPattern(plan, '/blog/category/*').count, 2);
  assert.equal(byPattern(plan, '/products/*/reviews/*').count, 2);
  assert.equal(byPattern(plan, '/blog/*?page=*').count, 2);
  assert.equal(byPattern(plan, '/blog/*?filter=*&sort=*').count, 2);
  for (const pattern of ['/en/blog/*', '/fr/blog/*', '/Blog/*']) assert.equal(byPattern(plan, pattern).count, 1);
  assert.equal(byPattern(plan, '/#/products/*').count, 2);
  assert.ok(plan.warnings.some(warning => warning.includes('Functional hash')));
  assert.ok(plan.warnings.some(warning => warning.includes('provisional')));
});

test('functional hash routes normalize tracking and retain meaningful hash-query variants', () => {
  const plan = planFor([
    'https://example.test/#/catalog/12?utm_source=x&page=1',
    'https://example.test/#/catalog/12?page=1',
    'https://example.test/#/catalog/13?page=2',
    'https://example.test/#!/catalog/13?sort=recent',
    'https://example.test/orders/12345678-abcd-4abc-8abc-123456789abc/items/1',
    'https://example.test/orders/87654321-abcd-4abc-8abc-123456789abc/items/2',
  ]);
  assert.equal(plan.counts.duplicates, 1);
  assert.equal(byPattern(plan, '/#/catalog/*?page=*').count, 2);
  assert.equal(byPattern(plan, '/#!/catalog/*?sort=*').count, 1);
  assert.equal(byPattern(plan, '/orders/*/items/*').count, 2);
  assert.ok(!plan.groups.flatMap(group => group.urls).some(url => url.includes('utm_source')));
});

test('suggested counts follow all five documented thresholds and examples are capped at three', () => {
  for (const [count, expected] of [[1, 1], [5, 5], [6, 5], [25, 5], [26, 8], [100, 8], [101, 12], [500, 12], [501, 15]]) {
    const plan = planFor(Array.from({ length: count }, (_, index) => `https://example.test/blog/post-${index}`));
    const group = byPattern(plan, '/blog/*');
    assert.equal(group.suggestedCount, expected);
    assert.equal(group.examples.length, Math.min(3, count));
  }
});

test('all groups require strict quotas; zero and all are supported without recommendations overriding choices', () => {
  const plan = planFor(['https://example.test/blog/a', 'https://example.test/blog/b']);
  const homepage = byPattern(plan, '/');
  const blog = byPattern(plan, '/blog/*');
  const quotas = { [homepage.id]: 0, [blog.id]: 'all' };
  const before = structuredClone(plan);
  const selection = selectUrlPlan(plan, quotas);
  assert.equal(selection.selectedUrls.length, 2);
  assert.equal(selection.deferredCount, 1);
  assert.deepEqual(selection.quotas, { [homepage.id]: 0, [blog.id]: 2 });
  assert.deepEqual(selectUrlPlan(plan, selection.quotas), selection);
  assert.deepEqual(plan, before);
  assert.deepEqual(quotas, { [homepage.id]: 0, [blog.id]: 'all' });
  for (const invalid of [null, [], {}, { [homepage.id]: 1 }, { ...allQuotas(plan), unknown: 0 }]) assert.throws(() => selectUrlPlan(plan, invalid), /Quotas|quota|Unknown/);
  for (const quantity of [-1, 0.5, 3, '2', true, null, NaN, Infinity, 'ALL']) assert.throws(() => selectUrlPlan(plan, { [homepage.id]: 0, [blog.id]: quantity }), /integer/);
  const zero = selectUrlPlan(plan, Object.fromEntries(plan.groups.map(group => [group.id, 0])));
  assert.deepEqual(zero.selectedUrls, []);
  assert.equal(zero.deferredCount, plan.counts.eligible);
});

test('seeded selection is non-sequential, stable without replacement, and larger quotas extend prefixes', () => {
  const links = Array.from({ length: 100 }, (_, index) => `https://example.test/blog/post-${String(index).padStart(3, '0')}`);
  const plan = planFor(links);
  const reordered = planFor([...links].reverse());
  assert.deepEqual(plan, reordered);
  const blog = byPattern(plan, '/blog/*');
  const quotas = { ...allQuotas(plan), [blog.id]: 8 };
  const selected = selectUrlPlan(plan, quotas);
  const sample = selected.groups.find(group => group.id === blog.id).selectedUrls;
  assert.deepEqual(selectUrlPlan(plan, quotas), selected);
  assert.notDeepEqual(sample, blog.urls.slice(0, 8));
  assert.equal(new Set(sample).size, sample.length);
  assert.ok(sample.every(url => blog.urls.includes(url)));
  const expanded = selectUrlPlan(plan, { ...quotas, [blog.id]: 20 }).groups.find(group => group.id === blog.id).selectedUrls;
  assert.deepEqual(expanded.slice(0, 8), sample);
  const different = buildUrlPlan(plan.seedUrl, { links }, { ...options, randomSeed: 'different-seed' });
  assert.notDeepEqual(selectUrlPlan(different, quotas).groups.find(group => group.id === blog.id).selectedUrls, sample);
});

test('tampered fingerprints and malformed plans are rejected even if their fingerprint is recomputed', () => {
  const plan = planFor(['https://example.test/blog/a', 'https://example.test/blog/b']);
  assert.equal(validateUrlPlan(plan), plan);
  const tampered = structuredClone(plan);
  tampered.randomSeed = 'changed';
  assert.throws(() => selectUrlPlan(tampered, allQuotas(tampered)), /tampered/);
  for (const modify of [
    value => { value.groups[0].count++; },
    value => { value.groups[0].urls.push('https://evil.test/'); },
    value => { value.groups[1].urls.reverse(); value.groups[1].examples = value.groups[1].urls.slice(0, 3); },
    value => { value.counts.discovered++; },
    value => { value.groups[0].pattern = '/invented/*'; },
    value => { value.status = 'selected'; },
    value => { value.groups = []; },
  ]) {
    const malformed = structuredClone(plan);
    modify(malformed);
    recalculateFingerprint(malformed);
    assert.throws(() => selectUrlPlan(malformed, allQuotas(malformed)), /tampered/);
  }
});

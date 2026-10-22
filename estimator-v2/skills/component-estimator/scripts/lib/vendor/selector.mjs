// Pick the smallest set of pages whose components together cover every signature found.
import { HEURISTIC_TYPES } from './scanner.mjs';

function bigrams(skeleton) {
  const toks = skeleton.match(/[a-z0-9:]+\*?|[()]/g) || [];
  const out = new Set();
  for (let i = 0; i + 1 < toks.length; i++) out.add(`${toks[i]}\u0000${toks[i + 1]}`);
  if (!out.size) out.add(`${skeleton}\u0000`);
  return out;
}

function jaccard(a, b) {
  if (!a.size && !b.size) return 1;
  let inter = 0;
  for (const x of a) if (b.has(x)) inter++;
  return inter / (a.size + b.size - inter);
}

const byPagesThenName = (index) => (a, b) => (index[b].pages - index[a].pages) || (a < b ? -1 : a > b ? 1 : 0);

// Map every raw signature to a canonical one. Same-type signatures whose skeletons are >= threshold similar
// merge into the most common one; threshold >= 1 disables similarity merging.
export function clusterSignatures(index, threshold) {
  const mapping = Object.fromEntries(Object.keys(index).map((s) => [s, s]));
  const bySkel = new Map();
  for (const [sig, info] of Object.entries(index)) {
    if (!info.skeleton) continue;
    if (!bySkel.has(info.skeleton)) bySkel.set(info.skeleton, []);
    bySkel.get(info.skeleton).push(sig);
  }
  for (const sigs of bySkel.values()) {
    if (sigs.length < 2) continue;
    sigs.sort(byPagesThenName(index));
    const rep = sigs[0];
    for (const other of sigs.slice(1)) {
      const a = index[rep].type;
      const b = index[other].type;
      if (a === b || HEURISTIC_TYPES.has(a) || HEURISTIC_TYPES.has(b)) mapping[other] = rep;
    }
  }
  if (threshold < 1) {
    const byType = new Map();
    for (const [sig, info] of Object.entries(index)) {
      if (mapping[sig] !== sig) continue;
      if (!byType.has(info.type)) byType.set(info.type, []);
      byType.get(info.type).push(sig);
    }
    for (const sigs of byType.values()) {
      sigs.sort(byPagesThenName(index));
      const reps = [];
      for (const sig of sigs) {
        const bg = bigrams(index[sig].skeleton);
        const hit = reps.find(([, repBg]) => jaccard(bg, repBg) >= threshold);
        if (hit) mapping[sig] = hit[0];
        else reps.push([sig, bg]);
      }
    }
  }
  const root = (x) => { while (mapping[x] !== x) x = mapping[x]; return x; };
  return Object.fromEntries(Object.keys(mapping).map((s) => [s, root(s)]));
}

export function pickHomepage(urls) {
  if (!urls.length) return null;
  const key = (u) => {
    const p = new URL(u);
    const segs = p.pathname.split('/').filter(Boolean);
    return [segs.length ? 1 : 0, segs.length, p.search ? 1 : 0, u.length];
  };
  return [...urls].sort((a, b) => {
    const ka = key(a); const kb = key(b);
    for (let i = 0; i < ka.length; i++) if (ka[i] !== kb[i]) return ka[i] - kb[i];
    return 0;
  })[0];
}

// Greedy (multi-)set cover. pages: {url, canonical_signatures, reliable, unreliable_reason}.
// The homepage is always selected first when usable.
export function selectPages(pages, sigTypes, { redundancy = 1, maxPages = null, homepage = null, includeUnreliable = false } = {}) {
  const eligible = [];
  const ineligible = [];
  for (const p of pages) {
    if (p.reliable !== false || includeUnreliable) {
      if (p.canonical_signatures.length) eligible.push(p);
      else ineligible.push({ url: p.url, reason: 'no components detected' });
    } else {
      ineligible.push({ url: p.url, reason: p.unreliable_reason || 'unreliable HTML' });
    }
  }
  const freq = new Map();
  for (const p of eligible) for (const s of p.canonical_signatures) {
    if (!freq.has(s)) freq.set(s, []);
    freq.get(s).push(p.url);
  }
  // Overlays are not visible in a normal capture: they never drive the selection.
  const overlays = new Set([...freq.keys()].filter((s) => ['cookie-banner', 'modal'].includes(sigTypes[s])));
  const need = new Map([...freq].filter(([s]) => !overlays.has(s)).map(([s, urls]) => [s, Math.min(Math.max(1, redundancy), urls.length)]));
  const have = new Map();
  const getHave = (s) => have.get(s) || 0;
  const byUrl = new Map(eligible.map((p) => [p.url, p]));
  const order = new Map(eligible.map((p, i) => [p.url, i]));
  const selected = [];
  const chosen = new Set();

  const take = (url, reason) => {
    const p = byUrl.get(url);
    const fresh = p.canonical_signatures.filter((s) => need.has(s) && getHave(s) < need.get(s));
    for (const s of p.canonical_signatures) have.set(s, getHave(s) + 1);
    chosen.add(url);
    selected.push({ url, reason, new_signatures: fresh.sort(), new_count: fresh.length, total_signatures: p.canonical_signatures.length });
  };

  const notes = [];
  const hp = homepage || pickHomepage(pages.map((p) => p.url));
  if (hp && byUrl.has(hp)) take(hp, 'homepage');
  else if (hp) notes.push(`homepage ${hp} could not be included (failed, unreliable or no components)`);

  const unmet = () => [...need.keys()].filter((s) => getHave(s) < need.get(s));
  while (unmet().length && (maxPages === null || selected.length < maxPages)) {
    let best = null;
    let bestKey = null;
    for (const p of eligible) {
      if (chosen.has(p.url)) continue;
      const gain = p.canonical_signatures.filter((s) => need.has(s) && getHave(s) < need.get(s)).length;
      if (!gain) continue;
      const k = [gain, p.canonical_signatures.length, -order.get(p.url)];
      if (!bestKey || k[0] > bestKey[0] || (k[0] === bestKey[0] && (k[1] > bestKey[1] || (k[1] === bestKey[1] && k[2] > bestKey[2])))) {
        best = p.url;
        bestKey = k;
      }
    }
    if (best === null) break;
    take(best, 'coverage');
  }

  if (overlays.size) notes.push(`${overlays.size} overlay component(s) (cookie banner / modal) are listed but not used to choose pages.`);
  if (!eligible.length) notes.push('No usable pages: every URL failed, was blocked/disallowed, or had no detectable components.');
  const remaining = unmet();
  const total = need.size;
  const coveredFirst = [...need.keys()].filter((s) => getHave(s) >= 1).length;
  const singletons = [...freq].filter(([s, urls]) => urls.length === 1 && !overlays.has(s))
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([s, urls]) => ({ signature: s, type: sigTypes[s] || s.split('-')[0], url: urls[0] }));
  if (remaining.length && maxPages !== null && selected.length >= maxPages) {
    notes.push(`stopped at max pages ${maxPages}; ${remaining.length} signature(s) not yet at required coverage`);
  }
  return {
    selected,
    coverage: {
      signatures_total: total,
      signatures_covered: coveredFirst,
      percent: total ? Math.round((1000 * coveredFirst) / total) / 10 : 0,
      redundancy,
      fully_met: eligible.length > 0 && remaining.length === 0,
    },
    uncovered: [...need.keys()].filter((s) => getHave(s) < 1).sort(),
    single_page_signatures: singletons,
    ineligible_pages: ineligible,
    eligible_pages: eligible.length,
    notes,
  };
}

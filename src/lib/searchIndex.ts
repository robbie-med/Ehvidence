/**
 * searchIndex.ts—pure, framework-free search over topics. Runs at build time to
 * emit a static JSON index (src/pages/search-index.json.ts) and again in the
 * browser island (src/components/SearchBox.tsx) to rank against a query, so the
 * scoring is identical on both sides. No Astro / Preact imports here.
 */
import type { ComputedTopic } from './derive';

export interface SearchDoc {
  slug: string;
  name: string;
  condition: string;
  intervention: string;
  comparator: string;
  category: string;
  status: string;
  summary: string;
  /** searchTerms + outcome labels + study authors, deduped. */
  terms: string[];
  url: string;
}

/** Field weights: name dominates, then the clinical who/what, then context. */
const WEIGHTS: Record<keyof Pick<SearchDoc,
  'name' | 'condition' | 'intervention' | 'comparator' | 'category' | 'summary'>, number> & {
  terms: number;
} = {
  name: 5,
  condition: 3,
  intervention: 3,
  comparator: 3,
  category: 2,
  terms: 2,
  summary: 1,
};

/** Lowercase, split on non-alphanumerics, drop empties. Shared everywhere. */
export function normalize(s: string): string[] {
  return (s || '')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}

/** Build the static index from computed topics (base is the site base path). */
export function buildSearchDocs(topics: ComputedTopic[], base = ''): SearchDoc[] {
  const root = base.replace(/\/$/, '');
  return topics.map((t) => {
    const raw = t.raw;
    const terms = new Set<string>();
    for (const s of raw.searchTerms ?? []) terms.add(s);
    for (const o of raw.outcomes) terms.add(o.label);
    for (const s of raw.studies) terms.add(s.author);
    return {
      slug: raw.slug,
      name: raw.name,
      condition: raw.condition,
      intervention: raw.intervention,
      comparator: raw.comparator,
      category: raw.category,
      status: t.status,
      summary: raw.summary,
      terms: [...terms],
      url: `${root}/topics/${raw.slug}`,
    };
  });
}

/**
 * Match a single query token against a haystack token, returning a 0..1 factor:
 * exact 1, prefix 0.6, substring 0.3, else 0.
 */
function tokenFactor(query: string, hay: string): number {
  if (hay === query) return 1;
  if (hay.startsWith(query)) return 0.6;
  if (hay.includes(query)) return 0.3;
  return 0;
}

/** Best factor for a query token across all tokens in a field value. */
function fieldFactor(query: string, value: string): number {
  let best = 0;
  for (const hay of normalize(value)) {
    const f = tokenFactor(query, hay);
    if (f > best) best = f;
    if (best === 1) break;
  }
  return best;
}

/**
 * Score a doc against already-normalized query tokens. AND-ish: a token that
 * matches nothing contributes 0, and if ANY token is unmatched the whole doc
 * scores 0 (so "vitamin melanoma" won't surface a vitamin-only topic).
 */
export function scoreDoc(doc: SearchDoc, queryTokens: string[]): number {
  if (queryTokens.length === 0) return 0;
  let total = 0;
  for (const q of queryTokens) {
    let tokenBest = 0;
    for (const [field, weight] of Object.entries(WEIGHTS)) {
      const value =
        field === 'terms'
          ? doc.terms.join(' ')
          : (doc[field as keyof SearchDoc] as string);
      const contribution = fieldFactor(q, value) * weight;
      if (contribution > tokenBest) tokenBest = contribution;
    }
    if (tokenBest === 0) return 0;
    total += tokenBest;
  }
  return total;
}

/** Rank docs against a raw query string; returns the top `limit` matches. */
export function searchDocs(docs: SearchDoc[], query: string, limit = 8): SearchDoc[] {
  const tokens = normalize(query);
  if (tokens.length === 0) return [];
  return docs
    .map((doc) => ({ doc, score: scoreDoc(doc, tokens) }))
    .filter((r) => r.score > 0)
    .sort((a, b) => b.score - a.score || a.doc.name.localeCompare(b.doc.name))
    .slice(0, limit)
    .map((r) => r.doc);
}

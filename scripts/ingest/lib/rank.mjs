/**
 * rank.mjs—pure scoring + dedupe for discovered candidate papers. No network,
 * no disk: takes candidate objects (already enriched with impact signals) and
 * the set of existing topics, returns a ranked, deduped shortlist. Unit-tested.
 *
 * "Most read" is not exposed by any free API, so the honest popularity proxy is
 * field-normalized citation influence (NIH iCite RCR) plus raw citations,
 * recency, open-access availability, and whether the paper is interventional.
 */

/** Lowercased alphanumerics — the shared dedupe/normalize key. */
export function normal(s) {
  return (s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

const CURRENT_YEAR = 2026;

/**
 * Composite rank score. Each term is bounded so no single signal dominates.
 * Weights are documented here so the ranking is auditable:
 *  - RCR (field-normalized influence): the primary signal, log-damped.
 *  - citations: raw pull, log-damped (a 2000-cite classic still ranks).
 *  - recency: newer meta-analyses preferred (evidence currency).
 *  - open access: we can auto-extract OA XML for free — a real tie-breaker.
 *  - interventional: RCT/treatment questions fit the site's model best.
 */
export function rankScore(c) {
  const rcr = Number(c.rcr) || 0;
  const citations = Number(c.citations) || 0;
  const year = Number(c.year) || 0;
  const rcrTerm = 4 * Math.log10(1 + Math.max(0, rcr));
  const citeTerm = 1.5 * Math.log10(1 + Math.max(0, citations));
  const age = year ? Math.max(0, CURRENT_YEAR - year) : 20;
  const recencyTerm = Math.max(0, 2 - age * 0.2); // full credit this year, 0 by ~10y
  const oaTerm = c.oa ? 1 : 0;
  const interventionalTerm = c.interventional ? 1 : 0;
  const total = rcrTerm + citeTerm + recencyTerm + oaTerm + interventionalTerm;
  return Number(total.toFixed(4));
}

/**
 * Drop candidates that duplicate an existing topic (by PMID, DOI, or a
 * substring-overlapping normalized title/name). Returns { fresh, skipped }.
 */
export function dedupe(candidates, existingTopics) {
  const knownPmid = new Set();
  const knownDoi = new Set();
  const knownTitles = [];
  for (const t of existingTopics) {
    for (const s of t.studies || []) {
      if (s.doi) knownDoi.add(normal(s.doi));
    }
    if (t.name) knownTitles.push(normal(t.name));
    if (t.pmid) knownPmid.add(String(t.pmid));
  }

  const fresh = [];
  const skipped = [];
  const seen = new Set();
  for (const c of candidates) {
    const titleKey = normal(c.title);
    const dup =
      (c.pmid && knownPmid.has(String(c.pmid))) ||
      (c.doi && knownDoi.has(normal(c.doi))) ||
      knownTitles.some((k) => k && titleKey && (k.includes(titleKey) || titleKey.includes(k))) ||
      seen.has(titleKey);
    if (dup) {
      skipped.push(c);
    } else {
      seen.add(titleKey);
      fresh.push(c);
    }
  }
  return { fresh, skipped };
}

/** Attach scores and sort a candidate list highest-first (pure). */
export function rankCandidates(candidates) {
  return candidates
    .map((c) => ({ ...c, score: rankScore(c) }))
    .sort((a, b) => b.score - a.score);
}

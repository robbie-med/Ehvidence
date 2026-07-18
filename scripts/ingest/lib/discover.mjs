/**
 * discover.mjs—free-API discovery of high-impact clinical meta-analyses. No
 * LLM, no cost. PubMed E-utilities finds systematic reviews / meta-analyses;
 * NIH iCite adds citation count + RCR (field-normalized influence); Europe PMC
 * adds open-access availability. Semantic Scholar is a best-effort enrichment.
 *
 * All enrichment is cached by the caller into the manifest so scheduled hourly
 * runs do not re-hit rate-limited endpoints.
 */

const UA = { 'user-agent': 'Ehvidence-ingest/0.1 (research; contact via repo)' };

/**
 * Find candidate meta-analyses / systematic reviews on a topic term.
 * Returns [{ pmid, title, year }].
 */
export async function pubmedMetaAnalyses(term, { retmax = 25 } = {}) {
  const filter =
    '(meta-analysis[ptyp] OR systematic review[ptyp]) AND hasabstract[text] AND humans[mesh]';
  const q = encodeURIComponent(`(${term}) AND ${filter}`);
  const es = await fetch(
    `https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi?db=pubmed&retmax=${retmax}&retmode=json&term=${q}`,
    { headers: UA },
  );
  if (!es.ok) throw new Error(`PubMed esearch ${es.status}`);
  const ids = (await es.json()).esearchresult?.idlist || [];
  if (ids.length === 0) return [];
  const su = await fetch(
    `https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esummary.fcgi?db=pubmed&retmode=json&id=${ids.join(',')}`,
    { headers: UA },
  );
  if (!su.ok) throw new Error(`PubMed esummary ${su.status}`);
  const r = (await su.json()).result || {};
  return ids.map((id) => {
    const doc = r[id] || {};
    const doi = (doc.articleids || []).find((a) => a.idtype === 'doi')?.value;
    const year = Number((doc.pubdate || '').slice(0, 4)) || 0;
    return { pmid: id, title: doc.title || '', year, doi, journal: doc.fulljournalname || '' };
  });
}

/** NIH iCite: batch citation count + RCR for a list of PMIDs. Map by pmid. */
export async function icite(pmids) {
  const out = new Map();
  if (pmids.length === 0) return out;
  const res = await fetch(`https://icite.od.nih.gov/api/pubs?pmids=${pmids.join(',')}`, {
    headers: UA,
  });
  if (!res.ok) throw new Error(`iCite ${res.status}`);
  const data = await res.json();
  for (const row of data.data || []) {
    out.set(String(row.pmid), {
      citations: Number(row.citation_count) || 0,
      rcr: Number(row.relative_citation_ratio) || 0,
      isRct: Boolean(row.is_clinical) || false,
    });
  }
  return out;
}

/** Europe PMC: open-access + PMCID for a PMID (best-effort, returns null on miss). */
export async function europePmcMeta(pmid) {
  const res = await fetch(
    `https://www.ebi.ac.uk/europepmc/webservices/rest/search?query=EXT_ID:${pmid}%20AND%20SRC:MED&format=json&resultType=core`,
    { headers: UA },
  );
  if (!res.ok) return null;
  const hit = (await res.json()).resultList?.result?.[0];
  if (!hit) return null;
  return {
    oa: hit.isOpenAccess === 'Y' || Boolean(hit.pmcid),
    pmcid: hit.pmcid || null,
    citations: Number(hit.citedByCount) || 0,
  };
}

/** Semantic Scholar: citations + TLDR (best-effort; unauthenticated is rate-limited). */
export async function semanticScholar(pmid) {
  try {
    const res = await fetch(
      `https://api.semanticscholar.org/graph/v1/paper/PMID:${pmid}?fields=citationCount,influentialCitationCount,tldr`,
      { headers: UA },
    );
    if (!res.ok) return null;
    const d = await res.json();
    return {
      citations: Number(d.citationCount) || 0,
      influential: Number(d.influentialCitationCount) || 0,
      tldr: d.tldr?.text || '',
    };
  } catch {
    return null;
  }
}

/**
 * Discover + enrich candidates for a set of search terms. Returns enriched
 * candidate objects ready for ranking. Failures on any single enrichment are
 * swallowed (the candidate keeps whatever signals it has).
 */
export async function discoverCandidates(terms, { retmax = 25 } = {}) {
  const byPmid = new Map();
  for (const term of terms) {
    let hits = [];
    try {
      hits = await pubmedMetaAnalyses(term, { retmax });
    } catch (e) {
      console.error(`  pubmed [${term}]: ${e.message}`);
      continue;
    }
    for (const h of hits) if (!byPmid.has(h.pmid)) byPmid.set(h.pmid, { ...h, terms: [term] });
    else byPmid.get(h.pmid).terms.push(term);
  }

  const pmids = [...byPmid.keys()];
  let cites = new Map();
  try {
    cites = await icite(pmids);
  } catch (e) {
    console.error(`  icite: ${e.message}`);
  }

  const enriched = [];
  for (const [pmid, base] of byPmid) {
    const ic = cites.get(pmid) || {};
    let epmc = null;
    try {
      epmc = await europePmcMeta(pmid);
    } catch {
      /* best-effort */
    }
    enriched.push({
      pmid,
      title: base.title,
      year: base.year,
      doi: base.doi || null,
      journal: base.journal || '',
      terms: base.terms,
      citations: Math.max(ic.citations || 0, epmc?.citations || 0),
      rcr: ic.rcr || 0,
      oa: Boolean(epmc?.oa),
      pmcid: epmc?.pmcid || null,
      interventional: Boolean(ic.isRct),
    });
  }
  return enriched;
}

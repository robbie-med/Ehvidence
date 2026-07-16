/**
 * scan-new-trials.js — on-demand scan for trials that may have appeared since a
 * topic was last updated. Reads a topic's `searchTerms`, queries
 * ClinicalTrials.gov (v2 API) and PubMed (E-utilities), and prints candidates
 * whose identifiers/titles are not already among the topic's encoded citations.
 *
 * Usage:  node scripts/scan-new-trials.js <slug>        (one topic)
 *         node scripts/scan-new-trials.js               (all with searchTerms)
 *
 * This is intentionally NOT scheduled: it is a manual assist, not the deferred
 * auto-watcher. Network access depends on the environment's policy.
 */
import { readFile, readdir } from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const topicsDir = path.resolve(__dirname, '..', 'src', 'content', 'topics');

async function loadTopics() {
  const files = (await readdir(topicsDir)).filter((f) => f.endsWith('.json'));
  const topics = [];
  for (const f of files) {
    topics.push(JSON.parse(await readFile(path.join(topicsDir, f), 'utf8')));
  }
  return topics;
}

/** Rough dedupe key: lowercased alphanumerics of a citation/title. */
function normal(s) {
  return (s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

async function ctgov(term) {
  const url =
    'https://clinicaltrials.gov/api/v2/studies?query.term=' +
    encodeURIComponent(term) +
    '&filter.overallStatus=COMPLETED&pageSize=25&fields=NCTId,BriefTitle,CompletionDate,EnrollmentCount';
  const res = await fetch(url, { headers: { accept: 'application/json' } });
  if (!res.ok) throw new Error(`ClinicalTrials.gov ${res.status}`);
  const data = await res.json();
  return (data.studies || []).map((s) => {
    const p = s.protocolSection || {};
    return {
      source: 'CT.gov',
      id: p.identificationModule?.nctId,
      title: p.identificationModule?.briefTitle,
      when: p.statusModule?.completionDateStruct?.date,
      n: p.designModule?.enrollmentInfo?.count,
    };
  });
}

async function pubmed(term) {
  const q = encodeURIComponent(`${term} AND randomized controlled trial[pt]`);
  const es = await fetch(
    `https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi?db=pubmed&retmax=25&retmode=json&term=${q}`,
  );
  if (!es.ok) throw new Error(`PubMed esearch ${es.status}`);
  const ids = (await es.json()).esearchresult?.idlist || [];
  if (ids.length === 0) return [];
  const su = await fetch(
    `https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esummary.fcgi?db=pubmed&retmode=json&id=${ids.join(',')}`,
  );
  if (!su.ok) throw new Error(`PubMed esummary ${su.status}`);
  const r = (await su.json()).result || {};
  return ids.map((id) => ({
    source: 'PubMed',
    id,
    title: r[id]?.title,
    when: r[id]?.pubdate,
    n: null,
  }));
}

async function scanTopic(topic) {
  const terms = topic.searchTerms || [];
  if (terms.length === 0) return;
  const known = new Set();
  for (const s of topic.studies || []) {
    known.add(normal(s.citation));
    if (s.doi) known.add(normal(s.doi));
  }
  const seen = new Set();
  const hits = [];
  for (const term of terms) {
    for (const fn of [ctgov, pubmed]) {
      try {
        const rows = await fn(term);
        for (const row of rows) {
          const key = normal(row.title);
          if (!key || seen.has(key)) continue;
          seen.add(key);
          // Skip if the title clearly matches an encoded study.
          const alreadyEncoded = [...known].some((k) => k && key && (k.includes(key) || key.includes(k)));
          if (!alreadyEncoded) hits.push(row);
        }
      } catch (e) {
        console.error(`  [${term}] ${fn.name}: ${e.message}`);
      }
    }
  }
  console.log(`\n=== ${topic.name} (${topic.slug}) ===`);
  if (hits.length === 0) {
    console.log('  no new candidate trials found');
    return;
  }
  for (const h of hits.slice(0, 30)) {
    console.log(`  [${h.source}] ${h.id || ''} ${h.when ? '(' + h.when + ')' : ''}`);
    console.log(`     ${h.title}${h.n ? ` · n=${h.n}` : ''}`);
  }
}

async function main() {
  const slug = process.argv[2];
  const topics = await loadTopics();
  const targets = slug ? topics.filter((t) => t.slug === slug) : topics.filter((t) => (t.searchTerms || []).length);
  if (targets.length === 0) {
    console.log(slug ? `No topic "${slug}" (or it has no searchTerms).` : 'No topics have searchTerms yet.');
    return;
  }
  for (const t of targets) await scanTopic(t);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

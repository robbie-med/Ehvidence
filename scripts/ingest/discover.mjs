/**
 * discover.mjs (CLI)—P0 of the ingestion pipeline: find + rank + dedupe
 * candidate meta-analyses and record them in the manifest as `ranked`. Free:
 * no LLM, no cost. Nothing is extracted here; a human (CLI or Telegram) later
 * approves items from the ranked list.
 *
 *   node scripts/ingest/discover.mjs            discover from seeds.json, update manifest
 *   node scripts/ingest/discover.mjs --print    also print the ranked shortlist
 *   node scripts/ingest/discover.mjs --dry-run   use fixtures (no network), print only
 *
 * --dry-run does not write the manifest, so it is safe to run anywhere.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { REPO_ROOT, loadDotenv } from './lib/env.mjs';
import { discoverCandidates } from './lib/discover.mjs';
import { rankCandidates, dedupe } from './lib/rank.mjs';
import { loadManifest, saveManifest, upsertPaper, MANIFEST_PATH } from './lib/manifest.mjs';

const HERE = join(REPO_ROOT, 'scripts', 'ingest');
const TOPICS_DIR = join(REPO_ROOT, 'src', 'content', 'topics');

function loadExistingTopics() {
  return readdirSync(TOPICS_DIR)
    .filter((f) => f.endsWith('.json'))
    .map((f) => JSON.parse(readFileSync(join(TOPICS_DIR, f), 'utf8')));
}

function nowISO() {
  // Injected by the caller/scheduler; kept out of the pure libs. Node's Date is
  // fine in a CLI (only the workflow-runner forbids it).
  return new Date().toISOString();
}

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const print = args.includes('--print') || dryRun;
  loadDotenv();

  const existing = loadExistingTopics();

  let enriched;
  if (dryRun) {
    const fx = JSON.parse(readFileSync(join(HERE, 'fixtures', 'discover.json'), 'utf8'));
    enriched = fx.candidates;
    console.log(`[dry-run] loaded ${enriched.length} fixture candidates (no network)`);
  } else {
    const seeds = JSON.parse(readFileSync(join(HERE, 'seeds.json'), 'utf8'));
    console.log(`Discovering from ${seeds.terms.length} seed terms…`);
    enriched = await discoverCandidates(seeds.terms);
    console.log(`Found ${enriched.length} candidate meta-analyses.`);
  }

  const { fresh, skipped } = dedupe(enriched, existing);
  const ranked = rankCandidates(fresh);

  if (print) {
    console.log(`\nRanked shortlist (${ranked.length} fresh, ${skipped.length} deduped):`);
    ranked.forEach((c, i) => {
      console.log(
        `  ${String(i + 1).padStart(2)}. [${c.score}] ${c.title}` +
          `\n       PMID ${c.pmid} · ${c.year} · ${c.journal || '—'} · RCR ${c.rcr} · ` +
          `${c.citations} cites · ${c.oa ? 'OA' : 'paywalled'}`,
      );
    });
    if (skipped.length) {
      console.log(`\nDeduped (already covered):`);
      skipped.forEach((c) => console.log(`  – ${c.title} (PMID ${c.pmid})`));
    }
  }

  if (dryRun) {
    console.log('\n[dry-run] manifest not written.');
    return;
  }

  const m = loadManifest();
  const ts = nowISO();
  for (const c of ranked) {
    const existingPaper = m.papers[String(c.pmid)];
    // Don't clobber papers already advanced past `ranked` (approved, extracted…).
    if (existingPaper && existingPaper.status !== 'discovered' && existingPaper.status !== 'ranked') {
      continue;
    }
    upsertPaper(
      m,
      c.pmid,
      {
        doi: c.doi,
        title: c.title,
        year: c.year,
        journal: c.journal,
        status: 'ranked',
        oaFullText: c.oa,
        pmcid: c.pmcid,
        sourceUrl: `https://pubmed.ncbi.nlm.nih.gov/${c.pmid}/`,
        scores: {
          rcr: c.rcr,
          citations: c.citations,
          oa: c.oa,
          interventional: c.interventional,
          total: c.score,
        },
        errors: existingPaper?.errors || [],
      },
      ts,
    );
  }
  saveManifest(m);
  console.log(`\nManifest updated (${ranked.length} ranked) → ${MANIFEST_PATH}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

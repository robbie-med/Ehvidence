/**
 * calibrate.mjs — measure how faithfully DeepSeek re-extracts our gold-set papers.
 *
 *   node scripts/ingest/calibrate.mjs            # real run (needs DEEPSEEK_API_KEY + sources)
 *   node scripts/ingest/calibrate.mjs <slug>     # one paper
 *   node scripts/ingest/calibrate.mjs --dry-run  # no API/sources: prove the harness works
 *
 * For each gold entry it loads the source paper, asks DeepSeek for a topic JSON,
 * and scores that JSON against the committed (known-good) topic. The report shows
 * per-paper and per-type faithfulness so you know exactly where DeepSeek can be
 * trusted before spending anything on live ingestion.
 */
import { readFile } from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { scoreTopic } from './lib/score.mjs';
import { extractTopic, hasKey } from './lib/deepseek.mjs';
import { loadSource } from './lib/source.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..', '..');
const topicsDir = path.join(root, 'src', 'content', 'topics');

async function loadGold(slug) {
  return JSON.parse(await readFile(path.join(topicsDir, `${slug}.json`), 'utf8'));
}

function pct(x) {
  return (x * 100).toFixed(0) + '%';
}

/** Perturb a gold topic to simulate a flawed extraction (for --dry-run). */
function perturb(gold) {
  const c = JSON.parse(JSON.stringify(gold));
  if (c.studies[0]?.data) {
    const d = c.studies[0].data;
    if (d.kind === '2x2') d.ctrlEvents = (d.ctrlEvents ?? 0) + 3;
    else if ('point' in d) d.point = d.point * 1.25;
    else if ('txMean' in d) d.txMean = d.txMean + 1;
  }
  if (c.studies.length > 2) c.studies.splice(1, 1); // drop a study
  return c;
}

function printReport(rows) {
  console.log('\n================ CALIBRATION REPORT ================');
  const byType = new Map();
  for (const r of rows) {
    console.log(`\n• ${r.slug}  [${r.type}]`);
    if (r.error) {
      console.log(`    ERROR: ${r.error}`);
      continue;
    }
    const s = r.score;
    console.log(`    overall ${pct(s.overall)} | numeric ${pct(s.numericAccuracy)} | study-recall ${pct(s.studyRecall)} | direction ${pct(s.directionAccuracy)}`);
    console.log(`    studies: gold ${s.counts.goldStudies}, extracted ${s.counts.candStudies}, matched ${s.counts.matched}, missing ${s.counts.missing}, extra ${s.counts.extra}`);
    if (s.missing.length) console.log(`    MISSING: ${s.missing.join('; ')}`);
    if (s.extra.length) console.log(`    EXTRA:   ${s.extra.join('; ')}`);
    for (const m of s.dataMismatches.slice(0, 6)) console.log(`    DIFF ${m.study}: ${m.detail.join(', ')}`);
    if (r.usage) console.log(`    tokens: in ${r.usage.prompt_tokens}, out ${r.usage.completion_tokens}`);
    if (!byType.has(r.type)) byType.set(r.type, []);
    byType.get(r.type).push(s.overall);
  }
  console.log('\n---------------- accuracy by type ----------------');
  for (const [type, scores] of byType) {
    const avg = scores.reduce((a, b) => a + b, 0) / scores.length;
    console.log(`  ${pct(avg)}  (${scores.length})  ${type}`);
  }
  const all = rows.filter((r) => r.score).map((r) => r.score.overall);
  if (all.length) console.log(`\n  OVERALL: ${pct(all.reduce((a, b) => a + b, 0) / all.length)} across ${all.length} papers`);
  console.log('===================================================\n');
}

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const onlySlug = args.find((a) => !a.startsWith('-'));
  const manifest = JSON.parse(await readFile(path.join(__dirname, 'gold-set.json'), 'utf8'));
  const agentsMd = await readFile(path.join(root, 'AGENTS.md'), 'utf8');
  let entries = manifest.entries;
  if (onlySlug) entries = entries.filter((e) => e.slug === onlySlug);

  if (dryRun) {
    console.log('DRY RUN — scoring each gold topic against a deliberately perturbed copy (no DeepSeek, no sources). This validates the scoring harness itself.');
  } else if (!hasKey()) {
    console.error('DEEPSEEK_API_KEY not set. Run with --dry-run to test the harness, or set the key for a real calibration.');
    process.exit(1);
  }

  const rows = [];
  for (const e of entries) {
    const gold = await loadGold(e.slug);
    if (dryRun) {
      rows.push({ slug: e.slug, type: e.type, score: scoreTopic(perturb(gold), gold) });
      continue;
    }
    const text = await loadSource(e.source).catch((err) => { console.error(`  [${e.slug}] source: ${err.message}`); return null; });
    if (!text) {
      rows.push({ slug: e.slug, type: e.type, error: `no source (set source.pmid for OA, or drop the PDF at ${e.source?.file})` });
      continue;
    }
    const out = await extractTopic(agentsMd, text);
    if (!out.ok) {
      rows.push({ slug: e.slug, type: e.type, error: out.error });
      continue;
    }
    rows.push({ slug: e.slug, type: e.type, score: scoreTopic(out.topic, gold), usage: out.usage });
  }
  printReport(rows);
}

main().catch((e) => { console.error(e); process.exit(1); });

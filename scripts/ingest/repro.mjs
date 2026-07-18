/**
 * repro.mjs—run the reproduction gate for one queued paper. Loads the extracted
 * topic.json + the paper's reported-pooled.json from the sidecar, runs the LIVE
 * engine (deriveTopic) and compares (compareReproduction), writes repro.json,
 * and returns the result. Free: no LLM.
 *
 * Run under tsx (imports .ts engine). Reported values stay in the sidecar and
 * the repro report — never in topic.json.
 *
 *   tsx scripts/ingest/repro.mjs <pmid>
 */
import { deriveTopic } from '../../src/lib/derive.ts';
import { compareReproduction } from '../../src/lib/repro.ts';
import { readArtifact, writeArtifact, hasArtifact } from './lib/queue.mjs';

/** Programmatic entry: returns the ReproResult (and writes repro.json). */
export function runRepro(pmid) {
  const topic = readArtifact(pmid, 'topic.json');
  if (!topic) throw new Error(`repro: no topic.json for ${pmid}`);
  const reportedFile = readArtifact(pmid, 'reported-pooled.json');
  const reported = reportedFile?.outcomes ?? [];
  const computed = deriveTopic(topic);
  const result = compareReproduction(computed, reported);
  writeArtifact(pmid, 'repro.json', result);
  return result;
}

function main() {
  const pmid = process.argv[2];
  if (!pmid) {
    console.error('usage: tsx scripts/ingest/repro.mjs <pmid>');
    process.exit(2);
  }
  if (!hasArtifact(pmid, 'reported-pooled.json')) {
    console.error(`repro: ${pmid} has no reported-pooled.json — cannot gate.`);
    process.exit(2);
  }
  const result = runRepro(pmid);
  console.log(`Reproduction gate for ${pmid}: ${result.pass ? 'PASS' : 'FAIL'}`);
  for (const o of result.outcomes) {
    const ours = o.ours ? `${o.ours.point.toFixed(3)} [${o.ours.ciLow.toFixed(3)}–${o.ours.ciHigh.toFixed(3)}]` : '—';
    const rep = `${o.reported.point} [${o.reported.ciLow}–${o.reported.ciHigh}]`;
    console.log(
      `  ${o.withinTol ? '✓' : '✗'} ${o.outcomeId} (${o.measure}): ours ${ours} vs paper ${rep} · Δ${o.pointDeltaPct}% · ${o.note}`,
    );
  }
  process.exit(result.pass ? 0 : 1);
}

if (import.meta.url === `file://${process.argv[1]}`) main();

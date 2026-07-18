/**
 * canary.mjs—drift detector. Periodically re-extract ONE gold paper with the
 * current model/prompt and score it against the committed (human-verified)
 * topic. A drop below threshold means the model or our prompt has drifted and
 * the pipeline should be paused for review.
 *
 * Reuses the calibration building blocks (source loader, DeepSeek client, the
 * fidelity scorer). Free-safe: with no DEEPSEEK_API_KEY it skips.
 *
 *   tsx scripts/ingest/canary.mjs [<slug>]   (defaults to the first OA gold paper)
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { REPO_ROOT } from './lib/env.mjs';
import { loadSource } from './lib/source.mjs';
import { extractTopic, hasKey } from './lib/deepseek.mjs';
import { scoreTopic } from './lib/score.mjs';

const DRIFT_THRESHOLD = Number(process.env.CANARY_THRESHOLD ?? 0.85);

export async function runCanary(slug) {
  if (!hasKey()) return { skipped: true, reason: 'no DEEPSEEK_API_KEY' };
  const gold = JSON.parse(readFileSync(join(REPO_ROOT, 'scripts', 'ingest', 'gold-set.json'), 'utf8'));
  const entry = slug ? gold.entries.find((e) => e.slug === slug) : gold.entries[0];
  if (!entry) return { skipped: true, reason: `no gold entry for ${slug}` };

  let text;
  try {
    text = await loadSource(entry.source);
  } catch (e) {
    return { skipped: true, reason: `source unavailable: ${e.message}` };
  }
  if (!text || text.length < 500) return { skipped: true, reason: 'source too short' };

  const agentsMd = readFileSync(join(REPO_ROOT, 'AGENTS.md'), 'utf8');
  const out = await extractTopic(agentsMd, text);
  if (!out.ok) return { skipped: false, error: out.error, slug: entry.slug };

  const goldTopic = JSON.parse(
    readFileSync(join(REPO_ROOT, 'src', 'content', 'topics', `${entry.slug}.json`), 'utf8'),
  );
  const score = scoreTopic(out.topic, goldTopic);
  const drift = score.overall < DRIFT_THRESHOLD;
  return { skipped: false, slug: entry.slug, overall: score.overall, drift, threshold: DRIFT_THRESHOLD, score };
}

function main() {
  runCanary(process.argv[2]).then((r) => {
    if (r.skipped) return console.log(`canary skipped (${r.reason})`);
    if (r.error) return console.error(`canary error on ${r.slug}: ${r.error}`);
    console.log(
      `canary ${r.slug}: overall ${r.overall.toFixed(3)} (threshold ${r.threshold}) → ${r.drift ? 'DRIFT ⚠️' : 'ok'}`,
    );
    process.exit(r.drift ? 1 : 0);
  });
}

if (import.meta.url === `file://${process.argv[1]}`) main();

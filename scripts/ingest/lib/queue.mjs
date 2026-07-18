/**
 * queue.mjs—the per-paper sidecar directory. Each paper being worked gets
 * scripts/ingest/queue/<pmid>/ holding:
 *   topic.json            the extracted, schema-shaped topic (the ONLY file
 *                         ever committed to a PR branch)
 *   reported-pooled.json  the paper's reported pooled values, used solely by the
 *                         reproduction gate + PR report — NEVER committed
 *   provenance.json       source ids/urls, model, tokens, cost, timestamps
 *   extraction.raw.txt    raw LLM output (audit trail)
 *   repro.json            reproduction-gate result
 *
 * The whole queue/ tree is gitignored. Keeping reported values out of topic.json
 * is what upholds the cardinal "never store a derived/pooled value" rule.
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { REPO_ROOT } from './env.mjs';

export const QUEUE_DIR = join(REPO_ROOT, 'scripts', 'ingest', 'queue');

export function paperDir(pmid) {
  return join(QUEUE_DIR, String(pmid));
}

export function ensurePaperDir(pmid) {
  const dir = paperDir(pmid);
  mkdirSync(dir, { recursive: true });
  return dir;
}

export function writeArtifact(pmid, name, contents) {
  const dir = ensurePaperDir(pmid);
  const path = join(dir, name);
  writeFileSync(path, typeof contents === 'string' ? contents : JSON.stringify(contents, null, 2));
  return path;
}

export function readArtifact(pmid, name) {
  const path = join(paperDir(pmid), name);
  if (!existsSync(path)) return null;
  const raw = readFileSync(path, 'utf8');
  return name.endsWith('.json') ? JSON.parse(raw) : raw;
}

export function hasArtifact(pmid, name) {
  return existsSync(join(paperDir(pmid), name));
}

/** The one file that is allowed to be committed to a PR branch. */
export const COMMITTABLE = 'topic.json';

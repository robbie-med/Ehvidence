/**
 * extract.mjs—P2 orchestrator: turn ONE approved paper into a reviewed PR.
 * Pipeline: load source → DeepSeek extract → schema-validate → reproduction gate
 * → methods auditor → open PR. Only `approved` papers within budget are touched.
 *
 * Run under tsx (imports the .ts engine/auditor).
 *   tsx scripts/ingest/extract.mjs <pmid> [--no-llm] [--dry-run-pr]
 *
 * --no-llm     skip the DeepSeek call and reuse an existing queue/<pmid>/topic.json
 *              (for offline testing of validate→repro→audit→PR-body with gold data)
 * --dry-run-pr build the branch/PR body but do not push or call gh
 *
 * The reproduction gate needs the paper's reported pooled values in
 * queue/<pmid>/reported-pooled.json. In --no-llm mode you supply that yourself;
 * in a real run the extractor also asks the model for them into the sidecar
 * (never into topic.json).
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { deriveTopic } from '../../src/lib/derive.ts';
import { compareReproduction } from '../../src/lib/repro.ts';
import { auditOutcome } from '../../src/lib/audit.ts';
import { topicSchema } from '../../src/lib/schema.ts';
import { REPO_ROOT, loadDotenv } from './lib/env.mjs';
import { loadSource } from './lib/source.mjs';
import { extractTopic, extractReportedPooled } from './lib/deepseek.mjs';
import { renderPrBody, openPr } from './lib/pr.mjs';
import {
  loadManifest,
  saveManifest,
  transition,
  chargeBudget,
} from './lib/manifest.mjs';
import { writeArtifact, readArtifact, paperDir, COMMITTABLE } from './lib/queue.mjs';

const AGENTS_MD = () => readFileSync(join(REPO_ROOT, 'AGENTS.md'), 'utf8');
const nowISO = () => new Date().toISOString();

/** Rough DeepSeek cost estimate (USD) from token usage. Cheap by design. */
function estimateCost(usage) {
  const inTok = usage?.prompt_tokens ?? 0;
  const outTok = usage?.completion_tokens ?? 0;
  // DeepSeek-chat ballpark: ~$0.27/M in, ~$1.10/M out.
  return Number(((inTok / 1e6) * 0.27 + (outTok / 1e6) * 1.1).toFixed(4));
}

function extractedOutcomeRows(computed) {
  return computed.outcomes.map((o) => ({
    id: o.outcome.id,
    label: o.outcome.label,
    k: o.pooled?.k ?? o.contPooled?.k ?? o.studies.length,
    patients: o.totalPatients,
    pooled: o.pooled
      ? { measure: 'RR', point: o.pooled.rr, ciLow: o.pooled.ciLow, ciHigh: o.pooled.ciHigh }
      : o.contPooled
        ? { measure: o.contPooled.measure, point: o.contPooled.estimate, ciLow: o.contPooled.ciLow, ciHigh: o.contPooled.ciHigh }
        : null,
  }));
}

export async function extractPaper(pmid, { noLlm = false, dryRunPr = false } = {}) {
  loadDotenv();
  const m = loadManifest();
  const paper = m.papers[String(pmid)];
  if (!paper) throw new Error(`extract: ${pmid} not in manifest`);
  if (!noLlm && paper.status !== 'approved') {
    throw new Error(`extract: ${pmid} is '${paper.status}', expected 'approved'`);
  }

  // 1. Extract (or reuse in --no-llm).
  let usage = {};
  let costUSD = 0;
  if (!noLlm) {
    transition(m, pmid, 'approved', 'extracting', { nowISO: nowISO() });
    saveManifest(m);
    const src = paper.pmcid ? { pmid } : paper.sourceFile ? { file: paper.sourceFile } : { pmid };
    const text = await loadSource(src);
    if (!text || text.length < 500) {
      transition(m, pmid, 'extracting', 'error', { note: 'source text unavailable/too short', nowISO: nowISO() });
      saveManifest(m);
      throw new Error('source text unavailable');
    }
    const out = await extractTopic(AGENTS_MD(), text);
    if (!out.ok) {
      transition(m, pmid, 'extracting', 'error', { note: out.error, nowISO: nowISO() });
      saveManifest(m);
      throw new Error(out.error);
    }
    usage = out.usage || {};
    writeArtifact(pmid, 'topic.json', out.topic);
    writeArtifact(pmid, 'extraction.raw.txt', out.raw || '');

    // Second pass: pull the paper's REPORTED pooled values into the sidecar
    // (never topic.json) so the reproduction gate has a comparison target.
    const outcomeIds = (out.topic.outcomes || []).map((o) => o.id);
    const rep = await extractReportedPooled(text, outcomeIds);
    if (rep.ok && rep.reported) {
      writeArtifact(pmid, 'reported-pooled.json', rep.reported);
      usage = {
        prompt_tokens: (usage.prompt_tokens || 0) + (rep.usage?.prompt_tokens || 0),
        completion_tokens: (usage.completion_tokens || 0) + (rep.usage?.completion_tokens || 0),
      };
    }
    costUSD = estimateCost(usage);
    transition(m, pmid, 'extracting', 'extracted', { nowISO: nowISO() });
    saveManifest(m);
  }

  // 2. Validate against the shared schema (fail fast before pooling).
  const topic = readArtifact(pmid, 'topic.json');
  if (!topic) throw new Error(`extract: no topic.json for ${pmid}`);
  const parsed = topicSchema.safeParse(topic);
  if (!parsed.success) {
    const errs = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).slice(0, 8);
    if (!noLlm) {
      transition(m, pmid, 'extracted', 'error', { note: `schema: ${errs[0]}`, nowISO: nowISO() });
      saveManifest(m);
    }
    throw new Error(`schema validation failed:\n  ${errs.join('\n  ')}`);
  }

  // 3. Reproduction gate (free).
  const computed = deriveTopic(topic);
  const reportedFile = readArtifact(pmid, 'reported-pooled.json');
  const reported = reportedFile?.outcomes ?? [];
  const repro = compareReproduction(computed, reported);
  writeArtifact(pmid, 'repro.json', repro);
  if (!noLlm) {
    transition(m, pmid, 'extracted', repro.pass ? 'reproPassed' : 'reproFailed', { nowISO: nowISO() });
    chargeBudget(m, costUSD);
    saveManifest(m);
  }

  // 4. Methods auditor.
  const audit = computed.outcomes.map((o) => ({ outcomeId: o.outcome.id, checks: auditOutcome(o) }));

  // 5. Provenance + PR body.
  const provenance = {
    source: { pmid, doi: paper.doi, title: paper.title, oa: paper.oaFullText },
    model: process.env.DEEPSEEK_MODEL || 'deepseek-chat',
    usage,
    costUSD,
    extractedAt: nowISO(),
  };
  writeArtifact(pmid, 'provenance.json', provenance);
  const body = renderPrBody({
    topic,
    provenance,
    repro,
    audit,
    extractedOutcomes: extractedOutcomeRows(computed),
  });

  // Only open a PR if the reproduction gate PASSED against the paper's reported
  // pooled values. An extraction with no reported values to check against is
  // UNVERIFIABLE (often a bad/wrong-paper fetch) — hold it for review rather than
  // auto-opening a PR the reproduction gate never actually vetted.
  let pr = { prUrl: null, branch: null };
  if (repro.pass) {
    // openPr copies the queued topic.json into src/content/topics/<slug>.json
    // on the branch and commits only that file (the sidecar stays gitignored).
    pr = openPr(topic.slug, join(paperDir(pmid), COMMITTABLE), body, { dryRun: dryRunPr });
    if (!noLlm && pr.prUrl && !pr.dryRun) {
      transition(m, pmid, 'reproPassed', 'prOpen', { nowISO: nowISO() });
      m.papers[String(pmid)].prUrl = pr.prUrl;
      m.papers[String(pmid)].branch = pr.branch;
      saveManifest(m);
    }
  }

  return { repro, audit, provenance, prBody: body, pr };
}

function main() {
  const args = process.argv.slice(2);
  const pmid = args.find((a) => !a.startsWith('--'));
  if (!pmid) {
    console.error('usage: tsx scripts/ingest/extract.mjs <pmid> [--no-llm] [--dry-run-pr]');
    process.exit(2);
  }
  extractPaper(pmid, { noLlm: args.includes('--no-llm'), dryRunPr: args.includes('--dry-run-pr') })
    .then((r) => {
      console.log(`\nReproduction: ${r.repro.pass ? 'PASS' : 'FAIL'} · PR: ${r.pr.prUrl || '(not opened)'}`);
      console.log('\n----- PR BODY -----\n');
      console.log(r.prBody);
    })
    .catch((e) => {
      console.error('extract failed:', e.message);
      process.exit(1);
    });
}

if (import.meta.url === `file://${process.argv[1]}`) main();

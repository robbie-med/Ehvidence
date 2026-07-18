/**
 * run.mjs—the scheduler entry point (cron invokes this hourly). One guarded
 * pass: discover (free) → triage new ranked (cheap) → extract up to N approved
 * within budget → sampled audit → periodic canary → summary. A lock file
 * prevents overlapping runs; hard budget caps bound spend.
 *
 * Nothing is extracted unless a human has set a paper to `approved` (via the
 * Telegram bot or the CLI), so this is safe to run on a schedule from day one.
 *
 *   tsx scripts/ingest/run.mjs [--once] [--no-discover]
 *
 * Invoke with the pinned Node 22 binary (bare `node` is v18 and lacks tsx/env).
 */
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync, rmSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { REPO_ROOT, loadDotenv, readCaps, assertNode22 } from './lib/env.mjs';
import {
  loadManifest,
  saveManifest,
  rollBudgetWindows,
  withinBudget,
  papersByStatus,
  transition,
} from './lib/manifest.mjs';
import { triage } from './lib/triage.mjs';
import { extractPaper } from './extract.mjs';
import { auditSample } from './auditSample.mjs';
import { runCanary } from './canary.mjs';
import { notify } from './lib/notify.mjs';

const STATE_DIR = join(REPO_ROOT, 'scripts', 'ingest', 'state');
const LOCK_PATH = join(STATE_DIR, 'run.lock');
const PAUSED_PATH = join(STATE_DIR, 'paused');
const AUDIT_COUNTER_PATH = join(STATE_DIR, 'audit-counter.json');
const nowISO = () => new Date().toISOString();

/** Acquire an exclusive lock; reclaim a stale one whose pid is gone. */
function acquireLock() {
  mkdirSync(STATE_DIR, { recursive: true });
  if (existsSync(LOCK_PATH)) {
    const prev = JSON.parse(readFileSync(LOCK_PATH, 'utf8'));
    let alive = false;
    try {
      process.kill(prev.pid, 0); // signal 0 = existence check
      alive = true;
    } catch {
      alive = false;
    }
    if (alive) return false;
    console.warn(`Reclaiming stale lock (pid ${prev.pid} gone).`);
  }
  writeFileSync(LOCK_PATH, JSON.stringify({ pid: process.pid, at: nowISO() }));
  return true;
}

function releaseLock() {
  rmSync(LOCK_PATH, { force: true });
}

/** Every-50 audit sampling counter. */
function bumpAuditCounter() {
  let n = 0;
  if (existsSync(AUDIT_COUNTER_PATH)) n = JSON.parse(readFileSync(AUDIT_COUNTER_PATH, 'utf8')).n || 0;
  n += 1;
  writeFileSync(AUDIT_COUNTER_PATH, JSON.stringify({ n }));
  return n;
}

async function main() {
  assertNode22();
  loadDotenv();
  const caps = readCaps();

  if (!acquireLock()) {
    console.log('Another run holds the lock; exiting.');
    return;
  }

  try {
    if (existsSync(PAUSED_PATH)) {
      console.log('Pipeline is paused (state/paused present); discovery only.');
    }

    const m = loadManifest();
    rollBudgetWindows(m, nowISO());
    saveManifest(m);

    const summary = { discovered: 0, triaged: 0, extracted: 0, prs: [], errors: [], audited: 0 };
    const paused = existsSync(PAUSED_PATH);

    // 1. Discover (free). Delegated to the standalone CLI so it owns its own
    //    network/error handling; it updates the manifest in place.
    if (!process.argv.includes('--no-discover')) {
      const NODE = process.execPath;
      const r = spawnSync(NODE, [join(REPO_ROOT, 'scripts', 'ingest', 'discover.mjs')], {
        cwd: REPO_ROOT,
        encoding: 'utf8',
      });
      if (r.status !== 0) summary.errors.push(`discover: ${(r.stderr || '').slice(0, 200)}`);
    }

    // 2. Triage newly-ranked papers (cheap; skipped safely without a key).
    const fresh = loadManifest();
    rollBudgetWindows(fresh, nowISO());
    for (const p of papersByStatus(fresh, 'ranked')) {
      if (p.triage) continue; // already triaged
      const t = await triage({ abstract: p.abstract || p.title || '' });
      p.triage = t;
      if (t.go === false && t.confidence >= 0.6) {
        try {
          transition(fresh, p.pmid, 'ranked', 'rejected', { nowISO: nowISO() });
        } catch {
          /* leave as ranked */
        }
      } else {
        summary.triaged += 1;
      }
    }
    saveManifest(fresh);

    // 3. Extract approved papers, up to the daily cap and monthly budget.
    for (const p of papersByStatus(fresh, 'approved')) {
      if (paused) break;
      const gate = withinBudget(loadManifest(), caps);
      if (!gate.ok) {
        notify('budget', `Extraction paused: ${gate.reason}.`, {}, nowISO());
        break;
      }
      try {
        const res = await extractPaper(p.pmid, {});
        summary.extracted += 1;
        if (res.pr?.prUrl) {
          summary.prs.push(res.pr.prUrl);
          notify('pr-open', `PR opened for ${p.pmid}: ${res.pr.prUrl}`, { pmid: p.pmid }, nowISO());
        }
        if (!res.repro.pass) {
          notify('repro-mismatch', `Reproduction gate FAILED for ${p.pmid} — held for review.`, { pmid: p.pmid }, nowISO());
        }
        // Sampled audit: every 50th extraction (stub-gated on ANTHROPIC key).
        if (bumpAuditCounter() % 50 === 0) {
          const a = await auditSample(p.pmid);
          if (!a.skipped) {
            summary.audited += 1;
            if (a.verdict === 'suspect') {
              notify('audit', `Claude audit flagged ${p.pmid}: ${a.summary}`, { pmid: p.pmid }, nowISO());
            }
          }
        }
      } catch (e) {
        summary.errors.push(`extract ${p.pmid}: ${e.message}`);
        notify('job-failure', `Extraction failed for ${p.pmid}: ${e.message}`, { pmid: p.pmid }, nowISO());
      }
    }

    // 4. Periodic canary (once per ~24 runs; cheap guard on the counter).
    const auditN = existsSync(AUDIT_COUNTER_PATH) ? JSON.parse(readFileSync(AUDIT_COUNTER_PATH, 'utf8')).n : 0;
    if (auditN % 24 === 0) {
      const c = await runCanary();
      if (!c.skipped && c.drift) {
        notify('job-failure', `Canary drift: gold ${c.slug} scored ${c.overall.toFixed(3)} < ${c.threshold}.`, {}, nowISO());
      }
    }

    // 5. Daily digest.
    notify(
      'digest',
      `Run complete: ${summary.triaged} triaged, ${summary.extracted} extracted, ` +
        `${summary.prs.length} PRs, ${summary.errors.length} errors.`,
      summary,
      nowISO(),
    );
    console.log(JSON.stringify(summary, null, 2));
  } finally {
    releaseLock();
  }
}

main().catch((e) => {
  console.error('run.mjs fatal:', e);
  releaseLock();
  process.exit(1);
});

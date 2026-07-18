/**
 * manifest.mjs—the ingestion pipeline's state store: a single JSON file that
 * every stage and the Telegram bot read/write. Chosen over SQLite because the
 * volume is a few papers/week, it stays human-readable and zero-dependency, and
 * both the scheduler and the bot can inspect it directly.
 *
 * The pure transition/budget helpers here are unit-tested; loadManifest /
 * saveManifest are the only functions that touch disk.
 */
import { readFileSync, writeFileSync, renameSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { REPO_ROOT } from './env.mjs';

export const MANIFEST_PATH = join(REPO_ROOT, 'scripts', 'ingest', 'state', 'manifest.json');

/** Lifecycle states a paper moves through. */
export const STATES = [
  'discovered',
  'ranked',
  'triaged',
  'rejected',
  'approved',
  'extracting',
  'extracted',
  'reproPassed',
  'reproFailed',
  'prOpen',
  'merged',
  'closed',
  'error',
];

/** Legal forward transitions. `error` is reachable from anywhere (see transition). */
const ALLOWED = {
  discovered: ['ranked', 'rejected'],
  ranked: ['triaged', 'approved', 'rejected'],
  triaged: ['approved', 'rejected'],
  rejected: ['ranked', 'approved'], // a human can revive a rejected paper
  approved: ['extracting', 'rejected'],
  extracting: ['extracted', 'error'],
  extracted: ['reproPassed', 'reproFailed', 'error'],
  reproPassed: ['prOpen', 'error'],
  reproFailed: ['approved', 'closed', 'error'], // retry after a fix, or drop
  prOpen: ['merged', 'closed'],
  merged: [],
  closed: ['approved'],
  error: ['approved', 'ranked', 'closed'],
};

export function emptyManifest() {
  return {
    version: 1,
    budget: { monthUTC: '', spentUSD: 0, papersToday: 0, dayUTC: '' },
    papers: {},
  };
}

export function loadManifest(path = MANIFEST_PATH) {
  if (!existsSync(path)) return emptyManifest();
  const m = JSON.parse(readFileSync(path, 'utf8'));
  // Tolerate older/partial files.
  return { ...emptyManifest(), ...m, budget: { ...emptyManifest().budget, ...(m.budget || {}) } };
}

export function saveManifest(m, path = MANIFEST_PATH) {
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.tmp`;
  writeFileSync(tmp, JSON.stringify(m, null, 2));
  renameSync(tmp, path); // atomic on same filesystem
  return m;
}

/** Insert-or-merge a paper record, keyed by pmid. Does not change status. */
export function upsertPaper(m, pmid, patch, nowISO = '') {
  const key = String(pmid);
  const prev = m.papers[key] || { pmid: key, status: 'discovered', errors: [] };
  m.papers[key] = { ...prev, ...patch, pmid: key, updatedAt: nowISO || prev.updatedAt || '' };
  return m;
}

/**
 * Move a paper to `to`, enforcing the legal-transition table. Passing the
 * expected `from` guards against races (throws on mismatch). `to === 'error'`
 * is always allowed and appends to errors[].
 */
export function transition(m, pmid, from, to, { note = '', nowISO = '' } = {}) {
  const key = String(pmid);
  const paper = m.papers[key];
  if (!paper) throw new Error(`transition: unknown paper ${key}`);
  if (from && paper.status !== from) {
    throw new Error(`transition: ${key} is '${paper.status}', expected '${from}'`);
  }
  if (to !== 'error') {
    const legal = ALLOWED[paper.status] || [];
    if (!legal.includes(to)) {
      throw new Error(`transition: illegal ${paper.status} → ${to} for ${key}`);
    }
  } else if (note) {
    paper.errors = [...(paper.errors || []), note];
  }
  paper.status = to;
  paper.updatedAt = nowISO || paper.updatedAt || '';
  return m;
}

/** Reset the day/month budget counters when the window rolls over. */
export function rollBudgetWindows(m, nowISO) {
  const day = nowISO.slice(0, 10); // YYYY-MM-DD
  const month = nowISO.slice(0, 7); // YYYY-MM
  if (m.budget.dayUTC !== day) {
    m.budget.dayUTC = day;
    m.budget.papersToday = 0;
  }
  if (m.budget.monthUTC !== month) {
    m.budget.monthUTC = month;
    m.budget.spentUSD = 0;
  }
  return m;
}

/** Budget gate: is there room for one more paid extraction right now? */
export function withinBudget(m, caps) {
  if (m.budget.papersToday >= caps.maxPapersPerDay) {
    return { ok: false, reason: `daily cap reached (${caps.maxPapersPerDay})` };
  }
  if (m.budget.spentUSD >= caps.monthlyBudgetUSD) {
    return { ok: false, reason: `monthly budget reached ($${caps.monthlyBudgetUSD})` };
  }
  return { ok: true, reason: '' };
}

/** Record spend + increment the daily paper counter after an extraction. */
export function chargeBudget(m, costUSD) {
  m.budget.spentUSD = Number((m.budget.spentUSD + (costUSD || 0)).toFixed(4));
  m.budget.papersToday += 1;
  return m;
}

/** Papers currently in a given status. */
export function papersByStatus(m, status) {
  return Object.values(m.papers).filter((p) => p.status === status);
}

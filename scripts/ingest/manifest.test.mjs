import { describe, it, expect } from 'vitest';
import {
  emptyManifest,
  upsertPaper,
  transition,
  rollBudgetWindows,
  withinBudget,
  chargeBudget,
  papersByStatus,
} from './lib/manifest.mjs';

describe('upsertPaper', () => {
  it('inserts then merges without losing prior fields', () => {
    const m = emptyManifest();
    upsertPaper(m, '1', { title: 'X', status: 'ranked' }, 't1');
    upsertPaper(m, '1', { doi: '10.1/x' }, 't2');
    expect(m.papers['1'].title).toBe('X');
    expect(m.papers['1'].doi).toBe('10.1/x');
    expect(m.papers['1'].updatedAt).toBe('t2');
  });
});

describe('transition—guards', () => {
  it('allows a legal forward move', () => {
    const m = emptyManifest();
    upsertPaper(m, '1', { status: 'ranked' });
    transition(m, '1', 'ranked', 'approved');
    expect(m.papers['1'].status).toBe('approved');
  });

  it('throws on an illegal move', () => {
    const m = emptyManifest();
    upsertPaper(m, '1', { status: 'ranked' });
    expect(() => transition(m, '1', 'ranked', 'merged')).toThrow(/illegal/);
  });

  it('throws when the expected `from` does not match (race guard)', () => {
    const m = emptyManifest();
    upsertPaper(m, '1', { status: 'approved' });
    expect(() => transition(m, '1', 'ranked', 'extracting')).toThrow(/expected/);
  });

  it('allows error from anywhere and records the note', () => {
    const m = emptyManifest();
    upsertPaper(m, '1', { status: 'extracting', errors: [] });
    transition(m, '1', 'extracting', 'error', { note: 'boom' });
    expect(m.papers['1'].status).toBe('error');
    expect(m.papers['1'].errors).toContain('boom');
  });

  it('throws for an unknown paper', () => {
    expect(() => transition(emptyManifest(), 'ghost', 'ranked', 'approved')).toThrow(/unknown/);
  });
});

describe('budget windows + gate', () => {
  it('resets daily/monthly counters when the window rolls', () => {
    const m = emptyManifest();
    m.budget = { monthUTC: '2026-06', dayUTC: '2026-06-30', papersToday: 3, spentUSD: 5 };
    rollBudgetWindows(m, '2026-07-01T00:00:00.000Z');
    expect(m.budget.papersToday).toBe(0);
    expect(m.budget.spentUSD).toBe(0);
    expect(m.budget.dayUTC).toBe('2026-07-01');
    expect(m.budget.monthUTC).toBe('2026-07');
  });

  it('keeps monthly spend when only the day rolls', () => {
    const m = emptyManifest();
    m.budget = { monthUTC: '2026-07', dayUTC: '2026-07-17', papersToday: 3, spentUSD: 5 };
    rollBudgetWindows(m, '2026-07-18T00:00:00.000Z');
    expect(m.budget.papersToday).toBe(0);
    expect(m.budget.spentUSD).toBe(5);
  });

  it('withinBudget blocks at the daily cap and the monthly cap', () => {
    const caps = { maxPapersPerDay: 3, monthlyBudgetUSD: 10 };
    const m = emptyManifest();
    m.budget = { monthUTC: '2026-07', dayUTC: '2026-07-18', papersToday: 3, spentUSD: 0 };
    expect(withinBudget(m, caps).ok).toBe(false);
    m.budget = { monthUTC: '2026-07', dayUTC: '2026-07-18', papersToday: 0, spentUSD: 10 };
    expect(withinBudget(m, caps).ok).toBe(false);
    m.budget = { monthUTC: '2026-07', dayUTC: '2026-07-18', papersToday: 1, spentUSD: 2 };
    expect(withinBudget(m, caps).ok).toBe(true);
  });

  it('chargeBudget accrues spend and increments the day counter', () => {
    const m = emptyManifest();
    chargeBudget(m, 0.12);
    chargeBudget(m, 0.08);
    expect(m.budget.spentUSD).toBeCloseTo(0.2, 5);
    expect(m.budget.papersToday).toBe(2);
  });
});

describe('papersByStatus', () => {
  it('filters by status', () => {
    const m = emptyManifest();
    upsertPaper(m, '1', { status: 'ranked' });
    upsertPaper(m, '2', { status: 'approved' });
    upsertPaper(m, '3', { status: 'ranked' });
    expect(papersByStatus(m, 'ranked').map((p) => p.pmid).sort()).toEqual(['1', '3']);
  });
});

import { describe, it, expect } from 'vitest';
import { evalue, eggerTest, metaFragility, leaveOneOut } from './audit';
import { absoluteRisk, poolRandomEffects, type StudyData } from './stats';

describe('evalue', () => {
  it('matches the VanderWeele–Ding worked example for a protective effect', () => {
    // RR 0.55 → E-value ≈ 3.03; CI upper 0.71 → bound ≈ 2.17.
    const e = evalue(0.55, 0.43, 0.71);
    expect(e.point).toBeCloseTo(3.03, 1);
    expect(e.bound).toBeCloseTo(2.17, 1);
  });
  it('is symmetric for a harmful effect', () => {
    expect(evalue(2.0, 1.5, 2.6).point).toBeCloseTo(3.41, 1);
  });
  it('returns bound 1 when the CI crosses the null', () => {
    expect(evalue(0.9, 0.7, 1.2).bound).toBe(1);
  });
});

describe('absoluteRisk', () => {
  it('translates a relative risk at a baseline into ARR and NNT', () => {
    // baseline 9.5%, RR 0.33 → ARR 6.37%, NNT 16.
    const a = absoluteRisk(0.095, { point: 0.33, ciLow: 0.21, ciHigh: 0.51 }, 'lowerIsBetter');
    expect(a.arr).toBeCloseTo(0.06365, 4);
    expect(a.kind).toBe('NNT');
    expect(a.nn).toBe(16);
    expect(a.per1000.delta).toBeCloseTo(63.65, 1);
  });
  it('reports NNH when the effect increases the event for a lower-is-better outcome', () => {
    const a = absoluteRisk(0.1, { point: 1.5, ciLow: 1.2, ciHigh: 1.9 }, 'lowerIsBetter');
    expect(a.kind).toBe('NNH');
    expect(a.nn).toBe(20); // ARR = 0.1 - 0.15 = -0.05 → 1/0.05
  });
});

describe('eggerTest', () => {
  it('returns null with fewer than 3 studies', () => {
    expect(eggerTest([0.1, -0.2], [0.3, 0.4])).toBeNull();
  });
  it('finds near-zero asymmetry for a symmetric set', () => {
    const ys = [0.0, 0.0, 0.0, 0.0];
    const ses = [0.1, 0.2, 0.3, 0.4];
    const r = eggerTest(ys, ses)!;
    expect(Math.abs(r.intercept)).toBeLessThan(1e-6);
  });
});

describe('metaFragility & leaveOneOut', () => {
  const tables: StudyData[] = [
    { kind: '2x2', txEvents: 10, txTotal: 100, ctrlEvents: 25, ctrlTotal: 100 },
    { kind: '2x2', txEvents: 8, txTotal: 100, ctrlEvents: 22, ctrlTotal: 100 },
    { kind: '2x2', txEvents: 12, txTotal: 100, ctrlEvents: 20, ctrlTotal: 100 },
  ];
  it('reports a positive fragility for a significant pooled benefit', () => {
    const base = poolRandomEffects(tables)!;
    expect(base.pooled.ciHigh).toBeLessThan(1); // significant
    const fi = metaFragility(
      tables as Extract<StudyData, { kind: '2x2' }>[],
      base.weighted.map((w) => w.weightPct),
    );
    expect(fi).not.toBeNull();
    expect(fi!).toBeGreaterThan(0);
  });
  it('leave-one-out returns a range spanning the base estimate', () => {
    const loo = leaveOneOut(tables)!;
    expect(loo.min).toBeLessThanOrEqual(loo.base + 1e-9);
    expect(loo.max).toBeGreaterThanOrEqual(loo.base - 1e-9);
  });
});

describe('pool diagnostics', () => {
  it('exposes fixed and random estimates and per-study weights', () => {
    const items: StudyData[] = [
      { kind: 'effect', measure: 'RR', point: 1.12, ciLow: 1.07, ciHigh: 1.16 },
      { kind: 'effect', measure: 'RR', point: 1.68, ciLow: 1.3, ciHigh: 2.19 },
    ];
    const d = poolRandomEffects(items)!.diagnostics;
    expect(d.ratioScale).toBe(true);
    expect(d.perStudy).toHaveLength(2);
    // The precise study dominates the fixed weight.
    expect(d.perStudy[0].wFixedPct).toBeGreaterThan(0.8);
    // Fixed effect sits near the precise study; random pulls higher.
    expect(d.fixed.est).toBeLessThan(d.random.est);
    expect(d.perStudy.reduce((a, s) => a + s.wRandomPct, 0)).toBeCloseTo(1, 5);
  });
});

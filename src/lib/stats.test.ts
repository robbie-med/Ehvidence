import { describe, it, expect } from 'vitest';
import {
  computeEffect,
  poolRandomEffects,
  deriveStatus,
  computeContinuous,
  poolContinuous,
  deriveStatusContinuous,
  type TwoByTwo,
  type PrecomputedEffect,
  type ContinuousData,
} from './stats';

describe('computeEffect—2x2 risk ratio', () => {
  it('computes RR, CI, % improvement and NNT for a standard table', () => {
    // a=5/250, c=12/248 => RR = 0.02 / 0.04839 = 0.4133
    const d: TwoByTwo = {
      kind: '2x2',
      txEvents: 5,
      txTotal: 250,
      ctrlEvents: 12,
      ctrlTotal: 248,
    };
    const r = computeEffect(d);
    expect(r.rr).toBeCloseTo(0.4133, 3);
    // Katz SE: sqrt(1/5 - 1/250 + 1/12 - 1/248) = sqrt(0.27530) = 0.52469
    expect(r.seLog).toBeCloseTo(0.5247, 3);
    expect(r.ciLow).toBeCloseTo(0.1478, 3);
    expect(r.ciHigh).toBeCloseTo(1.1561, 3);
    expect(r.improvementPct).toBeCloseTo(58.67, 1);
    // ARR = 12/248 - 5/250 = 0.04839 - 0.02 = 0.02839 => NNT = ceil(35.2) = 36
    expect(r.arr).toBeCloseTo(0.02839, 4);
    expect(r.nnt).toBe(36);
    expect(r.nnh).toBeNull();
    expect(r.continuityCorrected).toBe(false);
  });

  it('applies a continuity correction when a cell is zero', () => {
    const d: TwoByTwo = {
      kind: '2x2',
      txEvents: 0,
      txTotal: 100,
      ctrlEvents: 10,
      ctrlTotal: 100,
    };
    const r = computeEffect(d);
    expect(r.continuityCorrected).toBe(true);
    // Corrected RR = (0.5/101) / (10.5/101) = 0.5/10.5 = 0.0476
    expect(r.rr).toBeCloseTo(0.0476, 3);
    expect(Number.isFinite(r.seLog)).toBe(true);
    // ARR uses uncorrected risks: 0.10 - 0 = 0.10 => NNT = 10
    expect(r.nnt).toBe(10);
  });

  it('reports NNH when treatment increases risk', () => {
    const d: TwoByTwo = {
      kind: '2x2',
      txEvents: 20,
      txTotal: 100,
      ctrlEvents: 10,
      ctrlTotal: 100,
    };
    const r = computeEffect(d);
    expect(r.rr).toBeCloseTo(2.0, 5);
    expect(r.nnt).toBeNull();
    // ARI = 0.20 - 0.10 = 0.10 => NNH = 10
    expect(r.nnh).toBe(10);
    expect(r.improvementPct).toBeCloseTo(-100, 5);
  });
});

describe('computeEffect—precomputed effect', () => {
  it('recovers SE from a reported CI and computes NNT from control risk', () => {
    const d: PrecomputedEffect = {
      kind: 'effect',
      measure: 'RR',
      point: 0.5,
      ciLow: 0.25,
      ciHigh: 1.0,
      ctrlRisk: 0.2,
    };
    const r = computeEffect(d);
    expect(r.rr).toBe(0.5);
    // SE = (ln(1) - ln(0.25)) / (2 * 1.959964) = 1.3863 / 3.9199 = 0.3537
    expect(r.seLog).toBeCloseTo(0.3537, 3);
    // ARR = 0.2 * (1 - 0.5) = 0.1 => NNT = 10
    expect(r.nnt).toBe(10);
  });

  it('flags OR/HR effects as approximate and omits NNT without control risk', () => {
    const d: PrecomputedEffect = {
      kind: 'effect',
      measure: 'OR',
      point: 0.6,
      ciLow: 0.4,
      ciHigh: 0.9,
    };
    const r = computeEffect(d);
    expect(r.approximate).toBe(true);
    expect(r.nnt).toBeNull();
  });
});

describe('poolRandomEffects—DerSimonian–Laird', () => {
  it('pools homogeneous studies near their common effect with tau²≈0', () => {
    // Two identical studies should pool to the same RR with tau² = 0.
    const study: TwoByTwo = {
      kind: '2x2',
      txEvents: 5,
      txTotal: 250,
      ctrlEvents: 12,
      ctrlTotal: 248,
    };
    const out = poolRandomEffects([study, { ...study }]);
    expect(out).not.toBeNull();
    const { pooled } = out!;
    expect(pooled.k).toBe(2);
    expect(pooled.rr).toBeCloseTo(0.4133, 3);
    expect(pooled.tau2).toBeCloseTo(0, 5);
    expect(pooled.i2).toBeCloseTo(0, 5);
    // Pooling tightens the CI relative to a single study.
    expect(pooled.ciHigh - pooled.ciLow).toBeLessThan(1.1561 - 0.1478);
    expect(pooled.totalPatients).toBe((250 + 248) * 2);
  });

  it('produces positive heterogeneity for divergent studies', () => {
    const a: TwoByTwo = { kind: '2x2', txEvents: 2, txTotal: 200, ctrlEvents: 20, ctrlTotal: 200 };
    const b: TwoByTwo = { kind: '2x2', txEvents: 30, txTotal: 200, ctrlEvents: 10, ctrlTotal: 200 };
    const out = poolRandomEffects([a, b]);
    expect(out).not.toBeNull();
    expect(out!.pooled.tau2).toBeGreaterThan(0);
    expect(out!.pooled.i2).toBeGreaterThan(50);
  });

  it('normalizes plot weights to sum to 1', () => {
    const a: TwoByTwo = { kind: '2x2', txEvents: 5, txTotal: 500, ctrlEvents: 25, ctrlTotal: 500 };
    const b: TwoByTwo = { kind: '2x2', txEvents: 1, txTotal: 50, ctrlEvents: 5, ctrlTotal: 50 };
    const out = poolRandomEffects([a, b])!;
    const total = out.weighted.reduce((s, w) => s + w.weightPct, 0);
    expect(total).toBeCloseTo(1, 6);
    // The larger study should carry more weight.
    expect(out.weighted[0].weightPct).toBeGreaterThan(out.weighted[1].weightPct);
  });

  it('returns null when there is nothing to pool', () => {
    expect(poolRandomEffects([])).toBeNull();
  });

  it('derives a pooled NNT from reported control risks when no 2x2 exists', () => {
    // Two precomputed effects with control risks but no contingency tables.
    const a: PrecomputedEffect = { kind: 'effect', measure: 'RR', point: 0.2, ciLow: 0.1, ciHigh: 0.4, ctrlRisk: 0.1 };
    const b: PrecomputedEffect = { kind: 'effect', measure: 'RR', point: 0.3, ciLow: 0.15, ciHigh: 0.6, ctrlRisk: 0.2 };
    const out = poolRandomEffects([a, b])!;
    expect(out.pooled.totalEvents).toBe(0);
    expect(out.pooled.nnt).not.toBeNull();
    // Mean control risk 0.15, pooled RR ~0.24 => ARR ~0.114 => NNT ~9.
    expect(out.pooled.nnt!).toBeGreaterThan(5);
    expect(out.pooled.nnt!).toBeLessThan(15);
  });
});

describe('computeContinuous', () => {
  const d: ContinuousData = {
    kind: 'continuous',
    txMean: 5, txSd: 2, txN: 50,
    ctrlMean: 7, ctrlSd: 2, ctrlN: 50,
  };

  it('computes a mean difference with its CI', () => {
    const r = computeContinuous(d, 'MD');
    expect(r.estimate).toBeCloseTo(-2, 5);
    // SE = sqrt(4/50 + 4/50) = 0.4
    expect(r.se).toBeCloseTo(0.4, 5);
    expect(r.ciLow).toBeCloseTo(-2.784, 2);
    expect(r.ciHigh).toBeCloseTo(-1.216, 2);
  });

  it('computes a standardized mean difference (Hedges g)', () => {
    const r = computeContinuous(d, 'SMD');
    // pooled SD = 2, d = -1, J ~ 0.9923, g ~ -0.992
    expect(r.estimate).toBeCloseTo(-0.992, 2);
    expect(r.se).toBeCloseTo(0.2105, 3);
  });

  it('recovers SE from a 90% CI (TQT convention) and re-expresses it at 95%', () => {
    // Täubel 2020 levofloxacin: ∆∆QTcF 9.40 ms, 90% CI 8.21–10.59.
    const r = computeContinuous(
      { kind: 'continuousEffect', measure: 'MD', point: 9.4, ciLow: 8.21, ciHigh: 10.59, ciLevel: 90 },
      'MD',
    );
    expect(r.estimate).toBeCloseTo(9.4, 5);
    // SE = (10.59 - 8.21) / (2 * 1.644854) = 0.7235
    expect(r.se).toBeCloseTo(0.7235, 3);
    // Displayed CI is widened to 95%: 9.40 ± 1.959964 * 0.7235.
    expect(r.ciLow).toBeCloseTo(7.982, 2);
    expect(r.ciHigh).toBeCloseTo(10.818, 2);
  });

  it('defaults to 95% when no ciLevel is given', () => {
    const r = computeContinuous(
      { kind: 'continuousEffect', measure: 'MD', point: 7.12, ciLow: 5.16, ciHigh: 9.09 },
      'MD',
    );
    // SE = (9.09 - 5.16) / (2 * 1.959964) = 1.0026; the CI is re-expressed
    // symmetrically at 95% (7.12 ± 1.959964 * 1.0026).
    expect(r.se).toBeCloseTo(1.0026, 3);
    expect(r.ciLow).toBeCloseTo(5.155, 2);
    expect(r.ciHigh).toBeCloseTo(9.085, 2);
  });
});

describe('poolContinuous', () => {
  it('pools homogeneous studies and excludes 0 in the CI', () => {
    const a: ContinuousData = { kind: 'continuous', txMean: 2.8, txSd: 0.63, txN: 55, ctrlMean: 4.5, ctrlSd: 0.75, ctrlN: 55 };
    const out = poolContinuous([a, { ...a }], 'MD');
    expect(out).not.toBeNull();
    expect(out!.pooled.estimate).toBeCloseTo(-1.7, 2);
    expect(out!.pooled.tau2).toBeCloseTo(0, 5);
    expect(out!.pooled.ciHigh).toBeLessThan(0);
    expect(out!.pooled.totalPatients).toBe(220);
  });

  it('returns null when empty', () => {
    expect(poolContinuous([], 'SMD')).toBeNull();
  });
});

describe('deriveStatusContinuous', () => {
  const p = (est: number, lo: number, hi: number, k = 4) => ({
    k, measure: 'SMD' as const, estimate: est, ciLow: lo, ciHigh: hi, se: 0.2, q: 0, tau2: 0, i2: 0, totalPatients: 400,
  });
  it('is favorable when a reduction is significant (lower is better)', () => {
    expect(deriveStatusContinuous(p(-1.6, -2.1, -1.2), 'lowerIsBetter')).toBe('favorable');
  });
  it('is neutral when the CI crosses 0', () => {
    expect(deriveStatusContinuous(p(-0.2, -0.6, 0.2), 'lowerIsBetter')).toBe('neutral');
  });
  it('is limited with too few studies', () => {
    expect(deriveStatusContinuous(p(-1.6, -2.1, -1.2, 2), 'lowerIsBetter')).toBe('limited');
  });
});

describe('deriveStatus', () => {
  const pooled = (rr: number, lo: number, hi: number, k = 5, events = 100) => ({
    k,
    rr,
    ciLow: lo,
    ciHigh: hi,
    improvementPct: (1 - rr) * 100,
    q: 0,
    tau2: 0,
    i2: 0,
    nnt: null,
    nnh: null,
    totalPatients: 1000,
    totalEvents: events,
  });

  it('flags a significant reduction as favorable (lower is better)', () => {
    expect(deriveStatus(pooled(0.4, 0.25, 0.65), 'lowerIsBetter')).toBe('favorable');
  });

  it('flags a significant increase as harmful (lower is better)', () => {
    expect(deriveStatus(pooled(1.8, 1.2, 2.7), 'lowerIsBetter')).toBe('harmful');
  });

  it('is neutral when the CI crosses 1', () => {
    expect(deriveStatus(pooled(0.85, 0.6, 1.2), 'lowerIsBetter')).toBe('neutral');
  });

  it('is limited with too few studies or events', () => {
    expect(deriveStatus(pooled(0.4, 0.25, 0.65, 2, 100), 'lowerIsBetter')).toBe('limited');
    expect(deriveStatus(pooled(0.4, 0.25, 0.65, 5, 10), 'lowerIsBetter')).toBe('limited');
    expect(deriveStatus(null, 'lowerIsBetter')).toBe('limited');
  });

  it('does not penalize precomputed-effect topics that report zero raw events', () => {
    // 0 events but enough studies and a significant effect => favorable.
    expect(deriveStatus(pooled(0.4, 0.25, 0.65, 4, 0), 'lowerIsBetter')).toBe('favorable');
  });

  it('inverts orientation for higher-is-better outcomes', () => {
    // RR > 1 means more of a good outcome => favorable.
    expect(deriveStatus(pooled(1.8, 1.2, 2.7), 'higherIsBetter')).toBe('favorable');
    expect(deriveStatus(pooled(0.4, 0.25, 0.65), 'higherIsBetter')).toBe('harmful');
  });
});

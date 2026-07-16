import { describe, it, expect } from 'vitest';
import {
  normInv,
  cumulativeMeta,
  requiredInfoSize,
  trialSequential,
  flipTrial,
  type YearedStudy,
} from './living';
import type { StudyData } from './stats';

describe('normInv', () => {
  it('inverts the standard normal at known quantiles', () => {
    expect(normInv(0.975)).toBeCloseTo(1.959964, 3);
    expect(normInv(0.9)).toBeCloseTo(1.281552, 3);
    expect(normInv(0.5)).toBeCloseTo(0, 6);
  });
});

describe('requiredInfoSize', () => {
  it('matches a hand-computed RIS and inflates with heterogeneity', () => {
    // pc 0.10, RRR 25%, alpha .05, power .90, no diversity → ~5359 patients.
    const ris = requiredInfoSize(0.1, 0.25, 0.05, 0.9, 0);
    expect(ris).toBeGreaterThan(5200);
    expect(ris).toBeLessThan(5500);
    // Diversity D²=0.5 doubles the requirement.
    expect(requiredInfoSize(0.1, 0.25, 0.05, 0.9, 0.5)).toBeCloseTo(ris * 2, -1);
  });
});

const yeared: YearedStudy[] = [
  { data: { kind: '2x2', txEvents: 5, txTotal: 100, ctrlEvents: 15, ctrlTotal: 100 }, year: 2005, patients: 200 },
  { data: { kind: '2x2', txEvents: 8, txTotal: 120, ctrlEvents: 18, ctrlTotal: 118 }, year: 2010, patients: 238 },
  { data: { kind: '2x2', txEvents: 12, txTotal: 200, ctrlEvents: 25, ctrlTotal: 200 }, year: 2015, patients: 400 },
];

describe('cumulativeMeta', () => {
  it('pools each year-ordered prefix and accumulates patients', () => {
    const c = cumulativeMeta(yeared);
    expect(c).toHaveLength(3);
    expect(c[0].k).toBe(1);
    expect(c[2].k).toBe(3);
    expect(c[2].patients).toBe(838);
    // The last cumulative point equals the full pooled estimate.
    expect(c[2].rr).toBeGreaterThan(0);
    expect(c[0].patients).toBeLessThan(c[2].patients);
  });
});

describe('trialSequential', () => {
  it('returns a curve, a positive RIS and boundary values', () => {
    const t = trialSequential(yeared)!;
    expect(t).not.toBeNull();
    expect(t.risPatients).toBeGreaterThan(0);
    expect(t.points).toHaveLength(3);
    expect(t.controlRisk).toBeCloseTo(58 / 418, 3); // pooled control events/total
    // Monitoring boundary is high early (small info fraction) and finite.
    expect(t.points[0].boundary).toBeGreaterThan(1.96);
  });
});

describe('flipTrial', () => {
  it('reports a positive next-trial size for a significant pool', () => {
    const items = yeared.map((y) => y.data);
    const f = flipTrial(items);
    expect(f).not.toBeNull();
    expect(f!.patients).toBeGreaterThan(0);
  });
  it('returns null when the pooled estimate already includes the null', () => {
    const flat: StudyData[] = [
      { kind: '2x2', txEvents: 10, txTotal: 100, ctrlEvents: 10, ctrlTotal: 100 },
      { kind: '2x2', txEvents: 12, txTotal: 100, ctrlEvents: 11, ctrlTotal: 100 },
    ];
    expect(flipTrial(flat)).toBeNull();
  });
});

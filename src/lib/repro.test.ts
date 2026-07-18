import { describe, it, expect } from 'vitest';
import { compareReproduction, type ReportedPooled } from './repro';
import type { ComputedTopic, ComputedOutcome } from './derive';

/** Minimal ComputedTopic stub with just the fields repro.ts reads. */
function topicWith(outcomes: Array<{ id: string; ratio?: [number, number, number]; cont?: [number, number, number] }>): ComputedTopic {
  const ocs = outcomes.map((o) => {
    const oc: Partial<ComputedOutcome> = {
      outcome: { id: o.id, label: o.id, direction: 'lowerIsBetter' } as ComputedOutcome['outcome'],
      pooled: o.ratio ? ({ rr: o.ratio[0], ciLow: o.ratio[1], ciHigh: o.ratio[2] } as ComputedOutcome['pooled']) : null,
      contPooled: o.cont
        ? ({ estimate: o.cont[0], ciLow: o.cont[1], ciHigh: o.cont[2] } as ComputedOutcome['contPooled'])
        : null,
    };
    return oc as ComputedOutcome;
  });
  return { outcomes: ocs } as ComputedTopic;
}

const rep = (over: Partial<ReportedPooled>): ReportedPooled => ({
  outcomeId: 'mortality',
  measure: 'RR',
  point: 0.8,
  ciLow: 0.7,
  ciHigh: 0.92,
  ...over,
});

describe('compareReproduction—ratio measures', () => {
  it('passes when our pool matches the reported RR within tolerance', () => {
    const topic = topicWith([{ id: 'mortality', ratio: [0.82, 0.71, 0.95] }]);
    const r = compareReproduction(topic, [rep({})]);
    expect(r.pass).toBe(true);
    expect(r.outcomes[0].withinTol).toBe(true);
  });

  it('fails when the point estimate differs beyond tolerance', () => {
    const topic = topicWith([{ id: 'mortality', ratio: [0.5, 0.4, 0.62] }]);
    const r = compareReproduction(topic, [rep({})]);
    expect(r.pass).toBe(false);
    expect(r.outcomes[0].note).toMatch(/point differs/);
  });

  it('fails when the point is close but CIs do not overlap', () => {
    // ours 0.80 [0.79–0.81], reported 0.80 [0.70–0.92] actually overlaps; make ours disjoint.
    const topic = topicWith([{ id: 'mortality', ratio: [0.8, 0.96, 0.99] }]);
    const r = compareReproduction(topic, [rep({ point: 0.8, ciLow: 0.7, ciHigh: 0.92 })]);
    expect(r.outcomes[0].ciOverlap).toBe(false);
    expect(r.outcomes[0].withinTol).toBe(false);
  });

  it('log-scale symmetry: 2.0 vs 1.0 fails just like 0.5 vs 1.0', () => {
    const up = compareReproduction(topicWith([{ id: 'm', ratio: [2, 1.5, 2.6] }]), [
      rep({ outcomeId: 'm', point: 1, ciLow: 0.8, ciHigh: 1.25 }),
    ]);
    const down = compareReproduction(topicWith([{ id: 'm', ratio: [0.5, 0.38, 0.66] }]), [
      rep({ outcomeId: 'm', point: 1, ciLow: 0.8, ciHigh: 1.25 }),
    ]);
    expect(up.outcomes[0].withinTol).toBe(false);
    expect(down.outcomes[0].withinTol).toBe(false);
    expect(Math.abs(up.outcomes[0].pointDeltaPct)).toBeCloseTo(Math.abs(down.outcomes[0].pointDeltaPct), 1);
  });
});

describe('compareReproduction—continuous measures', () => {
  it('passes a mean difference within tolerance (scaled by CI width)', () => {
    const topic = topicWith([{ id: 'ldl', cont: [-10.2, -14, -6.4] }]);
    const r = compareReproduction(topic, [
      { outcomeId: 'ldl', measure: 'MD', point: -10.0, ciLow: -13.5, ciHigh: -6.5 },
    ]);
    expect(r.outcomes[0].withinTol).toBe(true);
  });

  it('fails an MD that is off by more than the CI width', () => {
    const topic = topicWith([{ id: 'ldl', cont: [-2, -5, 1] }]);
    const r = compareReproduction(topic, [
      { outcomeId: 'ldl', measure: 'MD', point: -10.0, ciLow: -13.5, ciHigh: -6.5 },
    ]);
    expect(r.outcomes[0].withinTol).toBe(false);
  });
});

describe('compareReproduction—edge cases', () => {
  it('fails (not throws) when an outcome has no pooled estimate', () => {
    const topic = topicWith([{ id: 'mortality' }]);
    const r = compareReproduction(topic, [rep({})]);
    expect(r.pass).toBe(false);
    expect(r.outcomes[0].ours).toBeNull();
    expect(r.outcomes[0].note).toMatch(/no pooled estimate/);
  });

  it('multi-outcome: passes only if every outcome reproduces', () => {
    const topic = topicWith([
      { id: 'mortality', ratio: [0.82, 0.71, 0.95] },
      { id: 'harm', ratio: [1.5, 1.2, 1.9] },
    ]);
    const ok = compareReproduction(topic, [rep({}), rep({ outcomeId: 'harm', point: 1.48, ciLow: 1.2, ciHigh: 1.85 })]);
    expect(ok.pass).toBe(true);
    const bad = compareReproduction(topic, [rep({}), rep({ outcomeId: 'harm', point: 0.9, ciLow: 0.7, ciHigh: 1.1 })]);
    expect(bad.pass).toBe(false);
  });

  it('empty reported list does not spuriously pass', () => {
    const topic = topicWith([{ id: 'mortality', ratio: [0.82, 0.71, 0.95] }]);
    expect(compareReproduction(topic, []).pass).toBe(false);
  });
});

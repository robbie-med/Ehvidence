import { describe, it, expect } from 'vitest';
import { numEq, compareData, matchStudies, scoreTopic } from './lib/score.mjs';

const gold = {
  slug: 'demo',
  outcomes: [
    { id: 'mas', direction: 'lowerIsBetter' },
    { id: 'dur', direction: 'lowerIsBetter' },
  ],
  studies: [
    { author: 'Adam', year: 1989, outcomeId: 'mas', data: { kind: '2x2', txEvents: 1, txTotal: 17, ctrlEvents: 4, ctrlTotal: 18 } },
    { author: 'Fraser', year: 2005, outcomeId: 'mas', data: { kind: 'effect', measure: 'OR', point: 1.41, ciLow: 0.88, ciHigh: 2.26 } },
    { author: 'Cao', year: 2017, outcomeId: 'dur', data: { kind: 'continuous', txMean: 0.13, txSd: 0.05, txN: 94, ctrlMean: 0.21, ctrlSd: 0.06, ctrlN: 94 } },
  ],
};
const clone = (o) => JSON.parse(JSON.stringify(o));

describe('numEq', () => {
  it('is exact for integer count fields', () => {
    expect(numEq(17, 17, { intField: true })).toBe(true);
    expect(numEq(17, 18, { intField: true })).toBe(false);
  });
  it('tolerates float rounding', () => {
    expect(numEq(1.41, 1.412, {})).toBe(true);
    expect(numEq(1.41, 1.6, {})).toBe(false);
  });
});

describe('compareData', () => {
  it('flags a kind mismatch', () => {
    const r = compareData({ kind: '2x2' }, { kind: 'effect' });
    expect(r.kindMatch).toBe(false);
    expect(r.matched).toBe(0);
  });
  it('counts matched fields', () => {
    const r = compareData(gold.studies[0].data, gold.studies[0].data);
    expect(r.matched).toBe(r.fields);
  });
});

describe('scoreTopic', () => {
  it('scores a perfect copy at 1.0', () => {
    const s = scoreTopic(clone(gold), gold);
    expect(s.overall).toBeCloseTo(1, 6);
    expect(s.numericAccuracy).toBeCloseTo(1, 6);
    expect(s.studyRecall).toBeCloseTo(1, 6);
  });
  it('detects a mistranscribed count', () => {
    const bad = clone(gold);
    bad.studies[0].data.ctrlEvents = 9; // was 4
    const s = scoreTopic(bad, gold);
    expect(s.numericAccuracy).toBeLessThan(1);
    expect(s.dataMismatches.length).toBe(1);
  });
  it('detects a dropped study (recall) and an extra study (precision)', () => {
    const bad = clone(gold);
    bad.studies.splice(1, 1); // drop Fraser
    bad.studies.push({ author: 'Ghost', year: 2020, outcomeId: 'mas', data: { kind: '2x2', txEvents: 1, txTotal: 10, ctrlEvents: 2, ctrlTotal: 10 } });
    const s = scoreTopic(bad, gold);
    expect(s.counts.missing).toBe(1);
    expect(s.counts.extra).toBe(1);
    expect(s.studyRecall).toBeLessThan(1);
  });
  it('detects a flipped direction', () => {
    const bad = clone(gold);
    bad.outcomes[0].direction = 'higherIsBetter';
    const s = scoreTopic(bad, gold);
    expect(s.directionAccuracy).toBeLessThan(1);
    expect(s.overall).toBeLessThan(1);
  });
});

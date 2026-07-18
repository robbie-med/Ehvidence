import { describe, it, expect } from 'vitest';
import { rankScore, dedupe, rankCandidates, normal } from './lib/rank.mjs';

const base = { pmid: '1', title: 'A meta-analysis', year: 2024, rcr: 1, citations: 10, oa: false, interventional: false };

describe('rankScore—monotonic in each signal', () => {
  it('rises with RCR', () => {
    expect(rankScore({ ...base, rcr: 8 })).toBeGreaterThan(rankScore({ ...base, rcr: 1 }));
  });
  it('rises with citations', () => {
    expect(rankScore({ ...base, citations: 1000 })).toBeGreaterThan(rankScore({ ...base, citations: 10 }));
  });
  it('rewards recency', () => {
    expect(rankScore({ ...base, year: 2026 })).toBeGreaterThan(rankScore({ ...base, year: 2010 }));
  });
  it('rewards open access and interventional', () => {
    expect(rankScore({ ...base, oa: true })).toBeGreaterThan(rankScore({ ...base, oa: false }));
    expect(rankScore({ ...base, interventional: true })).toBeGreaterThan(
      rankScore({ ...base, interventional: false }),
    );
  });
  it('handles missing/zero signals without NaN', () => {
    expect(Number.isFinite(rankScore({}))).toBe(true);
  });
});

describe('dedupe—against existing topics', () => {
  const existing = [
    { name: 'Statins for primary prevention', studies: [{ doi: '10.1/trial-a' }] },
    { name: 'Vitamin D supplementation for preeclampsia', studies: [] },
  ];

  it('drops a candidate whose title contains an existing topic name', () => {
    const { fresh, skipped } = dedupe(
      [{ pmid: '9', title: 'Vitamin D supplementation for preeclampsia: an updated meta-analysis' }],
      existing,
    );
    expect(fresh).toHaveLength(0);
    expect(skipped).toHaveLength(1);
  });

  it('drops a candidate sharing a study DOI', () => {
    const { fresh } = dedupe([{ pmid: '9', title: 'Totally new title', doi: '10.1/TRIAL-A' }], existing);
    expect(fresh).toHaveLength(0);
  });

  it('keeps a genuinely new candidate', () => {
    const { fresh } = dedupe([{ pmid: '9', title: 'Tranexamic acid for postpartum hemorrhage' }], existing);
    expect(fresh).toHaveLength(1);
  });

  it('dedupes within the candidate batch itself', () => {
    const { fresh } = dedupe(
      [
        { pmid: '1', title: 'Same review title here' },
        { pmid: '2', title: 'Same review title here' },
      ],
      [],
    );
    expect(fresh).toHaveLength(1);
  });
});

describe('rankCandidates—sorted highest-first', () => {
  it('orders by descending score', () => {
    const out = rankCandidates([
      { ...base, pmid: 'lo', rcr: 0.5, citations: 2 },
      { ...base, pmid: 'hi', rcr: 9, citations: 500, oa: true, interventional: true, year: 2026 },
    ]);
    expect(out[0].pmid).toBe('hi');
    expect(out[0].score).toBeGreaterThan(out[1].score);
  });
});

describe('normal', () => {
  it('lowercases and collapses non-alphanumerics', () => {
    expect(normal('Vitamin-D, 2023!')).toBe('vitamin d 2023');
  });
});

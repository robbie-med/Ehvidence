import { describe, it, expect } from 'vitest';
import { normalize, buildSearchDocs, scoreDoc, searchDocs, type SearchDoc } from './searchIndex';
import type { ComputedTopic } from './derive';

function doc(partial: Partial<SearchDoc>): SearchDoc {
  return {
    slug: 'x',
    name: '',
    condition: '',
    intervention: '',
    comparator: '',
    category: '',
    status: 'neutral',
    summary: '',
    terms: [],
    url: '/topics/x',
    ...partial,
  };
}

describe('normalize', () => {
  it('lowercases, splits on non-alphanumerics, drops empties', () => {
    expect(normalize('Vitamin-D, preeclampsia!')).toEqual(['vitamin', 'd', 'preeclampsia']);
  });
  it('returns [] for empty/undefined', () => {
    expect(normalize('')).toEqual([]);
    expect(normalize(undefined as unknown as string)).toEqual([]);
  });
});

describe('scoreDoc—field weighting', () => {
  it('weights a name hit above a summary hit', () => {
    const nameHit = doc({ name: 'statins' });
    const summaryHit = doc({ summary: 'statins' });
    expect(scoreDoc(nameHit, ['statins'])).toBeGreaterThan(scoreDoc(summaryHit, ['statins']));
  });

  it('ranks exact > prefix > substring', () => {
    const exact = doc({ name: 'statin' });
    const prefix = doc({ name: 'statins' });
    const sub = doc({ name: 'rosuvastatin' });
    expect(scoreDoc(exact, ['statin'])).toBeGreaterThan(scoreDoc(prefix, ['statin']));
    expect(scoreDoc(prefix, ['statin'])).toBeGreaterThan(scoreDoc(sub, ['statin']));
  });

  it('is AND-ish: any unmatched token zeroes the doc', () => {
    const d = doc({ name: 'vitamin d', condition: 'preeclampsia' });
    expect(scoreDoc(d, ['vitamin', 'preeclampsia'])).toBeGreaterThan(0);
    expect(scoreDoc(d, ['vitamin', 'melanoma'])).toBe(0);
  });

  it('scores empty query as 0', () => {
    expect(scoreDoc(doc({ name: 'anything' }), [])).toBe(0);
  });
});

describe('searchDocs—ranking and limit', () => {
  const docs = [
    doc({ slug: 'a', name: 'Statins primary prevention', category: 'Cardiology' }),
    doc({ slug: 'b', name: 'Omega-3 cardiovascular', summary: 'statins comparison' }),
    doc({ slug: 'c', name: 'Sunscreen skin cancer' }),
  ];

  it('returns the best match first', () => {
    const out = searchDocs(docs, 'statins');
    expect(out[0].slug).toBe('a');
  });
  it('excludes non-matches', () => {
    expect(searchDocs(docs, 'statins').map((d) => d.slug)).not.toContain('c');
  });
  it('respects the limit', () => {
    expect(searchDocs(docs, 'a', 1).length).toBeLessThanOrEqual(1);
  });
  it('returns [] for an empty query', () => {
    expect(searchDocs(docs, '   ')).toEqual([]);
  });
});

describe('buildSearchDocs', () => {
  it('collects searchTerms, outcome labels and study authors into terms; prefixes base', () => {
    const topic = {
      raw: {
        slug: 'vitamin-d-preeclampsia',
        name: 'Vitamin D for preeclampsia',
        condition: 'preeclampsia',
        intervention: 'vitamin D',
        comparator: 'placebo',
        category: 'Obstetrics',
        summary: 'summary',
        searchTerms: ['cholecalciferol'],
        outcomes: [{ label: 'Preeclampsia incidence' }],
        studies: [{ author: 'Hollis' }],
      },
      status: 'favorable',
    } as unknown as ComputedTopic;
    const [d] = buildSearchDocs([topic], '/base/');
    expect(d.url).toBe('/base/topics/vitamin-d-preeclampsia');
    expect(d.terms).toEqual(expect.arrayContaining(['cholecalciferol', 'Preeclampsia incidence', 'Hollis']));
    expect(scoreDoc(d, normalize('cholecalciferol'))).toBeGreaterThan(0);
  });
});

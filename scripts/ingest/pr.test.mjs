import { describe, it, expect } from 'vitest';
import { renderPrBody } from './lib/pr.mjs';

const ctx = {
  topic: { name: 'Statins for primary prevention', slug: 'statins-primary-prevention' },
  provenance: {
    source: { pmid: '12345678', doi: '10.1/abc', title: 'Statins RCT meta-analysis', oa: true },
    model: 'deepseek-chat',
    usage: { prompt_tokens: 40000, completion_tokens: 3000 },
    costUSD: 0.014,
    extractedAt: '2026-07-18T00:00:00.000Z',
  },
  repro: {
    pass: true,
    outcomes: [
      {
        outcomeId: 'all-cause-mortality',
        measure: 'RR',
        ours: { point: 0.832, ciLow: 0.728, ciHigh: 0.951 },
        reported: { point: 0.86, ciLow: 0.76, ciHigh: 0.97 },
        pointDeltaPct: -3.27,
        withinTol: true,
      },
    ],
  },
  audit: [
    { outcomeId: 'mace', checks: [{ id: 'egger', level: 'warn', label: 'Small-study effects', detail: 'Egger p=0.03' }] },
    { outcomeId: 'mi', checks: [{ id: 'frag', level: 'ok', label: 'Fragility', detail: 'robust' }] },
  ],
  extractedOutcomes: [
    { id: 'mace', label: 'Major adverse cardiac events', k: 12, patients: 60000, pooled: { measure: 'RR', point: 0.663, ciLow: 0.605, ciHigh: 0.728 } },
  ],
};

describe('renderPrBody', () => {
  const body = renderPrBody(ctx);

  it('flags the PR as review-required and never auto-merge', () => {
    expect(body).toMatch(/REVIEW REQUIRED/);
    expect(body).toMatch(/No auto-merge/);
  });

  it('includes the reproduction table with our vs reported', () => {
    expect(body).toMatch(/Reproduction check — ✅ PASS/);
    expect(body).toMatch(/all-cause-mortality/);
    expect(body).toMatch(/0\.832/); // ours
    expect(body).toMatch(/0\.86/); // reported (shown ONLY in the PR body)
  });

  it('surfaces auditor warnings/flags but not oks', () => {
    expect(body).toMatch(/Small-study effects/);
    expect(body).not.toMatch(/Fragility/); // level 'ok' is filtered out
  });

  it('shows provenance with model and cost', () => {
    expect(body).toMatch(/deepseek-chat/);
    expect(body).toMatch(/\$0\.014/);
  });

  it('renders a FAIL header when the gate fails', () => {
    const failBody = renderPrBody({ ...ctx, repro: { pass: false, outcomes: ctx.repro.outcomes } });
    expect(failBody).toMatch(/Reproduction check — ❌ FAIL/);
  });
});

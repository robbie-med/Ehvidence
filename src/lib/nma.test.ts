import { describe, it, expect } from 'vitest';
import { matInv, fitNMA, type Contrast } from './nma';

describe('matInv', () => {
  it('inverts a known 2x2', () => {
    const inv = matInv([[4, 7], [2, 6]]);
    expect(inv[0][0]).toBeCloseTo(0.6, 6);
    expect(inv[0][1]).toBeCloseTo(-0.7, 6);
    expect(inv[1][0]).toBeCloseTo(-0.2, 6);
    expect(inv[1][1]).toBeCloseTo(0.4, 6);
  });
  it('throws on a singular matrix', () => {
    expect(() => matInv([[1, 2], [2, 4]])).toThrow();
  });
});

describe('fitNMA — star network', () => {
  // Three actives vs a common Control; effects RR 0.5, 0.8, 0.9.
  const contrasts: Contrast[] = [
    { t: 'A', c: 'Control', y: Math.log(0.5), v: 0.01 },
    { t: 'B', c: 'Control', y: Math.log(0.8), v: 0.01 },
    { t: 'C', c: 'Control', y: Math.log(0.9), v: 0.01 },
  ];
  const r = fitNMA(contrasts, 'lowerIsBetter')!;

  it('picks the common comparator as reference and is connected', () => {
    expect(r.reference).toBe('Control');
    expect(r.connected).toBe(true);
    expect(r.tau2).toBeCloseTo(0, 6); // df = 0 in a star
  });
  it('recovers the direct effects vs reference', () => {
    expect(r.vsReference['A'].effect).toBeCloseTo(0.5, 4);
    expect(r.vsReference['B'].effect).toBeCloseTo(0.8, 4);
  });
  it('produces the correct indirect active-vs-active comparison', () => {
    const ab = r.league.find((p) => p.a === 'A' && p.b === 'B')!;
    expect(ab.effect).toBeCloseTo(0.5 / 0.8, 3); // 0.625
    expect(ab.se).toBeCloseTo(Math.sqrt(0.02), 4);
  });
  it('ranks the most protective treatment first (lower is better)', () => {
    expect(r.pScores[0].node).toBe('A');
    expect(r.pScores[r.pScores.length - 1].node).toBe('Control');
    // P-scores are probabilities in [0,1].
    for (const s of r.pScores) {
      expect(s.pScore).toBeGreaterThanOrEqual(0);
      expect(s.pScore).toBeLessThanOrEqual(1);
    }
  });
});

describe('fitNMA — network with a closed loop', () => {
  const contrasts: Contrast[] = [
    { t: 'A', c: 'Control', y: Math.log(0.5), v: 0.02 },
    { t: 'B', c: 'Control', y: Math.log(0.7), v: 0.02 },
    { t: 'A', c: 'B', y: Math.log(0.7), v: 0.03 }, // direct A vs B closing the loop
  ];
  it('fits with df>0 and returns a consistent estimate', () => {
    const r = fitNMA(contrasts, 'lowerIsBetter')!;
    expect(r.connected).toBe(true);
    expect(r.nodes).toContain('A');
    // A should still rank best.
    expect(r.pScores[0].node).toBe('A');
    expect(Number.isFinite(r.tau2)).toBe(true);
  });
});

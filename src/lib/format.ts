/** Number / percent / CI formatting helpers shared across pages and the GUI. */

/** Format a risk ratio to 2 significant-ish decimals (e.g. 0.29, 1.80). */
export function fmtRR(x: number): string {
  if (!Number.isFinite(x)) return '—';
  if (x >= 10) return x.toFixed(1);
  return x.toFixed(2);
}

/** Format a 95% CI as "0.18–0.47". */
export function fmtCI(low: number, high: number): string {
  return `${fmtRR(low)}–${fmtRR(high)}`;
}

/** Format a percentage with no decimals and an explicit sign-free magnitude. */
export function fmtPct(x: number): string {
  if (!Number.isFinite(x)) return '—';
  return `${Math.round(x)}%`;
}

/** "lower" / "higher" wording from a % improvement value. */
export function riskWord(improvementPct: number): 'lower' | 'higher' {
  return improvementPct >= 0 ? 'lower' : 'higher';
}

/** Format an NNT / NNH integer, or a dash when not computable. */
export function fmtNN(n: number | null): string {
  return n === null ? '—' : String(n);
}

/** Group thousands, e.g. 12300 -> "12,300". */
export function fmtInt(n: number): string {
  return n.toLocaleString('en-US');
}

/** Human label for the evidence status badge. */
export function statusLabel(status: string): string {
  switch (status) {
    case 'favorable':
      return 'Favorable';
    case 'harmful':
      return 'Harmful';
    case 'limited':
      return 'Limited data';
    default:
      return 'Inconclusive';
  }
}

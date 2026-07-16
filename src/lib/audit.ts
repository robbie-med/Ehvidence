/**
 * audit.ts—the methods auditor. A uniform credibility layer computed the same
 * way for every topic: fragility, e-value, small-study effects, leave-one-out,
 * fixed-vs-random divergence, single-study dominance and heterogeneity sanity.
 *
 * This is analysis the source papers usually do NOT contain. Every check is a
 * pure function; `auditOutcome` runs the applicable ones for a computed outcome
 * and returns uniform rows the UI renders as green/amber/red.
 */
import {
  poolRandomEffects,
  type StudyData,
  type PoolDiagnostics,
} from './stats';
import type { ComputedOutcome } from './derive';

export type AuditLevel = 'ok' | 'warn' | 'flag' | 'info';

export interface AuditCheck {
  id: string;
  label: string;
  level: AuditLevel;
  /** One-line, plain-language explanation. */
  detail: string;
  /** Optional headline number for the chip. */
  value?: string;
}

/* ------------------------------------------------------------------ */
/* Individual checks (each independently testable)                     */
/* ------------------------------------------------------------------ */

/**
 * VanderWeele–Ding E-value: how strong an unmeasured confounder (associated
 * with both exposure and outcome by this risk ratio) would need to be to fully
 * explain the observed effect. Larger = more robust. Uses the point estimate;
 * `bound` gives the E-value for the CI limit nearest the null (1 if the CI
 * crosses 1).
 */
export function evalue(rr: number, ciLow: number, ciHigh: number): { point: number; bound: number } {
  const e = (x: number): number => {
    if (!Number.isFinite(x) || x <= 0) return 1;
    const s = x >= 1 ? x : 1 / x;
    return s + Math.sqrt(s * (s - 1));
  };
  // CI bound closest to the null (1); if the interval spans 1, the bound E is 1.
  let bound = 1;
  if (ciLow > 1) bound = e(ciLow);
  else if (ciHigh < 1) bound = e(ciHigh);
  return { point: e(rr), bound };
}

/**
 * Egger's test for small-study effects / funnel asymmetry: OLS regression of the
 * standard normal deviate (y/se) on precision (1/se); a non-zero intercept
 * indicates asymmetry. Returns the intercept and a two-sided p (normal
 * approximation). Needs k ≥ 3.
 */
export function eggerTest(ys: number[], ses: number[]): { intercept: number; p: number } | null {
  const n = ys.length;
  if (n < 3) return null;
  const z = ys.map((y, i) => y / ses[i]); // standard normal deviate
  const x = ses.map((s) => 1 / s); // precision
  const mx = mean(x);
  const mz = mean(z);
  let sxx = 0;
  let sxz = 0;
  for (let i = 0; i < n; i++) {
    sxx += (x[i] - mx) ** 2;
    sxz += (x[i] - mx) * (z[i] - mz);
  }
  if (sxx === 0) return null;
  const slope = sxz / sxx;
  const intercept = mz - slope * mx;
  // Residual variance → SE of the intercept.
  let sse = 0;
  for (let i = 0; i < n; i++) {
    const fit = intercept + slope * x[i];
    sse += (z[i] - fit) ** 2;
  }
  const s2 = sse / (n - 2);
  const seIntercept = Math.sqrt(s2 * (1 / n + (mx * mx) / sxx));
  const t = seIntercept > 0 ? intercept / seIntercept : 0;
  const p = 2 * (1 - normalCdf(Math.abs(t)));
  return { intercept, p };
}

/**
 * Meta-analytic fragility (approximate): the number of extra events that would
 * have to appear in the treatment arm before the pooled 95% CI stops excluding
 * the null. Only defined when every study carries raw 2×2 counts and the pooled
 * effect is significant. Events are added greedily to the highest-weight study
 * with room. Returns null when not applicable.
 */
export function metaFragility(
  data2x2: Extract<StudyData, { kind: '2x2' }>[],
  weights: number[],
): number | null {
  const base = poolRandomEffects(data2x2);
  if (!base) return null;
  const sig = base.pooled.ciHigh < 1 || base.pooled.ciLow > 1;
  if (!sig) return null; // already non-significant; fragility is 0/undefined

  // Work on a mutable copy; each flip adds one event to whichever arm pushes the
  // pooled estimate toward the null (RR<1 → add to tx; RR>1 → add to ctrl).
  const beneficial = base.pooled.rr < 1;
  const tables = data2x2.map((d) => ({ ...d }));
  const order = weights
    .map((w, i) => ({ w, i }))
    .sort((a, b) => b.w - a.w)
    .map((o) => o.i);

  const CAP = 100000;
  let flips = 0;
  for (let guard = 0; guard < CAP; guard++) {
    // Pick the highest-weight study with room to add the toward-null event.
    let target = -1;
    for (const i of order) {
      const t = tables[i];
      if (beneficial ? t.txEvents < t.txTotal : t.ctrlEvents < t.ctrlTotal) {
        target = i;
        break;
      }
    }
    if (target === -1) return null; // ran out of room without losing significance
    if (beneficial) tables[target].txEvents += 1;
    else tables[target].ctrlEvents += 1;
    flips += 1;
    const p = poolRandomEffects(tables);
    if (!p) return null;
    if (!(p.pooled.ciHigh < 1 || p.pooled.ciLow > 1)) return flips;
  }
  return null;
}

/* ------------------------------------------------------------------ */
/* Orchestrator                                                        */
/* ------------------------------------------------------------------ */

/** Run every applicable check for a computed outcome. */
export function auditOutcome(o: ComputedOutcome): AuditCheck[] {
  const checks: AuditCheck[] = [];
  const diag = o.diagnostics;
  if (!diag) return checks;

  // --- single-study dominance ---
  const maxW = Math.max(0, ...diag.perStudy.map((s) => s.wRandomPct));
  if (diag.perStudy.length > 1) {
    checks.push({
      id: 'dominance',
      label: 'Single-study dominance',
      value: `${Math.round(maxW * 100)}%`,
      level: maxW > 0.5 ? 'flag' : maxW > 0.35 ? 'warn' : 'ok',
      detail:
        maxW > 0.5
          ? `One study carries ${Math.round(maxW * 100)}% of the weight—the pooled estimate largely reflects that single trial.`
          : `No single study dominates; the largest carries ${Math.round(maxW * 100)}% of the weight.`,
    });
  }

  // --- fixed vs random divergence ---
  const fr = diag.ratioScale
    ? Math.abs(Math.log(diag.fixed.est) - Math.log(diag.random.est))
    : Math.abs(diag.fixed.est - diag.random.est) / (Math.abs(diag.random.est) || 1);
  checks.push({
    id: 'fixed-random',
    label: 'Fixed vs random effects',
    value: fmtEst(diag.fixed.est, diag.ratioScale) + ' / ' + fmtEst(diag.random.est, diag.ratioScale),
    level: fr > 0.18 ? 'flag' : fr > 0.08 ? 'warn' : 'ok',
    detail:
      fr > 0.18
        ? `The two models disagree materially (fixed ${fmtEst(diag.fixed.est, diag.ratioScale)} vs random ${fmtEst(diag.random.est, diag.ratioScale)})—usually a sign one precise study dominates a heterogeneous set.`
        : `Fixed- and random-effects estimates agree closely.`,
  });

  // --- heterogeneity sanity ---
  const nonOverlap = hasNonOverlappingCIs(diag);
  checks.push({
    id: 'heterogeneity',
    label: 'Heterogeneity',
    value: `I² ${Math.round(diag.i2)}%`,
    level: nonOverlap && diag.i2 < 40 ? 'flag' : diag.i2 > 60 ? 'warn' : 'ok',
    detail:
      nonOverlap && diag.i2 < 40
        ? `Some studies' confidence intervals do not overlap, yet I² is only ${Math.round(diag.i2)}%—the reported homogeneity understates real disagreement between studies.`
        : diag.i2 > 60
        ? `Substantial heterogeneity (I² ${Math.round(diag.i2)}%): studies disagree, so pool with caution.`
        : `Heterogeneity is low to moderate (I² ${Math.round(diag.i2)}%).`,
  });

  // --- small-study effects (Egger) ---
  const usable = diag.perStudy.filter((s) => s.se > 0);
  const egger = eggerTest(usable.map((s) => s.y), usable.map((s) => s.se));
  if (egger) {
    checks.push({
      id: 'egger',
      label: 'Small-study effects (Egger)',
      value: `p ${fmtP(egger.p)}`,
      level: egger.p < 0.05 ? 'flag' : egger.p < 0.1 ? 'warn' : 'ok',
      detail:
        egger.p < 0.1
          ? `Funnel-plot asymmetry (Egger p ${fmtP(egger.p)}) suggests small-study effects or possible publication bias.`
          : `No significant funnel asymmetry (Egger p ${fmtP(egger.p)}).`,
    });
  }

  // --- binary-only checks: e-value + fragility ---
  if (o.kind === 'binary' && o.pooled) {
    if (o.outcome.direction && diag.ratioScale) {
      const ev = evalue(o.pooled.rr, o.pooled.ciLow, o.pooled.ciHigh);
      checks.push({
        id: 'evalue',
        label: 'E-value (confounding robustness)',
        value: ev.bound > 1 ? `${ev.point.toFixed(2)} (CI ${ev.bound.toFixed(2)})` : ev.point.toFixed(2),
        level: 'info',
        detail:
          ev.bound > 1
            ? `An unmeasured confounder would need a risk ratio of ${ev.point.toFixed(2)} with both exposure and outcome to explain the point estimate away (${ev.bound.toFixed(2)} to move the CI to the null).`
            : `The confidence interval already includes the null, so no confounding is required to explain a null result.`,
      });
    }

    const raw2x2 = o.studies
      .filter((s) => !s.excludeFromPooled && s.data.kind === '2x2')
      .map((s) => s.data as Extract<StudyData, { kind: '2x2' }>);
    const allRaw = o.studies.filter((s) => !s.excludeFromPooled).every((s) => s.data.kind === '2x2');
    if (allRaw && raw2x2.length > 0) {
      const weights = o.studies
        .filter((s) => !s.excludeFromPooled && s.data.kind === '2x2')
        .map((s) => s.weightPct);
      const fi = metaFragility(raw2x2, weights);
      if (fi !== null) {
        const totalEvents = o.pooled.totalEvents || 0;
        const fq = totalEvents > 0 ? fi / totalEvents : 0;
        checks.push({
          id: 'fragility',
          label: 'Fragility',
          value: `${fi} event${fi === 1 ? '' : 's'}`,
          level: fi <= 5 ? 'flag' : fi <= 15 ? 'warn' : 'ok',
          detail: `Adding just ${fi} more event${fi === 1 ? '' : 's'} to the treatment arm would make the pooled result non-significant (fragility quotient ${(fq * 100).toFixed(1)}% of all events).`,
        });
      }
    }
  }

  return checks;
}

/** Leave-one-out: re-pool dropping each poolable binary study; returns the swing. */
export function leaveOneOut(
  data2x2: StudyData[],
): { min: number; max: number; base: number } | null {
  const base = poolRandomEffects(data2x2);
  if (!base || data2x2.length < 3) return null;
  const ests: number[] = [];
  for (let i = 0; i < data2x2.length; i++) {
    const subset = data2x2.filter((_, j) => j !== i);
    const p = poolRandomEffects(subset);
    if (p) ests.push(p.pooled.rr);
  }
  return { min: Math.min(...ests), max: Math.max(...ests), base: base.pooled.rr };
}

/* ------------------------------------------------------------------ */
/* helpers                                                             */
/* ------------------------------------------------------------------ */

function hasNonOverlappingCIs(diag: PoolDiagnostics): boolean {
  const z = 1.959964;
  const rows = diag.perStudy
    .filter((s) => s.se > 0)
    .map((s) => ({ lo: s.y - z * s.se, hi: s.y + z * s.se }));
  for (let i = 0; i < rows.length; i++) {
    for (let j = i + 1; j < rows.length; j++) {
      if (rows[i].hi < rows[j].lo || rows[j].hi < rows[i].lo) return true;
    }
  }
  return false;
}

function mean(xs: number[]): number {
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}

/** Abramowitz–Stegun normal CDF approximation. */
function normalCdf(x: number): number {
  const t = 1 / (1 + 0.2316419 * Math.abs(x));
  const d = 0.3989423 * Math.exp((-x * x) / 2);
  const p =
    d * t * (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274))));
  return x > 0 ? 1 - p : p;
}

function fmtEst(x: number, ratio: boolean): string {
  return ratio ? x.toFixed(2) : (x >= 0 ? '+' : '') + x.toFixed(2);
}
function fmtP(p: number): string {
  return p < 0.001 ? '<0.001' : p.toFixed(3);
}

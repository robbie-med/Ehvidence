/**
 * living.ts—keeps an estimate current instead of frozen at publication. Cumulative
 * meta-analysis (how the pooled estimate evolved as trials accrued), a full
 * O'Brien–Fleming alpha-spending trial-sequential analysis (has the evidence
 * crossed the monitoring boundary, or is it still underpowered), the smallest
 * next trial that would overturn the result, and simple evidence-currency.
 *
 * Everything is computed from the constituent data with the shared engine, so a
 * static review can't do it but a recompute engine can.
 */
import { poolRandomEffects, poolControlRisk, type StudyData } from './stats';

const Z_95 = 1.959964;

/** Inverse standard normal CDF (Acklam's rational approximation). */
export function normInv(p: number): number {
  if (p <= 0) return -Infinity;
  if (p >= 1) return Infinity;
  const a = [-3.969683028665376e1, 2.209460984245205e2, -2.759285104469687e2, 1.38357751867269e2, -3.066479806614716e1, 2.506628277459239];
  const b = [-5.447609879822406e1, 1.615858368580409e2, -1.556989798598866e2, 6.680131188771972e1, -1.328068155288572e1];
  const c = [-7.784894002430293e-3, -3.223964580411365e-1, -2.400758277161838, -2.549732539343734, 4.374664141464968, 2.938163982698783];
  const d = [7.784695709041462e-3, 3.224671290700398e-1, 2.445134137142996, 3.754408661907416];
  const pl = 0.02425;
  let q: number;
  let r: number;
  if (p < pl) {
    q = Math.sqrt(-2 * Math.log(p));
    return (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
  }
  if (p <= 1 - pl) {
    q = p - 0.5;
    r = q * q;
    return (((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q / (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1);
  }
  q = Math.sqrt(-2 * Math.log(1 - p));
  return -(((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
}

export interface YearedStudy {
  data: StudyData;
  year: number;
  patients: number;
}

export interface CumulativePoint {
  year: number;
  k: number;
  rr: number;
  ciLow: number;
  ciHigh: number;
  patients: number;
}

/** Cumulative random-effects meta-analysis: pool each year-ordered prefix. */
export function cumulativeMeta(studies: YearedStudy[]): CumulativePoint[] {
  const sorted = [...studies].sort((a, b) => a.year - b.year);
  const out: CumulativePoint[] = [];
  let patients = 0;
  for (let k = 1; k <= sorted.length; k++) {
    const prefix = sorted.slice(0, k);
    patients += sorted[k - 1].patients;
    const pooled = poolRandomEffects(prefix.map((s) => s.data));
    if (!pooled) continue;
    out.push({
      year: sorted[k - 1].year,
      k,
      rr: pooled.pooled.rr,
      ciLow: pooled.pooled.ciLow,
      ciHigh: pooled.pooled.ciHigh,
      patients,
    });
  }
  return out;
}

export interface TSAPoint {
  year: number;
  k: number;
  patients: number;
  infoFrac: number;
  z: number;
  boundary: number;
}

export interface TSAResult {
  risPatients: number;
  d2: number;
  targetRRR: number;
  alpha: number;
  power: number;
  controlRisk: number;
  points: TSAPoint[];
  /** True once the cumulative z-curve crosses the benefit monitoring boundary. */
  crossedBenefit: boolean;
  /** Cumulative patients as a fraction of the (heterogeneity-adjusted) RIS. */
  reached: number;
}

/**
 * Diversity-adjusted required information size (patients): the sample a trial
 * would need to detect `targetRRR` at `alpha`/`power`, inflated for
 * between-study heterogeneity (diversity D²).
 */
export function requiredInfoSize(
  controlRisk: number,
  targetRRR: number,
  alpha: number,
  power: number,
  d2: number,
): number {
  const zA = normInv(1 - alpha / 2);
  const zB = normInv(power);
  const pc = controlRisk;
  const pt = pc * (1 - targetRRR);
  const denom = (pc - pt) ** 2;
  if (denom <= 0) return Infinity;
  const nPerGroup = ((zA + zB) ** 2 * (pc * (1 - pc) + pt * (1 - pt))) / denom;
  const risFixed = 2 * nPerGroup;
  return d2 < 1 ? risFixed / (1 - d2) : Infinity;
}

/**
 * Full O'Brien–Fleming alpha-spending trial-sequential analysis for a binary
 * outcome. Returns the cumulative z-curve, the monitoring boundary at each
 * information fraction, and the diversity-adjusted required information size.
 * Null when the outcome lacks a recoverable control risk.
 */
export function trialSequential(
  studies: YearedStudy[],
  opts: { alpha?: number; power?: number; targetRRR?: number } = {},
): TSAResult | null {
  const alpha = opts.alpha ?? 0.05;
  const power = opts.power ?? 0.9;
  const all = studies.map((s) => s.data);
  const full = poolRandomEffects(all);
  const pc = poolControlRisk(all);
  if (!full || pc === null || pc <= 0 || pc >= 1) return null;

  const targetRRR = opts.targetRRR ?? Math.abs(1 - full.pooled.rr);
  if (targetRRR <= 0) return null;

  // Diversity D² = tau² / (tau² + s²), s² = harmonic-mean within-study variance.
  const vs = full.diagnostics.perStudy.map((s) => s.v).filter((v) => v > 0 && Number.isFinite(v));
  const s2 = vs.length > 0 ? vs.length / vs.reduce((a, v) => a + 1 / v, 0) : 0;
  const tau2 = full.diagnostics.tau2;
  const d2 = tau2 + s2 > 0 ? tau2 / (tau2 + s2) : 0;

  const ris = requiredInfoSize(pc, targetRRR, alpha, power, d2);
  const zA = normInv(1 - alpha / 2);

  const cum = cumulativeMeta(studies);
  let crossedBenefit = false;
  const points: TSAPoint[] = cum.map((c) => {
    const pooled = poolRandomEffects(
      [...studies].sort((a, b) => a.year - b.year).slice(0, c.k).map((s) => s.data),
    )!;
    const logEst = pooled.diagnostics.random.logEst;
    const se = pooled.diagnostics.random.se;
    const z = se > 0 ? logEst / se : 0;
    const infoFrac = Number.isFinite(ris) && ris > 0 ? Math.min(1.5, c.patients / ris) : 0;
    // O'Brien–Fleming boundary on the z-scale: high early, → z_{α/2} at t=1.
    const boundary = infoFrac > 0 ? zA / Math.sqrt(infoFrac) : Infinity;
    if (Math.abs(z) >= boundary && infoFrac > 0.01) crossedBenefit = true;
    return { year: c.year, k: c.k, patients: c.patients, infoFrac, z, boundary };
  });

  const reached = Number.isFinite(ris) && ris > 0 ? cum[cum.length - 1].patients / ris : 0;
  return { risPatients: ris, d2, targetRRR, alpha, power, controlRisk: pc, points, crossedBenefit, reached };
}

/**
 * The smallest single future trial (assumed null) whose inclusion would move the
 * pooled estimate's CI back across the null. Returns total participants, or null
 * when the current estimate is already non-significant or has no control risk.
 */
export function flipTrial(items: StudyData[]): { patients: number } | null {
  const pooled = poolRandomEffects(items);
  const pc = poolControlRisk(items);
  if (!pooled || pc === null || pc <= 0 || pc >= 1) return null;
  const significant = pooled.pooled.ciHigh < 1 || pooled.pooled.ciLow > 1;
  if (!significant) return null;

  const y = pooled.diagnostics.random.logEst;
  const se = pooled.diagnostics.random.se;
  const W = 1 / (se * se); // current precision
  // A null study (y=0) with precision w pulls the pooled toward 0. The pool
  // becomes non-significant once |W·y|/(W+w) < z/√(W+w), i.e. w > W(W·y²−z²)/z².
  const wNeeded = (W * (W * y * y - Z_95 * Z_95)) / (Z_95 * Z_95);
  if (wNeeded <= 0) return null;
  // Convert precision to a two-arm sample size at a null effect: for equal-risk
  // arms, var(logRR) ≈ 2(1−pc)/(n·pc) per arm → n_arm = 2(1−pc)·w / pc.
  const nArm = (2 * (1 - pc) * wNeeded) / pc;
  return { patients: Math.ceil(2 * nArm) };
}

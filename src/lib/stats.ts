/**
 * stats.ts—the statistical engine shared by the build-time page renderer
 * and the client-side data-entry GUI. Pure functions, no framework imports,
 * so the numbers shown in the GUI are guaranteed identical to the rendered pages.
 *
 * Conventions: a 2x2 table describes a treatment arm (a events of n1) and a
 * control arm (c events of n2). Effects are expressed as a risk ratio (RR)
 * where RR < 1 favors treatment for a "lower is better" outcome.
 */

/** 97.5th percentile of the standard normal—the z multiplier for a 95% CI. */
export const Z_95 = 1.959964;

export type EffectMeasure = 'RR' | 'OR' | 'HR';

/** Raw 2x2 contingency data as authored in a study record. */
export interface TwoByTwo {
  kind: '2x2';
  txEvents: number;
  txTotal: number;
  ctrlEvents: number;
  ctrlTotal: number;
}

/** A precomputed effect estimate for studies that only publish RR/OR/HR + CI. */
export interface PrecomputedEffect {
  kind: 'effect';
  measure: EffectMeasure;
  point: number;
  ciLow: number;
  ciHigh: number;
  /** Baseline (control) risk, if reported—enables an NNT back-calculation. */
  ctrlRisk?: number;
}

export type StudyData = TwoByTwo | PrecomputedEffect;

/** A single study's computed effect, on both the natural and log scale. */
export interface EffectResult {
  /** Effect measure being reported. RR for 2x2 tables. */
  measure: EffectMeasure;
  /** Point estimate (e.g. RR). */
  rr: number;
  ciLow: number;
  ciHigh: number;
  /** Natural log of the point estimate—used for pooling. */
  logEffect: number;
  /** Standard error of the log effect—used for pooling weights. */
  seLog: number;
  /** % improvement = (1 - RR) * 100. Positive means lower risk than control. */
  improvementPct: number;
  /** Absolute risk reduction (control risk − treatment risk), if computable. */
  arr: number | null;
  /** Number needed to treat = 1/ARR (rounded up), if ARR > 0. */
  nnt: number | null;
  /** Number needed to harm = 1/ARI (rounded up), if treatment increases risk. */
  nnh: number | null;
  /** True if a continuity correction was applied (a zero cell was present). */
  continuityCorrected: boolean;
  /** True for OR/HR effects that are treated as RR-like approximations. */
  approximate: boolean;
}

export interface PooledResult {
  /** Number of studies pooled. */
  k: number;
  rr: number;
  ciLow: number;
  ciHigh: number;
  improvementPct: number;
  /** Cochran's Q heterogeneity statistic. */
  q: number;
  /** Between-study variance (DerSimonian–Laird). */
  tau2: number;
  /** I² heterogeneity percentage (0–100). */
  i2: number;
  /** Pooled NNT from the weighted pooled control risk, if computable. */
  nnt: number | null;
  /** Pooled NNH (also the NNT for a "higher is better" outcome). */
  nnh: number | null;
  /** Total patients across pooled studies (sum of both arms). */
  totalPatients: number;
  /** Total events across pooled studies (both arms). */
  totalEvents: number;
}

/** Per-study contribution to a pooled estimate, including plot weight. */
export interface WeightedEffect {
  effect: EffectResult;
  /** Random-effects weight w* = 1/(v + tau²). */
  weight: number;
  /** Normalized weight in [0,1] for marker sizing in the forest plot. */
  weightPct: number;
}

function isTwoByTwo(d: StudyData): d is TwoByTwo {
  return d.kind === '2x2';
}

/**
 * Compute the effect (RR, CI, % improvement, NNT/NNH) for one study.
 * For 2x2 data: RR with a Katz log-RR variance, Haldane–Anscombe continuity
 * correction for zero cells, and ARR-derived NNT/NNH from the *uncorrected*
 * risks. For precomputed effects: the supplied point/CI, with NNT only when a
 * control risk is provided.
 */
export function computeEffect(data: StudyData): EffectResult {
  if (isTwoByTwo(data)) {
    return effectFrom2x2(data);
  }
  return effectFromPrecomputed(data);
}

function effectFrom2x2(d: TwoByTwo): EffectResult {
  const { txEvents: a, txTotal: n1, ctrlEvents: c, ctrlTotal: n2 } = d;

  // Uncorrected risks drive the displayed risk difference / NNT.
  const p1 = a / n1;
  const p2 = c / n2;

  // Haldane–Anscombe correction when any cell of the 2x2 is empty.
  const hasZeroCell = a === 0 || c === 0 || n1 - a === 0 || n2 - c === 0;
  const aC = hasZeroCell ? a + 0.5 : a;
  const cC = hasZeroCell ? c + 0.5 : c;
  const n1C = hasZeroCell ? n1 + 1 : n1;
  const n2C = hasZeroCell ? n2 + 1 : n2;

  const rr = hasZeroCell ? (aC / n1C) / (cC / n2C) : p1 / p2;
  const logEffect = Math.log(rr);

  // Katz log-RR variance.
  const varLog = 1 / aC - 1 / n1C + 1 / cC - 1 / n2C;
  const seLog = Math.sqrt(varLog);

  const ciLow = Math.exp(logEffect - Z_95 * seLog);
  const ciHigh = Math.exp(logEffect + Z_95 * seLog);
  const improvementPct = (1 - rr) * 100;

  // Absolute risk reduction / increase from the uncorrected risks.
  const arr = p2 - p1; // > 0 => benefit
  let nnt: number | null = null;
  let nnh: number | null = null;
  if (arr > 0) nnt = Math.ceil(1 / arr);
  else if (arr < 0) nnh = Math.ceil(1 / -arr);

  return {
    measure: 'RR',
    rr,
    ciLow,
    ciHigh,
    logEffect,
    seLog,
    improvementPct,
    arr,
    nnt,
    nnh,
    continuityCorrected: hasZeroCell,
    approximate: false,
  };
}

function effectFromPrecomputed(d: PrecomputedEffect): EffectResult {
  const rr = d.point;
  const logEffect = Math.log(rr);
  // Recover SE from the reported CI width on the log scale.
  const seLog = (Math.log(d.ciHigh) - Math.log(d.ciLow)) / (2 * Z_95);
  const improvementPct = (1 - rr) * 100;

  let arr: number | null = null;
  let nnt: number | null = null;
  let nnh: number | null = null;
  if (typeof d.ctrlRisk === 'number') {
    arr = d.ctrlRisk * (1 - rr); // ctrlRisk - txRisk, where txRisk = ctrlRisk*rr
    if (arr > 0) nnt = Math.ceil(1 / arr);
    else if (arr < 0) nnh = Math.ceil(1 / -arr);
  }

  return {
    measure: d.measure,
    rr,
    ciLow: d.ciLow,
    ciHigh: d.ciHigh,
    logEffect,
    seLog,
    improvementPct,
    arr,
    nnt,
    nnh,
    continuityCorrected: false,
    approximate: d.measure !== 'RR',
  };
}

/**
 * Pool a set of studies with a DerSimonian–Laird random-effects model on the
 * log scale. Returns null when there are no poolable studies.
 *
 * @param items study data objects to pool (already filtered to one outcome).
 */
export function poolRandomEffects(items: StudyData[]): {
  pooled: PooledResult;
  weighted: WeightedEffect[];
} | null {
  if (items.length === 0) return null;

  const effects = items.map(computeEffect);
  const ys = effects.map((e) => e.logEffect);
  const vs = effects.map((e) => e.seLog * e.seLog);

  // Drop degenerate studies (zero variance / non-finite) from the pool.
  const valid = effects
    .map((e, i) => ({ e, y: ys[i], v: vs[i] }))
    .filter((x) => Number.isFinite(x.y) && Number.isFinite(x.v) && x.v > 0);

  if (valid.length === 0) return null;

  const wFixed = valid.map((x) => 1 / x.v);
  const sumW = sum(wFixed);
  const sumWy = sum(valid.map((x, i) => wFixed[i] * x.y));
  const yFixed = sumWy / sumW;

  // Cochran's Q and DerSimonian–Laird tau².
  const q = sum(valid.map((x, i) => wFixed[i] * (x.y - yFixed) ** 2));
  const df = valid.length - 1;
  const sumW2 = sum(wFixed.map((w) => w * w));
  const c = sumW - sumW2 / sumW; // scaling constant
  const tau2 = c > 0 ? Math.max(0, (q - df) / c) : 0;
  const i2 = q > 0 ? Math.max(0, ((q - df) / q) * 100) : 0;

  // Random-effects weights and pooled estimate.
  const wRandom = valid.map((x) => 1 / (x.v + tau2));
  const sumWr = sum(wRandom);
  const yRandom = sum(valid.map((x, i) => wRandom[i] * x.y)) / sumWr;
  const seRandom = Math.sqrt(1 / sumWr);

  const rr = Math.exp(yRandom);
  const ciLow = Math.exp(yRandom - Z_95 * seRandom);
  const ciHigh = Math.exp(yRandom + Z_95 * seRandom);

  // Map random-effects weights back onto every input study (degenerate ones get 0).
  let vi = 0;
  const weighted: WeightedEffect[] = effects.map((e) => {
    const v = e.seLog * e.seLog;
    const usable = Number.isFinite(e.logEffect) && Number.isFinite(v) && v > 0;
    const weight = usable ? 1 / (v + tau2) : 0;
    if (usable) vi += weight;
    return { effect: e, weight, weightPct: 0 };
  });
  for (const w of weighted) w.weightPct = vi > 0 ? w.weight / vi : 0;

  // Pooled NNT/NNH from a pooled control risk (2x2 events, else mean of
  // reported control risks). For a "higher is better" outcome the engine is
  // run with the good event as the "event", so ARR is negative and the
  // meaningful number-needed-to-treat surfaces as nnh (the display layer
  // relabels it based on the outcome direction).
  const { pooledCtrlRisk, totalPatients, totalEvents } = aggregateControlRisk(items);
  let nnt: number | null = null;
  let nnh: number | null = null;
  if (pooledCtrlRisk !== null) {
    const arr = pooledCtrlRisk * (1 - rr);
    if (arr > 0) nnt = Math.ceil(1 / arr);
    else if (arr < 0) nnh = Math.ceil(1 / -arr);
  }

  return {
    pooled: {
      k: valid.length,
      rr,
      ciLow,
      ciHigh,
      improvementPct: (1 - rr) * 100,
      q,
      tau2,
      i2,
      nnt,
      nnh,
      totalPatients,
      totalEvents,
    },
    weighted,
  };
}

/**
 * Pooled control risk and patient/event totals. Prefers a sample-size-weighted
 * control risk pooled from any 2x2 tables; if there are none, falls back to the
 * mean of control risks reported on precomputed effects (so an NNT can still be
 * shown for rare-outcome topics built entirely from reported effect sizes).
 */
function aggregateControlRisk(items: StudyData[]): {
  pooledCtrlRisk: number | null;
  totalPatients: number;
  totalEvents: number;
} {
  let ctrlEvents = 0;
  let ctrlTotal = 0;
  let totalPatients = 0;
  let totalEvents = 0;
  let any2x2 = false;
  const reportedRisks: number[] = [];
  for (const d of items) {
    if (isTwoByTwo(d)) {
      any2x2 = true;
      ctrlEvents += d.ctrlEvents;
      ctrlTotal += d.ctrlTotal;
      totalPatients += d.txTotal + d.ctrlTotal;
      totalEvents += d.txEvents + d.ctrlEvents;
    } else if (typeof d.ctrlRisk === 'number') {
      reportedRisks.push(d.ctrlRisk);
    }
  }
  let pooledCtrlRisk: number | null = null;
  if (any2x2 && ctrlTotal > 0) {
    pooledCtrlRisk = ctrlEvents / ctrlTotal;
  } else if (reportedRisks.length > 0) {
    pooledCtrlRisk = reportedRisks.reduce((a, b) => a + b, 0) / reportedRisks.length;
  }
  return { pooledCtrlRisk, totalPatients, totalEvents };
}

function sum(xs: number[]): number {
  return xs.reduce((acc, x) => acc + x, 0);
}

export type EvidenceStatus = 'favorable' | 'harmful' | 'limited' | 'neutral';

/**
 * Derive an evidence status from a pooled result, using a simple green/red/gray
 * convention. `direction` flips the orientation for outcomes where higher is better.
 */
export function deriveStatus(
  pooled: PooledResult | null,
  direction: 'lowerIsBetter' | 'higherIsBetter',
  minStudies = 3,
  minEvents = 25,
): EvidenceStatus {
  if (!pooled) return 'limited';
  if (pooled.k < minStudies) return 'limited';
  // Only apply the event-count floor when we actually have event counts (2x2
  // data); precomputed-effect topics legitimately report zero raw events.
  if (pooled.totalEvents > 0 && pooled.totalEvents < minEvents) return 'limited';

  // Significant if the CI excludes RR = 1.
  const significantBenefit = pooled.ciHigh < 1;
  const significantHarm = pooled.ciLow > 1;

  if (direction === 'lowerIsBetter') {
    if (significantBenefit) return 'favorable';
    if (significantHarm) return 'harmful';
  } else {
    // For higher-is-better, RR > 1 favors treatment.
    if (significantHarm) return 'favorable';
    if (significantBenefit) return 'harmful';
  }
  return 'neutral';
}

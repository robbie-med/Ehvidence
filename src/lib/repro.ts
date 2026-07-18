/**
 * repro.ts—the reproduction gate. Given a topic we built from extracted raw
 * study data (run through the live engine) and the pooled values the paper
 * REPORTED, check that our independent recomputation lands close to the paper.
 *
 * This is the near-free fabrication/typo detector: if the numbers were copied
 * faithfully, our random-effects pool should track the paper's headline within
 * tolerance. A mismatch flags the extraction for human review.
 *
 * The paper's reported pooled value is used ONLY here (and in the PR report). It
 * is NEVER written into the committed topic JSON—that would violate the cardinal
 * "compute everything live" rule. Reported values live in a gitignored sidecar.
 *
 * Pure + framework-free so it runs under tsx from the ingestion scripts and is
 * unit-tested.
 */
import type { ComputedTopic } from './derive';

export type ReproMeasure = 'RR' | 'OR' | 'HR' | 'MD' | 'SMD';

/** One reported pooled result from the paper, keyed to a topic outcome id. */
export interface ReportedPooled {
  outcomeId: string;
  measure: ReproMeasure;
  point: number;
  ciLow: number;
  ciHigh: number;
  /** CI confidence level as published (default 95). */
  ciLevel?: 90 | 95;
  /** Reported heterogeneity, if the paper gives one (informational). */
  i2?: number;
}

export interface ReproOutcome {
  outcomeId: string;
  measure: ReproMeasure;
  ours: { point: number; ciLow: number; ciHigh: number } | null;
  reported: ReportedPooled;
  /** Signed relative delta on the point estimate (log scale for ratios). */
  pointDeltaPct: number;
  withinTol: boolean;
  /** Do our CI and the paper's CI overlap at all? */
  ciOverlap: boolean;
  note: string;
}

export interface ReproResult {
  pass: boolean;
  outcomes: ReproOutcome[];
}

const RATIO: ReproMeasure[] = ['RR', 'OR', 'HR'];

/**
 * Distance between two point estimates.
 *
 * For ratio measures this is the log fold-change ln(ours/reported): symmetric
 * (2.0-vs-1.0 and 0.5-vs-1.0 are equal magnitude) and, crucially, independent
 * of how close the effect sits to the null — unlike normalizing by ln(reported),
 * which blows up for near-null effects (an RR of 0.83 vs 0.86 is ~3% apart, not
 * 22%). Compared directly against the tolerance (0.15 ≈ 16% multiplicative).
 *
 * For mean differences it is |a-b| scaled by the reported CI width—a natural
 * yardstick for "how big is this gap in this outcome's own units".
 */
function pointDelta(measure: ReproMeasure, ours: number, reported: ReportedPooled): number {
  if (RATIO.includes(measure)) {
    if (ours <= 0 || reported.point <= 0) return Infinity;
    return Math.log(ours / reported.point);
  }
  const ciWidth = Math.abs(reported.ciHigh - reported.ciLow) || Math.abs(reported.point) || 1;
  return (ours - reported.point) / ciWidth;
}

function overlaps(a: { ciLow: number; ciHigh: number }, b: { ciLow: number; ciHigh: number }): boolean {
  const aLo = Math.min(a.ciLow, a.ciHigh);
  const aHi = Math.max(a.ciLow, a.ciHigh);
  const bLo = Math.min(b.ciLow, b.ciHigh);
  const bHi = Math.max(b.ciLow, b.ciHigh);
  return aLo <= bHi && bLo <= aHi;
}

/** Pull our pooled point + CI for an outcome, ratio or continuous. */
function ourPooled(
  topic: ComputedTopic,
  outcomeId: string,
): { point: number; ciLow: number; ciHigh: number } | null {
  const oc = topic.outcomes.find((o) => o.outcome.id === outcomeId);
  if (!oc) return null;
  if (oc.pooled) return { point: oc.pooled.rr, ciLow: oc.pooled.ciLow, ciHigh: oc.pooled.ciHigh };
  if (oc.contPooled)
    return { point: oc.contPooled.estimate, ciLow: oc.contPooled.ciLow, ciHigh: oc.contPooled.ciHigh };
  return null;
}

export interface ReproTolerance {
  /** Max |pointDelta| to count as reproducing. Default 0.15 (~15%). */
  pointPct?: number;
  /** Require CI overlap in addition to the point tolerance. Default true. */
  requireOverlap?: boolean;
}

/**
 * Compare the engine's live pool to the paper's reported pooled values.
 * `pass` is true only if EVERY matched outcome is within tolerance. Outcomes we
 * couldn't pool (no data) fail that outcome and the whole check.
 */
export function compareReproduction(
  topic: ComputedTopic,
  reported: ReportedPooled[],
  tol: ReproTolerance = {},
): ReproResult {
  const pointPct = tol.pointPct ?? 0.15;
  const requireOverlap = tol.requireOverlap ?? true;

  const outcomes: ReproOutcome[] = reported.map((rep) => {
    const ours = ourPooled(topic, rep.outcomeId);
    if (!ours) {
      return {
        outcomeId: rep.outcomeId,
        measure: rep.measure,
        ours: null,
        reported: rep,
        pointDeltaPct: Infinity,
        withinTol: false,
        ciOverlap: false,
        note: 'no pooled estimate for this outcome (missing/invalid data)',
      };
    }
    const delta = pointDelta(rep.measure, ours.point, rep);
    const ciOverlap = overlaps(ours, rep);
    const withinPoint = Math.abs(delta) <= pointPct;
    const withinTol = withinPoint && (!requireOverlap || ciOverlap);
    const note = withinTol
      ? 'reproduced within tolerance'
      : !withinPoint
        ? `point differs by ${(delta * 100).toFixed(1)}% (tol ${(pointPct * 100).toFixed(0)}%)`
        : 'point ok but CIs do not overlap';
    return {
      outcomeId: rep.outcomeId,
      measure: rep.measure,
      ours,
      reported: rep,
      pointDeltaPct: Number((delta * 100).toFixed(2)),
      withinTol,
      ciOverlap,
      note,
    };
  });

  return { pass: outcomes.length > 0 && outcomes.every((o) => o.withinTol), outcomes };
}

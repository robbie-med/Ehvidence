/**
 * compare.ts—assembles outcome-centric comparisons. For each standard
 * outcome, it collects one row per intervention (topic) that measured that
 * exact outcome, using that topic's own pooled estimate. Interventions are
 * NOT pooled together—comparing varied treatments is the goal; pooling them
 * would be meaningless.
 */
import type { ComputedTopic } from './derive';
import type { PooledResult, EvidenceStatus } from './stats';
import {
  STANDARD_OUTCOMES,
  outcomesForProblem,
  type StandardOutcome,
} from './standardOutcomes';
import { fitNMA, type Contrast, type NMAResult } from './nma';

export interface ComparisonRow {
  topicSlug: string;
  topicName: string;
  intervention: string;
  /** Population the intervention was studied in (comparability caveat). */
  population: string;
  /** This intervention's pooled effect on the standard outcome. */
  pooled: PooledResult;
  status: EvidenceStatus;
  studyCount: number;
  /** The topic's own label for this outcome (may differ verbatim). */
  outcomeLabel: string;
}

export interface Comparison {
  outcome: StandardOutcome;
  rows: ComparisonRow[];
}

/**
 * Build all comparisons that have at least two interventions to compare.
 * @param minInterventions only surface comparisons with at least this many rows
 */
export function buildComparisons(
  topics: ComputedTopic[],
  minInterventions = 2,
): Comparison[] {
  return STANDARD_OUTCOMES.map((so) => {
    const rows: ComparisonRow[] = [];
    for (const t of topics) {
      const co = t.outcomes.find(
        (o) => o.outcome.standardOutcomeId === so.id,
      );
      if (!co || !co.pooled) continue;
      rows.push({
        topicSlug: t.raw.slug,
        topicName: t.raw.name,
        intervention: t.raw.intervention,
        population: t.raw.condition,
        pooled: co.pooled,
        status: co.status,
        studyCount: co.studies.length,
        outcomeLabel: co.outcome.label,
      });
    }
    // Best (largest reduction) first.
    rows.sort((a, b) => b.pooled.improvementPct - a.pooled.improvementPct);
    return { outcome: so, rows };
  }).filter((c) => c.rows.length >= minInterventions);
}

export function comparisonById(
  topics: ComputedTopic[],
  outcomeId: string,
): Comparison | undefined {
  return buildComparisons(topics, 1).find((c) => c.outcome.id === outcomeId);
}

/* ------------------------------------------------------------------ */
/* Network meta-analysis + benefit–harm ledger (feature 5)             */
/* ------------------------------------------------------------------ */

const Z95 = 1.959964;

/**
 * Build the network of aggregate contrasts for one standard outcome: each topic
 * that measured it and declares treatment/comparator nodes contributes one edge
 * (its pooled log-RR + variance).
 */
export function networkContrasts(
  topics: ComputedTopic[],
  standardOutcomeId: string,
): Contrast[] {
  const out: Contrast[] = [];
  for (const t of topics) {
    const tn = t.raw.treatmentNode;
    const cn = t.raw.comparatorNode;
    if (!tn || !cn) continue;
    const co = t.outcomes.find((o) => o.outcome.standardOutcomeId === standardOutcomeId);
    if (!co || !co.pooled || co.pooled.rr <= 0) continue;
    const y = Math.log(co.pooled.rr);
    const se = (Math.log(co.pooled.ciHigh) - Math.log(co.pooled.ciLow)) / (2 * Z95);
    if (!(se > 0)) continue;
    out.push({ t: tn, c: cn, y, v: se * se, slug: t.raw.slug });
  }
  return out;
}

export interface OutcomeNetwork {
  outcome: StandardOutcome;
  contrasts: Contrast[];
  nma: NMAResult;
}

/** Fit an NMA for every standard outcome in a problem that has a connected network. */
export function problemNetworks(
  topics: ComputedTopic[],
  problemId: string,
  minTreatments = 3,
): OutcomeNetwork[] {
  const nets: OutcomeNetwork[] = [];
  for (const so of outcomesForProblem(problemId)) {
    const contrasts = networkContrasts(topics, so.id);
    const nma = fitNMA(contrasts, so.direction);
    if (nma && nma.nodes.length >= minTreatments) {
      nets.push({ outcome: so, contrasts, nma });
    }
  }
  return nets;
}

export interface LedgerCell {
  rr: number;
  ciLow: number;
  ciHigh: number;
  status: EvidenceStatus;
  slug: string;
  direction: 'lowerIsBetter' | 'higherIsBetter';
}
export interface LedgerRow {
  intervention: string;
  slug: string;
  population: string;
  cells: Record<string, LedgerCell | null>;
}
export interface Ledger {
  outcomes: StandardOutcome[];
  rows: LedgerRow[];
}

/**
 * Benefit–harm ledger for a problem: one row per intervention, one column per
 * standard outcome, each cell that intervention's pooled effect (benefits and
 * harms side by side). Interventions are never pooled together.
 */
export function buildLedger(topics: ComputedTopic[], problemId: string): Ledger {
  const outcomes = outcomesForProblem(problemId);
  const rows: LedgerRow[] = [];
  for (const t of topics) {
    const cells: Record<string, LedgerCell | null> = {};
    let any = false;
    for (const so of outcomes) {
      const co = t.outcomes.find((o) => o.outcome.standardOutcomeId === so.id);
      if (co && co.pooled) {
        any = true;
        cells[so.id] = {
          rr: co.pooled.rr,
          ciLow: co.pooled.ciLow,
          ciHigh: co.pooled.ciHigh,
          status: co.status,
          slug: t.raw.slug,
          direction: co.outcome.direction,
        };
      } else {
        cells[so.id] = null;
      }
    }
    if (any) {
      rows.push({ intervention: t.raw.intervention, slug: t.raw.slug, population: t.raw.condition, cells });
    }
  }
  return { outcomes, rows };
}

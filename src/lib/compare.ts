/**
 * compare.ts — assembles outcome-centric comparisons. For each standard
 * outcome, it collects one row per intervention (topic) that measured that
 * exact outcome, using that topic's own pooled estimate. Interventions are
 * NOT pooled together — comparing varied treatments is the goal; pooling them
 * would be meaningless.
 */
import type { ComputedTopic } from './derive';
import type { PooledResult, EvidenceStatus } from './stats';
import {
  STANDARD_OUTCOMES,
  type StandardOutcome,
} from './standardOutcomes';

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

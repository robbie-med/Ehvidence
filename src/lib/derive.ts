/**
 * derive.ts — turns a raw, schema-validated topic into a render-ready view
 * model: per-outcome pooled estimates, per-study computed effects (with plot
 * weights), and an overall evidence status. Used by both the topic pages and
 * the home-page ranking/scatter.
 */
import {
  computeEffect,
  poolRandomEffects,
  deriveStatus,
  type StudyData,
  type EffectResult,
  type PooledResult,
  type EvidenceStatus,
} from './stats';

export interface RawStudy {
  id: string;
  author: string;
  year: number;
  citation: string;
  doi?: string;
  url?: string;
  design: string;
  outcomeId: string;
  doseRegimen?: string;
  population?: string;
  excludeFromPooled?: boolean;
  notes?: string;
  data: StudyData;
}

export interface RawOutcome {
  id: string;
  label: string;
  direction: 'lowerIsBetter' | 'higherIsBetter';
  description?: string;
}

export interface RawTopic {
  slug: string;
  name: string;
  condition: string;
  intervention: string;
  comparator: string;
  category: string;
  summary: string;
  description?: string;
  methodologyNotes?: string;
  status?: EvidenceStatus;
  primaryOutcomeId: string;
  lastUpdated: string;
  outcomes: RawOutcome[];
  studies: RawStudy[];
}

export interface ComputedStudy extends RawStudy {
  effect: EffectResult;
  /** Normalized random-effects weight within its outcome (0–1), 0 if excluded. */
  weightPct: number;
}

export interface ComputedOutcome {
  outcome: RawOutcome;
  studies: ComputedStudy[];
  pooled: PooledResult | null;
  status: EvidenceStatus;
}

export interface ComputedTopic {
  raw: RawTopic;
  outcomes: ComputedOutcome[];
  /** The outcome flagged as primary (falls back to the first outcome). */
  primary: ComputedOutcome;
  /** Topic-level status (authored override, else derived from the primary outcome). */
  status: EvidenceStatus;
  /** Total patients across all studies (both arms). */
  totalPatients: number;
  /** Total studies in the topic. */
  studyCount: number;
}

export function deriveTopic(raw: RawTopic): ComputedTopic {
  const outcomes: ComputedOutcome[] = raw.outcomes.map((outcome) =>
    computeOutcome(raw, outcome),
  );

  const primary =
    outcomes.find((o) => o.outcome.id === raw.primaryOutcomeId) ?? outcomes[0];

  const status = raw.status ?? primary.status;

  const totalPatients = raw.studies.reduce((sum, s) => {
    if (s.data.kind === '2x2') return sum + s.data.txTotal + s.data.ctrlTotal;
    return sum;
  }, 0);

  return {
    raw,
    outcomes,
    primary,
    status,
    totalPatients,
    studyCount: raw.studies.length,
  };
}

function computeOutcome(raw: RawTopic, outcome: RawOutcome): ComputedOutcome {
  const forOutcome = raw.studies.filter((s) => s.outcomeId === outcome.id);
  const poolable = forOutcome.filter((s) => !s.excludeFromPooled);

  const pooledResult = poolRandomEffects(poolable.map((s) => s.data));
  const pooled = pooledResult?.pooled ?? null;

  // Map pooled plot weights back onto poolable studies by index.
  const weightByIndex = new Map<number, number>();
  if (pooledResult) {
    poolable.forEach((s, i) => {
      weightByIndex.set(
        forOutcome.indexOf(s),
        pooledResult.weighted[i]?.weightPct ?? 0,
      );
    });
  }

  const studies: ComputedStudy[] = forOutcome.map((s, i) => ({
    ...s,
    effect: computeEffect(s.data),
    weightPct: weightByIndex.get(i) ?? 0,
  }));

  // Sort newest first for display.
  studies.sort((a, b) => b.year - a.year);

  const status = deriveStatus(pooled, outcome.direction);

  return { outcome, studies, pooled, status };
}

/** Flatten a topic's studies into recent-publication entries, newest first. */
export function recentStudies(raw: RawTopic, limit = 5): RawStudy[] {
  return [...raw.studies].sort((a, b) => b.year - a.year).slice(0, limit);
}

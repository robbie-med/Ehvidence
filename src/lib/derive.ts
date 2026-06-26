/**
 * derive.ts—turns a raw, schema-validated topic into a render-ready view
 * model: per-outcome pooled estimates, per-study computed effects (with plot
 * weights), and an overall evidence status. Used by both the topic pages and
 * the home-page ranking/scatter.
 */
import {
  computeEffect,
  poolRandomEffects,
  deriveStatus,
  computeContinuous,
  poolContinuous,
  deriveStatusContinuous,
  type StudyData,
  type ContinuousStudyData,
  type EffectResult,
  type ContinuousResult,
  type ContinuousMeasure,
  type PooledResult,
  type PooledContinuous,
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
  endpointDefinition?: string;
  n?: number;
  excludeFromPooled?: boolean;
  notes?: string;
  data: StudyData | ContinuousStudyData;
}

/** Participants analyzed in a study: from its arm totals, else its explicit n. */
export function studyPatients(s: RawStudy): number {
  if (s.data.kind === '2x2') return s.data.txTotal + s.data.ctrlTotal;
  if (s.data.kind === 'continuous') return s.data.txN + s.data.ctrlN;
  return s.n ?? 0;
}

export interface RawOutcome {
  id: string;
  label: string;
  direction: 'lowerIsBetter' | 'higherIsBetter';
  description?: string;
  standardOutcomeId?: string;
  kind?: 'binary' | 'continuous';
  measure?: ContinuousMeasure;
  /** Authored status override (otherwise derived from the pooled estimate). */
  status?: EvidenceStatus;
}

export interface RawTopic {
  slug: string;
  name: string;
  condition: string;
  intervention: string;
  comparator: string;
  category: string;
  evidenceClass?: 'efficacy' | 'implementation' | 'observational';
  summary: string;
  description?: string;
  interpretation?: string;
  methodologyNotes?: string;
  status?: EvidenceStatus;
  primaryOutcomeId: string;
  lastUpdated: string;
  outcomes: RawOutcome[];
  studies: RawStudy[];
}

export interface ComputedStudy extends RawStudy {
  /** Ratio effect (binary outcomes). */
  effect?: EffectResult;
  /** Continuous effect (mean-difference outcomes). */
  cont?: ContinuousResult;
  /** Normalized random-effects weight within its outcome (0–1), 0 if excluded. */
  weightPct: number;
}

export interface ComputedOutcome {
  outcome: RawOutcome;
  kind: 'binary' | 'continuous';
  /** Continuous measure (only meaningful when kind === 'continuous'). */
  measure: ContinuousMeasure;
  studies: ComputedStudy[];
  /** Pooled ratio estimate (binary outcomes). */
  pooled: PooledResult | null;
  /** Pooled continuous estimate (continuous outcomes). */
  contPooled: PooledContinuous | null;
  status: EvidenceStatus;
  /** Participants analyzed across this outcome's studies. */
  totalPatients: number;
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

  // A single study may report several outcomes and so appear as multiple
  // records (one per outcome). Dedupe by citation for topic-level counts so a
  // multi-outcome study is counted once, using its largest reported sample.
  const byStudy = new Map<string, number>();
  for (const s of raw.studies) {
    const key = s.citation || s.id;
    byStudy.set(key, Math.max(byStudy.get(key) ?? 0, studyPatients(s)));
  }
  const studyCount = byStudy.size;
  const totalPatients = [...byStudy.values()].reduce((sum, n) => sum + n, 0);

  return {
    raw,
    outcomes,
    primary,
    status,
    totalPatients,
    studyCount,
  };
}

function computeOutcome(raw: RawTopic, outcome: RawOutcome): ComputedOutcome {
  const forOutcome = raw.studies.filter((s) => s.outcomeId === outcome.id);
  const poolable = forOutcome.filter((s) => !s.excludeFromPooled);
  const isContinuous = outcome.kind === 'continuous';
  const measure: ContinuousMeasure = outcome.measure ?? 'SMD';
  const totalPatients = forOutcome.reduce((sum, s) => sum + studyPatients(s), 0);

  // Map pooled plot weights back onto poolable studies by index.
  const weightByIndex = new Map<number, number>();

  if (isContinuous) {
    const pooledResult = poolContinuous(
      poolable.map((s) => s.data as ContinuousStudyData),
      measure,
    );
    if (pooledResult) {
      poolable.forEach((s, i) =>
        weightByIndex.set(forOutcome.indexOf(s), pooledResult.weighted[i]?.weightPct ?? 0),
      );
    }
    const studies: ComputedStudy[] = forOutcome.map((s, i) => ({
      ...s,
      cont: computeContinuous(s.data as ContinuousStudyData, measure),
      weightPct: weightByIndex.get(i) ?? 0,
    }));
    studies.sort((a, b) => b.year - a.year);
    const contPooled = pooledResult?.pooled ?? null;
    const status = outcome.status ?? deriveStatusContinuous(contPooled, outcome.direction);
    return { outcome, kind: 'continuous', measure, studies, pooled: null, contPooled, status, totalPatients };
  }

  const pooledResult = poolRandomEffects(poolable.map((s) => s.data as StudyData));
  const pooled = pooledResult?.pooled ?? null;
  if (pooledResult) {
    poolable.forEach((s, i) =>
      weightByIndex.set(forOutcome.indexOf(s), pooledResult.weighted[i]?.weightPct ?? 0),
    );
  }
  const studies: ComputedStudy[] = forOutcome.map((s, i) => ({
    ...s,
    effect: computeEffect(s.data as StudyData),
    weightPct: weightByIndex.get(i) ?? 0,
  }));
  studies.sort((a, b) => b.year - a.year);
  const status = outcome.status ?? deriveStatus(pooled, outcome.direction);
  return { outcome, kind: 'binary', measure, studies, pooled, contPooled: null, status, totalPatients };
}

/** Flatten a topic's studies into recent-publication entries, newest first. */
export function recentStudies(raw: RawTopic, limit = 5): RawStudy[] {
  return [...raw.studies].sort((a, b) => b.year - a.year).slice(0, limit);
}

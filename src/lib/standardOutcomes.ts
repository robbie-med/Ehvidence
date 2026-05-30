/**
 * standardOutcomes.ts — the controlled vocabulary of "standard outcomes" that
 * makes cross-intervention comparison honest. A comparison only ever lines up
 * interventions that measured the SAME standard outcome.
 *
 * Grain is deliberately clinical-but-matchable (e.g. "new squamous-cell
 * carcinoma", "all-cause mortality") rather than hyper-specific, so studies can
 * actually be matched; within-bucket differences (exact composite, population)
 * are surfaced as caveats on the comparison page, not split into new buckets.
 */

export interface Problem {
  id: string;
  label: string;
  description?: string;
}

export interface StandardOutcome {
  id: string;
  label: string;
  /** Plain-language definition of exactly what this outcome counts. */
  definition: string;
  problemId: string;
  direction: 'lowerIsBetter' | 'higherIsBetter';
  /** Shown when the underlying definitions are known to vary across studies. */
  caveat?: string;
}

export const PROBLEMS: Problem[] = [
  {
    id: 'skin-cancer-prevention',
    label: 'Skin cancer prevention',
    description:
      'Preventing new skin cancers. Compare interventions on a specific cancer type — relative effects are broadly comparable, but baseline risk (general vs high-risk populations) differs, so absolute benefit/NNT is not.',
  },
  {
    id: 'cv-event-prevention',
    label: 'Cardiovascular event prevention',
    description:
      'Preventing cardiovascular events. All-cause mortality and the individual components are cleanly matchable; the "major cardiovascular events" composite is not — its definition varies by trial.',
  },
];

export const STANDARD_OUTCOMES: StandardOutcome[] = [
  // --- skin cancer ---
  {
    id: 'scc-incidence',
    label: 'New squamous-cell carcinoma',
    definition: 'New (incident) cutaneous squamous-cell carcinoma.',
    problemId: 'skin-cancer-prevention',
    direction: 'lowerIsBetter',
  },
  {
    id: 'bcc-incidence',
    label: 'New basal-cell carcinoma',
    definition: 'New (incident) cutaneous basal-cell carcinoma.',
    problemId: 'skin-cancer-prevention',
    direction: 'lowerIsBetter',
  },
  {
    id: 'nmsc-incidence',
    label: 'New nonmelanoma skin cancer',
    definition: 'New basal-cell plus squamous-cell carcinoma (combined).',
    problemId: 'skin-cancer-prevention',
    direction: 'lowerIsBetter',
  },
  {
    id: 'melanoma-incidence',
    label: 'Melanoma',
    definition: 'New cutaneous melanoma (invasive and/or in situ as reported).',
    problemId: 'skin-cancer-prevention',
    direction: 'lowerIsBetter',
  },
  // --- cardiovascular ---
  {
    id: 'all-cause-mortality',
    label: 'All-cause mortality',
    definition: 'Death from any cause. Definition is identical across trials.',
    problemId: 'cv-event-prevention',
    direction: 'lowerIsBetter',
  },
  {
    id: 'mi',
    label: 'Myocardial infarction',
    definition: 'Fatal or nonfatal myocardial infarction.',
    problemId: 'cv-event-prevention',
    direction: 'lowerIsBetter',
  },
  {
    id: 'stroke',
    label: 'Stroke',
    definition: 'Fatal or nonfatal stroke.',
    problemId: 'cv-event-prevention',
    direction: 'lowerIsBetter',
  },
  {
    id: 'mace',
    label: 'Major cardiovascular events (composite)',
    definition:
      "Each trial's primary major adverse cardiovascular event composite.",
    problemId: 'cv-event-prevention',
    direction: 'lowerIsBetter',
    caveat:
      'The composite components differ across trials and interventions (some include revascularization or unstable angina, others only MI/stroke/CV death). Relative effects on this row are NOT strictly like-for-like — read each intervention with its endpoint definition.',
  },
];

export function standardOutcome(id?: string): StandardOutcome | undefined {
  return STANDARD_OUTCOMES.find((o) => o.id === id);
}

export function problem(id: string): Problem | undefined {
  return PROBLEMS.find((p) => p.id === id);
}

/** Standard outcomes belonging to a problem, in registry order. */
export function outcomesForProblem(problemId: string): StandardOutcome[] {
  return STANDARD_OUTCOMES.filter((o) => o.problemId === problemId);
}

/**
 * evidence.ts—presentation rules for the "evidence class" of a topic.
 * Distinguishes classic efficacy meta-analysis (RCTs, NNT applies) from
 * implementation/QI work (exposure rates, NNT usually doesn't apply) and
 * observational comparisons, so each genre is read with the right lens.
 */
export type EvidenceClass = 'efficacy' | 'implementation' | 'observational';

export interface EvidenceMeta {
  key: EvidenceClass;
  /** Short badge label. */
  label: string;
  /** One-line "how to read this evidence" explainer. */
  blurb: string;
  /** Whether a number-needed-to-treat is meaningful for this genre. */
  showNnt: boolean;
  /** Forest-plot end labels (left favors the intervention). */
  favorLabel: string;
  againstLabel: string;
}

export function evidenceMeta(evidenceClass?: string): EvidenceMeta {
  switch (evidenceClass) {
    case 'implementation':
      return {
        key: 'implementation',
        label: 'Implementation / QI',
        blurb:
          'Quality-improvement evidence with process/exposure outcomes (often pre-post, single-arm). Effects are rate ratios; a number-needed-to-treat generally does not apply.',
        showNnt: false,
        favorLabel: 'favors intervention',
        againstLabel: 'favors usual care',
      };
    case 'observational':
      return {
        key: 'observational',
        label: 'Observational',
        blurb:
          'Non-randomized comparative data (adjusted odds or hazard ratios). Informative but subject to confounding.',
        showNnt: true,
        favorLabel: 'favors intervention',
        againstLabel: 'favors comparator',
      };
    case 'efficacy':
    default:
      return {
        key: 'efficacy',
        label: 'Efficacy (RCT)',
        blurb:
          'Efficacy evidence on clinical outcomes. Effects are risk ratios with number-needed-to-treat where a baseline risk is available.',
        showNnt: true,
        favorLabel: 'favors treatment',
        againstLabel: 'favors control',
      };
  }
}

/** Stable display order for grouping on the home page. */
export const EVIDENCE_ORDER: EvidenceClass[] = ['efficacy', 'implementation', 'observational'];

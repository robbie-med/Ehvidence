import { defineCollection, z } from 'astro:content';
import { glob } from 'astro/loaders';

/**
 * The "topics" collection: one JSON file per clinical topic in
 * src/content/topics/. Each file is validated against this schema at build
 * time—invalid data fails the build, which is the data-quality gate.
 */

const twoByTwo = z.object({
  kind: z.literal('2x2'),
  txEvents: z.number().int().nonnegative(),
  txTotal: z.number().int().positive(),
  ctrlEvents: z.number().int().nonnegative(),
  ctrlTotal: z.number().int().positive(),
});

const precomputedEffect = z.object({
  kind: z.literal('effect'),
  measure: z.enum(['RR', 'OR', 'HR']),
  point: z.number().positive(),
  ciLow: z.number().positive(),
  ciHigh: z.number().positive(),
  // Baseline control risk (probability) or, for count/rate outcomes, the
  // control event rate per person—used to derive an NNT. May exceed 1 for
  // rate outcomes (e.g. mean lesions per person).
  ctrlRisk: z.number().min(0).optional(),
  // Confidence level the reported CI was published at (default 95).
  ciLevel: z.union([z.literal(90), z.literal(95)]).optional(),
});

const continuous = z.object({
  kind: z.literal('continuous'),
  txMean: z.number(),
  txSd: z.number().nonnegative(),
  txN: z.number().int().positive(),
  ctrlMean: z.number(),
  ctrlSd: z.number().nonnegative(),
  ctrlN: z.number().int().positive(),
});

const continuousEffect = z.object({
  kind: z.literal('continuousEffect'),
  measure: z.enum(['MD', 'SMD']),
  point: z.number(),
  ciLow: z.number(),
  ciHigh: z.number(),
  n: z.number().int().positive().optional(),
  // Confidence level the reported CI was published at (default 95). TQT
  // studies conventionally report 90% CIs.
  ciLevel: z.union([z.literal(90), z.literal(95)]).optional(),
});

const study = z.object({
  id: z.string(),
  author: z.string(),
  year: z.number().int(),
  citation: z.string(),
  doi: z.string().optional(),
  url: z.string().url().optional(),
  design: z.enum([
    'DB-RCT',
    'RCT',
    'pre-post',
    'prospective',
    'retrospective',
    'case-control',
    'cohort',
    'ecological',
    'review',
  ]),
  outcomeId: z.string(),
  doseRegimen: z.string().optional(),
  population: z.string().optional(),
  // Verbatim endpoint definition as stated in the study (for comparability).
  endpointDefinition: z.string().optional(),
  // Total participants analyzed—derived automatically for 2x2 tables; set
  // explicitly for precomputed effects where the sample size is known.
  n: z.number().int().positive().optional(),
  excludeFromPooled: z.boolean().optional(),
  notes: z.string().optional(),
  data: z.discriminatedUnion('kind', [twoByTwo, precomputedEffect, continuous, continuousEffect]),
});

const outcome = z.object({
  id: z.string(),
  label: z.string(),
  direction: z.enum(['lowerIsBetter', 'higherIsBetter']),
  description: z.string().optional(),
  // 'binary' (event/ratio, the default) or 'continuous' (mean difference).
  kind: z.enum(['binary', 'continuous']).optional(),
  // For continuous outcomes: mean difference (same units) or standardized.
  measure: z.enum(['MD', 'SMD']).optional(),
  // Optional authored status override for this outcome (otherwise derived from
  // the pooled estimate). Useful for single large studies where the automatic
  // k<3 "limited" rule does not reflect the evidence.
  status: z.enum(['favorable', 'harmful', 'limited', 'neutral']).optional(),
  // Baseline (comparator-arm) risk model for the absolute-risk translator.
  // Defaults to the pooled control-arm risk when omitted; authored when the
  // control arm is not representative of the population of interest.
  baselineRisk: z
    .object({
      default: z.number().min(0).max(1),
      min: z.number().min(0).max(1).optional(),
      max: z.number().min(0).max(1).optional(),
      unit: z.string().optional(),
      presets: z
        .array(z.object({ label: z.string(), value: z.number().min(0).max(1) }))
        .optional(),
    })
    .optional(),
  // Links this outcome to a controlled standard outcome so it can be compared
  // across interventions. See src/lib/standardOutcomes.ts.
  standardOutcomeId: z.string().optional(),
});

const topics = defineCollection({
  loader: glob({ pattern: '**/*.json', base: './src/content/topics' }),
  schema: z.object({
    slug: z.string(),
    name: z.string(),
    condition: z.string(),
    intervention: z.string(),
    comparator: z.string(),
    category: z.string(),
    evidenceClass: z.enum(['efficacy', 'implementation', 'observational']).optional(),
    // Network meta-analysis nodes: this topic is one edge (treatment vs
    // comparator). Topics that share a comparator node form a connected network.
    treatmentNode: z.string().optional(),
    comparatorNode: z.string().optional(),
    summary: z.string(),
    description: z.string().optional(),
    interpretation: z.string().optional(),
    methodologyNotes: z.string().optional(),
    status: z.enum(['favorable', 'harmful', 'limited', 'neutral']).optional(),
    primaryOutcomeId: z.string(),
    lastUpdated: z.string(),
    // Search terms for the on-demand new-trial scanner (scripts/scan-new-trials.js).
    searchTerms: z.array(z.string()).optional(),
    // Registered trials not yet reported—shown as a "watch list" on the topic.
    pendingTrials: z
      .array(
        z.object({
          name: z.string(),
          registryId: z.string().optional(),
          expectedN: z.number().int().positive().optional(),
          expectedReadout: z.string().optional(),
          url: z.string().url().optional(),
        }),
      )
      .optional(),
    outcomes: z.array(outcome).min(1),
    studies: z.array(study),
  }),
});

export const collections = { topics };

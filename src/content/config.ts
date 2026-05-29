import { defineCollection, z } from 'astro:content';
import { glob } from 'astro/loaders';

/**
 * The "topics" collection: one JSON file per clinical topic in
 * src/content/topics/. Each file is validated against this schema at build
 * time — invalid data fails the build, which is the data-quality gate.
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
  ctrlRisk: z.number().min(0).max(1).optional(),
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
  excludeFromPooled: z.boolean().optional(),
  notes: z.string().optional(),
  data: z.discriminatedUnion('kind', [twoByTwo, precomputedEffect]),
});

const outcome = z.object({
  id: z.string(),
  label: z.string(),
  direction: z.enum(['lowerIsBetter', 'higherIsBetter']),
  description: z.string().optional(),
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
    summary: z.string(),
    description: z.string().optional(),
    methodologyNotes: z.string().optional(),
    status: z.enum(['favorable', 'harmful', 'limited', 'neutral']).optional(),
    primaryOutcomeId: z.string(),
    lastUpdated: z.string(),
    outcomes: z.array(outcome).min(1),
    studies: z.array(study),
  }),
});

export const collections = { topics };

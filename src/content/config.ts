import { defineCollection } from 'astro:content';
import { glob } from 'astro/loaders';
import { topicSchema } from '../lib/schema';

/**
 * The "topics" collection: one JSON file per clinical topic in
 * src/content/topics/. Each file is validated against the topicSchema at build
 * time—invalid data fails the build, which is the data-quality gate.
 *
 * The schema itself lives in src/lib/schema.ts (framework-free) so the exact
 * same validation runs in the standalone ingestion gates (scripts/ingest).
 */

const topics = defineCollection({
  loader: glob({ pattern: '**/*.json', base: './src/content/topics' }),
  schema: topicSchema,
});

export const collections = { topics };

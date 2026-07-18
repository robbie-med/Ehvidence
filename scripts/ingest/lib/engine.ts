/**
 * engine.ts—one import surface for the Node/tsx ingestion scripts to reach the
 * site's live statistical engine and schema. These re-exported modules are
 * framework-free (no astro:content), so `tsx` can execute them directly with no
 * Vite build. Do NOT add framework imports to anything reachable from here.
 */
export { deriveTopic, recentStudies, studyPatients } from '../../../src/lib/derive';
export type {
  RawTopic,
  RawStudy,
  RawOutcome,
  ComputedTopic,
  ComputedOutcome,
} from '../../../src/lib/derive';
export { topicSchema } from '../../../src/lib/schema';
export type { TopicInput } from '../../../src/lib/schema';
export { compareReproduction } from '../../../src/lib/repro';
export type { ReportedPooled, ReproResult, ReproOutcome } from '../../../src/lib/repro';

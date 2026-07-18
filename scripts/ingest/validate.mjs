/**
 * validate.mjs—standalone schema validation outside `astro build`. Imports the
 * SAME topicSchema the site build enforces (src/lib/schema.ts), so a topic that
 * passes here will pass the Pages build. Run under tsx (it imports a .ts file).
 *
 *   tsx scripts/ingest/validate.mjs <path/to/topic.json>
 *   (also exported as validateTopic for programmatic use by extract.mjs)
 */
import { readFileSync } from 'node:fs';
import { topicSchema } from '../../src/lib/schema.ts';

/** Validate a parsed topic object. Returns { ok, errors }. */
export function validateTopic(json) {
  const res = topicSchema.safeParse(json);
  if (res.success) return { ok: true, errors: [] };
  return {
    ok: false,
    errors: res.error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`),
  };
}

function main() {
  const path = process.argv[2];
  if (!path) {
    console.error('usage: tsx scripts/ingest/validate.mjs <topic.json>');
    process.exit(2);
  }
  const json = JSON.parse(readFileSync(path, 'utf8'));
  const { ok, errors } = validateTopic(json);
  if (ok) {
    console.log(`✓ ${path} is schema-valid`);
  } else {
    console.error(`✗ ${path} failed schema validation:`);
    for (const e of errors) console.error(`   - ${e}`);
    process.exit(1);
  }
}

// Only run the CLI when invoked directly, not when imported.
if (import.meta.url === `file://${process.argv[1]}`) main();

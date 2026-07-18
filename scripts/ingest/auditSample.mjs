/**
 * auditSample.mjs—the sampled Claude semantic audit. This is the ONLY place the
 * pipeline uses Claude (the maintainer's split: DeepSeek extracts, Claude audits
 * a sample). It is stub-gated: with no ANTHROPIC_API_KEY it logs "skipped" and
 * records nothing, so the pipeline runs fully without it.
 *
 * Reads a queued paper's source + extracted topic and asks Claude to judge
 * framing, outcome selection, and whether the prose matches the data. Returns a
 * verdict; the caller decides whether to escalate.
 *
 *   tsx scripts/ingest/auditSample.mjs <pmid>
 */
import { readArtifact } from './lib/queue.mjs';

const ANTHROPIC_BASE = process.env.ANTHROPIC_BASE_URL || 'https://api.anthropic.com';
const AUDIT_MODEL = process.env.ANTHROPIC_AUDIT_MODEL || 'claude-sonnet-4-6';

export function hasAnthropicKey() {
  return Boolean(process.env.ANTHROPIC_API_KEY);
}

const AUDIT_BRIEF = `
You are auditing an automated extraction of a clinical meta-analysis into a structured
topic. You are given the extracted topic JSON. Judge, briefly:
- Does the outcome framing match convention (beneficial outcomes as success counts, etc.)?
- Are any studies obviously missing or duplicated vs a meta-analysis of this size?
- Do the study designs/citations look plausible (not fabricated)?
Respond with ONE JSON object:
{"verdict":"ok|suspect","confidence":0..1,"issues":["..."],"summary":"one sentence"}
`;

/** Run the audit. Returns { skipped } if no key, else { verdict, ... }. */
export async function auditSample(pmid) {
  if (!hasAnthropicKey()) {
    return { skipped: true, reason: 'no ANTHROPIC_API_KEY' };
  }
  const topic = readArtifact(pmid, 'topic.json');
  if (!topic) return { skipped: true, reason: 'no topic.json' };

  const res = await fetch(`${ANTHROPIC_BASE}/v1/messages`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': process.env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: AUDIT_MODEL,
      max_tokens: 700,
      system: AUDIT_BRIEF,
      messages: [{ role: 'user', content: `Extracted topic:\n\n${JSON.stringify(topic, null, 2).slice(0, 60000)}` }],
    }),
  });
  if (!res.ok) return { skipped: false, error: `anthropic ${res.status}` };
  const data = await res.json();
  const text = data.content?.[0]?.text ?? '{}';
  try {
    return { skipped: false, ...JSON.parse(text.replace(/^```json\s*|\s*```$/g, '')) };
  } catch {
    return { skipped: false, error: 'unparseable audit JSON', raw: text };
  }
}

function main() {
  const pmid = process.argv[2];
  if (!pmid) {
    console.error('usage: tsx scripts/ingest/auditSample.mjs <pmid>');
    process.exit(2);
  }
  auditSample(pmid).then((r) => {
    if (r.skipped) console.log(`audit skipped (${r.reason})`);
    else console.log(JSON.stringify(r, null, 2));
  });
}

if (import.meta.url === `file://${process.argv[1]}`) main();

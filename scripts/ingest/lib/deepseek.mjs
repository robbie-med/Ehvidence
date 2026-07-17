/**
 * deepseek.mjs — thin client for DeepSeek's OpenAI-compatible chat API, used as the
 * cheap extraction worker. Reads DEEPSEEK_API_KEY from the environment. The system
 * prompt is AGENTS.md (the same rules a human/Claude follows), so the model is asked
 * to produce a schema-valid topic JSON and nothing else.
 */
const BASE = process.env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com';
const MODEL = process.env.DEEPSEEK_MODEL || 'deepseek-chat';

export function hasKey() {
  return Boolean(process.env.DEEPSEEK_API_KEY);
}

const EXTRACTION_BRIEF = `
You are a careful medical-evidence data-extraction engine. Follow the rules in the
AGENTS.md provided below EXACTLY. Read the paper text and produce ONE JSON object: a
single Ehvidence topic, matching the schema in AGENTS.md.

Absolute rules (violating any is a failure):
- Copy every number verbatim from the paper. Invent nothing. Do not compute or
  hardcode any pooled/derived value (RR, OR, HR, NNT, SMD, I2, %); enter only the
  per-study raw data and let the site compute the rest.
- Enter a meta-analysis as its constituent trials, never as one pooled row.
- Do not exclude any study the source included.
- Keep the source's framing (e.g. higher-is-better outcomes use success counts).
- Leave optional fields (standardOutcomeId, treatmentNode, comparatorNode, status)
  blank/absent unless you are certain.

Output: raw JSON only, no markdown fences, no commentary.
`;

/**
 * Extract a topic JSON from paper text. Returns { ok, topic|null, raw, usage, error }.
 */
export async function extractTopic(agentsMd, paperText, { model = MODEL, maxChars = 120000 } = {}) {
  if (!hasKey()) return { ok: false, error: 'DEEPSEEK_API_KEY not set', topic: null };
  const text = paperText.length > maxChars ? paperText.slice(0, maxChars) : paperText;
  const body = {
    model,
    messages: [
      { role: 'system', content: `${EXTRACTION_BRIEF}\n\n===== AGENTS.md =====\n${agentsMd}` },
      { role: 'user', content: `Extract the topic JSON from this paper:\n\n${text}` },
    ],
    temperature: 0,
    response_format: { type: 'json_object' },
    max_tokens: 8000,
  };
  const res = await fetch(`${BASE}/chat/completions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${process.env.DEEPSEEK_API_KEY}` },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    return { ok: false, error: `DeepSeek ${res.status}: ${await res.text().catch(() => '')}`, topic: null };
  }
  const data = await res.json();
  const raw = data.choices?.[0]?.message?.content ?? '';
  let topic = null;
  try {
    topic = JSON.parse(raw.replace(/^```json\s*|\s*```$/g, ''));
  } catch (e) {
    return { ok: false, error: `unparseable JSON: ${e.message}`, raw, topic: null, usage: data.usage };
  }
  return { ok: true, topic, raw, usage: data.usage };
}

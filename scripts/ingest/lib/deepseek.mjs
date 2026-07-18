/**
 * deepseek.mjs — thin client for DeepSeek's OpenAI-compatible chat API, used as the
 * cheap extraction worker. Reads DEEPSEEK_API_KEY from the environment. The system
 * prompt is AGENTS.md (the same rules a human/Claude follows), so the model is asked
 * to produce a schema-valid topic JSON and nothing else.
 */
// Read config at CALL time, never at module load: these scripts call loadDotenv()
// AFTER importing this module, and ES imports initialize before that runs — so a
// module-level `const BASE = process.env...` would capture undefined and fall back
// to the native DeepSeek API (which rejects the PPQ proxy key). Always resolve live.
const base = () => process.env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com';
const defaultModel = () => process.env.DEEPSEEK_MODEL || 'deepseek/deepseek-chat';

export function hasKey() {
  return Boolean(process.env.DEEPSEEK_API_KEY);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * POST a chat completion with retries. The PPQ.AI proxy load-balances across
 * many upstream providers (DeepInfra, Novita, StreamLake, …) and at least one
 * intermittently rejects the forwarded key with a 401. A retry re-routes to a
 * different provider, so transient auth/5xx/network failures are retried a few
 * times with backoff before giving up. Returns the parsed JSON response or
 * throws with the last error text.
 */
async function postChat(body, { attempts = 4 } = {}) {
  let lastErr = '';
  for (let i = 0; i < attempts; i++) {
    try {
      const res = await fetch(`${base()}/chat/completions`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${process.env.DEEPSEEK_API_KEY}`,
        },
        body: JSON.stringify(body),
      });
      if (res.ok) return await res.json();
      lastErr = `${res.status}: ${(await res.text().catch(() => '')).slice(0, 200)}`;
      if (process.env.INGEST_DEBUG) console.error(`  [postChat attempt ${i + 1}] ${lastErr.slice(0, 90)}`);
      // 401 here is usually a bad upstream route, not a truly bad key — retry.
      if (res.status !== 401 && res.status !== 429 && res.status < 500) {
        throw new Error(`DeepSeek ${lastErr}`);
      }
    } catch (e) {
      lastErr = e.message;
    }
    if (i < attempts - 1) await sleep(600 * (i + 1));
  }
  throw new Error(`DeepSeek failed after ${attempts} attempts — ${lastErr}`);
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
export async function extractTopic(agentsMd, paperText, { model = defaultModel(), maxChars = 120000 } = {}) {
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
  let data;
  try {
    data = await postChat(body);
  } catch (e) {
    return { ok: false, error: e.message, topic: null };
  }
  const raw = data.choices?.[0]?.message?.content ?? '';
  let topic = null;
  try {
    topic = JSON.parse(raw.replace(/^```json\s*|\s*```$/g, ''));
  } catch (e) {
    return { ok: false, error: `unparseable JSON: ${e.message}`, raw, topic: null, usage: data.usage };
  }
  return { ok: true, topic, raw, usage: data.usage };
}

const REPORTED_BRIEF = `
You are reading a meta-analysis. Report ONLY the pooled/summary effect estimates the
AUTHORS themselves report (the forest-plot diamond or the headline pooled value) for each
outcome — NOT anything you compute yourself. These are used solely to sanity-check an
independent re-pooling; they are never published.

You are given the list of outcome ids used elsewhere. Use those SAME ids.

Output ONE JSON object only:
{"outcomes":[{"outcomeId":"<id>","measure":"RR|OR|HR|MD|SMD","point":<num>,"ciLow":<num>,"ciHigh":<num>,"ciLevel":95,"i2":<num or omit>}]}
Include only outcomes for which the paper prints a pooled estimate. Omit any you cannot find.
`;

/**
 * Extract the paper's REPORTED pooled values (the reproduction-gate target).
 * Kept separate from topic extraction so these numbers land in the sidecar,
 * never in topic.json. Returns { ok, reported: {outcomes:[…]}|null, raw, usage }.
 */
export async function extractReportedPooled(paperText, outcomeIds, { model = defaultModel(), maxChars = 120000 } = {}) {
  if (!hasKey()) return { ok: false, error: 'DEEPSEEK_API_KEY not set', reported: null };
  const text = paperText.length > maxChars ? paperText.slice(0, maxChars) : paperText;
  const body = {
    model,
    messages: [
      { role: 'system', content: REPORTED_BRIEF },
      {
        role: 'user',
        content: `Outcome ids to use: ${JSON.stringify(outcomeIds)}\n\nPaper:\n\n${text}`,
      },
    ],
    temperature: 0,
    response_format: { type: 'json_object' },
    max_tokens: 1500,
  };
  let data;
  try {
    data = await postChat(body);
  } catch (e) {
    return { ok: false, error: e.message, reported: null };
  }
  const raw = data.choices?.[0]?.message?.content ?? '{}';
  try {
    const reported = JSON.parse(raw.replace(/^```json\s*|\s*```$/g, ''));
    return { ok: true, reported, raw, usage: data.usage };
  } catch (e) {
    return { ok: false, error: `unparseable JSON: ${e.message}`, raw, reported: null, usage: data.usage };
  }
}

/**
 * triage.mjs—cheap go/no-go on a candidate before spending extraction tokens.
 * Uses the same DeepSeek worker (the maintainer's split: DeepSeek does all LLM
 * work, Claude only audits). Sees only the abstract + TLDR + section headings,
 * so it is a fraction of an extraction's cost.
 *
 * Absent DEEPSEEK_API_KEY it returns a no-go with a reason rather than throwing,
 * so the pipeline degrades safely (the paper simply stays `ranked`).
 */
import { hasKey } from './deepseek.mjs';

// Resolve at call time (see deepseek.mjs) — loadDotenv runs after imports.
const base = () => process.env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com';
const defaultModel = () => process.env.DEEPSEEK_MODEL || 'deepseek/deepseek-chat';

const TRIAGE_BRIEF = `
You are triaging a clinical paper for an evidence-aggregation site that pools
per-trial data from randomized/comparative studies. Decide if this paper is a
good fit to extract.

GOOD fit: a systematic review or meta-analysis that reports the CONSTITUENT
trials with per-arm counts or per-trial effect estimates (i.e. a forest plot we
can re-pool). Interventional (RCT) questions are ideal.

POOR fit: narrative reviews with no per-trial data, single small studies,
protocols, editorials, animal/in-vitro work, or papers that only give one pooled
number with no trial-level breakdown.

Respond with ONE JSON object only:
{"go": true|false, "confidence": 0..1, "primaryOutcome": "short label", "reason": "one sentence"}
`;

/**
 * Triage a candidate. Input is whatever context we have (abstract, optional
 * TLDR, optional headings). Returns { go, confidence, primaryOutcome, reason,
 * model, usage }.
 */
export async function triage({ abstract = '', tldr = '', headings = '' }, { model = defaultModel() } = {}) {
  if (!hasKey()) {
    return { go: false, confidence: 0, primaryOutcome: '', reason: 'no DEEPSEEK_API_KEY', model: null };
  }
  const context = [
    tldr && `TLDR: ${tldr}`,
    abstract && `ABSTRACT: ${abstract}`,
    headings && `SECTION HEADINGS: ${headings}`,
  ]
    .filter(Boolean)
    .join('\n\n');

  const body = {
    model,
    messages: [
      { role: 'system', content: TRIAGE_BRIEF },
      { role: 'user', content: context || '(no abstract available)' },
    ],
    temperature: 0,
    response_format: { type: 'json_object' },
    max_tokens: 300,
  };
  const res = await fetch(`${base()}/chat/completions`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${process.env.DEEPSEEK_API_KEY}`,
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    return {
      go: false,
      confidence: 0,
      primaryOutcome: '',
      reason: `triage HTTP ${res.status}`,
      model,
    };
  }
  const data = await res.json();
  const raw = data.choices?.[0]?.message?.content ?? '{}';
  let parsed = {};
  try {
    parsed = JSON.parse(raw.replace(/^```json\s*|\s*```$/g, ''));
  } catch {
    return { go: false, confidence: 0, primaryOutcome: '', reason: 'unparseable triage JSON', model };
  }
  return {
    go: Boolean(parsed.go),
    confidence: Number(parsed.confidence) || 0,
    primaryOutcome: parsed.primaryOutcome || '',
    reason: parsed.reason || '',
    model,
    usage: data.usage,
  };
}

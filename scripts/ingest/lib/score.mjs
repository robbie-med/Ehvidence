/**
 * score.mjs — compare an extracted topic JSON against a known-good ("gold") topic
 * and produce a faithfulness score. This is the heart of the calibration harness:
 * because the gold topics were verified against their papers by hand, matching a
 * candidate's per-study numbers to the gold is a direct measure of extraction
 * fidelity — no LLM and no source paper needed at scoring time.
 *
 * Pure functions, no dependencies, so they are unit-tested in the CI gate.
 */

/** Loose numeric equality: exact for integer counts, relative-tolerant for floats. */
export function numEq(a, b, { intField = false } = {}) {
  if (a == null || b == null) return a === b;
  if (typeof a !== 'number' || typeof b !== 'number') return String(a) === String(b);
  if (intField) return Math.round(a) === Math.round(b);
  const scale = Math.max(1e-9, Math.abs(a), Math.abs(b));
  return Math.abs(a - b) <= Math.max(0.005, scale * 0.01); // 1% or 0.005 abs
}

const INT_FIELDS = new Set(['txEvents', 'txTotal', 'ctrlEvents', 'ctrlTotal', 'txN', 'ctrlN', 'n']);
const DATA_FIELDS = {
  '2x2': ['txEvents', 'txTotal', 'ctrlEvents', 'ctrlTotal'],
  effect: ['measure', 'point', 'ciLow', 'ciHigh'],
  continuous: ['txMean', 'txSd', 'txN', 'ctrlMean', 'ctrlSd', 'ctrlN'],
  continuousEffect: ['measure', 'point', 'ciLow', 'ciHigh'],
};

/** Compare two `data` blocks; returns {fields, matched, kindMatch, detail[]}. */
export function compareData(cand, gold) {
  const detail = [];
  if (!cand || !gold) return { fields: 1, matched: 0, kindMatch: false, detail: ['missing data'] };
  if (cand.kind !== gold.kind) {
    return { fields: 1, matched: 0, kindMatch: false, detail: [`kind ${cand.kind} vs ${gold.kind}`] };
  }
  const fieldList = DATA_FIELDS[gold.kind] || [];
  let matched = 0;
  for (const f of fieldList) {
    const ok = numEq(cand[f], gold[f], { intField: INT_FIELDS.has(f) });
    if (ok) matched++;
    else detail.push(`${f}: ${cand[f]} vs ${gold[f]}`);
  }
  return { fields: fieldList.length, matched, kindMatch: true, detail };
}

function studyKey(s) {
  return `${(s.author || '').toLowerCase().replace(/[^a-z]/g, '')}|${s.year || ''}|${s.outcomeId || ''}`;
}

/**
 * Greedy match of candidate studies to gold studies by (author, year, outcome),
 * then by data similarity for the leftovers.
 */
export function matchStudies(candStudies = [], goldStudies = []) {
  const pairs = [];
  const usedCand = new Set();
  const byKey = new Map();
  candStudies.forEach((s, i) => {
    const k = studyKey(s);
    if (!byKey.has(k)) byKey.set(k, []);
    byKey.get(k).push(i);
  });
  const missing = [];
  for (const g of goldStudies) {
    const k = studyKey(g);
    const bucket = byKey.get(k) || [];
    const ci = bucket.find((i) => !usedCand.has(i));
    if (ci != null) {
      usedCand.add(ci);
      pairs.push({ cand: candStudies[ci], gold: g });
    } else {
      missing.push(g);
    }
  }
  const extra = candStudies.filter((_, i) => !usedCand.has(i));
  return { pairs, missing, extra };
}

/** Faithfulness score of a candidate topic vs the gold topic. */
export function scoreTopic(candidate, gold) {
  const cand = candidate || {};
  const { pairs, missing, extra } = matchStudies(cand.studies, gold.studies);

  let fields = 0;
  let matchedFields = 0;
  const dataMismatches = [];
  for (const { cand: c, gold: g } of pairs) {
    const cmp = compareData(c.data, g.data);
    fields += cmp.fields;
    matchedFields += cmp.matched;
    if (cmp.matched < cmp.fields) dataMismatches.push({ study: `${g.author} ${g.year}`, detail: cmp.detail });
  }

  // Outcome-level structure.
  const goldOut = new Map((gold.outcomes || []).map((o) => [o.id, o]));
  const candOut = new Map((cand.outcomes || []).map((o) => [o.id, o]));
  let dirOk = 0;
  let dirTot = 0;
  for (const [id, go] of goldOut) {
    const co = candOut.get(id);
    if (!co) continue;
    dirTot++;
    if (co.direction === go.direction) dirOk++;
  }

  const goldN = (gold.studies || []).length;
  const candN = (cand.studies || []).length;
  const numericAccuracy = fields > 0 ? matchedFields / fields : 0;
  const studyRecall = goldN > 0 ? pairs.length / goldN : 0;
  const studyPrecision = candN > 0 ? pairs.length / candN : 0;
  const directionAccuracy = dirTot > 0 ? dirOk / dirTot : 1;
  const outcomeRecall = goldOut.size > 0 ? [...goldOut.keys()].filter((k) => candOut.has(k)).length / goldOut.size : 0;

  // Headline: geometric-ish blend that punishes any single failure mode.
  const overall = numericAccuracy * studyRecall * directionAccuracy;

  return {
    slug: gold.slug,
    overall,
    numericAccuracy,
    studyRecall,
    studyPrecision,
    directionAccuracy,
    outcomeRecall,
    counts: { goldStudies: goldN, candStudies: candN, matched: pairs.length, missing: missing.length, extra: extra.length, fields, matchedFields },
    missing: missing.map((s) => `${s.author} ${s.year} (${s.outcomeId})`),
    extra: extra.map((s) => `${s.author} ${s.year} (${s.outcomeId})`),
    dataMismatches,
  };
}

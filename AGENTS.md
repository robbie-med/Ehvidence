# AGENTS.md — Rules for adding studies to Ehvidence

This file is the authoritative guide for any AI (or human) adding study data to
this repository. Follow it exactly. The site's credibility depends on the raw
data being faithful to the source and on **every** displayed statistic being
computed by the engine, not by you.

---

## 0. Cardinal rules (do not break these)

1. **Compute nothing yourself. Hardcode no derived value.** You enter only the
   raw numbers a source reports (event counts, arm means/SDs, or a ratio/effect
   *that the source itself reports* with its CI). You NEVER enter a pooled
   estimate, RR, OR, HR, SMD, NNT, % improvement, or I² that you calculated.
   The engine (`src/lib/stats.ts`) computes all of those live from the raw data.
2. **Never exclude a study, and never do your own meta-analysis.** Do not use
   `excludeFromPooled` to drop a trial you find inconvenient, to run a
   sensitivity analysis, or to make the pool match a published number. Include
   every relevant study. (`excludeFromPooled` exists only for the narrow case of
   a row that would double-count, e.g. a systematic review shown next to its own
   constituent trials — see §6.)
3. **Prefer the constituent trials, not a review's pooled number.** When the
   source is a meta-analysis, enter its individual trials (each as its own study
   record) so the engine pools them. Do NOT enter the review's pooled SMD/RR as
   a single "study." The site re-derives the pool on the fly; that is the point.
   It is expected and acceptable that the site's random-effects pool differs
   slightly from a paper that used a different model. State that in
   `methodologyNotes` if useful, but show the live computation.
4. **Be faithful to the source's framing. Do not reframe to inflate effects.**
   If the source reports a *beneficial* outcome (cure, effectiveness, response
   rate), encode it as a `higherIsBetter` outcome using the **success counts**.
   Do not encode the complement ("treatment failure") to make a small relative
   benefit look like a large one.
5. **Verify every count against the primary source.** Require 100% certainty for
   2x2 cell counts and arm means/SDs. If a number is not reported, do not invent
   it — use a `*Effect` form (a reported ratio/MD/SMD + CI) instead, and say so
   in `notes`.
6. **Keep prose minimal and factual.** `summary`, `interpretation`, and
   `methodologyNotes` are optional context. Do not editorialize, hedge, or pad.
   State only what the data and the source support.
7. **Punctuation:** use a tight em dash `—` (no surrounding spaces), and only
   when needed.

---

## 1. Where the data lives

- One JSON file per **topic** at `src/content/topics/<slug>.json`.
- `<slug>` must equal the `slug` field inside the file (url-safe, kebab-case).
- The file is validated against `src/content/config.ts` (Zod) at build time.
  Invalid data fails the build.

**Adding one study to an existing topic:** edit that topic's file and append a
study object to its `studies` array with the correct `outcomeId`. Do NOT make a
new topic. Use the **same `citation` string** the study already has elsewhere in
the file (study counts are de-duplicated by citation).

**Adding a new topic:** create a new file. Required topic fields are listed in §3.

---

## 2. Workflow you must follow

1. Read the source carefully. Extract, per outcome, the raw numbers each study
   reports (2x2 counts, arm mean/SD/n, or a reported effect + CI).
2. Write the JSON per the schema below.
3. Validate it: `node -e "JSON.parse(require('fs').readFileSync('<path>','utf8'))"`.
4. Build: `npm run build` must succeed (this runs schema validation) and
   `npm run test` must pass.
5. Save at `src/content/topics/<slug>.json` and commit.

Never push a file that fails the build.

---

## 3. Topic schema

```jsonc
{
  "slug": "kebab-case-id",            // REQUIRED, matches filename
  "name": "Human readable title",      // REQUIRED
  "condition": "...",                  // REQUIRED, the disease/population
  "intervention": "...",               // REQUIRED, the treatment
  "comparator": "...",                 // REQUIRED, what it is compared to
  "category": "Cardiovascular",        // REQUIRED, free-text grouping
  "evidenceClass": "efficacy",         // optional: efficacy | implementation | observational
  "summary": "One factual sentence.",  // REQUIRED, plain summary (no spin)
  "description": "...",                // optional, short background
  "interpretation": "...",             // optional, key caveats (terse)
  "methodologyNotes": "...",           // optional, how the numbers were obtained
  "status": "favorable",               // optional: favorable|harmful|limited|neutral
                                       //   OMIT unless overriding the auto value (see §7)
  "primaryOutcomeId": "outcome-id",    // REQUIRED, must match an outcomes[].id
  "lastUpdated": "2026-06-06",         // REQUIRED, ISO date
  "outcomes": [ /* see §4 */ ],         // REQUIRED, >= 1
  "studies":  [ /* see §5 */ ]          // REQUIRED
}
```

`evidenceClass` (controls presentation):
- `efficacy` — RCT/clinical-outcome evidence; NNT shown.
- `implementation` — quality-improvement / process-rate outcomes; NNT hidden.
- `observational` — non-randomized comparative data.

---

## 4. Outcome schema

```jsonc
{
  "id": "outcome-id",                  // REQUIRED, unique within the topic
  "label": "All-cause mortality",      // REQUIRED
  "direction": "lowerIsBetter",        // REQUIRED: lowerIsBetter | higherIsBetter
  "description": "...",                // optional
  "kind": "binary",                    // optional: binary (default) | continuous
  "measure": "SMD",                    // continuous only: MD | SMD
  "standardOutcomeId": "all-cause-mortality" // optional, see §8
}
```

- `direction`: a **bad** event (death, MI, recurrence) is `lowerIsBetter`. A
  **good** event (cure, response, effectiveness) is `higherIsBetter` — and you
  encode the success counts (see rule 4).
- `kind`:
  - `binary` (default): event/ratio outcomes (counts → RR, or a reported RR/OR/HR).
  - `continuous`: a measured quantity (days, a score, a lab value). Requires
    `measure`: `MD` (mean difference, same units across studies) or `SMD`
    (standardized, for combining different scales). Continuous outcomes have no
    RR/NNT; the no-effect value is 0.

---

## 5. Study schema and the four `data` kinds

```jsonc
{
  "id": "unique-id",                   // REQUIRED, unique within the topic
  "author": "Ridker",                  // REQUIRED, short author label
  "year": 2008,                        // REQUIRED, integer
  "citation": "Full citation text.",   // REQUIRED (same string per study across outcomes)
  "doi": "10.xxxx/...",                // optional
  "url": "https://...",                // optional, valid URL
  "design": "DB-RCT",                  // REQUIRED, see enum below
  "outcomeId": "outcome-id",           // REQUIRED, FK to an outcomes[].id
  "doseRegimen": "...",                // optional
  "population": "...",                 // optional
  "endpointDefinition": "verbatim",    // optional, the exact endpoint as defined
  "n": 8901,                           // optional, total analyzed (for *Effect forms)
  "excludeFromPooled": false,          // optional, almost always omit (see §6)
  "notes": "...",                      // optional, shown as a footnote
  "data": { /* ONE of the four kinds below */ }
}
```

`design` enum: `DB-RCT`, `RCT`, `pre-post`, `prospective`, `retrospective`,
`case-control`, `cohort`, `ecological`, `review`.

A study that reports several outcomes appears as **multiple records** (one per
outcome), each with the same `citation`.

### data kind A — `2x2` (binary outcome, per-arm counts) — PREFERRED
Use whenever the source gives events and totals per arm.
```jsonc
"data": { "kind": "2x2", "txEvents": 31, "txTotal": 8901, "ctrlEvents": 68, "ctrlTotal": 8901 }
```
Engine computes RR (Katz log-RR CI), ARR, NNT/NNH. Zero cells get a
Haldane-Anscombe correction automatically.

### data kind B — `effect` (binary outcome, reported ratio) 
Use when only a ratio + CI is reported (no per-arm counts). `measure` is the
ratio type. OR/HR are treated as RR-approximations and flagged.
```jsonc
"data": { "kind": "effect", "measure": "RR", "point": 0.75, "ciLow": 0.68, "ciHigh": 0.83, "ctrlRisk": 0.22 }
```
- `point`, `ciLow`, `ciHigh`: all positive, exactly as the source reports them.
- `ctrlRisk`: optional baseline (control) absolute risk. Include ONLY if the
  source reports it (or a reported NNT it implies); it enables an NNT. **Never
  invent it.** For a count/rate baseline it may exceed 1 (e.g. lesions/person).
- Set `n` on the study for the patient count.

### data kind C — `continuous` (continuous outcome, per-arm mean/SD/n) — PREFERRED for quantities
The outcome must have `"kind": "continuous"` and a `measure`.
```jsonc
"data": { "kind": "continuous", "txMean": 2.8, "txSd": 0.63, "txN": 55, "ctrlMean": 4.5, "ctrlSd": 0.75, "ctrlN": 55 }
```
Engine computes the MD or SMD (Hedges' g) + CI and pools by inverse-variance DL.

### data kind D — `continuousEffect` (continuous outcome, reported MD/SMD)
Use when only a reported MD/SMD + CI is available (no arm means/SDs).
```jsonc
"data": { "kind": "continuousEffect", "measure": "SMD", "point": -1.63, "ciLow": -2.08, "ciHigh": -1.18, "n": 687 }
```
Do NOT use this to enter a meta-analysis's pooled value in place of its trials
(rule 3). It is for a single study that reports only a summary statistic.

---

## 6. `excludeFromPooled` — when (rarely) to use it

The default is to omit it (i.e. every study is pooled). Set it `true` ONLY when
a row is shown for context but would double-count, specifically:
- A systematic review / pooled estimate displayed alongside the individual
  trials it already contains (e.g. a USPSTF or Cochrane row next to the RCTs).
Never use it to remove an outlier, to exclude a study the source included, or to
make the pool match a target number. That is altering the analysis.

---

## 7. `status` (evidence badge)

Usually **omit** `status`; it is auto-derived from the pooled result
(favorable if the CI excludes the null in the beneficial direction; limited if
fewer than 3 studies or too few events; etc.). Set it explicitly only to
override the auto value, and only with a justification in `methodologyNotes`
(e.g. a single landmark trial with a significant result that the 3-study rule
would otherwise label "limited"). Do not set it to make results look better.

---

## 8. `standardOutcomeId` (cross-intervention comparison)

If an outcome matches an entry in the controlled vocabulary in
`src/lib/standardOutcomes.ts` (currently: `scc-incidence`, `bcc-incidence`,
`nmsc-incidence`, `melanoma-incidence`, `all-cause-mortality`, `mi`, `stroke`,
`mace`), set `standardOutcomeId` to that id so the topic appears on the matching
`/compare/<id>` page. Match only on a genuinely identical outcome definition.
If nothing matches, omit it. Do not invent new ids in topic files; new standard
outcomes are added to the registry by a maintainer.

---

## 9. Minimal complete example (binary, two trials, one outcome)

```jsonc
{
  "slug": "example-statin-mortality",
  "name": "Example statin trial set",
  "condition": "Cardiovascular disease",
  "intervention": "Statin",
  "comparator": "Placebo",
  "category": "Cardiovascular",
  "evidenceClass": "efficacy",
  "summary": "Statins reduced all-cause mortality across two placebo-controlled trials.",
  "primaryOutcomeId": "acm",
  "lastUpdated": "2026-06-06",
  "outcomes": [
    { "id": "acm", "label": "All-cause mortality", "direction": "lowerIsBetter", "standardOutcomeId": "all-cause-mortality" }
  ],
  "studies": [
    { "id": "trialA-acm", "author": "TrialA", "year": 2008, "citation": "TrialA et al. NEJM 2008.", "design": "DB-RCT", "outcomeId": "acm",
      "data": { "kind": "2x2", "txEvents": 198, "txTotal": 8901, "ctrlEvents": 247, "ctrlTotal": 8901 } },
    { "id": "trialB-acm", "author": "TrialB", "year": 2003, "citation": "TrialB et al. Lancet 2003.", "design": "DB-RCT", "outcomeId": "acm",
      "data": { "kind": "2x2", "txEvents": 185, "txTotal": 5168, "ctrlEvents": 212, "ctrlTotal": 5137 } }
  ]
}
```

The engine then computes each RR, the pooled RR + CI, NNT, I², and status. You
write none of those numbers.

---

## 10. Self-check before committing

- [ ] Every number in `data` is copied verbatim from the source. No counts invented.
- [ ] No pooled/derived value (RR, NNT, SMD, I², %) is hardcoded anywhere.
- [ ] No study is excluded that the source included. `excludeFromPooled` is absent
      except for a review-vs-its-own-trials row.
- [ ] Beneficial outcomes use `higherIsBetter` + success counts (not the complement).
- [ ] A meta-analysis is entered as its constituent trials, not as one pooled row.
- [ ] `node` JSON parse passes; `npm run build` and `npm run test` pass.
- [ ] Prose is terse and factual; tight em dashes only where needed.

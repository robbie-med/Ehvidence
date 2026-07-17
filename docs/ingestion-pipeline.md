# Plan: background auto-ingestion of high-impact papers

**Goal.** A job on your own machine that continuously finds the most-cited /
highest-impact clinical meta-analyses on PubMed, extracts their per-trial data
into Ehvidence topics, and opens them for review — running quietly over months at
low cost, and **never fabricating a number**.

## Guiding principles

1. **Faithfulness over throughput.** The site's whole value is trustworthy data.
   The pipeline must *never auto-commit*; it opens a PR for human review. It self-
   detects likely fabrication before it ever asks for review (see the reproduction
   gate below).
2. **Cost is dominated by LLM extraction tokens**, so spend them only on vetted,
   high-value papers, and feed structured text (open-access XML + tables) instead of
   raw PDFs wherever possible. Everything else (discovery, ranking, validation) is
   free.
3. **One meta-analysis → one rich topic with many trials.** Highest value per token;
   also the format the schema + engine are built for.
4. **Reuse what exists.** The schema (`src/content/config.ts`), the rules
   (`AGENTS.md`), the build/test gate, and the pooling engine are the pipeline's
   validators. The reproduction check is already how we verify by hand.

## The safety gate that makes this viable

For every meta-analysis we already know the answer the paper reports (its pooled
RR/OR/HR/MD + CI + I²). After extraction, we build the topic, run the engine, and
**compare our live pooled estimate to the paper's reported one**. If they match
within tolerance, the per-trial extraction is almost certainly faithful; if they
diverge, something was mis-read (a count, a CI, a sign) — flag for a human. This is
a near-free, powerful fabrication/typo detector, and it's exactly the check we ran
manually on amnioinfusion, vitamin D, Bajaj, etc. It becomes an automated CI step.

## Architecture (six stages, cheap → expensive)

```
 discover ─▶ rank ─▶ triage ─▶ EXTRACT ─▶ validate+reproduce ─▶ open PR ─▶ human merge
  (free)    (free)  (cheap LLM) (strong LLM)   (free, local)      (free)
```

### 1. Discover (free — Node + public APIs)
- **PubMed E-utilities** `esearch` with filters: `("meta-analysis"[ptyp] OR
  "systematic review"[ptyp])` + a clinical scope, `hasabstract`, date windows.
- Enrich each PMID with an impact signal:
  - **NIH iCite** (free, batched): citation count + **Relative Citation Ratio (RCR)**
    — a field-normalized "influence" score, better than raw counts.
  - **Semantic Scholar** (free, rate-limited): citation count, *influential* citation
    count, and a one-line TLDR (useful for triage).
  - **Europe PMC** (free): citation counts **and** open-access full-text availability.
- ("Most read" isn't exposed by any free API; RCR + recency is the honest proxy.
  Altmetric would add social attention but is paid — skip for now.)

### 2. Rank & dedupe (free)
- Score = f(RCR, citations, recency, open-access, is-interventional-meta-analysis).
- Drop anything already covered (match on DOI/PMID/title against
  `src/content/topics/*.json` and a processed-manifest). Keep a queue.

### 3. Triage (cheap LLM — e.g. Haiku)
- On the abstract + TLDR + section headings only (tiny token cost), ask: *is this a
  meta-analysis of a health intervention vs a comparator, reporting per-trial effect
  data we could extract?* Prefer open-access. Output a go/no-go + confidence + the
  primary outcome. Cull hard here so the strong model only sees good candidates.

### 4. Extract (strong LLM — Sonnet/Opus; the only real cost)
- **Prefer open-access XML** (Europe PMC / PMC OA) + its tables/supplements over the
  PDF — no OCR, cleaner numbers. Fall back to PDF (pdftotext + page-image reading)
  only when necessary; forest plots are often images, so this is the expensive path.
- Prompt = `AGENTS.md` (the rules doc) + the paper text/figures. Produce topic JSON:
  per-trial rows for each outcome the review pools, `standardOutcomeId`/nodes where a
  registry match exists, terse prose. Emit its *own* provenance (source PMID/DOI, and
  the paper's reported pooled values, stored to compare against).
- Token thrift: only shortlisted papers reach here; feed structured text; cache by
  PMID so nothing is ever extracted twice.

### 5. Validate + reproduce (free — local)
- Zod schema parse → `npm run build` → `npm run test`. Any failure = reject/retry.
- **Reproduction gate**: engine pooled estimate vs the paper's reported pooled
  estimate, per outcome. Within tolerance → pass; else → attach the diff and mark
  "needs human eyes."
- Run the **methods auditor** (already built) on the new topic and attach its output
  to the PR — the reviewer immediately sees fragility, Egger, fixed-vs-random, etc.
- (Optional, for the top papers) a second independent extraction pass; disagreement
  between the two passes is another fabrication signal.

### 6. Open a PR (free) → human merges
- Branch + commit the new `*.json`, open a PR whose body is an auto-report:
  extracted outcomes, reproduction-check table (ours vs the paper's), auditor flags,
  and links to the source. **No auto-merge.** You skim and click merge; the daily
  README/coverage job and Pages deploy handle the rest.

## State, scheduling, cost control

- **State**: a small SQLite (or JSON) manifest — `{pmid, doi, status, scores,
  tokensUsed, costUSD, reproCheck, prUrl}` — so runs are incremental and resumable.
- **Scheduler**: a local cron / launchd job, e.g. hourly, processing **1–3 papers per
  run** with hard caps (`MAX_PAPERS_PER_DAY`, `MONTHLY_BUDGET_USD`). It sips, not
  floods — exactly the "over the next few months" cadence you want.
- **Cost knobs**: model tiering (Haiku triage, Sonnet extract, Opus only for the
  hardest/top papers), OA-XML-first, aggressive caching, and the free reproduction
  gate catching errors without extra LLM calls. Rough order of magnitude: a few
  cents of triage per 100 candidates, and single-digit dollars per *extracted*
  meta-analysis — so a steady 2–5/week is a few dollars a week, capped by budget.

## Two ways to build the worker

- **(a) Plain API script** (`scripts/ingest/`): Node orchestrator + Anthropic API
  calls per stage. Most control over cost; fully headless.
- **(b) Claude Code on a schedule**: point the Claude Code agent at a queue item with
  `AGENTS.md` as its brief — it already does "read paper → write JSON → build/test →
  open PR" (that's this whole session). Less glue code, uses the same agentic loop we
  validated by hand; cost is the agent's tokens. A hybrid is ideal: cheap Node for
  stages 1–3 & 5–6, Claude Code (or a strong-model call) only for stage 4.

## Rollout

- **P0** Discovery + ranking + manifest (free, no LLM) — prints a ranked candidate
  list you can eyeball. Proves the "find the important papers" half with zero spend.
- **P1** Triage + the reproduction gate wired to the existing build/test — still cheap.
- **P2** Extraction on a **hand-approved** shortlist, PR-per-paper with the auto-report.
  Human-in-the-loop from day one.
- **P3** Turn on the scheduler with budget caps; widen the shortlist as trust grows.
- **P4** (only if you ever want it) relax to auto-merge for papers that pass repro +
  auditor + a second-pass agreement — but given the project's standards, I'd keep a
  human on the merge button indefinitely.

## What I'd watch out for
- Forest-plot-as-image is the genuine hard case (needs vision/OCR); OA-XML-first
  dodges much of it, and the reproduction gate catches the rest before merge.
- Registry matching (`standardOutcomeId`, treatment nodes) needs a human or a curated
  map — the pipeline should leave them blank rather than guess, so a topic still lands
  correctly and can be linked into comparisons later.
- Duplicate/overlapping meta-analyses of the same question — dedupe on the question,
  not just the DOI, and prefer the newest/largest.

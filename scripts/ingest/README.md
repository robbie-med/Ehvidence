# Ingestion & calibration harness (run this on your own machine)

This is the local, low-cost pipeline for auto-adding papers (see
`docs/ingestion-pipeline.md` for the full design). It runs entirely on your
computer: **DeepSeek** does the cheap extraction, and free deterministic gates plus a
sampled **Claude** audit keep it honest. This folder currently ships the first,
highest-value piece: the **calibration harness**, which measures how faithfully
DeepSeek can re-extract papers whose correct answer we already have.

## Port to your machine

```bash
git clone https://github.com/robbie-med/Ehvidence.git
cd Ehvidence
npm install                     # site + test deps (Node 20+)
npm run build && npm run test   # confirm the site + gates work locally

# for PDF sources (paywalled papers):
#   macOS:  brew install poppler
#   Ubuntu: sudo apt-get install poppler-utils
```

Set your DeepSeek key (OpenAI-compatible API):

```bash
export DEEPSEEK_API_KEY=sk-...            # required for a real run
export DEEPSEEK_MODEL=deepseek-chat       # optional (deepseek-reasoner for hard papers)
```

## Prove the harness works (no key, no sources, no cost)

```bash
node scripts/ingest/calibrate.mjs --dry-run
```

This scores each gold topic against a deliberately corrupted copy of itself, so you
can see the scorer catch dropped studies and mistranscribed numbers. The scorer is
also unit-tested (`scripts/ingest/score.test.mjs`, part of `npm run test`).

## Calibrate DeepSeek for real

1. **Sources.** Open-access papers auto-fetch from Europe PMC (via the `pmid` in
   `scripts/ingest/gold-set.json`). For paywalled ones, drop the PDF at the `file`
   path listed there, e.g. `scripts/ingest/sources/amnioinfusion-meconium.pdf`.
2. **Run:**

   ```bash
   node scripts/ingest/calibrate.mjs                 # all gold papers
   node scripts/ingest/calibrate.mjs ntprobnp-guided-therapy-hf   # one
   ```

3. **Read the report.** Per paper you get `overall / numeric / study-recall /
   direction`, the missing/extra studies, the exact per-field `DIFF`s, and DeepSeek's
   token usage; then an **accuracy-by-type** summary. That tells you which paper types
   DeepSeek handles cleanly (usually open-access with tables) and which to escalate to
   Claude or a human (usually forest-plot-as-image).

## How this fits the pipeline

- The **gold set** (`gold-set.json`) is the topics verified by hand — the free ground
  truth. `slug` → `src/content/topics/<slug>.json` is the known-good answer.
- The **scorer** (`lib/score.mjs`) compares extracted per-study numbers to gold — a
  direct fidelity measure needing no LLM at scoring time.
- The **DeepSeek client** (`lib/deepseek.mjs`) uses `AGENTS.md` as its system prompt,
  so it follows the same rules a human/Claude does.
- The **source loader** (`lib/source.mjs`) prefers open-access XML (cheap) over PDF.

## Next pieces (not built yet — see docs/ingestion-pipeline.md)

- Live discovery/ranking (PubMed + iCite RCR + Semantic Scholar) → candidate queue.
- The reproduction gate for *live* papers (no gold): engine pooled vs the paper's
  reported pooled, wired into build/test.
- The every-50 Claude audit + PR-per-paper with the auto-report.

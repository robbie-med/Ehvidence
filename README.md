# Ehvidence

Real-time analysis of medical evidence, in the style of c19early.org, generalized to arbitrary
clinical topics. The home page lists topics; each topic gets its own page with a summary statistics
block, a forest plot, a dense study table, and computed **NNT/NNH**, relative risk, 95% CI, and a
random-effects pooled estimate.

## How it works

- **Data** lives as one JSON file per topic in `src/content/topics/`, validated against a Zod
  schema (`src/content/config.ts`) at build time. Invalid data fails the build.
- **Statistics** are computed from the raw data by `src/lib/stats.ts` (RR, Katz CI, NNT/NNH with
  continuity correction, DerSimonian–Laird pooling). The same module powers both the rendered pages
  and the data-entry GUI, so the numbers always agree. Unit tests in `src/lib/stats.test.ts`.
- **Pages** are static Astro routes; `src/pages/topics/[slug].astro` generates one page per topic.
- **Data-entry GUI** (`src/islands/DataEntryApp.tsx`, served at `/contribute`) turns a study's 2×2
  table — or a reported RR/OR/HR with its CI — into a validated data block, with live-computed
  metrics, and exports the topic JSON.

## Adding a topic

1. Open `/contribute`, fill in the topic + outcomes, add a card per study, review the live preview.
2. **Export JSON** and save it as `src/content/topics/<slug>.json`.
3. Commit. The build validates and generates the topic page automatically — no code changes needed.

(You can also hand-author the JSON following the schema; see `vitamin-k-vkdb.json` for an example.)

## Develop

```bash
npm install
npm run dev      # local dev server
npm run test     # run the statistics unit tests
npm run build    # static build into dist/
```

## Deploy

Pushing to the configured branch triggers `.github/workflows/deploy.yml`, which runs the tests,
builds the static site, and publishes it to GitHub Pages. Set the repository's Pages source to
"GitHub Actions". The base path is configured in `astro.config.mjs`.

## Disclaimer

Not medical advice. Pooled estimates are only as good as the extracted study data; seeded topics may
contain illustrative placeholder counts until verified extractions are entered (see each topic's
methodology notes). Released under CC0 1.0.

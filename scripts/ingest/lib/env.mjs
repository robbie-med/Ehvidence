/**
 * env.mjs—environment + Node-version helpers for the ingestion pipeline.
 *
 * Two hazards this guards against on the maintainer's box:
 *  1. The default `node` on PATH is v18, but `--env-file` (>=20.6) and tsx
 *     type-stripping want >=22. assertNode22() fails loud rather than silent.
 *  2. `.env` may need loading when a script is run without `--env-file`
 *     (e.g. under tsx). loadDotenv() is a tiny zero-dep fallback parser.
 */
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = join(HERE, '..', '..', '..');

/** Known-good Node >=22 binary on this host (bare `node` is v18). */
export const PINNED_NODE =
  process.env.EHVIDENCE_NODE ||
  `${process.env.HOME}/.local/share/pi-node/node-v22.23.1-linux-x64/bin/node`;

/** Absolute path to the Node binary the scheduler/systemd unit should invoke. */
export function pinnedNode() {
  return PINNED_NODE;
}

/** Throw unless the current runtime is Node >=22 (needed for --env-file/tsx). */
export function assertNode22() {
  const major = Number(process.versions.node.split('.')[0]);
  if (major < 22) {
    throw new Error(
      `Ehvidence ingestion requires Node >=22 (got ${process.version}). ` +
        `Invoke with the pinned binary: ${PINNED_NODE}`,
    );
  }
}

/**
 * Minimal .env loader: KEY=VALUE lines, `#` comments, optional surrounding
 * quotes. Only fills vars not already present in process.env, so a real
 * `--env-file` or exported var always wins. No-op if the file is absent.
 */
export function loadDotenv(path = join(REPO_ROOT, '.env')) {
  if (!existsSync(path)) return {};
  const out = {};
  for (const rawLine of readFileSync(path, 'utf8').split('\n')) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    let val = line.slice(eq + 1).trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    out[key] = val;
    if (process.env[key] === undefined) process.env[key] = val;
  }
  return out;
}

/** Read caps with sane defaults for the scheduler budget guard. */
export function readCaps() {
  return {
    maxPapersPerDay: Number(process.env.MAX_PAPERS_PER_DAY ?? 3),
    monthlyBudgetUSD: Number(process.env.MONTHLY_BUDGET_USD ?? 10),
  };
}

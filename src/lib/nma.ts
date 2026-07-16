/**
 * nma.ts—full contrast-based frequentist random-effects network meta-analysis.
 *
 * Each topic contributes one aggregate contrast (its pooled log-effect + variance
 * between a treatment node and a comparator node). Sharing a common comparator
 * across topics forms a network, letting us estimate relative effects—and a
 * ranking—for interventions that were never compared head to head. Estimation is
 * generalized least squares with a network method-of-moments heterogeneity τ².
 */

/* ----------------------------- tiny linear algebra ----------------------------- */

/** Invert a square matrix via Gauss–Jordan elimination. */
export function matInv(A: number[][]): number[][] {
  const n = A.length;
  const M = A.map((row, i) => [...row, ...Array.from({ length: n }, (_, j) => (i === j ? 1 : 0))]);
  for (let col = 0; col < n; col++) {
    // Partial pivot.
    let piv = col;
    for (let r = col + 1; r < n; r++) if (Math.abs(M[r][col]) > Math.abs(M[piv][col])) piv = r;
    if (Math.abs(M[piv][col]) < 1e-12) throw new Error('singular network matrix');
    [M[col], M[piv]] = [M[piv], M[col]];
    const d = M[col][col];
    for (let j = 0; j < 2 * n; j++) M[col][j] /= d;
    for (let r = 0; r < n; r++) {
      if (r === col) continue;
      const f = M[r][col];
      for (let j = 0; j < 2 * n; j++) M[r][j] -= f * M[col][j];
    }
  }
  return M.map((row) => row.slice(n));
}

function matT(A: number[][]): number[][] {
  return A[0].map((_, j) => A.map((row) => row[j]));
}
function matMul(A: number[][], B: number[][]): number[][] {
  return A.map((row) => B[0].map((_, j) => row.reduce((s, v, k) => s + v * B[k][j], 0)));
}
function matVec(A: number[][], v: number[]): number[] {
  return A.map((row) => row.reduce((s, x, k) => s + x * v[k], 0));
}

/* --------------------------------- normal CDF --------------------------------- */
function normalCdf(x: number): number {
  const t = 1 / (1 + 0.2316419 * Math.abs(x));
  const d = 0.3989423 * Math.exp((-x * x) / 2);
  const p = d * t * (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274))));
  return x > 0 ? 1 - p : p;
}

const Z95 = 1.959964;

/* ----------------------------------- model ----------------------------------- */

export interface Contrast {
  /** Treatment node label. */
  t: string;
  /** Comparator node label. */
  c: string;
  /** Log effect of t vs c (e.g. ln RR). */
  y: number;
  /** Variance of `y`. */
  v: number;
  /** Source topic slug (for provenance). */
  slug?: string;
}

export interface Pair {
  a: string;
  b: string;
  /** Natural-scale effect of a vs b (exp of the log contrast). */
  effect: number;
  ciLow: number;
  ciHigh: number;
  logEffect: number;
  se: number;
}

export interface NMAResult {
  nodes: string[];
  reference: string;
  tau2: number;
  connected: boolean;
  /** Relative effect of every node vs the reference (natural scale). */
  vsReference: Record<string, { effect: number; ciLow: number; ciHigh: number }>;
  /** Full league table: effect of row-vs-column for every ordered pair. */
  league: Pair[];
  /** Frequentist ranking (P-score, 0–1; higher = better given direction). */
  pScores: { node: string; pScore: number }[];
  contrasts: Contrast[];
}

/** True if every node is reachable from `ref` through the contrast edges. */
function isConnected(nodes: string[], contrasts: Contrast[], ref: string): boolean {
  const adj = new Map<string, Set<string>>();
  for (const n of nodes) adj.set(n, new Set());
  for (const c of contrasts) {
    adj.get(c.t)!.add(c.c);
    adj.get(c.c)!.add(c.t);
  }
  const seen = new Set([ref]);
  const stack = [ref];
  while (stack.length) {
    const cur = stack.pop()!;
    for (const nb of adj.get(cur)!) if (!seen.has(nb)) {
      seen.add(nb);
      stack.push(nb);
    }
  }
  return seen.size === nodes.length;
}

/**
 * Fit the network. `direction` decides which end of the scale is "better" for
 * the P-score ranking (lowerIsBetter → smaller effect ranks higher).
 */
export function fitNMA(
  contrasts: Contrast[],
  direction: 'lowerIsBetter' | 'higherIsBetter',
): NMAResult | null {
  const nodes = [...new Set(contrasts.flatMap((c) => [c.t, c.c]))].sort();
  if (nodes.length < 2 || contrasts.length < 1) return null;

  // Reference = the most-connected node (usually the common comparator).
  const degree = new Map<string, number>();
  for (const c of contrasts) {
    degree.set(c.t, (degree.get(c.t) ?? 0) + 1);
    degree.set(c.c, (degree.get(c.c) ?? 0) + 1);
  }
  const reference = [...nodes].sort((a, b) => (degree.get(b) ?? 0) - (degree.get(a) ?? 0))[0];
  const connected = isConnected(nodes, contrasts, reference);

  const basics = nodes.filter((n) => n !== reference);
  const idx = new Map(basics.map((n, i) => [n, i]));
  // Design matrix: +1 for treatment, −1 for comparator (reference column dropped).
  const X = contrasts.map((c) => {
    const row = new Array(basics.length).fill(0);
    if (c.t !== reference) row[idx.get(c.t)!] += 1;
    if (c.c !== reference) row[idx.get(c.c)!] -= 1;
    return row;
  });
  const d = contrasts.map((c) => c.y);

  const fit = (tau2: number) => {
    const W = contrasts.map((c) => 1 / (c.v + tau2));
    const Xt = matT(X);
    const XtW = Xt.map((row) => row.map((x, i) => x * W[i]));
    const XtWX = matMul(XtW, X);
    const cov = matInv(XtWX);
    const beta = matVec(cov, matVec(XtW, d));
    return { W, cov, beta };
  };

  // Network DerSimonian–Laird τ² from the fixed-effect residuals.
  const f0 = fit(0);
  const resid = contrasts.map((c, i) => c.y - (X[i].reduce((s, x, k) => s + x * f0.beta[k], 0)));
  const Q = resid.reduce((s, r, i) => s + f0.W[i] * r * r, 0);
  const df = contrasts.length - basics.length;
  // Scaling constant C = tr(W) − tr((XᵀWX)⁻¹ XᵀW²X).
  const Xt = matT(X);
  const XtW2 = Xt.map((row) => row.map((x, i) => x * f0.W[i] * f0.W[i]));
  const XtW2X = matMul(XtW2, X);
  const P = matMul(f0.cov, XtW2X);
  const trP = P.reduce((s, row, i) => s + row[i], 0);
  const sumW = f0.W.reduce((a, b) => a + b, 0);
  const C = sumW - trP;
  const tau2 = df > 0 && C > 0 ? Math.max(0, (Q - df) / C) : 0;

  const { cov, beta } = fit(tau2);

  // Node effects vs reference (log scale); reference is 0.
  const logVs = new Map<string, number>([[reference, 0]]);
  const varVs = new Map<string, number>([[reference, 0]]);
  basics.forEach((n, i) => {
    logVs.set(n, beta[i]);
    varVs.set(n, cov[i][i]);
  });
  const covVs = (a: string, b: string): number => {
    if (a === reference || b === reference) return 0;
    return cov[idx.get(a)!][idx.get(b)!];
  };

  const vsReference: NMAResult['vsReference'] = {};
  for (const n of nodes) {
    const l = logVs.get(n)!;
    const se = Math.sqrt(varVs.get(n)!);
    vsReference[n] = { effect: Math.exp(l), ciLow: Math.exp(l - Z95 * se), ciHigh: Math.exp(l + Z95 * se) };
  }

  // League: every ordered pair a vs b.
  const league: Pair[] = [];
  for (const a of nodes) {
    for (const b of nodes) {
      if (a === b) continue;
      const log = logVs.get(a)! - logVs.get(b)!;
      const se = Math.sqrt(varVs.get(a)! + varVs.get(b)! - 2 * covVs(a, b));
      league.push({
        a, b, logEffect: log, se,
        effect: Math.exp(log), ciLow: Math.exp(log - Z95 * se), ciHigh: Math.exp(log + Z95 * se),
      });
    }
  }

  // P-scores (Rücker & Schwarzer): mean prob. that node beats each competitor.
  const pScores = nodes.map((a) => {
    let sum = 0;
    let count = 0;
    for (const b of nodes) {
      if (a === b) continue;
      const log = logVs.get(a)! - logVs.get(b)!;
      const se = Math.sqrt(varVs.get(a)! + varVs.get(b)! - 2 * covVs(a, b));
      if (se <= 0) continue;
      // Favorable when a's effect is on the better side of the null vs b.
      const zFav = direction === 'lowerIsBetter' ? -log / se : log / se;
      sum += normalCdf(zFav);
      count += 1;
    }
    return { node: a, pScore: count > 0 ? sum / count : 0 };
  }).sort((x, y) => y.pScore - x.pScore);

  return { nodes, reference, tau2, connected, vsReference, league, pScores, contrasts };
}

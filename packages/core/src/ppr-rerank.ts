/**
 * Wave 2 — Personalized PageRank reranker post-pass.
 *
 * Runs after the cross-encoder rerank (reranker.ts) and before the
 * permanenceMultiplier map in contextSearch (context-packing.ts).
 *
 * Algorithm (see ~/.claude/plans/session-start-tranquil-zephyr.md for the full
 * derivation + adversarial-review history):
 *
 *   1. Build a column-stochastic adjacency matrix from typed memory_connections
 *      restricted to the candidate pool.
 *   2. Personalization vector p = min-max + L1 normalized rerank scores
 *      (uniform fallback if scores are degenerate).
 *   3. Power iteration r ← (1-d) p + d A_col r with damping d = teleportProbability,
 *      max 10 iters, early-stop on residual < 1e-4.
 *   4. Blend final = w · z(rerank) + (1-w) · z(ppr) using z-score normalization.
 *   5. Resort descending; stable secondary sort by id.
 *
 * Naming discipline (Saboteur F3):
 *   - teleportProbability (d) ∈ [0,1] — PPR damping (default 0.85)
 *   - rerankBlendWeight (w) ∈ [0,1] — final blend weight on rerank vs ppr (default 0.7)
 * The two are NEVER both called α in code or comments.
 *
 * Failure semantics: caller wraps in try/catch and substitutes pre-PPR ordering
 * on throw. NaN-guards are inline because NaN does not throw in JS.
 */

export interface PprCandidate {
  id: string;
  rerankScore: number;
}

export interface PprEdge {
  source: string;
  target: string;
  // relationship is unused in v1 (uniform weight = 1.0 per edge); kept on the
  // shape so a follow-up that adds per-relationship weighting doesn't need
  // a public-API change.
  relationship: string;
}

export interface PprResult {
  /** Ordered descending by blended score. Length === candidates.length. */
  ordered: Array<{ id: string; finalScore: number; rerankScore: number; pprScore: number }>;
  /** Telemetry surfaced into ContextMeta.pprPass (engaged is set by the caller). */
  meta: {
    iterations: number;
    converged: boolean;
    candidatePoolSize: number;
    edgeCount: number;
  };
}

export interface PprOptions {
  /** PPR damping; standard convention is 0.85. r ← (1-d) p + d A r. */
  teleportProbability?: number;
  /** Final blend weight on rerank vs ppr; final = w·z(rerank) + (1-w)·z(ppr). */
  rerankBlendWeight?: number;
  /** Hard upper bound on power iterations; early-stop on residual < residualEps. */
  maxIterations?: number;
  /** L1-norm convergence threshold for early stop. */
  residualEps?: number;
}

/**
 * Module constants — tuned offline by scripts/w2-ppr-shape-ab.mjs and
 * hardcoded per Cost/Scope F1. Re-run the pre-flight to retune.
 */
export const PPR_DEFAULTS = {
  teleportProbability: 0.85,
  rerankBlendWeight: 0.7,
  maxIterations: 10,
  residualEps: 1e-4,
} as const;

/**
 * Hard fast-path ceiling per Saboteur F12. hybridSearch caps at 200 candidates
 * (see context-packing.ts stage1Limit), so this is defense-in-depth: if the
 * pool somehow exceeds this, skip PPR entirely rather than blow the latency
 * budget on an out-of-spec input.
 */
export const PPR_MAX_POOL_SIZE = 200;

/**
 * Apply Personalized PageRank over a candidate pool using a typed
 * memory_connections subgraph. Returns the candidates re-ordered by a blend
 * of cross-encoder rerank score and PPR stationary distribution.
 *
 * Throws on structural input errors (mismatched IDs, NaN in rerank scores).
 * Callers MUST wrap in try/catch and fall back to the pre-PPR ordering.
 *
 * Returns input-order with empty meta if candidates.length === 0 OR
 * candidates.length > PPR_MAX_POOL_SIZE — both are no-op fast-paths, not errors.
 */
export function applyPprPass(
  candidates: PprCandidate[],
  edges: PprEdge[],
  options: PprOptions = {},
): PprResult {
  const teleport = clamp01(options.teleportProbability ?? PPR_DEFAULTS.teleportProbability);
  const blend = clamp01(options.rerankBlendWeight ?? PPR_DEFAULTS.rerankBlendWeight);
  const maxIter = Math.max(1, Math.floor(options.maxIterations ?? PPR_DEFAULTS.maxIterations));
  const eps = options.residualEps ?? PPR_DEFAULTS.residualEps;

  const N = candidates.length;
  if (N === 0 || N > PPR_MAX_POOL_SIZE) {
    return {
      ordered: candidates.map((c) => ({ id: c.id, finalScore: c.rerankScore, rerankScore: c.rerankScore, pprScore: 0 })),
      meta: { iterations: 0, converged: true, candidatePoolSize: N, edgeCount: 0 },
    };
  }

  // Reject NaN/Infinity rerank scores up front — propagating these would
  // poison the personalization vector and the z-score blend. Caller's
  // try/catch turns this into a fixed `pprError` token.
  for (let i = 0; i < N; i++) {
    if (!Number.isFinite(candidates[i].rerankScore)) {
      throw new Error(`ppr: non-finite rerank score at candidate ${candidates[i].id}`);
    }
  }

  // ID → column index. Edges referencing IDs not in candidates are silently
  // dropped (closed-subgraph design per S2; pre-flight Step 1 enforces that
  // rescue paths exist within the pool).
  const idToIdx = new Map<string, number>();
  for (let i = 0; i < N; i++) idToIdx.set(candidates[i].id, i);

  // ---------- Personalization vector p (min-max + L1, NaN-guarded) ----------
  const rerankScores = new Float32Array(N);
  let minScore = Infinity;
  for (let i = 0; i < N; i++) {
    rerankScores[i] = candidates[i].rerankScore;
    if (rerankScores[i] < minScore) minScore = rerankScores[i];
  }
  const shifted = new Float32Array(N);
  let sumShifted = 0;
  for (let i = 0; i < N; i++) {
    shifted[i] = rerankScores[i] - minScore; // ≥ 0
    sumShifted += shifted[i];
  }
  const p = new Float32Array(N);
  if (sumShifted > 0) {
    for (let i = 0; i < N; i++) p[i] = shifted[i] / sumShifted;
  } else {
    // NaN guard (Saboteur F6): all-equal scores → sumShifted = 0 → uniform p.
    const u = 1 / N;
    for (let i = 0; i < N; i++) p[i] = u;
  }

  // ---------- Build column-stochastic A ----------
  // Undirected (S8: column-stochastic naturally dampens hub influence — each
  // edge into a node contributes 1/degree(neighbor)). Self-loops skipped.
  // Duplicates within the pool deduped via Set.
  const adj = new Array<Set<number>>(N);
  for (let i = 0; i < N; i++) adj[i] = new Set<number>();
  let edgeCount = 0;
  for (const e of edges) {
    const si = idToIdx.get(e.source);
    const ti = idToIdx.get(e.target);
    if (si === undefined || ti === undefined) continue;
    if (si === ti) continue;
    const before = adj[si].size + adj[ti].size;
    adj[si].add(ti);
    adj[ti].add(si);
    if (adj[si].size + adj[ti].size > before) edgeCount++;
  }

  // Dense N×N column-stochastic transition matrix in row-major Float32Array.
  // M[targetIdx * N + sourceIdx] = transition prob from source to target.
  // Dangling-node convention (New Hire F4): zero-degree columns get the
  // personalization vector p (standard PPR treatment).
  const M = new Float32Array(N * N);
  for (let src = 0; src < N; src++) {
    const neighbors = adj[src];
    if (neighbors.size === 0) {
      // Dangling: column = p
      for (let dst = 0; dst < N; dst++) M[dst * N + src] = p[dst];
    } else {
      const w = 1 / neighbors.size;
      for (const dst of neighbors) M[dst * N + src] = w;
    }
  }

  // ---------- Power iteration ----------
  let r = new Float32Array(N);
  for (let i = 0; i < N; i++) r[i] = p[i]; // initial = personalization
  let next = new Float32Array(N);
  const oneMinusD = 1 - teleport;
  let iter = 0;
  let converged = false;
  for (iter = 0; iter < maxIter; iter++) {
    // next = (1-d) p + d * M r
    for (let dst = 0; dst < N; dst++) {
      let acc = 0;
      const rowOff = dst * N;
      for (let src = 0; src < N; src++) acc += M[rowOff + src] * r[src];
      next[dst] = oneMinusD * p[dst] + teleport * acc;
    }
    // L1 residual
    let l1 = 0;
    for (let i = 0; i < N; i++) l1 += Math.abs(next[i] - r[i]);
    const tmp = r; r = next; next = tmp; // swap
    if (l1 < eps) {
      iter++; // count this iteration as completed
      converged = true;
      break;
    }
  }
  if (!converged && iter === maxIter) {
    // Did all iterations without early-stop; convergence unverified.
    converged = false;
  }

  // ---------- Z-score normalize both vectors ----------
  // Saboteur F7: min-max'd reranker spreads mass evenly while PPR concentrates
  // on hubs. Same nominal scale, very different variance, makes raw-blend
  // uninterpretable. Z-score normalizes magnitude so blend weight is stable
  // across queries.
  const zRerank = zScore(rerankScores);
  const zPpr = zScore(r);

  // ---------- Blend ----------
  const finalScores = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    const v = blend * zRerank[i] + (1 - blend) * zPpr[i];
    if (!Number.isFinite(v)) {
      // Belt-and-suspenders (Saboteur F6): if a NaN slips through despite the
      // up-front guard, throw so the caller's catch records "ppr_nan_guard".
      throw new Error(`ppr: non-finite blended score at candidate ${candidates[i].id}`);
    }
    finalScores[i] = v;
  }

  // ---------- Order ----------
  // Sb-N9 in code-review round 1: when uniform reranker output meets a
  // non-trivial graph, both zRerank and zPpr collapse to all-zero — the blend
  // is then identically zero and the original tie-break (id.localeCompare)
  // produced an alphabetical ordering, silently replacing rerank ordering
  // with meaningless lexical sort. Fall back to input order on the
  // degenerate-blend case so the upstream rerank/RRF order is preserved.
  const ordered = candidates.map((c, i) => ({
    id: c.id,
    finalScore: finalScores[i],
    rerankScore: c.rerankScore,
    pprScore: r[i],
    inputIdx: i,
  }));
  ordered.sort((a, b) => {
    const d = b.finalScore - a.finalScore;
    if (Math.abs(d) > 1e-10) return d;
    // Tie-break: preserve input order (stable). NOT id.localeCompare —
    // that produces meaningless alphabetical ordering on degenerate blends.
    return a.inputIdx - b.inputIdx;
  });
  // Strip the helper field from the public shape.
  return {
    ordered: ordered.map((o) => ({
      id: o.id,
      finalScore: o.finalScore,
      rerankScore: o.rerankScore,
      pprScore: o.pprScore,
    })),
    meta: {
      iterations: iter,
      converged,
      candidatePoolSize: N,
      edgeCount,
    },
  };
}

// ---------- Helpers ----------

function clamp01(x: number): number {
  if (!Number.isFinite(x)) return 0.5;
  if (x < 0) return 0;
  if (x > 1) return 1;
  return x;
}

function zScore(xs: Float32Array): Float32Array {
  const n = xs.length;
  if (n === 0) return new Float32Array(0);
  let sum = 0;
  for (let i = 0; i < n; i++) sum += xs[i];
  const mean = sum / n;
  let varAcc = 0;
  for (let i = 0; i < n; i++) {
    const d = xs[i] - mean;
    varAcc += d * d;
  }
  const std = Math.sqrt(varAcc / n);
  const out = new Float32Array(n);
  if (std > 0) {
    for (let i = 0; i < n; i++) out[i] = (xs[i] - mean) / std;
  }
  // std === 0 (uniform input): return zeros — z-score is undefined, and a
  // uniform vector contributes nothing to the blend anyway.
  return out;
}

// ---------- Env config ----------

/**
 * Resolve PPR config from env. Mirror of selectRerankerProvider() / resolveRerankTopK().
 *
 *   • LODIS_PPR_RERANK_DISABLED=1 → off (kill switch — wins over ENABLED)
 *   • LODIS_PPR_RERANK_ENABLED=1  → on
 *   • LODIS_PPR_TIMEOUT_MS=200    → wall-clock budget for the SQL fetch (best-effort
 *                                    on the power iteration; see Saboteur F12 in plan)
 *
 * Returns { enabled, timeoutMs } so callers can decide whether to fetch edges
 * + run the pass at all.
 */
export interface PprConfig {
  enabled: boolean;
  timeoutMs: number;
}

export function resolvePprConfig(env: NodeJS.ProcessEnv = process.env): PprConfig {
  const enabled = (() => {
    if (env.LODIS_PPR_RERANK_DISABLED === "1") return false;
    if (env.LODIS_PPR_RERANK_ENABLED === "1") return true;
    return false;
  })();
  const raw = env.LODIS_PPR_TIMEOUT_MS;
  const parsed = raw ? Number(raw) : NaN;
  const timeoutMs = Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : 200;
  return { enabled, timeoutMs };
}

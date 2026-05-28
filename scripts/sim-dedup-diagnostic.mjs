// Dedup diagnostic: how prevalent are near-duplicate memories in the real
// corpus, and where do true-dups sit in cosine space? Informs (1) Phase 4
// cleanup sizing and (2) the threshold for any server-side auto-skip fix.
//
// Reads embeddings from ~/.lodis/lodis.db, normalizes, computes each memory's
// nearest-neighbor cosine, reports the distribution + top example pairs.
//
// Run: node scripts/sim-dedup-diagnostic.mjs

import { createClient } from "@libsql/client";
import os from "node:os";
import path from "node:path";

const c = createClient({ url: "file:" + path.join(os.homedir(), ".lodis", "lodis.db") });
const rows = (await c.execute(
  "SELECT id, content, vector_extract(embedding) AS v FROM memories WHERE embedding IS NOT NULL AND deleted_at IS NULL"
)).rows;

const N = rows.length;
const DIM = 384;
console.error(`[diag] ${N} embedded memories`);
const vecs = new Float32Array(N * DIM);
const content = [];
const domain = [];
for (let i = 0; i < N; i++) {
  const arr = JSON.parse(rows[i].v);
  let norm = 0;
  for (let d = 0; d < DIM; d++) norm += arr[d] * arr[d];
  norm = Math.sqrt(norm) || 1;
  for (let d = 0; d < DIM; d++) vecs[i * DIM + d] = arr[d] / norm;
  content.push(String(rows[i].content || ""));
}

const best = new Float32Array(N).fill(-1);
const bestJ = new Int32Array(N).fill(-1);
const t0 = Date.now();
for (let i = 0; i < N; i++) {
  const bi = i * DIM;
  for (let j = i + 1; j < N; j++) {
    const bj = j * DIM;
    let s = 0;
    for (let d = 0; d < DIM; d++) s += vecs[bi + d] * vecs[bj + d];
    if (s > best[i]) { best[i] = s; bestJ[i] = j; }
    if (s > best[j]) { best[j] = s; bestJ[j] = i; }
  }
  if (i % 500 === 0) process.stderr.write(`[diag] ${i}/${N}\n`);
}
console.error(`[diag] pairwise done in ${((Date.now() - t0) / 1000).toFixed(1)}s`);

// Cumulative distribution: # memories whose nearest neighbor is >= T.
const thresholds = [0.99, 0.97, 0.95, 0.92, 0.90, 0.85, 0.80, 0.70];
console.log("\n==== near-duplicate prevalence (nearest-neighbor cosine) ====");
console.log(`corpus: ${N} memories`);
for (const T of thresholds) {
  let n = 0;
  for (let i = 0; i < N; i++) if (best[i] >= T) n++;
  console.log(`NN cosine >= ${T.toFixed(2)}: ${n} memories (${(100 * n / N).toFixed(1)}%)`);
}

// Top example pairs (dedup by unordered pair), highest similarity first.
const pairs = [];
const seen = new Set();
for (let i = 0; i < N; i++) {
  const j = bestJ[i];
  if (j < 0) continue;
  const key = i < j ? `${i}-${j}` : `${j}-${i}`;
  if (seen.has(key)) continue;
  seen.add(key);
  pairs.push({ sim: best[i], a: content[i].slice(0, 70), b: content[j].slice(0, 70) });
}
pairs.sort((x, y) => y.sim - x.sim);
console.log("\n==== top 12 nearest pairs (eyeball: true dup vs distinct?) ====");
for (const p of pairs.slice(0, 12)) {
  console.log(`sim=${p.sim.toFixed(3)}\n   A: ${p.a}\n   B: ${p.b}`);
}
process.exit(0);

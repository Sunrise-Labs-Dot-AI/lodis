// W1a vec-side A/B: does bracketed-prefix reshape move the memory embedding
// CLOSER to realistic query embeddings than content+detail alone?
//
// This is the missing signal from w1a-prefix-shape-ab.mjs. That A/B measured
// reranker logits (stage 2). This measures cosine similarity between query
// and memory embeddings on the DENSE-VEC side (stage 1 of hybrid retrieval).
// Recall@10 depends on hybrid pool ordering, which depends on cosine.
//
// Uses @lodis/core's generateEmbedding (all-MiniLM-L6-v2, 384d, matches prod).

import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const coreDistPath = path.resolve("packages/core/dist/index.js");
if (!fs.existsSync(coreDistPath)) {
  console.error(`Missing ${coreDistPath}. Run 'pnpm --filter @lodis/core build' first.`);
  process.exit(1);
}
const core = await import(pathToFileURL(coreDistPath).href);
const { generateEmbedding } = core;

const ART = process.env.LODIS_MRCR_DATA_DIR;
if (!ART) {
  console.error("Missing LODIS_MRCR_DATA_DIR.");
  process.exit(1);
}
const memories = JSON.parse(fs.readFileSync(path.join(ART, "data/memories.json"), "utf8"));
const byId = new Map(memories.map((m) => [m.id, m]));

// Same helpers as w1a-prefix-shape-ab.mjs
function extractTags(sd) {
  if (!sd) return [];
  let obj;
  if (typeof sd === "string") { try { obj = JSON.parse(sd); } catch { return []; } }
  else obj = sd;
  if (!obj || typeof obj !== "object") return [];
  const tags = obj.tags;
  if (!Array.isArray(tags)) return [];
  return tags.filter((t) => typeof t === "string").map((t) => t.replace(/[\r\n\x1b\[\]{}]/g, "").trim()).filter((t) => t.length > 0).slice(0, 16);
}
function buildEmbedText(m) {
  const parts = [];
  const s = (x) => x.replace(/[\r\n\x1b\[\]{}]/g, "").trim();
  if (m.entity_name) parts.push(`[${s(m.entity_name)}]`);
  if (m.entity_type) parts.push(`[${m.entity_type}]`);
  if (m.domain) parts.push(`[${m.domain}]`);
  const tags = extractTags(m.structured_data);
  if (tags.length > 0) parts.push(`[${tags.join(", ")}]`);
  parts.push(m.content);
  if (m.detail) parts.push(m.detail);
  return parts.join(" ");
}
function legacyEmbedText(m) {
  return m.content + (m.detail ? " " + m.detail : "");
}

function cosine(a, b) {
  // all-MiniLM-L6-v2 outputs normalized vectors (per generateEmbedding), so
  // cosine == dot product.
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i] * b[i];
  return s;
}

// Same cases as the reranker A/B
const CASES = [
  { id: "04fb9f878ac51a325e2dab20667d5a20", label: "n4 nanny", queries: [
    "who is Person_0091's nanny",
    "nanny schedule hours calendar",
    "list the members of Person_0091's household including partner children and nanny",
  ]},
  { id: "b26ddf766fb9e003443939ee534fb0fd", label: "n5 Engrams infra", queries: [
    "which three infrastructure services does Engrams Pro tier use",
    "Engrams Clerk Turso Vercel deployment",
    "what is the origin and infrastructure of Engrams",
  ]},
  { id: "9c8f6f75668af90d6db928b71f7fce5d", label: "n7 Magda", queries: [
    "who did Person_0091 meet with about Marin real estate",
    "who is Person_0091's realtor",
    "what was discussed in the Marin County market meeting",
  ]},
];

console.error("Computing embeddings (legacy + reshape) for each miss memory + each query...\n");

const rows = [];
for (const c of CASES) {
  const m = byId.get(c.id);
  const legacyText = legacyEmbedText(m);
  const reshapeText = buildEmbedText(m);
  const legacyEmb = await generateEmbedding(legacyText);
  const reshapeEmb = await generateEmbedding(reshapeText);
  for (const q of c.queries) {
    const qEmb = await generateEmbedding(q);
    const cosLegacy = cosine(qEmb, legacyEmb);
    const cosReshape = cosine(qEmb, reshapeEmb);
    const delta = cosReshape - cosLegacy;
    rows.push({ label: c.label, query: q, cosLegacy, cosReshape, delta });
    console.error(`  ${c.label} | "${q.slice(0, 55)}"  legacy=${cosLegacy.toFixed(4)} reshape=${cosReshape.toFixed(4)} Δ=${delta > 0 ? "+" : ""}${delta.toFixed(4)}`);
  }
}

console.log("\n# W1a vec-side A/B (all-MiniLM-L6-v2 cosine)\n");
console.log("| Miss | Query | legacy cos | reshape cos | Δ |");
console.log("|---|---|---|---|---|");
for (const r of rows) {
  const sign = r.delta > 0 ? "+" : "";
  console.log(`| ${r.label} | ${r.query.slice(0, 55)} | ${r.cosLegacy.toFixed(4)} | ${r.cosReshape.toFixed(4)} | ${sign}${r.delta.toFixed(4)} |`);
}

const deltas = rows.map((r) => r.delta);
const median = [...deltas].sort((a, b) => a - b)[Math.floor(deltas.length / 2)];
const mean = deltas.reduce((s, x) => s + x, 0) / deltas.length;
const positive = deltas.filter((d) => d > 0).length;
console.log(`\n**Miss cosine Δ:** median=${median.toFixed(4)} mean=${mean.toFixed(4)} positive=${positive}/${rows.length}`);

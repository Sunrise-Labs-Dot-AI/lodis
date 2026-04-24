// PR2 Pre-flight A/B: does the bracketed-prefix embed-text shape
// (buildEmbedText → `[entity_name] [entity_type] [domain] [tags] content detail`)
// actually improve cross-encoder relevance over `content + detail` alone?
//
// Gate for PR2 implementation — structurally the same discipline that caught
// P1 earlier this session. If this A/B shows the reshape regresses cosine
// against the query, DO NOT implement PR2. Reshape to natural-prose variant
// and re-gate, OR bail W1a entirely.
//
// Uses @lodis/core's LocalReranker (BGE-reranker-base via Transformers.js, ~88MB
// first-run). Local-only, no Modal dependency, no network.
//
// Pass conditions (all three must hold to proceed with PR2):
//   (i)   Median Δ ≥ 0 across 3 miss memories × 3 needle-questions = 9 pairs.
//         We want no regression; improvement is better.
//   (ii)  7 contrast (non-miss) memories show median Δ in [-0.05, +0.05]
//         for the query that matches their content. Stability on neutral cases.
//   (iii) n7 Magda Meeting Notes specifically shows Δ ≥ +0.02 for at least one
//         of its needles. This is the target case W1a is designed to fix.

import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const coreDistPath = path.resolve("packages/core/dist/index.js");
if (!fs.existsSync(coreDistPath)) {
  console.error(`Missing ${coreDistPath}. Run 'pnpm --filter @lodis/core build' first.`);
  process.exit(1);
}
const core = await import(pathToFileURL(coreDistPath).href);
const { LocalReranker } = core;

// Load the MRCR corpus to get the real memory objects.
const ART = process.env.LODIS_MRCR_DATA_DIR;
if (!ART) {
  console.error("Missing LODIS_MRCR_DATA_DIR env var. Point it at a directory containing data/memories.json.");
  process.exit(1);
}
const memoriesPath = path.join(ART, "data/memories.json");
const memories = JSON.parse(fs.readFileSync(memoriesPath, "utf8"));
const byId = new Map(memories.map((m) => [m.id, m]));

// ---------- Helpers ----------

/**
 * Inline implementation of the PROPOSED buildEmbedText + extractTags from the
 * retrieval-wave-1 plan. Kept here (NOT imported from core) so this A/B runs
 * independently of whether W1a has been written. If the gate passes, these
 * exact functions get moved into packages/core/src/embeddings.ts.
 */
function extractTags(sd) {
  if (!sd) return [];
  let obj;
  if (typeof sd === "string") {
    try { obj = JSON.parse(sd); } catch { return []; }
  } else obj = sd;
  if (!obj || typeof obj !== "object") return [];
  const tags = obj.tags;
  if (!Array.isArray(tags)) return [];
  return tags
    .filter((t) => typeof t === "string")
    .map((t) => t.replace(/[\r\n\x1b\[\]{}]/g, "").trim())
    .filter((t) => t.length > 0)
    .slice(0, 16);
}

function buildEmbedText(memory) {
  const parts = [];
  const sanitize = (s) => s.replace(/[\r\n\x1b\[\]{}]/g, "").trim();
  if (memory.entity_name) parts.push(`[${sanitize(memory.entity_name)}]`);
  if (memory.entity_type) parts.push(`[${memory.entity_type}]`);
  if (memory.domain) parts.push(`[${memory.domain}]`);
  const tags = extractTags(memory.structured_data);
  if (tags.length > 0) parts.push(`[${tags.join(", ")}]`);
  parts.push(memory.content);
  if (memory.detail) parts.push(memory.detail);
  return parts.join(" ");
}

function legacyEmbedText(memory) {
  return memory.content + (memory.detail ? " " + memory.detail : "");
}

// ---------- Test cases ----------

// 3 MISS memories (the ones Stage C consistently fails to surface in top-10)
// × 3 realistic needle-questions each.
const MISS_CASES = [
  {
    memoryId: "04fb9f878ac51a325e2dab20667d5a20", // n4 nanny
    label: "n4 nanny",
    questions: [
      "who is Person_0091's nanny",
      "nanny schedule hours calendar",
      "list the members of Person_0091's household including partner children and nanny",
    ],
  },
  {
    memoryId: "b26ddf766fb9e003443939ee534fb0fd", // n5 Engrams infra
    label: "n5 Engrams infra",
    questions: [
      "which three infrastructure services does Engrams Pro tier use",
      "Engrams Clerk Turso Vercel deployment",
      "what is the origin and infrastructure of Engrams",
    ],
  },
  {
    memoryId: "9c8f6f75668af90d6db928b71f7fce5d", // n7 Magda
    label: "n7 Magda",
    questions: [
      "who did Person_0091 meet with about Marin real estate",
      "who is Person_0091's realtor",
      "what was discussed in the Marin County market meeting",
    ],
  },
];

// 7 CONTRAST memories — memories that SHOULD match their own query well under
// BOTH shapes. Stability check: the reshape shouldn't degrade these.
// Pick memories that have rich metadata (entity_name + tags + domain) so the
// bracketed prefix has signal to add.
const CONTRAST_CASES = [
  { memoryId: "1c9d9f37252c5db321914edfdd6abd3d", query: "household roster family kids dog" },
  { memoryId: "795dcb6fadb2057e2df80f2629ac904e", query: "anthropic interview PM consumer role" },
  { memoryId: "22fd2f66658a4a4b87fbd9368b6a16e5", query: "SoCal trip March 2026 flights" },
  { memoryId: "841bc943d5dadc6df3e5d4d5a6844cd3", query: "Sitter babysitter coordination app" },
  { memoryId: "f540bdf4fcd598feb5da7ba5d5e210d6", query: "Marin County Tiburon property research" },
  { memoryId: "2c6c5a4f70a55e80884212089eb858b4", query: "Sierra AI advice PM career" },
  { memoryId: "aea340d98be282e13263dcb800d3ebf6", query: "anthropic mission personal motivation family" },
];

// ---------- Run ----------

console.error("Loading BGE-reranker-base (first run may download ~88MB)...");
const reranker = new LocalReranker();

async function scorePair(query, text, id) {
  const out = await reranker.rerank(query, [{ id, text }], { topK: 1 });
  return out[0].score;
}

function dump(memoryId) {
  const m = byId.get(memoryId);
  if (!m) throw new Error(`Memory not found in corpus: ${memoryId}`);
  return m;
}

console.error("\n== Miss cases (3 memories × 3 questions = 9 pairs) ==\n");
const missRows = [];
for (const c of MISS_CASES) {
  const m = dump(c.memoryId);
  const legacy = legacyEmbedText(m);
  const reshape = buildEmbedText(m);
  for (const q of c.questions) {
    const sLegacy = await scorePair(q, legacy, "legacy");
    const sReshape = await scorePair(q, reshape, "reshape");
    const delta = sReshape - sLegacy;
    missRows.push({ label: c.label, question: q, sLegacy, sReshape, delta });
    console.error(
      `  ${c.label} | "${q.slice(0, 60)}"  legacy=${sLegacy.toFixed(4)} reshape=${sReshape.toFixed(4)} Δ=${delta > 0 ? "+" : ""}${delta.toFixed(4)}`,
    );
  }
}

console.error("\n== Contrast cases (7 memories × 1 question = 7 pairs) ==\n");
const contrastRows = [];
for (const c of CONTRAST_CASES) {
  const m = dump(c.memoryId);
  const legacy = legacyEmbedText(m);
  const reshape = buildEmbedText(m);
  const sLegacy = await scorePair(c.query, legacy, "legacy");
  const sReshape = await scorePair(c.query, reshape, "reshape");
  const delta = sReshape - sLegacy;
  const label = m.entity_name || m.content.slice(0, 40);
  contrastRows.push({ label, query: c.query, sLegacy, sReshape, delta });
  console.error(
    `  ${label.slice(0, 40)} | "${c.query.slice(0, 40)}"  legacy=${sLegacy.toFixed(4)} reshape=${sReshape.toFixed(4)} Δ=${delta > 0 ? "+" : ""}${delta.toFixed(4)}`,
  );
}

// ---------- Report ----------

function median(arr) {
  if (arr.length === 0) return null;
  const s = [...arr].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
}
function mean(arr) {
  if (arr.length === 0) return null;
  return arr.reduce((s, x) => s + x, 0) / arr.length;
}

const missDeltas = missRows.map((r) => r.delta);
const missMedian = median(missDeltas);
const missMean = mean(missDeltas);
const missPositive = missDeltas.filter((d) => d > 0).length;

const contrastDeltas = contrastRows.map((r) => r.delta);
const contrastMedian = median(contrastDeltas);
const contrastInBand = contrastDeltas.filter((d) => d >= -0.05 && d <= 0.05).length;

const magdaDeltas = missRows.filter((r) => r.label === "n7 Magda").map((r) => r.delta);
const magdaBest = Math.max(...magdaDeltas);

console.log("\n# PR2 pre-flight A/B: bracketed-prefix buildEmbedText shape\n");
console.log(`Reranker: @lodis/core LocalReranker (BGE-reranker-base)`);
console.log(`Miss samples: 3 memories × 3 questions = ${missRows.length}`);
console.log(`Contrast samples: 7 memories × 1 question = ${contrastRows.length}\n`);

console.log("## Miss cases\n");
console.log("| Memory | Question | legacy | reshape | Δ |");
console.log("|---|---|---|---|---|");
for (const r of missRows) {
  const sign = r.delta > 0 ? "+" : "";
  console.log(`| ${r.label} | ${r.question.slice(0, 60)} | ${r.sLegacy.toFixed(4)} | ${r.sReshape.toFixed(4)} | ${sign}${r.delta.toFixed(4)} |`);
}

console.log("\n## Contrast cases\n");
console.log("| Memory | Query | legacy | reshape | Δ |");
console.log("|---|---|---|---|---|");
for (const r of contrastRows) {
  const sign = r.delta > 0 ? "+" : "";
  console.log(`| ${r.label.slice(0, 40)} | ${r.query} | ${r.sLegacy.toFixed(4)} | ${r.sReshape.toFixed(4)} | ${sign}${r.delta.toFixed(4)} |`);
}

console.log("\n## Summary");
console.log(`- Miss median Δ: ${missMedian > 0 ? "+" : ""}${missMedian.toFixed(4)}`);
console.log(`- Miss mean Δ: ${missMean > 0 ? "+" : ""}${missMean.toFixed(4)}`);
console.log(`- Miss positive: ${missPositive}/${missRows.length}`);
console.log(`- Contrast median Δ: ${contrastMedian > 0 ? "+" : ""}${contrastMedian.toFixed(4)}`);
console.log(`- Contrast in-band [-0.05, +0.05]: ${contrastInBand}/${contrastRows.length}`);
console.log(`- n7 Magda best Δ: ${magdaBest > 0 ? "+" : ""}${magdaBest.toFixed(4)}`);

console.log("\n## Gate\n");
const gateA = missMedian >= 0;
const gateB = contrastMedian >= -0.05 && contrastMedian <= 0.05;
const gateC = magdaBest >= 0.02;
console.log(`- (i)   Miss median Δ ≥ 0: ${gateA ? "✅" : "❌"}`);
console.log(`- (ii)  Contrast median in [-0.05, +0.05]: ${gateB ? "✅" : "❌"}`);
console.log(`- (iii) n7 Magda best Δ ≥ +0.02: ${gateC ? "✅" : "❌"}`);
console.log();
if (gateA && gateB && gateC) {
  console.log(`✅ **PROCEED** — all three gates pass. Implement PR2 W1a.`);
  process.exit(0);
} else {
  console.log(`❌ **ABORT** — at least one gate failed. Do NOT implement W1a with this shape.`);
  console.log(`Write handoff-w1a-prefix-bail.md capturing the result. Consider natural-prose variant.`);
  process.exit(1);
}

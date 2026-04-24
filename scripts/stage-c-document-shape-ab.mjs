// P1a Pre-flight A/B: does stripping `[Document] ` prefix + em-dash meaningfully
// improve cross-encoder reranker scores?
//
// Falsify or confirm the claim before spending time on the P1 backfill.
// Gate: median Δ ≥ 0.02 across (memory × question) pairs. If below, abort P1c.
//
// Uses @lodis/core's LocalReranker (BGE-reranker-base via Transformers.js).
// BGE is MORE quality-sensitive than the production MiniLM reranker — if BGE
// shows Δ ≥ 0.02, MiniLM almost certainly does too. First run downloads
// ~88MB model under ~/.cache/transformers; subsequent runs are ~20s warm.
//
// Why local, not Modal: Modal workspace billing hit its spend limit during
// P1a preparation. BGE-local is a fair proxy and unblocks the gate.

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

// Sample memories + realistic questions. Content strings are verbatim copies
// from the live mrcr-bench memories written by memory_index — so this A/B
// reflects the exact production shape.
const CASES = [
  {
    label: "Magda Meeting Notes",
    original: "[Document] Magda Meeting Notes — Notes from Nov 2025 meeting with realtor Magda about Marin County market. Covers pricing dynamics, Tiburon vs Mill Valley value, seasonal inventory patterns, and next steps.",
    reshaped: "Magda Meeting Notes. Notes from Nov 2025 meeting with realtor Magda about Marin County market. Covers pricing dynamics, Tiburon vs Mill Valley value, seasonal inventory patterns, and next steps.",
    questions: [
      "who did Person_0091 meet with about Marin real estate",
      "who is Person_0091's realtor",
      "what was discussed in the Marin County market meeting",
    ],
  },
  {
    label: "Marin Stack Rank for Magda",
    original: "[Document] Person_0091/Person_0023 Marin Stack Rank for Magda — Prioritized home search criteria for Marin County. Covers bedroom/bathroom count, square footage, school district, yard space, walkability, and commute. Shared with realtor Magda.",
    reshaped: "Person_0091/Person_0023 Marin Stack Rank for Magda. Prioritized home search criteria for Marin County. Covers bedroom/bathroom count, square footage, school district, yard space, walkability, and commute. Shared with realtor Magda.",
    questions: [
      "what are Person_0091's home search priorities in Marin",
      "what criteria did Person_0091 share with his realtor",
      "Person_0091 home search bedroom bathroom school district",
    ],
  },
  {
    label: "Property Tax",
    original: "[Document] Property Tax — Property tax document, likely related to current home or Marin County home search.",
    reshaped: "Property Tax. Property tax document, likely related to current home or Marin County home search.",
    questions: [
      "what does Person_0091 know about property tax",
      "Person_0091 home property tax documents",
      "Marin County home search tax information",
    ],
  },
  {
    label: "Anthropic Interview Prep",
    original: "[Document] Anthropic — Interview Prep — Interview prep for Anthropic PM Consumer role. Covers building autonomous systems on Claude APIs, AI adoption at Mill, and real conviction about AI products.",
    reshaped: "Anthropic — Interview Prep. Interview prep for Anthropic PM Consumer role. Covers building autonomous systems on Claude APIs, AI adoption at Mill, and real conviction about AI products.",
    questions: [
      "how did Person_0091 prep for the Anthropic interview",
      "Person_0091 Anthropic interview preparation notes",
      "what topics did Person_0091 plan to discuss at Anthropic",
    ],
  },
  {
    label: "Recruiting Copilot HQ",
    original: "[Document] Recruiting Copilot HQ — Central hub for the job search. Everything Claude needs to help find jobs, prep for interviews, and land an offer.",
    reshaped: "Recruiting Copilot HQ. Central hub for the job search. Everything Claude needs to help find jobs, prep for interviews, and land an offer.",
    questions: [
      "where does Person_0091 keep his job search notes",
      "Person_0091 job search central hub",
      "Person_0091 recruiting copilot workspace",
    ],
  },
];

console.error("Loading local BGE-reranker-base (first run may download ~88MB)...");
const reranker = new LocalReranker();

async function scorePair(question, text, id) {
  const results = await reranker.rerank(question, [{ id, text }], { topK: 1 });
  return results[0].score;
}

console.error("Scoring pairs...\n");
const rows = [];
const t0 = Date.now();
for (const c of CASES) {
  for (const q of c.questions) {
    try {
      const sOrig = await scorePair(q, c.original, "orig");
      const sReshape = await scorePair(q, c.reshaped, "reshape");
      const delta = sReshape - sOrig;
      rows.push({ label: c.label, question: q, sOrig, sReshape, delta });
      console.error(`  ${c.label} | "${q.slice(0, 60)}"  orig=${sOrig.toFixed(4)} reshape=${sReshape.toFixed(4)} Δ=${delta > 0 ? "+" : ""}${delta.toFixed(4)}`);
    } catch (err) {
      console.error(`  ERROR ${c.label} | "${q.slice(0, 60)}": ${err.message}`);
      rows.push({ label: c.label, question: q, error: err.message });
    }
  }
}
console.error(`\nTotal scoring time: ${((Date.now() - t0) / 1000).toFixed(1)}s`);

// ---------- Report ----------
console.log("\n# P1a pre-flight A/B: [Document] prefix shape impact on cross-encoder\n");
console.log(`Reranker: @lodis/core LocalReranker (Xenova/bge-reranker-base)`);
console.log(`Samples: ${CASES.length} memories × ~3 questions = ${rows.length} pairs\n`);
console.log("| Memory | Question | Orig score | Reshape score | Δ |");
console.log("|---|---|---|---|---|");
for (const r of rows) {
  if (r.error) {
    console.log(`| ${r.label} | ${r.question.slice(0, 60)}... | — | — | ERROR |`);
  } else {
    const sign = r.delta > 0 ? "+" : "";
    console.log(`| ${r.label} | ${r.question.slice(0, 60)}... | ${r.sOrig.toFixed(4)} | ${r.sReshape.toFixed(4)} | ${sign}${r.delta.toFixed(4)} |`);
  }
}

const validDeltas = rows.filter((r) => !r.error).map((r) => r.delta).sort((a, b) => a - b);
const median = validDeltas.length > 0 ? validDeltas[Math.floor(validDeltas.length / 2)] : null;
const mean = validDeltas.length > 0 ? validDeltas.reduce((s, d) => s + d, 0) / validDeltas.length : null;
const positive = validDeltas.filter((d) => d > 0).length;

console.log(`\n**Summary**`);
console.log(`- Valid pairs: ${validDeltas.length}/${rows.length}`);
console.log(`- Median Δ: ${median !== null ? (median > 0 ? "+" : "") + median.toFixed(4) : "N/A"}`);
console.log(`- Mean Δ: ${mean !== null ? (mean > 0 ? "+" : "") + mean.toFixed(4) : "N/A"}`);
console.log(`- Positive deltas: ${positive}/${validDeltas.length}`);

console.log(`\n## Gate`);
if (median !== null && median >= 0.02) {
  console.log(`✅ **PROCEED** — median Δ=${median.toFixed(4)} meets the 0.02 threshold. P1c backfill is justified.`);
  process.exit(0);
} else {
  console.log(`❌ **ABORT** — median Δ=${median !== null ? median.toFixed(4) : "N/A"} below 0.02 threshold.`);
  console.log(`Write handoff-document-shape-bail.md capturing the result; do NOT run the backfill.`);
  process.exit(1);
}

// Stage B benchmark for the cross-encoder reranker.
//
// Same rehydrate-and-query setup as scripts/stage-a-diagnostic.mjs, but now
// exercising the *full* contextSearch pipeline (including the new reranker
// stage inside context-packing.ts). Measures retrieval_recall_at_k=10 per
// needle — i.e. how many ground-truth IDs appear in the top-10 memories
// returned by memory_context after reranking.
//
// Gate from the plan: recall@10 must improve from the ~17% Stage A baseline
// to ≥ 45%. Stretch goal: 80%+ (since top-200 contains 94% of GT IDs, a
// well-calibrated reranker should surface most of them into top-10).

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

const coreDistPath = path.resolve("packages/core/dist/index.js");
if (!fs.existsSync(coreDistPath)) {
  console.error(`Missing ${coreDistPath}. Run 'pnpm --filter @lodis/core build' first.`);
  process.exit(1);
}
const core = await import(pathToFileURL(coreDistPath).href);
const { createDatabase, contextSearch, generateEmbeddings } = core;

const ART = "/Users/jamesheath/Documents/Claude/Projects/Anthropic Take Home Demo/simulation";
const memoriesPath = path.join(ART, "data/memories.json");
const needlesPath = path.join(ART, "needles-public.json");

const GROUND_TRUTH = {
  n1_anthropic_interview: [
    "795dcb6fadb2057e2df80f2629ac904e",
    "b472213204e816ff2caa03142d938383",
    "7ed5c23f62254b0b2ff72a816e7dc97b",
  ],
  n2_sierra_advice: [
    "2c6c5a4f70a55e80884212089eb858b4",
    "538b0c561f0677dbb25cdbfa3262343f",
  ],
  n3_socal_trip: ["22fd2f66658a4a4b87fbd9368b6a16e5"],
  n4_household_roster: [
    "1c9d9f37252c5db321914edfdd6abd3d",
    "04fb9f878ac51a325e2dab20667d5a20",
    "462face88053814e141a3cca127f6c08",
    "78d7f4bd29fe29cbfa6cd605b18494dc",
  ],
  n5_engrams_origin_infra: [
    "f8095ca4f3aae04bec1de7c2c726bfdc",
    "b26ddf766fb9e003443939ee534fb0fd",
  ],
  n6_two_products: [
    "841bc943d5dadc6df3e5d4d5a6844cd3",
    "f8095ca4f3aae04bec1de7c2c726bfdc",
  ],
  n7_marin_search: [
    "f540bdf4fcd598feb5da7ba5d5e210d6",
    "5f8d5f07ff42ebe7fde7a2636e975af1",
    "9c8f6f75668af90d6db928b71f7fce5d",
  ],
  n8_anthropic_motivation: ["aea340d98be282e13263dcb800d3ebf6"],
};

const needleSpec = JSON.parse(fs.readFileSync(needlesPath, "utf8"));
const NEEDLES = needleSpec.needles;
const memories = JSON.parse(fs.readFileSync(memoriesPath, "utf8"));
console.error(`Loaded ${memories.length} memories and ${NEEDLES.length} needles.`);

// --- Temp DB setup (same as Stage A) ---
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "lodis-stage-b-"));
const dbPath = path.join(tmpDir, "stage-b.db");
const url = "file:" + dbPath;
console.error(`Temp DB: ${dbPath}`);
const { client, vecAvailable } = await createDatabase({ url });
console.error(`vecAvailable=${vecAvailable}`);

console.error("Generating embeddings...");
const embedTexts = memories.map((m) => m.content + (m.detail ? " " + m.detail : ""));
const t0 = Date.now();
const embeddings = await generateEmbeddings(embedTexts);
console.error(`Embeddings generated in ${((Date.now() - t0) / 1000).toFixed(1)}s.`);

console.error("Inserting memories...");
const BATCH = 200;
for (let i = 0; i < memories.length; i += BATCH) {
  const chunk = memories.slice(i, i + BATCH);
  const stmts = [];
  for (let j = 0; j < chunk.length; j++) {
    const m = chunk[j];
    const emb = embeddings[i + j];
    stmts.push({
      sql: `INSERT INTO memories (
        id, content, detail, domain,
        source_agent_id, source_agent_name,
        source_type, source_description,
        confidence, learned_at, has_pii_flag,
        entity_type, entity_name, structured_data,
        permanence, expires_at, user_id
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      args: [
        m.id,
        m.content,
        m.detail ?? null,
        m.domain ?? "general",
        "stage-b",
        "stage-b-benchmark",
        m.source_type ?? "observed",
        m.source_description ?? null,
        m.confidence ?? 0.75,
        m.learned_at ?? new Date().toISOString(),
        0,
        m.entity_type ?? null,
        m.entity_name ?? null,
        m.structured_data ? (typeof m.structured_data === "string" ? m.structured_data : JSON.stringify(m.structured_data)) : null,
        m.permanence ?? "active",
        null,
        null,
      ],
    });
    if (emb) {
      stmts.push({
        sql: `UPDATE memories SET embedding = vector(?) WHERE id = ?`,
        args: [JSON.stringify(Array.from(emb)), m.id],
      });
    }
  }
  await client.batch(stmts, "write");
}
await client.execute({ sql: `INSERT INTO memory_fts(memory_fts) VALUES('rebuild')`, args: [] });
await client.execute({
  sql: `INSERT OR REPLACE INTO lodis_meta (key, value) VALUES ('last_modified', ?)`,
  args: [new Date().toISOString()],
});

// --- Run contextSearch (the full pipeline) per needle ---
async function runOne(rerankerEnabled, needle) {
  if (rerankerEnabled) delete process.env.LODIS_RERANKER_DISABLED;
  else process.env.LODIS_RERANKER_DISABLED = "1";

  const gt = GROUND_TRUTH[needle.id] ?? [];
  const start = Date.now();
  const result = await contextSearch(client, needle.question, {
    tokenBudget: 6000,
    format: "hierarchical",
  });
  const elapsed = Date.now() - start;

  const returnedIds = result.returnedMemoryIds ?? [];
  const primary =
    result.meta.format === "hierarchical"
      ? result.primary.memories.map((m) => m.id)
      : returnedIds;

  const ranks = gt.map((id) => ({
    id,
    rankInReturned: returnedIds.indexOf(id) === -1 ? null : returnedIds.indexOf(id) + 1,
    inPrimaryTop10: primary.slice(0, 10).includes(id),
  }));
  const hitsTop10 = ranks.filter((r) => r.inPrimaryTop10).length;
  return {
    needle: needle.id,
    gtCount: gt.length,
    tokensUsed: result.meta.tokensUsed,
    returnedCount: returnedIds.length,
    primaryCount: primary.length,
    hitsTop10,
    ranks,
    elapsedMs: elapsed,
  };
}

console.error("\nBaseline (reranker OFF, legacy limit=50)...");
const baseline = [];
for (const n of NEEDLES) baseline.push(await runOne(false, n));

console.error("With reranker (ON, limit=200 → rerank top-40)...");
const reranked = [];
for (const n of NEEDLES) reranked.push(await runOne(true, n));

// --- Report ---
console.log("# Stage B Benchmark — memory_context with cross-encoder reranker\n");
console.log("| Needle | GT count | Baseline hits top-10 | Reranked hits top-10 | Δ |");
console.log("|---|---|---|---|---|");
let totalGt = 0;
let totalBase = 0;
let totalRerank = 0;
for (let i = 0; i < NEEDLES.length; i++) {
  const n = NEEDLES[i].id;
  totalGt += baseline[i].gtCount;
  totalBase += baseline[i].hitsTop10;
  totalRerank += reranked[i].hitsTop10;
  const delta = reranked[i].hitsTop10 - baseline[i].hitsTop10;
  const sign = delta > 0 ? "+" : delta < 0 ? "" : "±";
  console.log(
    `| ${n} | ${baseline[i].gtCount} | ${baseline[i].hitsTop10} | ${reranked[i].hitsTop10} | ${sign}${delta} |`,
  );
}
const basePct = ((totalBase / totalGt) * 100).toFixed(1);
const rerankPct = ((totalRerank / totalGt) * 100).toFixed(1);
const gainPct = ((totalRerank - totalBase) / totalGt * 100).toFixed(1);
console.log(`\n**Totals:** ${totalGt} GT IDs across 8 needles`);
console.log(`- **Baseline:** ${totalBase}/${totalGt} (${basePct}%)`);
console.log(`- **Reranker:** ${totalRerank}/${totalGt} (${rerankPct}%)`);
console.log(`- **Δ:** +${totalRerank - totalBase} IDs (+${gainPct} pp)`);

console.log("\n## Timing");
const baseAvg = Math.round(baseline.reduce((a, r) => a + r.elapsedMs, 0) / baseline.length);
const rerankAvg = Math.round(reranked.reduce((a, r) => a + r.elapsedMs, 0) / reranked.length);
console.log(`- Baseline avg: ${baseAvg} ms/query`);
console.log(`- Reranker avg: ${rerankAvg} ms/query (${(rerankAvg / baseAvg).toFixed(2)}×)`);

// Gate check
console.log("\n## Verdict");
if (totalRerank / totalGt >= 0.45) {
  console.log(`✅ **GATE PASSED**: reranker retrieval recall@10 is ${rerankPct}% (target ≥45%).`);
} else {
  console.log(`⚠️  **GATE FAILED**: reranker retrieval recall@10 is ${rerankPct}% (target ≥45%). Investigate before shipping.`);
}

try {
  fs.rmSync(tmpDir, { recursive: true, force: true });
} catch {}
process.exit(0);

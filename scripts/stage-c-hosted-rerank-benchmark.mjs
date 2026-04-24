// Stage C benchmark: measure memory_context recall@10 through the HOSTED Lodis
// stack (https://app.getengrams.com/api/mcp) with production Modal cross-encoder
// reranker (cross-encoder/ms-marco-MiniLM-L-6-v2).
//
// Comparison baseline: Stage B local BGE-reranker-base hit 83.3% recall@10.
// Gate: >=45%. Stretch: >=70% (MiniLM vs BGE expected quality drop is small).
//
// Seeds the 1990 MRCR memories into a scoped domain (mrcr-bench) on the hosted
// account (idempotent — re-runs detect prior seeding and skip upload). memory_bulk_upload
// auto-generates new IDs, so we capture the originalId -> newId map and remap
// GROUND_TRUTH before scoring.
//
// Prereq: ~/.lodis-mrcr-run/hosted-api-key.txt (mode 0600) or $LODIS_HOSTED_API_KEY
// holding an API token generated at https://app.getengrams.com/settings.
//
// Flags:
//   --skip-seed        skip the seeding step (use when corpus already present)
//   --skip-cleanup     no-op for now (script never auto-deletes; domain stays)
//   --needle=<id>      run only one needle (for spot-check)

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// ---------- Config ----------
const ART = "/Users/jamesheath/Documents/Claude/Projects/Anthropic Take Home Demo/simulation";
const memoriesPath = path.join(ART, "data/memories.json");
const needlesPath = path.join(ART, "needles-public.json");
const MCP_URL = process.env.LODIS_MCP_URL ?? "https://app.getengrams.com/api/mcp";
const BENCH_DOMAIN = "mrcr-bench";
const SOURCE_AGENT_ID = "stage-c-bench";
const SOURCE_AGENT_NAME = "Stage C Hosted Benchmark";
const RESULTS_PATH = path.join(os.homedir(), ".lodis-mrcr-run/stage-c-results.json");
const SEED_MAP_PATH = path.join(os.homedir(), ".lodis-mrcr-run/stage-c-seed-map.json");

const args = new Set(process.argv.slice(2));
const skipSeed = args.has("--skip-seed");
const needleFilterArg = [...args].find((a) => a.startsWith("--needle="));
const needleFilter = needleFilterArg ? needleFilterArg.split("=")[1] : null;

// ---------- API key ----------
function loadApiKey() {
  if (process.env.LODIS_HOSTED_API_KEY) return process.env.LODIS_HOSTED_API_KEY.trim();
  const keyPath = path.join(os.homedir(), ".lodis-mrcr-run/hosted-api-key.txt");
  if (!fs.existsSync(keyPath)) {
    console.error(`Missing API key. Generate at https://app.getengrams.com/settings and write to ${keyPath} (mode 0600), or set $LODIS_HOSTED_API_KEY.`);
    process.exit(1);
  }
  return fs.readFileSync(keyPath, "utf8").trim();
}
const API_KEY = loadApiKey();

// ---------- JSON-RPC / streamable-http MCP client ----------
let rpcId = 1;
async function mcpCall(toolName, argsObj) {
  const body = JSON.stringify({
    jsonrpc: "2.0",
    id: rpcId++,
    method: "tools/call",
    params: { name: toolName, arguments: argsObj },
  });
  const res = await fetch(MCP_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${API_KEY}`,
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
      "Mcp-Protocol-Version": "2024-11-05",
    },
    body,
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`MCP HTTP ${res.status} calling ${toolName}: ${text.slice(0, 400)}`);
  }
  const ct = res.headers.get("content-type") ?? "";
  const envelope = ct.includes("text/event-stream") ? parseSseEnvelope(text) : JSON.parse(text);
  if (envelope.error) {
    throw new Error(`MCP error calling ${toolName}: ${JSON.stringify(envelope.error).slice(0, 400)}`);
  }
  // Tool response is stringified JSON inside result.content[0].text
  const content = envelope.result?.content?.[0];
  if (!content || content.type !== "text") {
    throw new Error(`Unexpected tool response shape for ${toolName}: ${JSON.stringify(envelope).slice(0, 400)}`);
  }
  try {
    return JSON.parse(content.text);
  } catch {
    return content.text;
  }
}

function parseSseEnvelope(text) {
  let last = null;
  for (const line of text.split(/\r?\n/)) {
    if (line.startsWith("data:")) {
      const data = line.slice(5).trim();
      if (data && data !== "[DONE]") last = data;
    }
  }
  if (!last) throw new Error(`No data lines in SSE response: ${text.slice(0, 200)}`);
  return JSON.parse(last);
}

// ---------- Ground truth (from Stage B) ----------
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

// ---------- Load fixtures ----------
const needleSpec = JSON.parse(fs.readFileSync(needlesPath, "utf8"));
let NEEDLES = needleSpec.needles;
if (needleFilter) NEEDLES = NEEDLES.filter((n) => n.id === needleFilter);
const memories = JSON.parse(fs.readFileSync(memoriesPath, "utf8"));
console.error(`Loaded ${memories.length} memories and ${NEEDLES.length} needle(s).`);

// ---------- Seed (or reuse) ----------
// originalId -> newId mapping, persisted across runs at SEED_MAP_PATH
let idMap = {};
if (fs.existsSync(SEED_MAP_PATH)) {
  try {
    idMap = JSON.parse(fs.readFileSync(SEED_MAP_PATH, "utf8"));
    console.error(`Loaded existing seed map with ${Object.keys(idMap).length} entries from ${SEED_MAP_PATH}.`);
  } catch {
    idMap = {};
  }
}

if (!skipSeed && Object.keys(idMap).length < memories.length) {
  console.error(`Seeding ${memories.length} memories into domain="${BENCH_DOMAIN}" on hosted Lodis...`);
  const CHUNK = 500;
  const t0 = Date.now();
  for (let start = 0; start < memories.length; start += CHUNK) {
    const chunk = memories.slice(start, start + CHUNK);
    const entries = chunk.map((m) => ({
      content: m.content,
      detail: m.detail ?? undefined,
      domain: BENCH_DOMAIN,
      sourceType: (m.source_type ?? "observed"),
      sourceDescription: m.source_description ?? undefined,
      entityType: m.entity_type ?? undefined,
      entityName: m.entity_name ?? undefined,
      structuredData:
        m.structured_data && typeof m.structured_data === "string"
          ? safeParseJson(m.structured_data)
          : m.structured_data ?? undefined,
      permanence: m.permanence && m.permanence !== "archived" ? m.permanence : undefined,
    }));
    const result = await mcpCall("memory_bulk_upload", {
      entries,
      sourceAgentId: SOURCE_AGENT_ID,
      sourceAgentName: SOURCE_AGENT_NAME,
      skipDedup: true,
      batchSize: 100,
    });
    // Map: entry.index within this chunk -> result.results[k].id
    // We need to tie each result back to its original memory's id (memories[start + index])
    for (const r of result.results ?? []) {
      if (r.status === "written" && typeof r.id === "string") {
        const originalId = memories[start + r.index].id;
        idMap[originalId] = r.id;
      }
    }
    console.error(
      `  chunk ${start}..${start + chunk.length}: written=${result.written} failed=${result.failed} skipped=${result.skipped} in ${result.durationMs}ms`,
    );
  }
  fs.mkdirSync(path.dirname(SEED_MAP_PATH), { recursive: true });
  fs.writeFileSync(SEED_MAP_PATH, JSON.stringify(idMap, null, 2));
  console.error(`Seeding done in ${((Date.now() - t0) / 1000).toFixed(1)}s. Mapped ${Object.keys(idMap).length} IDs. Saved to ${SEED_MAP_PATH}.`);
} else if (skipSeed) {
  console.error(`--skip-seed set; using existing idMap (${Object.keys(idMap).length} entries).`);
} else {
  console.error(`idMap already complete (${Object.keys(idMap).length} entries); skipping seed.`);
}

function safeParseJson(s) {
  try {
    return JSON.parse(s);
  } catch {
    return undefined;
  }
}

// ---------- Remap ground truth to hosted IDs ----------
const REMAPPED_GT = {};
const missingGt = [];
for (const [needle, gtIds] of Object.entries(GROUND_TRUTH)) {
  REMAPPED_GT[needle] = [];
  for (const origId of gtIds) {
    const newId = idMap[origId];
    if (newId) REMAPPED_GT[needle].push(newId);
    else missingGt.push({ needle, origId });
  }
}
if (missingGt.length > 0) {
  console.error(`WARN: ${missingGt.length} ground-truth ID(s) have no mapping:`);
  for (const m of missingGt) console.error(`  ${m.needle}: ${m.origId}`);
}

// ---------- Run needles ----------
console.error("\nRunning memory_context for each needle...");
const results = [];
for (const needle of NEEDLES) {
  const gt = REMAPPED_GT[needle.id] ?? [];
  const start = Date.now();
  let result;
  try {
    result = await mcpCall("memory_context", {
      query: needle.question,
      token_budget: 6000,
      format: "hierarchical",
      domain: BENCH_DOMAIN,
    });
  } catch (err) {
    console.error(`  ${needle.id}: ERROR ${err.message}`);
    results.push({ needle: needle.id, error: err.message, gtCount: gt.length, hitsTop10: 0 });
    continue;
  }
  const elapsed = Date.now() - start;

  const returnedIds = result.returnedMemoryIds ?? [];
  const primary =
    result.meta?.format === "hierarchical"
      ? (result.primary?.memories ?? []).map((m) => m.id)
      : returnedIds;

  const ranks = gt.map((id) => ({
    id,
    rankInReturned: returnedIds.indexOf(id) === -1 ? null : returnedIds.indexOf(id) + 1,
    inPrimaryTop10: primary.slice(0, 10).includes(id),
  }));
  const hitsTop10 = ranks.filter((r) => r.inPrimaryTop10).length;

  results.push({
    needle: needle.id,
    question: needle.question,
    gtCount: gt.length,
    hitsTop10,
    ranks,
    tokensUsed: result.meta?.tokensUsed,
    returnedCount: returnedIds.length,
    primaryCount: primary.length,
    rerankerEngaged: result.meta?.rerankerEngaged,
    rerankerError: result.meta?.rerankerError,
    scoreDistributionShape: result.meta?.scoreDistribution?.shape,
    saturationBudgetBound: result.meta?.saturation?.budgetBound,
    elapsedMs: elapsed,
  });
  console.error(
    `  ${needle.id}: ${hitsTop10}/${gt.length} top10, reranker=${result.meta?.rerankerEngaged ?? "?"}, ${elapsed}ms`,
  );
}

// ---------- Report ----------
console.log("# Stage C Benchmark — hosted Lodis memory_context with Modal MiniLM reranker\n");
console.log(`Endpoint: ${MCP_URL}`);
console.log(`Domain: ${BENCH_DOMAIN}`);
console.log(`Corpus: ${memories.length} MRCR memories\n`);
console.log("| Needle | GT count | Hits top-10 | Reranker | Shape | Tokens | ms |");
console.log("|---|---|---|---|---|---|---|");
let totalGt = 0;
let totalHits = 0;
let allRerankerOk = true;
for (const r of results) {
  totalGt += r.gtCount;
  totalHits += r.hitsTop10;
  if (!r.rerankerEngaged) allRerankerOk = false;
  console.log(
    `| ${r.needle} | ${r.gtCount} | ${r.hitsTop10} | ${r.rerankerEngaged ?? "ERR"} | ${r.scoreDistributionShape ?? "—"} | ${r.tokensUsed ?? "—"} | ${r.elapsedMs ?? "—"} |`,
  );
}
const pct = totalGt ? ((totalHits / totalGt) * 100).toFixed(1) : "N/A";
console.log(`\n**Totals:** ${totalHits}/${totalGt} = ${pct}% recall@10`);
console.log(`- Stage B local BGE baseline: 83.3%`);
console.log(`- Gate: ≥ 45%`);
console.log(`- Stretch: ≥ 70%`);

console.log("\n## Verdict");
if (!allRerankerOk) {
  console.log("⚠️  Some needles ran without reranker engaged. Numbers are compromised.");
}
const pctNum = totalGt ? totalHits / totalGt : 0;
if (pctNum >= 0.7) {
  console.log(`✅ STRETCH PASS — recall@10 ${pct}% within striking distance of Stage B's 83.3%.`);
} else if (pctNum >= 0.45) {
  console.log(`⚠️ GATE PASS but below stretch — MiniLM quality noticeably below BGE. Consider T4 GPU or candidate pre-truncation.`);
} else {
  console.log(`❌ GATE FAIL — MiniLM regression confirmed. Write handoff-reranker-gpu-or-truncate.md.`);
}

// ---------- Archive ----------
fs.mkdirSync(path.dirname(RESULTS_PATH), { recursive: true });
fs.writeFileSync(
  RESULTS_PATH,
  JSON.stringify(
    {
      runAt: new Date().toISOString(),
      endpoint: MCP_URL,
      domain: BENCH_DOMAIN,
      corpusSize: memories.length,
      needleCount: NEEDLES.length,
      totalGt,
      totalHits,
      recallAt10: pctNum,
      stageBBaseline: 0.833,
      results,
      missingGt,
    },
    null,
    2,
  ),
);
console.error(`\nResults archived to ${RESULTS_PATH}`);
process.exit(0);

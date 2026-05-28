// Verify the core migration fix: in-process LocalReranker engages with no HTTP
// timeout. LODIS_RERANKER_URL is unset -> selectRerankerProvider() picks
// LocalReranker (Xenova/bge-reranker-base). Runs a real contextSearch against
// the local DB and reports the reranker diagnostics.
import { createDatabase, contextSearch, selectRerankerProvider } from "../packages/core/dist/index.js";

console.error("reranker provider:", selectRerankerProvider()?.constructor?.name ?? "(none)");
console.error("LODIS_RERANKER_URL:", process.env.LODIS_RERANKER_URL ?? "(unset -> LocalReranker)");

const { client } = await createDatabase();
const query = process.argv[2] || "lodis reranker latency timeout fix";

const t0 = Date.now();
const result = await contextSearch(client, query, { userId: null, tokenBudget: 3000 });
const ms = Date.now() - t0;
const meta = result.meta || {};

console.log("query:", JSON.stringify(query));
console.log("latency_ms:", ms);
console.log("rerankerEngaged:", meta.rerankerEngaged);
console.log("rerankerError:", meta.rerankerError ?? "(none)");
console.log("format:", meta.format);
console.log("saturation:", JSON.stringify(meta.saturation ?? null));
console.log("scoreDistribution:", JSON.stringify(meta.scoreDistribution ?? null));
console.log("result keys:", Object.keys(result).join(", "));
const primaryN = Array.isArray(result.primary) ? result.primary.length : (Array.isArray(result.memories) ? result.memories.length : "n/a");
console.log("primary/result items:", primaryN);
process.exit(0);

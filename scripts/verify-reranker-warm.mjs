// Measure TRUE warm reranker latency: two contextSearch calls in one process.
// Query 1 pays model load (cold); query 2 has the model resident (warm) — that
// warm number is the real per-query cost on a long-lived server.
import { createDatabase, contextSearch } from "../packages/core/dist/index.js";

const { client } = await createDatabase();
const run = async (q) => {
  const t = Date.now();
  const r = await contextSearch(client, q, { userId: null, tokenBudget: 3000 });
  return { ms: Date.now() - t, engaged: r.meta?.rerankerEngaged, err: r.meta?.rerankerError ?? "(none)" };
};

const cold = await run("lodis reranker latency timeout");
const warm1 = await run("recruiting pipeline ops database reconciliation");
const warm2 = await run("anthropic interview decline reflection curriculum");

console.log("cold  (q1, incl model load):", cold.ms, "ms | engaged:", cold.engaged);
console.log("WARM  (q2, model resident):", warm1.ms, "ms | engaged:", warm1.engaged, "| err:", warm1.err);
console.log("WARM  (q3, model resident):", warm2.ms, "ms | engaged:", warm2.engaged, "| err:", warm2.err);
process.exit(0);

// Snippet content diagnostic (READ-ONLY, deterministic, zero-LLM).
//
// Now that snippets are partitioned out of default search, the write-time
// memory-vs-snippet choice decides visibility. This measures the SHAPE of the
// 600+ snippets to decide how to harden the write path:
//   - bridge gap   -> motivates giving snippets connections[] (option C)
//   - content depth -> motivates a companion durable-write (option B)
//   - permanence    -> how many snippets are already "promoted" to durable
//
// It MUTATES NOTHING.
//
// Run: node scripts/snippet-content-diagnostic.mjs

import { createClient } from "@libsql/client";
import os from "node:os";
import path from "node:path";

const c = createClient({ url: "file:" + path.join(os.homedir(), ".lodis", "lodis.db") });

const snippets = (await c.execute(
  `SELECT id, content, detail, structured_data, permanence, expires_at, learned_at
   FROM memories WHERE entity_type = 'snippet' AND deleted_at IS NULL`,
)).rows;
const N = snippets.length;

// Edge map: which memory ids participate in connections, and to what.
const snippetIds = new Set(snippets.map((s) => String(s.id)));
const edges = (await c.execute(
  `SELECT source_memory_id AS s, target_memory_id AS t FROM memory_connections`,
)).rows;
const bridged = new Set(); // snippet ids with >=1 edge to a NON-snippet memory
let snippetToSnippetEdges = 0;
for (const e of edges) {
  const s = String(e.s), t = String(e.t);
  const sSnip = snippetIds.has(s), tSnip = snippetIds.has(t);
  if (sSnip && !tSnip) bridged.add(s);
  if (tSnip && !sSnip) bridged.add(t);
  if (sSnip && tSnip) snippetToSnippetEdges++;
}

// Tallies.
const tally = (rows, fn) => {
  const m = new Map();
  for (const r of rows) { const k = fn(r) ?? "(none)"; m.set(k, (m.get(k) ?? 0) + 1); }
  return [...m.entries()].sort((a, b) => b[1] - a[1]);
};
const sd = (r) => { try { return JSON.parse(r.structured_data ?? "{}"); } catch { return {}; } };

const byType = tally(snippets, (r) => sd(r).snippet_type);
const byDomain = tally(snippets, (r) => sd(r).life_domain);
const bySource = tally(snippets, (r) => sd(r).source_system);
const byPerm = tally(snippets, (r) => r.permanence);

let withDetail = 0, withStructDetail = 0, totalLen = 0;
const lens = [];
for (const r of snippets) {
  const detail = String(r.detail ?? "").trim();
  if (detail.length > 0) withDetail++;
  if (String(sd(r).content_detail ?? "").trim().length > 0) withStructDetail++;
  const L = String(r.content ?? "").length; totalLen += L; lens.push(L);
}
lens.sort((a, b) => a - b);
const pct = (p) => lens.length ? lens[Math.min(lens.length - 1, Math.floor(p * lens.length))] : 0;

const nowMs = Date.now();
let expiredNotSwept = 0, expiringSoon = 0, noExpiry = 0;
for (const r of snippets) {
  if (!r.expires_at) { noExpiry++; continue; }
  const ms = new Date(r.expires_at).getTime();
  if (ms < nowMs) expiredNotSwept++;
  else if (ms < nowMs + 30 * 864e5) expiringSoon++;
}

const p = (n) => `${n} (${N ? (100 * n / N).toFixed(1) : "0"}%)`;
console.log(`\n==== snippet content diagnostic ====`);
console.log(`total live snippets: ${N}`);

console.log(`\nby snippet_type:`); for (const [k, v] of byType) console.log(`  ${k}: ${v}`);
console.log(`\nby permanence (already-promoted = active/canonical):`); for (const [k, v] of byPerm) console.log(`  ${k}: ${v}`);
console.log(`\nby source_system (top 8):`); for (const [k, v] of bySource.slice(0, 8)) console.log(`  ${k}: ${v}`);
console.log(`\nby life_domain (top 10):`); for (const [k, v] of byDomain.slice(0, 10)) console.log(`  ${k}: ${v}`);

console.log(`\n-- content depth (motivates companion durable-write, option B) --`);
console.log(`  content length p50/p90/max: ${pct(0.5)}/${pct(0.9)}/${lens[lens.length - 1] ?? 0} chars (avg ${N ? Math.round(totalLen / N) : 0})`);
console.log(`  has 'detail' column:        ${p(withDetail)}`);
console.log(`  has structured content_detail: ${p(withStructDetail)}`);

console.log(`\n-- graph bridge (motivates snippet connections[], option C) --`);
console.log(`  bridged to a non-snippet memory: ${p(bridged.size)}`);
console.log(`  ISOLATED (no durable bridge):    ${p(N - bridged.size)}`);
console.log(`  snippet<->snippet edges:         ${snippetToSnippetEdges}`);

console.log(`\n-- lifecycle --`);
console.log(`  expired but not swept: ${p(expiredNotSwept)}`);
console.log(`  expiring within 30d:   ${p(expiringSoon)}`);
console.log(`  no expiry (pinned):    ${p(noExpiry)}`);
process.exit(0);

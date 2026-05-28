// Contacts triage diagnostic (READ-ONLY, deterministic, zero-LLM).
//
// The ~1,320 imported Google Contacts (domain='contacts', entity_type='person')
// were a name->resourceName index. The personal-assistant MCP now owns contact
// lookup directly, so the bare pointers are redundant — but some contact
// entities may have accreted real memory (graph edges, usage, notes) and must
// NOT be lost. This script classifies each contact row as:
//
//   bare      — safe to archive/remove: no edges, never used/referenced,
//               unconfirmed, no detail, content is just the display name.
//   enriched  — keep findable: has edges OR usage OR confirmation OR detail OR
//               content beyond the name.
//
// It MUTATES NOTHING. It prints a summary and writes the full classification
// (with per-row reasons + ID lists) to a JSON report for review before any
// archive/removal decision.
//
// Run: node scripts/contacts-triage-diagnostic.mjs
//      node scripts/contacts-triage-diagnostic.mjs --domain contacts --db ~/.lodis/lodis.db

import { createClient } from "@libsql/client";
import os from "node:os";
import path from "node:path";
import fs from "node:fs";

function arg(name, fallback) {
  const i = process.argv.indexOf(name);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}
function expand(p) {
  return p.startsWith("~") ? path.join(os.homedir(), p.slice(1)) : p;
}

const domain = arg("--domain", "contacts");
const dbPath = expand(arg("--db", path.join(os.homedir(), ".lodis", "lodis.db")));
const stamp = new Date().toISOString().slice(0, 10);
const outPath = expand(
  arg("--out", path.join(os.homedir(), ".lodis", "exports", `contacts-triage-${stamp}.json`)),
);

const c = createClient({ url: "file:" + dbPath });

// Every memory id that participates in at least one connection edge.
const edgeRows = (await c.execute(
  "SELECT source_memory_id AS id FROM memory_connections UNION SELECT target_memory_id AS id FROM memory_connections",
)).rows;
const connected = new Set(edgeRows.map((r) => String(r.id)));

const rows = (await c.execute({
  sql: `SELECT id, content, detail, entity_name, used_count, referenced_count, confirmed_count, structured_data, learned_at
        FROM memories
        WHERE domain = ? AND deleted_at IS NULL`,
  args: [domain],
})).rows;

const num = (v) => (v === null || v === undefined ? 0 : Number(v));
const norm = (s) => String(s ?? "").trim().toLowerCase();

const bare = [];
const enriched = [];
const signalTally = { edges: 0, used: 0, referenced: 0, confirmed: 0, hasDetail: 0, contentBeyondName: 0 };

for (const r of rows) {
  const id = String(r.id);
  const reasons = [];
  if (connected.has(id)) { reasons.push("edges"); signalTally.edges++; }
  if (num(r.used_count) > 0) { reasons.push("used"); signalTally.used++; }
  if (num(r.referenced_count) > 0) { reasons.push("referenced"); signalTally.referenced++; }
  if (num(r.confirmed_count) > 0) { reasons.push("confirmed"); signalTally.confirmed++; }
  const detail = String(r.detail ?? "").trim();
  if (detail.length > 0) { reasons.push("hasDetail"); signalTally.hasDetail++; }
  // "content beyond the name" = content carries more than the display name.
  const content = norm(r.content);
  const name = norm(r.entity_name);
  if (name && content && content !== name && !content.startsWith(name)) {
    reasons.push("contentBeyondName");
    signalTally.contentBeyondName++;
  }

  const rec = { id, entity_name: r.entity_name ?? null, content: String(r.content ?? "").slice(0, 80), reasons };
  if (reasons.length > 0) enriched.push(rec);
  else bare.push(rec);
}

const total = rows.length;
console.log(`\n==== contacts triage (domain='${domain}') ====`);
console.log(`db: ${dbPath}`);
console.log(`total non-deleted rows: ${total}`);
console.log(`  bare pointers (archive/remove candidates): ${bare.length} (${total ? (100 * bare.length / total).toFixed(1) : "0"}%)`);
console.log(`  enriched (keep findable):                  ${enriched.length} (${total ? (100 * enriched.length / total).toFixed(1) : "0"}%)`);
console.log(`\nenriched signal breakdown (a row can hit several):`);
for (const [k, v] of Object.entries(signalTally)) console.log(`  ${k}: ${v}`);

console.log(`\nsample enriched (up to 15):`);
for (const e of enriched.slice(0, 15)) {
  console.log(`  ${e.id}  [${e.reasons.join(",")}]  ${e.entity_name ?? ""}`);
}

fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, JSON.stringify({
  generated_at: new Date().toISOString(),
  db: dbPath,
  domain,
  total,
  counts: { bare: bare.length, enriched: enriched.length },
  signalTally,
  enriched,
  bare,
}, null, 2));
console.log(`\nFull classification (all ${total} rows, with reasons + ID lists) written to:\n  ${outPath}`);
console.log(`\nNo data was modified. Review before archiving/removing.`);
process.exit(0);

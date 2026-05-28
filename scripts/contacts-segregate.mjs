// Contacts segregation (Phase 4). Re-homes the ENRICHED contacts identified by
// contacts-triage-diagnostic.mjs out of the `contacts` domain into `people` so
// they stay in the default search pool, then (separately, via the MCP tools)
// the `contacts` domain is archived to drop the ~1,239 bare pointers.
//
// This script ONLY re-homes the enriched rows + writes a rollback file. Domain
// registration/archival is done via the MCP register/archive tools (which carry
// the validated dedup + last_modified logic). Reversible: the rollback JSON
// lists every moved id and its prior domain.
//
// Dry-run by default. Pass --apply to mutate. Pins to the exact enriched set in
// the triage JSON (not a re-classification) so we move precisely what was
// reviewed.
//
// Run: node scripts/contacts-segregate.mjs            # dry-run
//      node scripts/contacts-segregate.mjs --apply

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

const APPLY = process.argv.includes("--apply");
const TARGET = arg("--target", "people");
const SOURCE = arg("--source", "contacts");
const stamp = new Date().toISOString().slice(0, 10);
const triagePath = expand(arg("--triage", path.join(os.homedir(), ".lodis", "exports", `contacts-triage-${stamp}.json`)));
const dbPath = expand(arg("--db", path.join(os.homedir(), ".lodis", "lodis.db")));
const rollbackPath = expand(path.join(os.homedir(), ".lodis", "exports", `contacts-segregate-rollback-${stamp}.json`));

if (!fs.existsSync(triagePath)) {
  console.error(`Triage file not found: ${triagePath}\nRun: node scripts/contacts-triage-diagnostic.mjs`);
  process.exit(1);
}
const triage = JSON.parse(fs.readFileSync(triagePath, "utf8"));
const enrichedIds = (triage.enriched ?? []).map((e) => e.id);
console.log(`triage: ${triagePath}`);
console.log(`enriched (to re-home ${SOURCE} -> ${TARGET}): ${enrichedIds.length}`);
console.log(`bare (stay in ${SOURCE}, hidden once archived): ${triage.counts?.bare ?? "?"}`);

const c = createClient({ url: "file:" + dbPath });

// Only move rows that are STILL in the source domain (drift-safe).
const ph = enrichedIds.map(() => "?").join(",");
const live = enrichedIds.length
  ? (await c.execute({
      sql: `SELECT id, domain FROM memories WHERE id IN (${ph}) AND deleted_at IS NULL`,
      args: enrichedIds,
    })).rows
  : [];
const movable = live.filter((r) => String(r.domain) === SOURCE).map((r) => String(r.id));
const skipped = live.length - movable.length;
console.log(`live enriched rows: ${live.length}; movable (still in ${SOURCE}): ${movable.length}; already moved/elsewhere: ${skipped}`);

if (!APPLY) {
  console.log(`\n[dry-run] would re-home ${movable.length} rows ${SOURCE} -> ${TARGET}, then archive '${SOURCE}' via MCP.`);
  console.log(`[dry-run] re-run with --apply to mutate. No changes made.`);
  process.exit(0);
}

const ts = new Date().toISOString();
const stmts = [];
for (const id of movable) {
  stmts.push({ sql: `UPDATE memories SET domain = ?, updated_at = ? WHERE id = ? AND domain = ?`, args: [TARGET, ts, id, SOURCE] });
  stmts.push({
    sql: `INSERT INTO memory_events (id, memory_id, event_type, agent_id, old_value, new_value, timestamp) VALUES (lower(hex(randomblob(16))), ?, 'updated', 'contacts-segregate', ?, ?, ?)`,
    args: [id, JSON.stringify({ domain: SOURCE }), JSON.stringify({ domain: TARGET }), ts],
  });
}
// Invalidate search result cache so the re-home is reflected immediately.
stmts.push({ sql: `INSERT OR REPLACE INTO lodis_meta (key, value) VALUES ('last_modified', ?)`, args: [ts] });

if (stmts.length) await c.batch(stmts, "write");

fs.mkdirSync(path.dirname(rollbackPath), { recursive: true });
fs.writeFileSync(rollbackPath, JSON.stringify({
  applied_at: ts,
  db: dbPath,
  rehomed: movable,
  from_domain: SOURCE,
  to_domain: TARGET,
  note: `To roll back: UPDATE memories SET domain='${SOURCE}' WHERE id IN (rehomed); then unarchive '${SOURCE}' via memory_register_domain.`,
}, null, 2));

console.log(`\n[applied] re-homed ${movable.length} rows ${SOURCE} -> ${TARGET}.`);
console.log(`[applied] rollback written: ${rollbackPath}`);
console.log(`Next: register '${TARGET}' + register/archive '${SOURCE}' via the MCP tools.`);
process.exit(0);

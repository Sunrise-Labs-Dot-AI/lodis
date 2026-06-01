// One-off: merge fragmented person entities in the LOCAL lodis.db.
// Reversible (soft-delete losers + edge re-point); rollback exports written
// 2026-05-29 to ~/.lodis/exports/people-dedup-*.json.
//
// Usage:
//   node scripts/merge-people-2026-05-29.mjs            # dry-run (default)
//   node scripts/merge-people-2026-05-29.mjs --apply    # execute
//
// Each merge: repoint loser's edges → winner (INSERT OR IGNORE for the
// (src,tgt,rel) UNIQUE index; SKIP edges that would become winner→winner
// self-loops), delete loser's edges, soft-delete loser. Winners with combined
// content (Jeff Grimes, Allegra) get an explicit detail-append.

import { createClient } from "@libsql/client";
import { homedir } from "os";
import { resolve } from "path";

const APPLY = process.argv.includes("--apply");
const DB_URL = "file:" + resolve(homedir(), ".lodis/lodis.db");
const NOW = new Date().toISOString();
const client = createClient({ url: DB_URL });

// Resolve a short id8 prefix to the full id (defensive — fail if ambiguous/missing).
async function resolveId(prefix) {
  const r = await client.execute({ sql: `SELECT id FROM memories WHERE id LIKE ?`, args: [prefix + "%"] });
  if (r.rows.length !== 1) throw new Error(`id prefix ${prefix} resolved to ${r.rows.length} rows`);
  return r.rows[0].id;
}

// winner id8 ← [loser id8, ...].  (10 clean pairs + 2 content-merges)
const MERGES = [
  { name: "Aakash Sahney",       winner: "8268d71a", losers: ["b15ea1f5"] },
  { name: "Cole Bevis",          winner: "2c6c5a4f", losers: ["81c986ea"] },
  { name: "Dev Bala",            winner: "d9f3949a", losers: ["2dfe9578"] },
  { name: "Emma Bright",         winner: "8ff95269", losers: ["c5c37b73"] },
  { name: "Jason Toff",          winner: "e00007bb", losers: ["41516f0c"] },
  { name: "Nitin Iyer",          winner: "99da26ef", losers: ["ee6f9c11"] },
  { name: "Raja Ayyagari",       winner: "cc6788c6", losers: ["440ff0f5"] },
  { name: "Fred Fahlke",         winner: "4b546b3a", losers: ["b4ee8020"] },
  { name: "Milla Mothershelper", winner: "8b87c4cf", losers: ["06ead0e9"] },
  { name: "Pete Stine",          winner: "1a8b82b8", losers: ["4407f673"] },
  // Content-merges (winner gets a detail-append folding the loser's facts):
  { name: "Jeff Grimes", winner: "6a316263", losers: ["a3cdda27", "919d8061"],
    appendDetail: "[Merged 2026-05-29 from networking-domain row] Personal/family: wife Kathleen (from Irvine, CA), daughter Veronica (~8mo as of late May 2026, est. born ~Sep 2025). James↔Kathleen possible shared Irvine/University High connection — UNVERIFIED, James not certain; verify before relying." },
  { name: "Allegra Margolis Heath", winner: "462face8", losers: ["e5348a03"],
    appendDetail: "[Merged 2026-05-29] Married — anniversary marked on the 7th of each month on the Heath Fam calendar. Calendar also shows \"Allegra Margolis Heath Review\" (Jun 23, 2025)." },
];

let repointed = 0, deletedEdges = 0, skippedSelfLoops = 0, softDeleted = 0;

for (const m of MERGES) {
  const winner = await resolveId(m.winner);
  const losers = [];
  for (const l of m.losers) losers.push(await resolveId(l));

  for (const loser of losers) {
    // Edges where loser is SOURCE → repoint source to winner (skip if target===winner: self-loop)
    const asSrc = await client.execute({
      sql: `SELECT target_memory_id, relationship, user_id FROM memory_connections WHERE source_memory_id = ?`,
      args: [loser],
    });
    // Edges where loser is TARGET → repoint target to winner (skip if source===winner: self-loop)
    const asTgt = await client.execute({
      sql: `SELECT source_memory_id, relationship, user_id FROM memory_connections WHERE target_memory_id = ?`,
      args: [loser],
    });

    for (const e of asSrc.rows) {
      if (e.target_memory_id === winner) { skippedSelfLoops++; continue; }
      if (APPLY) await client.execute({
        sql: `INSERT OR IGNORE INTO memory_connections (source_memory_id, target_memory_id, relationship, user_id) VALUES (?, ?, ?, ?)`,
        args: [winner, e.target_memory_id, e.relationship, e.user_id ?? null],
      });
      repointed++;
    }
    for (const e of asTgt.rows) {
      if (e.source_memory_id === winner) { skippedSelfLoops++; continue; }
      if (APPLY) await client.execute({
        sql: `INSERT OR IGNORE INTO memory_connections (source_memory_id, target_memory_id, relationship, user_id) VALUES (?, ?, ?, ?)`,
        args: [e.source_memory_id, winner, e.relationship, e.user_id ?? null],
      });
      repointed++;
    }

    // Drop the loser's now-redundant edges, then soft-delete the loser row + audit event.
    if (APPLY) {
      await client.execute({ sql: `DELETE FROM memory_connections WHERE source_memory_id = ? OR target_memory_id = ?`, args: [loser, loser] });
      await client.execute({ sql: `UPDATE memories SET deleted_at = ?, updated_at = ? WHERE id = ?`, args: [NOW, NOW, loser] });
      await client.execute({
        sql: `INSERT INTO memory_events (id, memory_id, event_type, old_value, new_value, timestamp) VALUES (lower(hex(randomblob(16))), ?, 'removed', ?, ?, ?)`,
        args: [loser, "active", `merged_into:${winner}`, NOW],
      });
    }
    deletedEdges += asSrc.rows.length + asTgt.rows.length;
    softDeleted++;
  }

  if (m.appendDetail && APPLY) {
    await client.execute({
      sql: `UPDATE memories SET detail = TRIM(COALESCE(detail,'') || char(10) || ?), updated_at = ? WHERE id = ?`,
      args: [m.appendDetail, NOW, winner],
    });
  }
  console.log(`${APPLY ? "MERGED" : "DRY"} ${m.name}: winner ${m.winner} ← ${m.losers.join(", ")}${m.appendDetail ? " (+detail)" : ""}`);
}

if (APPLY) await client.execute({ sql: `UPDATE lodis_meta SET value = ? WHERE key = 'last_modified'`, args: [NOW] });

console.log(`\n${APPLY ? "APPLIED" : "DRY-RUN"}: ${MERGES.length} merges, ${softDeleted} rows soft-deleted, ${repointed} edges repointed (INSERT OR IGNORE), ${skippedSelfLoops} self-loops skipped, ${deletedEdges} loser-edges deleted.`);
client.close();

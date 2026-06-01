// One-off: backfill `about` edges from progress snippets to the person
// entities they name, in the LOCAL lodis.db. Closes the gap where pollers
// wrote snippets without the connections[] param (Phase 4), leaving ~99% of
// snippets graph-isolated despite naming real people.
//
// Deterministic, ZERO LLM (matches Lodis's read/write-path invariant):
//   candidate = (snippet, person) where snippet.content CONTAINS person.entity_name
//   relationship = "about"  (per CLAUDE.md snippet ownership rule: the entity
//                            a progress event concerns)
//
// Safety filters:
//   - person entities only, NOT deleted
//   - drop short single-word names (<8 chars, no space) — substring-FP prone
//     (Margo↔Margolis, Milla↔inside-words, Naomi, etc.)
//   - skip pairs that already have an edge (either direction)
//   - INSERT OR IGNORE against the (src,tgt,rel) UNIQUE index
//
// Usage:
//   node scripts/backfill-snippet-person-edges-2026-05-29.mjs          # dry-run
//   node scripts/backfill-snippet-person-edges-2026-05-29.mjs --apply   # execute
//
// Reversible: every inserted edge is logged to ~/.lodis/exports/
// snippet-edge-backfill-2026-05-29.json so it can be deleted wholesale.

import { createClient } from "@libsql/client";
import { homedir } from "os";
import { resolve } from "path";
import { writeFileSync } from "fs";

const APPLY = process.argv.includes("--apply");
const DB_URL = "file:" + resolve(homedir(), ".lodis/lodis.db");
const NOW = new Date().toISOString();
const LOG = resolve(homedir(), ".lodis/exports/snippet-edge-backfill-2026-05-29.json");
const client = createClient({ url: DB_URL });

// Live person entities, filtered to substring-safe names.
const people = (await client.execute({
  sql: `SELECT id, entity_name, user_id FROM memories
        WHERE deleted_at IS NULL AND entity_type='person'
          AND (entity_name LIKE '% %' OR length(entity_name) >= 8)`,
})).rows;

// Live snippets.
const snippets = (await client.execute({
  sql: `SELECT id, content, user_id FROM memories WHERE deleted_at IS NULL AND entity_type='snippet'`,
})).rows;

// Existing edges as a Set of "src|tgt" (both directions) for O(1) skip.
const edges = (await client.execute({ sql: `SELECT source_memory_id s, target_memory_id t FROM memory_connections` })).rows;
const edgeSet = new Set();
for (const e of edges) { edgeSet.add(`${e.s}|${e.t}`); edgeSet.add(`${e.t}|${e.s}`); }

const toInsert = [];
for (const s of snippets) {
  const content = String(s.content ?? "");
  for (const p of people) {
    const name = String(p.entity_name);
    if (!content.includes(name)) continue;
    if (edgeSet.has(`${s.id}|${p.id}`)) continue; // already connected (either dir)
    toInsert.push({ source: s.id, target: p.id, person: name, user_id: s.user_id ?? p.user_id ?? null });
    edgeSet.add(`${s.id}|${p.id}`); edgeSet.add(`${p.id}|${s.id}`); // de-dup within this run
  }
}

console.log(`candidates: ${toInsert.length} snippet→person 'about' edges (${new Set(toInsert.map(e=>e.source)).size} snippets, ${new Set(toInsert.map(e=>e.person)).size} people)`);

if (APPLY) {
  let applied = 0;
  for (const e of toInsert) {
    const r = await client.execute({
      sql: `INSERT OR IGNORE INTO memory_connections (source_memory_id, target_memory_id, relationship, user_id) VALUES (?, ?, 'about', ?)`,
      args: [e.source, e.target, e.user_id],
    });
    applied += r.rowsAffected;
  }
  await client.execute({ sql: `UPDATE lodis_meta SET value = ? WHERE key = 'last_modified'`, args: [NOW] });
  writeFileSync(LOG, JSON.stringify({ created_at: NOW, relationship: "about", edges: toInsert }, null, 2));
  console.log(`APPLIED: ${applied} edges inserted. Rollback log: ${LOG}`);
} else {
  console.log("DRY-RUN — re-run with --apply to insert. Sample:");
  for (const e of toInsert.slice(0, 8)) console.log(`  ${e.source.slice(0,8)} → ${e.person} (about)`);
}
client.close();

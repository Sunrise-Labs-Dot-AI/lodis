// Recurring sweep: connect orphaned progress snippets to the person/org
// entities they name, in the LOCAL lodis.db. Deterministic, ZERO LLM,
// idempotent — safe to run on any cadence.
//
// This is the stable, undated companion to the one-off
// backfill-snippet-person-edges-2026-05-29.mjs. The scheduled task
// `lodis-snippet-edge-backfill` (~/.claude/scheduled-tasks/) runs THIS file
// daily. It is the downstream safety net for snippet-writing agents that
// don't pass connections[] (notably the Cowork `recruiting-pipeline-ingest`
// task); the root fix is adding connections[] to those writer prompts.
//
// Must be run with cwd = this repo (so `@libsql/client` resolves from
// node_modules):  node scripts/sweep-snippet-person-edges.mjs
//
// Default APPLIES. Pass --dry-run to preview without writing.

import { createClient } from "@libsql/client";
import { homedir } from "os";
import { resolve } from "path";
import { writeFileSync } from "fs";

const DRY = process.argv.includes("--dry-run");
const DB_URL = "file:" + resolve(homedir(), ".lodis/lodis.db");
const NOW = new Date().toISOString();
const LOG = resolve(homedir(), ".lodis/exports/snippet-edge-backfill-sweep.json");
const client = createClient({ url: DB_URL });

// Live person/org entities, filtered to substring-safe names (multi-word OR
// >=8 chars) so short common names can't false-match inside other words.
const ents = (await client.execute({
  sql: `SELECT id, entity_name, user_id FROM memories
        WHERE deleted_at IS NULL AND entity_type IN ('person','organization')
          AND (entity_name LIKE '% %' OR length(entity_name) >= 8)`,
})).rows;

const snippets = (await client.execute({
  sql: `SELECT id, content, user_id FROM memories WHERE deleted_at IS NULL AND entity_type='snippet'`,
})).rows;

const edges = (await client.execute({ sql: `SELECT source_memory_id s, target_memory_id t FROM memory_connections` })).rows;
const edgeSet = new Set();
for (const e of edges) { edgeSet.add(`${e.s}|${e.t}`); edgeSet.add(`${e.t}|${e.s}`); }

const toInsert = [];
for (const sn of snippets) {
  const content = String(sn.content ?? "");
  for (const p of ents) {
    const name = String(p.entity_name);
    if (!content.includes(name)) continue;
    if (edgeSet.has(`${sn.id}|${p.id}`)) continue;
    toInsert.push({ source: sn.id, target: p.id, person: name, user_id: sn.user_id ?? p.user_id ?? null });
    edgeSet.add(`${sn.id}|${p.id}`); edgeSet.add(`${p.id}|${sn.id}`);
  }
}

let applied = 0;
if (!DRY) {
  for (const e of toInsert) {
    const r = await client.execute({
      sql: `INSERT OR IGNORE INTO memory_connections (source_memory_id, target_memory_id, relationship, user_id) VALUES (?, ?, 'about', ?)`,
      args: [e.source, e.target, e.user_id],
    });
    applied += r.rowsAffected;
  }
  if (applied > 0) {
    await client.execute({ sql: `UPDATE lodis_meta SET value = ? WHERE key = 'last_modified'`, args: [NOW] });
    writeFileSync(LOG, JSON.stringify({ created_at: NOW, relationship: "about", edges: toInsert }, null, 2));
  }
}

const label = DRY ? `would add ${toInsert.length}` : `${applied} new`;
console.log(`lodis snippet-edge sweep: ${label} 'about' edges (${new Set(toInsert.map(x=>x.source)).size} snippets, ${new Set(toInsert.map(x=>x.person)).size} entities)`);
client.close();

// Migrate a user's memory corpus FROM the hosted cloud (Turso) DOWN to the
// local Lodis DB (~/.lodis/lodis.db). Operator-run, not a runtime feature.
//
// Why not `memory_migrate direction=to_local`? That tool unconditionally
// decrypts every row (migrate.ts), but the hosted server writes content in
// PLAINTEXT — so its decrypt path throws on the first row. It only round-trips
// data that was pushed up via `to_cloud` (encrypted). This script reads the
// plaintext cloud rows directly and imports them through the repo's own tested
// export/import functions, then regenerates embeddings in the local vector
// store. Local and cloud both run on @libsql/client (see db.ts createDatabase),
// so schema/format are compatible — but the vector index must be rebuilt
// locally, hence regenerateEmbeddings rather than copying raw embedding blobs.
//
// What it copies: memories, connections, events (the corpus). user_id is
// remapped to NULL so rows are visible in local single-user mode
// (server.ts read filter: `user_id IS NULL OR user_id = ''`).
//
// What it does NOT copy (regenerated, default-permissive, or not corpus data):
//   - agent_permissions  (local default-allows; copying could lock out an agent)
//   - domains registry   (only matters if you use memory_write_snippet locally)
//   - memory_summaries   (entity-profile cache; regenerates on demand)
//   - user_settings / api_tokens (cloud-only concerns)
// Ask if you want any of these added.
//
// Usage:
//   node scripts/migrate-cloud-to-local.mjs                         # dry-run (counts only)
//   node scripts/migrate-cloud-to-local.mjs --apply --i-have-backup
//   node scripts/migrate-cloud-to-local.mjs --apply --i-have-backup --skip-embeddings
//
// Required env (credentials NEVER via CLI flags — argv is visible in `ps`):
//   TURSO_DATABASE_URL   Turso libsql URL of the hosted Lodis DB
//   TURSO_AUTH_TOKEN     Turso auth token
//   LODIS_USER_ID        Clerk user_id whose memories to pull (REQUIRED — the
//                        hosted store is multi-tenant; without it you'd pull
//                        only user_id IS NULL rows, typically zero).
//
// Safety: dry-run by default; --apply requires --i-have-backup; the existing
// local lodis.db is backed up before any write; import is idempotent
// (INSERT OR IGNORE by memory id), so re-running is safe.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createClient } from "@libsql/client";
import {
  createDatabase,
  exportMemories,
  importFromExport,
  regenerateEmbeddings,
  bumpLastModified,
} from "../packages/core/dist/index.js";

// ---------- Flags ----------
const args = new Set(process.argv.slice(2));
const apply = args.has("--apply");
const iHaveBackup = args.has("--i-have-backup");
const skipEmbeddings = args.has("--skip-embeddings");
const showHelp = args.has("--help") || args.has("-h");

// Reject credential-bearing flags — credentials must come from env only.
for (const a of args) {
  if (/^--(api|token|key|password|secret|auth|url)(-|=|$)/i.test(a)) {
    console.error(`Credential-bearing flags are rejected for safety. Use env vars (TURSO_DATABASE_URL / TURSO_AUTH_TOKEN / LODIS_USER_ID). Found: ${a}`);
    process.exit(1);
  }
}

if (showHelp) {
  console.log(`Migrate hosted cloud memories down to local ~/.lodis/lodis.db.

Usage:
  node scripts/migrate-cloud-to-local.mjs                         # dry-run
  node scripts/migrate-cloud-to-local.mjs --apply --i-have-backup
  node scripts/migrate-cloud-to-local.mjs --apply --i-have-backup --skip-embeddings

Env (required):
  TURSO_DATABASE_URL   Hosted Turso libsql URL
  TURSO_AUTH_TOKEN     Hosted Turso auth token
  LODIS_USER_ID        Clerk user_id whose memories to pull

Flags:
  --apply              Actually write to the local DB. Default is dry-run.
  --i-have-backup      Required with --apply. Acknowledges the local DB backup.
  --skip-embeddings    Import metadata only; skip local vector regeneration
                       (keyword/FTS search works; semantic search until you
                       run reembed-contextual.mjs against the local DB).
  --help               Show this message.
`);
  process.exit(0);
}

// ---------- Env ----------
const cloudUrl = process.env.TURSO_DATABASE_URL;
const cloudToken = process.env.TURSO_AUTH_TOKEN;
const userId = process.env.LODIS_USER_ID;

if (!cloudUrl) {
  console.error("Missing TURSO_DATABASE_URL env var (the hosted Turso libsql URL).");
  process.exit(1);
}
if (!userId || userId.length === 0) {
  console.error("Missing LODIS_USER_ID env var. The hosted store is multi-tenant — pass the Clerk user_id whose memories to pull, e.g. user_3C8AS2SablK6XBaVHDzrdj3fGLi.");
  process.exit(1);
}

const PAGE_SIZE = 500;
const redactedUrl = cloudUrl.replace(/\?.*$/, "");

// ---------- Connect to cloud (read-only) ----------
console.error(`[migrate] cloud source: ${redactedUrl}  userId=${userId}`);
const cloud = createClient({ url: cloudUrl, authToken: cloudToken || undefined });

// ---------- Count (dry-run report) ----------
const countRes = await cloud.execute({
  sql: `SELECT COUNT(*) AS n FROM memories WHERE deleted_at IS NULL AND user_id = ?`,
  args: [userId],
});
const cloudCount = Number(countRes.rows[0]?.n ?? 0);
console.error(`[migrate] cloud has ${cloudCount} non-deleted memories for this user.`);

if (cloudCount === 0) {
  console.error("[migrate] nothing to migrate — exiting.");
  process.exit(0);
}

if (!apply) {
  console.error(`[migrate] DRY-RUN. Re-run with --apply --i-have-backup to write ${cloudCount} memories to ~/.lodis/lodis.db.`);
  process.exit(0);
}

if (!iHaveBackup) {
  console.error("[migrate] --apply requires --i-have-backup. (This script also auto-backs-up the local DB.)");
  process.exit(1);
}

// ---------- Back up existing local DB ----------
const localDbPath = path.join(os.homedir(), ".lodis", "lodis.db");
if (fs.existsSync(localDbPath)) {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const bak = `${localDbPath}.bak-${stamp}`;
  fs.copyFileSync(localDbPath, bak);
  console.error(`[migrate] backed up existing local DB → ${bak}`);
}

// ---------- Open local destination (correct schema + pragmas + FTS + vec) ----------
const { client: local, vecAvailable } = await createDatabase(); // default → ~/.lodis/lodis.db
console.error(`[migrate] local destination ready (vecAvailable=${vecAvailable}).`);
if (!vecAvailable && !skipEmbeddings) {
  console.error("[migrate] WARNING: local vector support unavailable — semantic search will be FTS-only. Proceeding with metadata import.");
}

// ---------- Drain cloud via paginated export ----------
const memories = [];
const connections = [];
const events = [];
const seenConn = new Set();
let offset = 0;
let pages = 0;

while (true) {
  const page = await exportMemories(cloud, {
    userId,
    includeEvents: true,
    limit: PAGE_SIZE,
    offset,
  });

  // Strip user_id so import lands rows as NULL (visible in local single-user mode).
  for (const m of page.memories) { delete m.user_id; memories.push(m); }

  for (const c of page.connections) {
    const key = `${c.source_memory_id}::${c.target_memory_id}::${c.relationship}`;
    if (!seenConn.has(key)) {
      seenConn.add(key);
      delete c.user_id;
      connections.push(c);
    }
  }

  if (page.events) for (const e of page.events) { delete e.user_id; events.push(e); }

  pages += 1;
  console.error(`[migrate] page ${pages}: ${memories.length}/${cloudCount} memories drained...`);
  if (!page.pagination.hasMore) break;
  offset += PAGE_SIZE;
}

// ---------- Import into local (user_id → NULL, idempotent) ----------
const imp = await importFromExport(local, { memories, connections, events }, { userId: null });
console.error(`[migrate] imported: ${imp.imported} memories (${imp.skipped} skipped/dup), ${imp.connections} connections, ${imp.events} events.`);

// ---------- Regenerate embeddings locally ----------
if (skipEmbeddings) {
  console.error("[migrate] --skip-embeddings set; skipping local vector regeneration.");
} else if (vecAvailable) {
  console.error("[migrate] regenerating embeddings locally (loads MiniLM model; CPU-bound)...");
  let last = 0;
  const res = await regenerateEmbeddings(local, {
    shape: "legacy",
    userId: null,
    skipAlreadyShape: false,
    batchSize: 200,
    onProgress: (done, total) => {
      const now = Date.now();
      if (now - last > 2000 || done === total) {
        last = now;
        process.stderr.write(`  [embed ${done}/${total}]\n`);
      }
    },
  });
  console.error(`[migrate] embeddings: processed=${res.processed} skipped=${res.skipped} failed=${res.failed}`);
}

// ---------- Rebuild FTS + bump cache marker ----------
try {
  await local.execute({ sql: `INSERT INTO memory_fts(memory_fts) VALUES('rebuild')`, args: [] });
} catch (e) {
  console.error(`[migrate] FTS rebuild note: ${e instanceof Error ? e.message : e}`);
}
await bumpLastModified(local);

console.error(`\n[migrate] DONE. Local DB now holds your corpus at ${localDbPath}.`);
console.error("[migrate] Next: point your MCP client(s) at the local stdio server (full cutover).");
process.exit(0);

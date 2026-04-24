// W1a migration: re-embed memories under a target embedding shape.
// Direct Turso connection (NOT via MCP) — sidesteps memory_list pagination
// limits and the DoS surface an `all: true` MCP tool would create.
//
// Call sites:
//   node scripts/reembed-contextual.mjs                              # dry-run
//   node scripts/reembed-contextual.mjs --apply --i-have-backup      # write
//   node scripts/reembed-contextual.mjs --apply --i-have-backup --domain mrcr-bench
//   node scripts/reembed-contextual.mjs --apply --i-have-backup --shape legacy   # rollback
//
// Required env:
//   TURSO_DATABASE_URL     — Turso libsql URL for the hosted Lodis DB
//   TURSO_AUTH_TOKEN       — Turso auth token
//   LODIS_USER_ID          — The Clerk user_id whose memories to migrate.
//                             Omit or set to "" for local mode (user_id IS NULL).
//
// Results are logged to ~/.lodis-mrcr-run/reembed-<timestamp>-results.json
// (IDs + status + counts only; NO content).
//
// Safety:
//   - Dry-run by default; --apply REQUIRED to write.
//   - --i-have-backup REQUIRED alongside --apply (explicit acknowledgement).
//   - Idempotent via embedding_shape column (skipAlreadyShape=true).
//   - Per-row errors collected; run aborts if >10% of any single-batch fails.
//   - CLI flags do NOT accept credentials — prevents argv exposure.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createClient } from "@libsql/client";
import { regenerateEmbeddings } from "../packages/core/dist/index.js";

// ---------- Flags ----------
const args = new Set(process.argv.slice(2));
const apply = args.has("--apply");
const iHaveBackup = args.has("--i-have-backup");
const showHelp = args.has("--help") || args.has("-h");

function argValue(prefix) {
  const a = [...args].find((x) => x.startsWith(prefix));
  return a ? a.slice(prefix.length) : null;
}

const domainFilter = argValue("--domain=");
const shapeArg = argValue("--shape=") ?? "v1-bracketed";
if (shapeArg !== "v1-bracketed" && shapeArg !== "legacy") {
  console.error(`Invalid --shape=${shapeArg}. Must be "v1-bracketed" or "legacy".`);
  process.exit(1);
}
const shape = shapeArg;

// Reject credential-bearing flags — credentials must come from env only.
for (const a of args) {
  if (/^--(api|token|key|password|secret|auth)(-|=|$)/i.test(a)) {
    console.error(`Credential-bearing flags are rejected for safety. Use env vars (TURSO_DATABASE_URL / TURSO_AUTH_TOKEN / LODIS_USER_ID). Found: ${a}`);
    process.exit(1);
  }
}

if (showHelp) {
  console.log(`Usage:
  node scripts/reembed-contextual.mjs                        # dry-run
  node scripts/reembed-contextual.mjs --apply --i-have-backup
  node scripts/reembed-contextual.mjs --apply --i-have-backup --domain=mrcr-bench
  node scripts/reembed-contextual.mjs --apply --i-have-backup --shape=legacy

Env:
  TURSO_DATABASE_URL  (required)
  TURSO_AUTH_TOKEN    (required for remote Turso; omit for file: URLs)
  LODIS_USER_ID       (required for hosted multi-tenant; omit for local user_id=NULL)

Flags:
  --apply               Actually write. Default is dry-run.
  --i-have-backup       Explicit operator acknowledgement (required with --apply).
  --domain=<name>       Limit to one domain.
  --shape=<name>        "v1-bracketed" (W1a, default) or "legacy" (rollback).
  --help                Show this message.
`);
  process.exit(0);
}

// ---------- Env ----------
const dbUrl = process.env.TURSO_DATABASE_URL;
if (!dbUrl) {
  console.error("Missing TURSO_DATABASE_URL env var.");
  process.exit(1);
}
const authToken = process.env.TURSO_AUTH_TOKEN;
const userIdEnv = process.env.LODIS_USER_ID;
const userId = userIdEnv && userIdEnv.length > 0 ? userIdEnv : null;

// ---------- DB connect ----------
console.error(`Connecting to ${dbUrl.replace(/\?.*$/, "")} (userId=${userId ?? "NULL (local mode)"})...`);
const client = createClient({
  url: dbUrl,
  authToken: authToken || undefined,
});

// ---------- Dry-run count ----------
const whereClauses = ["deleted_at IS NULL"];
const whereArgs = [];
if (userId === null) whereClauses.push("user_id IS NULL");
else { whereClauses.push("user_id = ?"); whereArgs.push(userId); }
if (domainFilter) { whereClauses.push("domain = ?"); whereArgs.push(domainFilter); }

const countResult = await client.execute({
  sql: `SELECT
          COUNT(*) AS total,
          SUM(CASE WHEN embedding_shape = ? THEN 1 ELSE 0 END) AS already_at_shape,
          SUM(CASE WHEN embedding_shape IS NULL THEN 1 ELSE 0 END) AS legacy_null,
          SUM(CASE WHEN embedding_shape IS NOT NULL AND embedding_shape <> ? THEN 1 ELSE 0 END) AS other_shape
        FROM memories WHERE ${whereClauses.join(" AND ")}`,
  args: [shape, shape, ...whereArgs],
});
const { total, already_at_shape, legacy_null, other_shape } = countResult.rows[0];
const toProcess = Number(total) - Number(already_at_shape);

console.error(`
Matching rows: ${total}
  already at shape "${shape}": ${already_at_shape}
  NULL embedding_shape (legacy default): ${legacy_null}
  other shape: ${other_shape}
  → would re-embed: ${toProcess}
`);

if (!apply) {
  console.error("Dry-run (no --apply). Exit.");
  process.exit(0);
}

if (apply && !iHaveBackup) {
  console.error("--apply requires --i-have-backup. Confirm you have a recent Turso backup.");
  process.exit(1);
}

// ---------- Apply ----------
console.error(`\nApplying. Target shape: ${shape}. Scope: ${domainFilter ? `domain=${domainFilter}` : "all domains"}, userId=${userId ?? "NULL"}`);

const t0 = Date.now();
let lastReport = 0;
const result = await regenerateEmbeddings(client, {
  shape,
  domain: domainFilter ?? undefined,
  userId,
  skipAlreadyShape: true,
  batchSize: 200,
  onProgress: (done, total, id, status) => {
    const now = Date.now();
    if (now - lastReport > 2000 || done === total) {
      lastReport = now;
      process.stderr.write(`  [${done}/${total}] ${status.padEnd(8)} ${id}\n`);
    }
  },
});

const elapsedSec = ((Date.now() - t0) / 1000).toFixed(1);
console.error(`\nDone in ${elapsedSec}s. processed=${result.processed} skipped=${result.skipped} failed=${result.failed}`);

// ---------- Archive results (IDs + status only; no content) ----------
// Per Security-3 on PR #86: mode 0600 matches the credentials.json precedent
// and prevents same-host processes from reading the error messages (which
// can incidentally include SQLite/libsql error text mentioning row data).
const archivePath = path.join(os.homedir(), `.lodis-mrcr-run/reembed-${Date.now()}-results.json`);
fs.mkdirSync(path.dirname(archivePath), { recursive: true, mode: 0o700 });
fs.writeFileSync(archivePath, JSON.stringify({
  ranAt: new Date().toISOString(),
  shape,
  domain: domainFilter,
  userId,
  elapsedSec: Number(elapsedSec),
  summary: {
    processed: result.processed,
    skipped: result.skipped,
    failed: result.failed,
  },
  errors: result.errors, // { id, error } objects
}, null, 2), { mode: 0o600 });
console.error(`Archived to ${archivePath}`);

// Abort gate: if >10% of processed+failed failed, that's a systemic problem.
const attemptedCount = result.processed + result.failed;
if (attemptedCount > 0 && result.failed / attemptedCount > 0.1) {
  console.error(`\n⚠ Failure rate ${((result.failed / attemptedCount) * 100).toFixed(1)}% exceeds 10%. Review errors in ${archivePath}.`);
  process.exit(2);
}

process.exit(0);

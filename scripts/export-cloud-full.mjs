// Phase 0 (migration safety net): full export of the live cloud (Turso) memory
// store to a single portable JSON file BEFORE any migration change.
//
// This is the disaster-recovery artifact. It is read-only against the cloud and
// only writes a local JSON file. Output matches `LodisExportData` (the shape
// `memory_import` / `importFromExport` consume), so it doubles as the re-import
// source for Phase 1 and as the rollback artifact for the whole migration.
//
// Talks DIRECTLY to Turso (does NOT go through the MCP connector) — so it works
// even when the `engrams` MCP server is disconnected, and avoids MCP payload
// bloat. Drains ALL domains (no domain filter), including connections + events.
//
// Usage:
//   node scripts/export-cloud-full.mjs            # writes the dated safety file
//   node scripts/export-cloud-full.mjs --out <path>
//
// Required env (credentials via env ONLY — never CLI flags; argv is visible in `ps`):
//   TURSO_DATABASE_URL   Hosted Turso libsql URL
//   TURSO_AUTH_TOKEN     Hosted Turso auth token
//   LODIS_USER_ID        Clerk user_id whose memories to export (the hosted store
//                        is multi-tenant; without it you'd export only
//                        user_id IS NULL rows — typically zero).

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { createClient } from "@libsql/client";

// ---------- CLI ----------
const argv = process.argv.slice(2);
for (const a of argv) {
  if (/^--(api|token|key|password|secret|auth|url)(-|=|$)/i.test(a)) {
    console.error(`Credential-bearing flags are rejected for safety. Use env vars (TURSO_DATABASE_URL / TURSO_AUTH_TOKEN / LODIS_USER_ID). Found: ${a}`);
    process.exit(1);
  }
}
function getArg(name, def) {
  const i = argv.indexOf(name);
  return i !== -1 && i + 1 < argv.length ? argv[i + 1] : def;
}
if (argv.includes("--help") || argv.includes("-h")) {
  console.log(`Phase 0 full cloud export (Turso-direct, read-only).

Usage:
  node scripts/export-cloud-full.mjs [--out <path>]

Env (required):
  TURSO_DATABASE_URL   Hosted Turso libsql URL
  TURSO_AUTH_TOKEN     Hosted Turso auth token
  LODIS_USER_ID        Clerk user_id whose memories to export
`);
  process.exit(0);
}

const DEFAULT_OUT = path.join(os.homedir(), ".lodis", "exports", "cloud-full-2026-05-27.json");
const outArg = getArg("--out", DEFAULT_OUT);
const outPath = outArg.startsWith("~/") ? path.join(os.homedir(), outArg.slice(2)) : path.resolve(outArg);

// Refuse to overwrite — this is a checkpoint, not a scratch file.
if (fs.existsSync(outPath)) {
  console.error(`[export] refusing to overwrite existing file: ${outPath}`);
  console.error(`[export] move it aside or pass a different --out path.`);
  process.exit(1);
}

// ---------- Env ----------
const dbUrl = process.env.TURSO_DATABASE_URL;
const authToken = process.env.TURSO_AUTH_TOKEN;
const userId = process.env.LODIS_USER_ID;
if (!dbUrl) { console.error("Missing TURSO_DATABASE_URL env var."); process.exit(1); }
if (!userId || userId.length === 0) {
  console.error("Missing LODIS_USER_ID env var (the Clerk user_id whose memories to export, e.g. user_3C8AS2SablK6XBaVHDzrdj3fGLi).");
  process.exit(1);
}

// Catch the most common mistake: the command-template placeholders ("…" / "<...>")
// pasted verbatim instead of real credentials.
if (/[…]|\.\.\.|^<.*>$/.test(dbUrl) || (authToken && /[…]|\.\.\.|^<.*>$/.test(authToken))) {
  console.error("TURSO_DATABASE_URL / TURSO_AUTH_TOKEN still contain the placeholder from the command template — substitute your REAL hosted-Lodis Turso credentials:");
  console.error("  TURSO_DATABASE_URL  e.g. libsql://lodis-<org>.turso.io   (Turso CLI: `turso db show <db> --url`)");
  console.error("  TURSO_AUTH_TOKEN    a token string                       (Turso CLI: `turso db tokens create <db>`)");
  console.error("  Or copy both from the app.getengrams.com project env vars in Vercel.");
  process.exit(1);
}
try {
  new URL(dbUrl);
} catch {
  console.error(`TURSO_DATABASE_URL is not a valid URL: "${dbUrl}". Expected e.g. libsql://lodis-<org>.turso.io`);
  process.exit(1);
}

// ---------- Lodis core (built dist) — reuse the canonical export logic ----------
const coreDistPath = path.resolve("packages/core/dist/index.js");
if (!fs.existsSync(coreDistPath)) {
  console.error(`Missing ${coreDistPath}. Run 'pnpm --filter @lodis/core build' first.`);
  process.exit(1);
}
const { exportMemories } = await import(pathToFileURL(coreDistPath).href);

// ---------- Connect (read-only) ----------
const redacted = dbUrl.replace(/\?.*$/, "");
console.error(`[export] cloud source: ${redacted}  userId=${userId}`);
const client = createClient({ url: dbUrl, authToken: authToken || undefined });

// ---------- Paginated drain across ALL domains ----------
const PAGE_SIZE = 500;
const memories = [];
const connections = [];
const events = [];
const seenConn = new Set();
let offset = 0;
let total = 0;
let pages = 0;

while (true) {
  const page = await exportMemories(client, {
    userId,            // multi-tenant filter — required to get this user's rows
    includeEvents: true,
    limit: PAGE_SIZE,
    offset,
    // no `domain` → all domains
  });

  if (pages === 0) {
    total = page.pagination.total;
    console.error(`[export] total non-deleted memories for user: ${total}`);
    if (total === 0) {
      console.error("[export] nothing to export — check LODIS_USER_ID. Exiting without writing.");
      process.exit(1);
    }
  }

  memories.push(...page.memories);
  for (const c of page.connections) {
    const key = `${c.source_memory_id}::${c.target_memory_id}::${c.relationship}`;
    if (!seenConn.has(key)) { seenConn.add(key); connections.push(c); }
  }
  if (page.events) events.push(...page.events);

  pages += 1;
  console.error(`[export] page ${pages}: ${memories.length}/${total} memories...`);
  if (!page.pagination.hasMore) break;
  offset += PAGE_SIZE;
}

// ---------- Write artifact (LodisExportData shape + provenance) ----------
fs.mkdirSync(path.dirname(outPath), { recursive: true });
const output = {
  version: "1.0",
  exportedAt: new Date().toISOString(),
  source: { dbUrl: redacted, userId, totalReported: total },
  memories,
  connections,
  events,
  pagination: { offset: 0, limit: memories.length, total: memories.length, hasMore: false },
};
fs.writeFileSync(outPath, JSON.stringify(output, null, 2));
const sizeMb = (fs.statSync(outPath).size / (1024 * 1024)).toFixed(1);

console.error(`\n[export] DONE.`);
console.error(`[export]   memories:    ${memories.length}  (Turso reported ${total})`);
console.error(`[export]   connections: ${connections.length}`);
console.error(`[export]   events:      ${events.length}`);
console.error(`[export]   file:        ${outPath} (${sizeMb} MB)`);
if (memories.length !== total) {
  console.error(`[export] WARNING: drained ${memories.length} but Turso reported ${total} — investigate before trusting this as the backup.`);
  process.exit(2);
}
process.exit(0);

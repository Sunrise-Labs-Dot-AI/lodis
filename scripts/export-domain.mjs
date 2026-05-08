// Export every non-deleted memory in a single domain to a local JSON file.
//
// Output shape matches `LodisExportData` (the same shape consumed by
// `memory_import` and `importFromExport`) — re-importable as-is to restore
// the corpus, preserving original ids, learned_at, confidence, etc. Does
// NOT include embeddings (binary, model-specific — regenerated on import).
//
// Designed for the "save off a corpus before bulk-deleting it" workflow:
//
//   LODIS_DB_URL=libsql://... LODIS_AUTH_TOKEN=... \
//     node scripts/export-domain.mjs \
//       --domain mrcr-bench \
//       --user-id <id> \
//       --out ~/.lodis/exports/mrcr-bench-2026-05-07.json
//
// Then run `memory_remove_bulk` (MCP) with `filter: { domain: "mrcr-bench" }`.
// Restore later by re-importing the JSON via `memory_import`.
//
// Operator-run, not a runtime feature. Talks to the DB directly via the same
// Turso/local connection the MCP server uses.
//
// Usage:
//   node scripts/export-domain.mjs --domain <name> --out <path> [--user-id <id>] [--include-events]

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

// ---------- CLI parsing ----------
const args = process.argv.slice(2);
function getArg(name, def) {
  const i = args.indexOf(name);
  if (i === -1 || i + 1 >= args.length) return def;
  return args[i + 1];
}
function hasFlag(name) {
  return args.includes(name);
}

const DOMAIN = getArg("--domain", null);
const OUT = getArg("--out", null);
const USER_ID = getArg("--user-id", null);
const INCLUDE_EVENTS = hasFlag("--include-events");
const PAGE_SIZE = parseInt(getArg("--page-size", "500"), 10);

if (!DOMAIN) {
  console.error("Missing --domain. Pass the domain name to export.");
  process.exit(1);
}
if (!OUT) {
  console.error("Missing --out. Pass an absolute output path.");
  process.exit(1);
}

const outPath = OUT.startsWith("~/") ? path.join(os.homedir(), OUT.slice(2)) : path.resolve(OUT);

// Refuse to overwrite an existing file silently — exports are checkpoints.
if (fs.existsSync(outPath)) {
  console.error(`[export] refusing to overwrite existing file: ${outPath}`);
  console.error(`[export] move it aside or pass a different --out path.`);
  process.exit(1);
}

const outDir = path.dirname(outPath);
if (!fs.existsSync(outDir)) {
  fs.mkdirSync(outDir, { recursive: true });
}

// ---------- Lodis core (built dist) ----------
const coreDistPath = path.resolve("packages/core/dist/index.js");
if (!fs.existsSync(coreDistPath)) {
  console.error(`Missing ${coreDistPath}. Run 'pnpm --filter @lodis/core build' first.`);
  process.exit(1);
}
const core = await import(pathToFileURL(coreDistPath).href);
const { createDatabase, exportMemories } = core;

// ---------- DB connection ----------
const dbUrl = process.env.LODIS_DB_URL;
const authToken = process.env.LODIS_AUTH_TOKEN;
const { client } = await createDatabase(dbUrl ? { url: dbUrl, authToken } : undefined);
console.error(`[export] connected to ${dbUrl ?? "default local Lodis DB"}`);

if (dbUrl && !USER_ID) {
  console.error(
    "[export] WARNING: connected to a remote DB without --user-id. " +
      "Only memories with user_id IS NULL will be exported (typically zero on hosted Turso). " +
      "Pass --user-id <id> to target a specific user's memories.",
  );
}

// ---------- Paginated drain ----------
const allMemories = [];
const allConnections = [];
const allEvents = INCLUDE_EVENTS ? [] : undefined;
const seenConnectionKeys = new Set(); // dedup connections fetched on overlapping pages

let offset = 0;
let total = 0;
let pages = 0;

while (true) {
  const page = await exportMemories(client, {
    domain: DOMAIN,
    userId: USER_ID,
    limit: PAGE_SIZE,
    offset,
    includeEvents: INCLUDE_EVENTS,
  });

  if (pages === 0) {
    total = page.pagination.total;
    console.error(`[export] domain="${DOMAIN}" total=${total} userId=${USER_ID ?? "(null)"}`);
    if (total === 0) {
      console.error("[export] nothing to export — exiting without writing a file.");
      process.exit(0);
    }
  }

  allMemories.push(...page.memories);

  // Dedup connections — exportMemories returns edges where EITHER endpoint
  // matches the page's id set, so a cross-page edge can appear twice.
  for (const c of page.connections) {
    const key = `${c.source_memory_id}::${c.target_memory_id}::${c.relationship}`;
    if (!seenConnectionKeys.has(key)) {
      seenConnectionKeys.add(key);
      allConnections.push(c);
    }
  }

  if (allEvents && page.events) allEvents.push(...page.events);

  pages += 1;
  console.error(`[export] page ${pages}: +${page.memories.length} memories (running total ${allMemories.length}/${total})`);

  if (!page.pagination.hasMore) break;
  offset += PAGE_SIZE;
}

// ---------- Write output ----------
const output = {
  version: "1.0",
  exportedAt: new Date().toISOString(),
  source: {
    domain: DOMAIN,
    userId: USER_ID,
    dbUrl: dbUrl ?? null,
    totalRows: allMemories.length,
  },
  memories: allMemories,
  connections: allConnections,
  ...(allEvents ? { events: allEvents } : {}),
  pagination: { offset: 0, limit: allMemories.length, total: allMemories.length, hasMore: false },
};

fs.writeFileSync(outPath, JSON.stringify(output, null, 2));
const sizeKb = Math.round(fs.statSync(outPath).size / 1024);
console.error(`[export] wrote ${allMemories.length} memories + ${allConnections.length} connections to ${outPath} (${sizeKb} KB)`);
process.exit(0);

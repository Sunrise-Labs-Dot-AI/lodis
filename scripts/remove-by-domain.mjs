// Soft-delete every non-deleted memory in a single domain (or matching an
// entity_name) directly against Turso. Uses the same `bulkRemoveMemories`
// core function that powers the `memory_remove_bulk` MCP tool — but talks
// to the DB directly so it works without waiting for a server redeploy.
//
// Workflow:
//   1) Always export first via scripts/export-domain.mjs — this script
//      verifies an export file exists for the same domain+user before it
//      will commit a delete (refuse to destroy uncaptured data).
//   2) Default mode is dry-run. Pass --execute to actually delete.
//
// Usage:
//   LODIS_DB_URL=libsql://... LODIS_AUTH_TOKEN=... \
//     node scripts/remove-by-domain.mjs \
//       --domain mrcr-bench \
//       --user-id <id> \
//       --reason "retired benchmark corpus" \
//       --export-file ~/.lodis/exports/mrcr-bench-2026-05-08.json \
//       [--entity-name <name>] \
//       [--max 10000] \
//       [--batch-size 100] \
//       [--execute]      # without this flag, dry-run only
//
// Operator-run, not a runtime feature.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import readline from "node:readline";

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
const ENTITY_NAME = getArg("--entity-name", null);
const USER_ID = getArg("--user-id", null);
const REASON = getArg("--reason", null);
const EXPORT_FILE = getArg("--export-file", null);
const MAX_TO_REMOVE = parseInt(getArg("--max", "10000"), 10);
const BATCH_SIZE = parseInt(getArg("--batch-size", "100"), 10);
const EXECUTE = hasFlag("--execute");
const SKIP_EXPORT_CHECK = hasFlag("--skip-export-check");
const NO_CONFIRM = hasFlag("--no-confirm");

if (!DOMAIN && !ENTITY_NAME) {
  console.error("Missing filter. Pass --domain <name> or --entity-name <name>.");
  process.exit(1);
}
if (!REASON) {
  console.error("Missing --reason. Required for the audit trail.");
  process.exit(1);
}
if (!EXPORT_FILE && !SKIP_EXPORT_CHECK && EXECUTE) {
  console.error("Missing --export-file. Pass the path to a recent export-domain.mjs output, or --skip-export-check to bypass.");
  console.error("Run scripts/export-domain.mjs first to capture the corpus before deletion.");
  process.exit(1);
}

// ---------- Lodis core (built dist) ----------
const coreDistPath = path.resolve("packages/core/dist/index.js");
if (!fs.existsSync(coreDistPath)) {
  console.error(`Missing ${coreDistPath}. Run 'pnpm --filter @lodis/core build' first.`);
  process.exit(1);
}
const core = await import(pathToFileURL(coreDistPath).href);
const { createDatabase, resolveBulkRemoveTargets, bulkRemoveMemories } = core;

// ---------- Export-file sanity check ----------
if (EXPORT_FILE && !SKIP_EXPORT_CHECK && EXECUTE) {
  const expandedPath = EXPORT_FILE.startsWith("~/")
    ? path.join(os.homedir(), EXPORT_FILE.slice(2))
    : path.resolve(EXPORT_FILE);
  if (!fs.existsSync(expandedPath)) {
    console.error(`[remove] export-file does not exist: ${expandedPath}`);
    process.exit(1);
  }
  let exportData;
  try {
    exportData = JSON.parse(fs.readFileSync(expandedPath, "utf8"));
  } catch (err) {
    console.error(`[remove] export-file is not valid JSON: ${err.message}`);
    process.exit(1);
  }
  // Cheap consistency checks.
  if (exportData.source?.domain && DOMAIN && exportData.source.domain !== DOMAIN) {
    console.error(`[remove] export-file domain mismatch: file=${exportData.source.domain} flag=${DOMAIN}`);
    process.exit(1);
  }
  if (exportData.source?.userId !== USER_ID) {
    console.error(`[remove] export-file userId mismatch: file=${exportData.source?.userId ?? "(null)"} flag=${USER_ID ?? "(null)"}`);
    process.exit(1);
  }
  console.error(`[remove] export-file ok: ${expandedPath} (${exportData.memories?.length ?? "?"} rows)`);
}

// ---------- DB connection ----------
const dbUrl = process.env.LODIS_DB_URL;
const authToken = process.env.LODIS_AUTH_TOKEN;
const { client } = await createDatabase(dbUrl ? { url: dbUrl, authToken } : undefined);
console.error(`[remove] connected to ${dbUrl ?? "default local Lodis DB"}`);

if (dbUrl && !USER_ID) {
  console.error(
    "[remove] WARNING: connected to a remote DB without --user-id. " +
      "Only memories with user_id IS NULL will be matched (typically zero on hosted Turso). " +
      "Pass --user-id <id> to target a specific user's memories.",
  );
}

// ---------- Resolve targets ----------
const filter = {};
if (DOMAIN) filter.domain = DOMAIN;
if (ENTITY_NAME) filter.entityName = ENTITY_NAME;

let resolved;
try {
  resolved = await resolveBulkRemoveTargets(client, filter, {
    userId: USER_ID,
    maxToScan: MAX_TO_REMOVE,
  });
} catch (err) {
  console.error(`[remove] filter rejected: ${err.message}`);
  process.exit(1);
}

if (resolved.overflowed) {
  console.error(
    `[remove] filter matches more than --max=${MAX_TO_REMOVE}. Refusing without explicit higher cap. ` +
      `Increase --max or narrow the filter.`,
  );
  console.error(`  byDomain: ${JSON.stringify(resolved.byDomain)}`);
  process.exit(1);
}

console.error(`[remove] filter: ${JSON.stringify(filter)}`);
console.error(`[remove] would remove: ${resolved.targets.length} memories`);
console.error(`[remove] byDomain: ${JSON.stringify(resolved.byDomain)}`);
console.error(`[remove] sample ids: ${resolved.sampleIds.slice(0, 5).join(", ")}${resolved.sampleIds.length > 5 ? ", ..." : ""}`);

if (resolved.targets.length === 0) {
  console.error("[remove] nothing to delete — exiting.");
  process.exit(0);
}

if (!EXECUTE) {
  console.error("[remove] DRY RUN — pass --execute to commit the deletion.");
  process.exit(0);
}

// ---------- Confirm ----------
if (!NO_CONFIRM && process.stdin.isTTY) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stderr });
  const answer = await new Promise((resolve) =>
    rl.question(
      `Soft-delete ${resolved.targets.length} memories. Type the count to confirm: `,
      (a) => { rl.close(); resolve(a.trim()); },
    ),
  );
  if (answer !== String(resolved.targets.length)) {
    console.error(`[remove] confirmation failed (got "${answer}", expected "${resolved.targets.length}"). Aborting.`);
    process.exit(1);
  }
}

// ---------- Commit ----------
const result = await bulkRemoveMemories(client, resolved.targets, {
  sourceAgentId: "remove-by-domain-script",
  sourceAgentName: "remove-by-domain.mjs",
  userId: USER_ID,
  reason: REASON,
  batchSize: BATCH_SIZE,
});

console.error(
  `[remove] removed=${result.removed} failed=${result.failed} durationMs=${result.durationMs}`,
);
console.error(`[remove] byDomain: ${JSON.stringify(result.byDomain)}`);
if (result.failed > 0) {
  console.error("[remove] FAILED IDs (first 10):");
  for (const r of result.results.filter((x) => x.status === "failed").slice(0, 10)) {
    console.error(`  ${r.id}: ${r.error}`);
  }
  process.exit(1);
}
console.error("[remove] done. Soft-deleted rows have deleted_at set; recover by clearing the column or re-importing the export file.");
process.exit(0);

// Phase 1: import the verified Phase-0 export into a FRESH local Lodis DB.
//
// Sources from the local backup JSON (NOT a second cloud read), so the verified
// disaster-recovery artifact is the single source of truth. Backs up any
// existing ~/.lodis/lodis.db aside first, creates a fresh current-schema DB via
// createDatabase() (proper migrations + FTS + vec setup), imports memories +
// connections + events with user_id remapped to NULL (so rows are visible in
// local single-user mode), then regenerates embeddings locally.
//
// Read/write LOCAL only — does not touch the cloud. Idempotent on re-run
// (INSERT OR IGNORE by memory id).
//
// Usage:
//   node scripts/import-to-local.mjs [--in <path>] [--skip-embeddings]

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

const argv = process.argv.slice(2);
const getArg = (n, d) => { const i = argv.indexOf(n); return i !== -1 && i + 1 < argv.length ? argv[i + 1] : d; };
const skipEmbeddings = argv.includes("--skip-embeddings");

const inPath = getArg("--in", path.join(os.homedir(), ".lodis", "exports", "cloud-full-2026-05-27.json"));
if (!fs.existsSync(inPath)) { console.error(`Missing export file: ${inPath}`); process.exit(1); }

const coreDistPath = path.resolve("packages/core/dist/index.js");
if (!fs.existsSync(coreDistPath)) { console.error(`Missing ${coreDistPath}. Run 'pnpm --filter @lodis/core build'.`); process.exit(1); }
const { createDatabase, importFromExport, regenerateEmbeddings, bumpLastModified } = await import(pathToFileURL(coreDistPath).href);

// ---------- Back up any existing local DB aside (so createDatabase makes fresh) ----------
const lodisDir = path.join(os.homedir(), ".lodis");
const dbPath = path.join(lodisDir, "lodis.db");
const stamp = new Date().toISOString().replace(/[:.]/g, "-");
for (const suffix of ["", "-wal", "-shm"]) {
  const f = dbPath + suffix;
  if (fs.existsSync(f)) {
    const bak = `${dbPath}.stale-bak-${stamp}${suffix}`;
    fs.renameSync(f, bak);
    console.error(`[import] moved aside ${path.basename(f)} -> ${path.basename(bak)}`);
  }
}

// ---------- Load export ----------
const data = JSON.parse(fs.readFileSync(inPath, "utf8"));
console.error(`[import] export: ${data.memories.length} memories, ${data.connections.length} connections, ${(data.events||[]).length} events`);

// Strip user_id so rows land NULL (visible in local single-user mode: WHERE user_id IS NULL OR = '').
const strip = (rows) => (rows || []).map((r) => { const c = { ...r }; delete c.user_id; return c; });
const memories = strip(data.memories);
const connections = strip(data.connections);
const events = strip(data.events);

// ---------- Fresh local DB (proper schema + pragmas + FTS + vec) ----------
const { client: local, vecAvailable } = await createDatabase(); // default -> ~/.lodis/lodis.db
console.error(`[import] fresh local DB created (vecAvailable=${vecAvailable})`);

// ---------- Import ----------
const res = await importFromExport(local, { memories, connections, events }, { userId: null });
console.error(`[import] imported -> memories: ${res.imported} (skipped ${res.skipped}), connections: ${res.connections}, events: ${res.events}`);

// ---------- Regenerate embeddings locally ----------
if (skipEmbeddings) {
  console.error("[import] --skip-embeddings set; skipping vector regeneration (run reembed-contextual.mjs later).");
} else if (!vecAvailable) {
  console.error("[import] WARNING: vec unavailable — semantic search will be FTS-only.");
} else {
  console.error("[import] regenerating embeddings locally (MiniLM; CPU-bound)...");
  let last = 0;
  const emb = await regenerateEmbeddings(local, {
    shape: "legacy", userId: null, skipAlreadyShape: false, batchSize: 200,
    onProgress: (done, total) => { const now = Date.now(); if (now - last > 3000 || done === total) { last = now; process.stderr.write(`  [embed ${done}/${total}]\n`); } },
  });
  console.error(`[import] embeddings -> processed: ${emb.processed}, skipped: ${emb.skipped}, failed: ${emb.failed}`);
}

// ---------- FTS rebuild + cache marker ----------
try { await local.execute({ sql: `INSERT INTO memory_fts(memory_fts) VALUES('rebuild')`, args: [] }); }
catch (e) { console.error(`[import] FTS rebuild note: ${e instanceof Error ? e.message : e}`); }
await bumpLastModified(local);

console.error(`\n[import] DONE. Local DB ready at ${dbPath}.`);
process.exit(0);

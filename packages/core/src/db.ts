import Database from "better-sqlite3";
import { drizzle, type BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import { resolve } from "path";
import { homedir } from "os";
import { mkdirSync, chmodSync } from "fs";
import * as schema from "./schema.js";
import { setupFTS } from "./fts.js";
import { setupVec } from "./vec.js";

export type EngramsDatabase = BetterSQLite3Database<typeof schema>;

const CREATE_TABLES_SQL = `
  CREATE TABLE IF NOT EXISTS memories (
    id TEXT PRIMARY KEY,
    content TEXT NOT NULL,
    detail TEXT,
    domain TEXT NOT NULL DEFAULT 'general',
    source_agent_id TEXT NOT NULL,
    source_agent_name TEXT NOT NULL,
    cross_agent_id TEXT,
    cross_agent_name TEXT,
    source_type TEXT NOT NULL,
    source_description TEXT,
    confidence REAL NOT NULL DEFAULT 0.7,
    confirmed_count INTEGER NOT NULL DEFAULT 0,
    corrected_count INTEGER NOT NULL DEFAULT 0,
    mistake_count INTEGER NOT NULL DEFAULT 0,
    used_count INTEGER NOT NULL DEFAULT 0,
    learned_at TEXT,
    confirmed_at TEXT,
    last_used_at TEXT,
    deleted_at TEXT
  );

  CREATE TABLE IF NOT EXISTS memory_connections (
    source_memory_id TEXT NOT NULL REFERENCES memories(id),
    target_memory_id TEXT NOT NULL REFERENCES memories(id),
    relationship TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS memory_events (
    id TEXT PRIMARY KEY,
    memory_id TEXT NOT NULL REFERENCES memories(id),
    event_type TEXT NOT NULL,
    agent_id TEXT,
    agent_name TEXT,
    old_value TEXT,
    new_value TEXT,
    timestamp TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS agent_permissions (
    agent_id TEXT NOT NULL,
    domain TEXT NOT NULL,
    can_read INTEGER NOT NULL DEFAULT 1,
    can_write INTEGER NOT NULL DEFAULT 1
  );

  CREATE TABLE IF NOT EXISTS engrams_meta (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );
  INSERT OR IGNORE INTO engrams_meta (key, value) VALUES ('last_modified', datetime('now'));
`;

const MIGRATIONS_SQL = `
  -- Add has_pii_flag column if it doesn't exist
  -- SQLite doesn't support IF NOT EXISTS for ALTER TABLE, so we use a pragma check
  CREATE TABLE IF NOT EXISTS _migrations (name TEXT PRIMARY KEY);
  INSERT OR IGNORE INTO _migrations (name) VALUES ('add_has_pii_flag');
`;

function runMigration(sqlite: Database.Database, name: string, fn: () => void): void {
  const exists = sqlite.prepare(`SELECT 1 FROM _migrations WHERE name = ?`).get(name);
  if (!exists) {
    try { fn(); } catch { /* Column/index may already exist */ }
    sqlite.prepare(`INSERT OR IGNORE INTO _migrations (name) VALUES (?)`).run(name);
  }
}

function runMigrations(sqlite: Database.Database): void {
  sqlite.exec(`CREATE TABLE IF NOT EXISTS _migrations (name TEXT PRIMARY KEY)`);

  runMigration(sqlite, "add_has_pii_flag", () => {
    sqlite.exec(`ALTER TABLE memories ADD COLUMN has_pii_flag INTEGER NOT NULL DEFAULT 0`);
  });

  runMigration(sqlite, "add_entity_columns", () => {
    sqlite.exec(`ALTER TABLE memories ADD COLUMN entity_type TEXT`);
    sqlite.exec(`ALTER TABLE memories ADD COLUMN entity_name TEXT`);
    sqlite.exec(`ALTER TABLE memories ADD COLUMN structured_data TEXT`);
    sqlite.exec(`CREATE INDEX IF NOT EXISTS idx_memories_entity_type ON memories(entity_type) WHERE deleted_at IS NULL`);
    sqlite.exec(`CREATE INDEX IF NOT EXISTS idx_memories_entity_name ON memories(entity_name) WHERE deleted_at IS NULL`);
  });

  runMigration(sqlite, "fts_add_entity_name", () => {
    // Drop old FTS table and triggers, then recreate with entity_name column
    sqlite.exec(`DROP TRIGGER IF EXISTS memory_fts_insert`);
    sqlite.exec(`DROP TRIGGER IF EXISTS memory_fts_delete`);
    sqlite.exec(`DROP TRIGGER IF EXISTS memory_fts_update`);
    sqlite.exec(`DROP TABLE IF EXISTS memory_fts`);
    // setupFTS() will recreate the table and triggers with entity_name included
  });
}

export function createDatabase(dbPath?: string): { db: EngramsDatabase; sqlite: Database.Database; vecAvailable: boolean } {
  const dir = resolve(homedir(), ".engrams");
  mkdirSync(dir, { recursive: true });
  const path = dbPath ?? resolve(dir, "engrams.db");
  const sqlite = new Database(path);

  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("foreign_keys = ON");

  sqlite.exec(CREATE_TABLES_SQL);
  runMigrations(sqlite);
  setupFTS(sqlite);

  // Rebuild FTS index content (needed after migration drops and recreates the FTS table)
  try {
    sqlite.exec(`INSERT INTO memory_fts(memory_fts) VALUES('rebuild')`);
  } catch {
    // Non-fatal — FTS rebuild may fail if table is already populated
  }

  let vecAvailable = false;
  try {
    vecAvailable = setupVec(sqlite);
  } catch {
    // Defense-in-depth — setupVec has its own try/catch
  }

  try {
    chmodSync(path, 0o600);
  } catch {
    // May fail on some platforms; non-critical
  }

  const db = drizzle(sqlite, { schema });

  return { db, sqlite, vecAvailable };
}

export function bumpLastModified(sqlite: Database.Database): void {
  sqlite
    .prepare(`INSERT OR REPLACE INTO engrams_meta (key, value) VALUES ('last_modified', ?)`)
    .run(new Date().toISOString());
}

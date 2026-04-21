import { createClient, type Client } from "@libsql/client";
import { drizzle, type LibSQLDatabase } from "drizzle-orm/libsql";
import { resolve } from "path";
import { homedir } from "os";
import { mkdirSync, chmodSync } from "fs";
import * as schema from "./schema.js";
import { setupFTS } from "./fts.js";
import { setupVec } from "./vec.js";

export type LodisDatabase = LibSQLDatabase<typeof schema>;

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
    deleted_at TEXT,
    summary TEXT,
    permanence TEXT,
    expires_at TEXT,
    archived_at TEXT
  );

  CREATE TABLE IF NOT EXISTS memory_summaries (
    id TEXT PRIMARY KEY,
    entity_name TEXT NOT NULL,
    entity_type TEXT NOT NULL,
    summary TEXT NOT NULL,
    memory_ids TEXT NOT NULL,
    token_count INTEGER NOT NULL,
    generated_at TEXT NOT NULL,
    user_id TEXT,
    UNIQUE(entity_name, entity_type, user_id)
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
  -- The (agent_id, domain, IFNULL(user_id, '')) unique index is added
  -- by the agent_permissions_unique_index migration below — it cannot
  -- live in this initial CREATE TABLE because user_id is itself added
  -- by the add_user_id_columns migration which runs after this block.

  CREATE TABLE IF NOT EXISTS user_settings (
    user_id TEXT PRIMARY KEY,
    tier TEXT NOT NULL DEFAULT 'local',
    byok_provider TEXT,
    byok_api_key_enc TEXT,
    byok_base_url TEXT,
    byok_extraction_model TEXT,
    byok_analysis_model TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS api_tokens (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    token_hash TEXT NOT NULL UNIQUE,
    token_prefix TEXT NOT NULL,
    name TEXT NOT NULL,
    scopes TEXT NOT NULL DEFAULT 'read,write',
    expires_at TEXT,
    last_used_at TEXT,
    last_ip TEXT,
    revoked_at TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS sensitive_domains (
    user_id TEXT,
    domain TEXT NOT NULL,
    marked_at TEXT
  );
  CREATE UNIQUE INDEX IF NOT EXISTS idx_sensitive_domains_user_domain
    ON sensitive_domains(IFNULL(user_id, ''), domain);

  CREATE TABLE IF NOT EXISTS lodis_meta (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );
  INSERT OR IGNORE INTO lodis_meta (key, value) VALUES ('last_modified', datetime('now'));
`;

async function runMigration(client: Client, name: string, fn: () => Promise<void>): Promise<void> {
  const exists = await client.execute({ sql: `SELECT 1 FROM _migrations WHERE name = ?`, args: [name] });
  if (exists.rows.length === 0) {
    try { await fn(); } catch { /* Column/index may already exist */ }
    await client.execute({ sql: `INSERT OR IGNORE INTO _migrations (name) VALUES (?)`, args: [name] });
  }
}

async function runMigrations(client: Client): Promise<void> {
  await client.executeMultiple(`CREATE TABLE IF NOT EXISTS _migrations (name TEXT PRIMARY KEY)`);

  await runMigration(client, "add_has_pii_flag", async () => {
    await client.executeMultiple(`ALTER TABLE memories ADD COLUMN has_pii_flag INTEGER NOT NULL DEFAULT 0`);
  });

  await runMigration(client, "add_entity_columns", async () => {
    await client.executeMultiple(`
      ALTER TABLE memories ADD COLUMN entity_type TEXT;
      ALTER TABLE memories ADD COLUMN entity_name TEXT;
      ALTER TABLE memories ADD COLUMN structured_data TEXT;
    `);
    await client.execute({ sql: `CREATE INDEX IF NOT EXISTS idx_memories_entity_type ON memories(entity_type) WHERE deleted_at IS NULL`, args: [] });
    await client.execute({ sql: `CREATE INDEX IF NOT EXISTS idx_memories_entity_name ON memories(entity_name) WHERE deleted_at IS NULL`, args: [] });
  });

  await runMigration(client, "add_updated_at", async () => {
    await client.executeMultiple(`
      ALTER TABLE memories ADD COLUMN updated_at TEXT;
      UPDATE memories SET updated_at = COALESCE(confirmed_at, learned_at, datetime('now')) WHERE updated_at IS NULL;
      ALTER TABLE memory_connections ADD COLUMN updated_at TEXT;
      UPDATE memory_connections SET updated_at = datetime('now') WHERE updated_at IS NULL;
    `);

    await client.executeMultiple(`
      CREATE TRIGGER IF NOT EXISTS memories_updated_at_insert
      AFTER INSERT ON memories
      BEGIN
        UPDATE memories SET updated_at = datetime('now') WHERE id = NEW.id AND updated_at IS NULL;
      END;
    `);
    await client.executeMultiple(`
      CREATE TRIGGER IF NOT EXISTS memories_updated_at_update
      AFTER UPDATE ON memories
      WHEN NEW.updated_at IS OLD.updated_at OR NEW.updated_at IS NULL
      BEGIN
        UPDATE memories SET updated_at = datetime('now') WHERE id = NEW.id;
      END;
    `);
    await client.executeMultiple(`
      CREATE TRIGGER IF NOT EXISTS connections_updated_at_insert
      AFTER INSERT ON memory_connections
      BEGIN
        UPDATE memory_connections SET updated_at = datetime('now')
        WHERE source_memory_id = NEW.source_memory_id
          AND target_memory_id = NEW.target_memory_id
          AND relationship = NEW.relationship
          AND updated_at IS NULL;
      END;
    `);
  });

  await runMigration(client, "add_pro_tables", async () => {
    await client.executeMultiple(`
      CREATE TABLE IF NOT EXISTS user_settings (
        user_id TEXT PRIMARY KEY,
        tier TEXT NOT NULL DEFAULT 'local',
        byok_provider TEXT,
        byok_api_key_enc TEXT,
        byok_base_url TEXT,
        byok_extraction_model TEXT,
        byok_analysis_model TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE TABLE IF NOT EXISTS api_tokens (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        token_hash TEXT NOT NULL UNIQUE,
        token_prefix TEXT NOT NULL,
        name TEXT NOT NULL,
        scopes TEXT NOT NULL DEFAULT 'read,write',
        expires_at TEXT,
        last_used_at TEXT,
        last_ip TEXT,
        revoked_at TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
    `);
  });

  await runMigration(client, "add_user_id_columns", async () => {
    await client.executeMultiple(`
      ALTER TABLE memories ADD COLUMN user_id TEXT;
      ALTER TABLE memory_connections ADD COLUMN user_id TEXT;
      ALTER TABLE memory_events ADD COLUMN user_id TEXT;
      ALTER TABLE agent_permissions ADD COLUMN user_id TEXT;
    `);
    await client.execute({ sql: `CREATE INDEX IF NOT EXISTS idx_memories_user_id ON memories(user_id)`, args: [] });
    await client.execute({ sql: `CREATE INDEX IF NOT EXISTS idx_api_tokens_hash ON api_tokens(token_hash)`, args: [] });
    await client.execute({ sql: `CREATE INDEX IF NOT EXISTS idx_api_tokens_user ON api_tokens(user_id)`, args: [] });
  });

  await runMigration(client, "add_permanence_columns", async () => {
    await client.executeMultiple(`
      ALTER TABLE memories ADD COLUMN permanence TEXT;
      ALTER TABLE memories ADD COLUMN expires_at TEXT;
      ALTER TABLE memories ADD COLUMN archived_at TEXT;
    `);
    await client.execute({ sql: `CREATE INDEX IF NOT EXISTS idx_memories_permanence ON memories(permanence) WHERE deleted_at IS NULL`, args: [] });
    await client.execute({ sql: `CREATE INDEX IF NOT EXISTS idx_memories_expires_at ON memories(expires_at) WHERE deleted_at IS NULL AND expires_at IS NOT NULL`, args: [] });
  });

  await runMigration(client, "add_summary_and_profiles", async () => {
    await client.execute({ sql: `ALTER TABLE memories ADD COLUMN summary TEXT`, args: [] });
    await client.executeMultiple(`
      CREATE TABLE IF NOT EXISTS memory_summaries (
        id TEXT PRIMARY KEY,
        entity_name TEXT NOT NULL,
        entity_type TEXT NOT NULL,
        summary TEXT NOT NULL,
        memory_ids TEXT NOT NULL,
        token_count INTEGER NOT NULL,
        generated_at TEXT NOT NULL,
        user_id TEXT,
        UNIQUE(entity_name, entity_type, user_id)
      );
    `);
  });

  await runMigration(client, "add_cleanup_dismissals", async () => {
    await client.executeMultiple(`
      CREATE TABLE IF NOT EXISTS cleanup_dismissals (
        id TEXT PRIMARY KEY,
        user_id TEXT,
        suggestion_key TEXT NOT NULL,
        suggestion_type TEXT NOT NULL,
        action TEXT NOT NULL,
        resolution_note TEXT,
        created_at TEXT NOT NULL,
        UNIQUE(user_id, suggestion_key)
      );
      CREATE INDEX IF NOT EXISTS idx_cleanup_dismissals_user ON cleanup_dismissals(user_id);
    `);
  });

  await runMigration(client, "add_context_retrievals_and_feedback", async () => {
    await client.executeMultiple(`
      ALTER TABLE memories ADD COLUMN referenced_count INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE memories ADD COLUMN noise_count INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE memories ADD COLUMN last_referenced_at TEXT;
      CREATE TABLE IF NOT EXISTS context_retrievals (
        id TEXT PRIMARY KEY,
        user_id TEXT,
        agent_id TEXT,
        agent_name TEXT,
        query TEXT NOT NULL,
        query_hash TEXT,
        query_redacted TEXT,
        token_budget INTEGER NOT NULL,
        format TEXT NOT NULL,
        filters_json TEXT,
        tokens_used INTEGER NOT NULL DEFAULT 0,
        returned_memory_ids_json TEXT NOT NULL,
        saturation_json TEXT,
        score_distribution_json TEXT,
        created_at TEXT NOT NULL,
        rated_at TEXT,
        referenced_memory_ids_json TEXT,
        noise_memory_ids_json TEXT,
        notes TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_context_retrievals_user ON context_retrievals(user_id);
      CREATE INDEX IF NOT EXISTS idx_context_retrievals_created ON context_retrievals(created_at);
      CREATE INDEX IF NOT EXISTS idx_context_retrievals_rated ON context_retrievals(rated_at) WHERE rated_at IS NULL;
    `);
  });

  await runMigration(client, "agent_permissions_unique_index", async () => {
    // Dedupe any existing duplicate (agent_id, domain, user_id) rows so the
    // unique index can be created. Keeps the most permissive copy per group
    // (max can_read, max can_write) — safer than picking arbitrarily, since
    // a zero-permission row that shadows a real grant would be worse than
    // the reverse. IFNULL(user_id, '') matches the index expression below.
    await client.executeMultiple(`
      DELETE FROM agent_permissions
      WHERE rowid NOT IN (
        SELECT MIN(rowid) FROM agent_permissions
        GROUP BY agent_id, domain, IFNULL(user_id, '')
      );
      CREATE UNIQUE INDEX IF NOT EXISTS idx_agent_permissions_unique
        ON agent_permissions(agent_id, domain, IFNULL(user_id, ''));
    `);
  });

  await runMigration(client, "fts_add_entity_name", async () => {
    // Drop old FTS table and triggers, then recreate with entity_name column
    await client.executeMultiple(`
      DROP TRIGGER IF EXISTS memory_fts_insert;
      DROP TRIGGER IF EXISTS memory_fts_delete;
      DROP TRIGGER IF EXISTS memory_fts_update;
      DROP TABLE IF EXISTS memory_fts;
    `);
    // setupFTS() will recreate the table and triggers with entity_name included
  });

  await runMigration(client, "fts_porter_stemming", async () => {
    // Rebuild FTS table with porter stemming tokenizer for better search recall
    await client.executeMultiple(`
      DROP TRIGGER IF EXISTS memory_fts_insert;
      DROP TRIGGER IF EXISTS memory_fts_delete;
      DROP TRIGGER IF EXISTS memory_fts_update;
      DROP TABLE IF EXISTS memory_fts;
    `);
    // setupFTS() will recreate with tokenize='porter unicode61'
  });

  await runMigration(client, "add_reranker_diagnostic_columns", async () => {
    // Telemetry for the cross-encoder reranker (Stage 2 of memory_context).
    // `reranker_engaged`: 1 = reranker produced final ordering, 0 = disabled
    // / no candidates / silent-fallback after throw, NULL = pre-migration row.
    // `reranker_error`: captured message when Stage 2 threw and fell back to
    // RRF ordering. Surfaces silent-fallback rates on /retrievals dashboard.
    await client.executeMultiple(`
      ALTER TABLE context_retrievals ADD COLUMN reranker_engaged INTEGER;
      ALTER TABLE context_retrievals ADD COLUMN reranker_error TEXT;
    `);
  });
}

export async function createDatabase(config?: {
  url?: string;
  authToken?: string;
}): Promise<{ db: LodisDatabase; client: Client; vecAvailable: boolean }> {
  const isLocal = !config?.url || config.url.startsWith("file:");

  let url: string;
  if (isLocal) {
    const dir = resolve(homedir(), ".lodis");
    mkdirSync(dir, { recursive: true });
    url = config?.url ?? "file:" + resolve(dir, "lodis.db");
  } else {
    url = config.url!;
  }

  const client = createClient({
    url,
    authToken: config?.authToken,
  });

  // For local mode, apply WAL and foreign keys pragmas
  if (isLocal) {
    await client.execute({ sql: "PRAGMA journal_mode = WAL", args: [] });
    await client.execute({ sql: "PRAGMA foreign_keys = ON", args: [] });
  }

  await client.executeMultiple(CREATE_TABLES_SQL);
  await runMigrations(client);
  await setupFTS(client);

  // Rebuild FTS index content (needed after migration drops and recreates the FTS table)
  try {
    await client.execute({ sql: `INSERT INTO memory_fts(memory_fts) VALUES('rebuild')`, args: [] });
  } catch {
    // Non-fatal — FTS rebuild may fail if table is already populated
  }

  let vecAvailable = false;
  try {
    vecAvailable = await setupVec(client);
  } catch {
    // Defense-in-depth — setupVec has its own try/catch
  }

  if (isLocal) {
    try {
      const dbPath = url.replace(/^file:/, "");
      chmodSync(dbPath, 0o600);
    } catch {
      // May fail on some platforms; non-critical
    }
  }

  const db = drizzle(client, { schema });

  return { db, client, vecAvailable };
}

export async function bumpLastModified(client: Client): Promise<void> {
  await client.execute({
    sql: `INSERT OR REPLACE INTO lodis_meta (key, value) VALUES ('last_modified', ?)`,
    args: [new Date().toISOString()],
  });
}

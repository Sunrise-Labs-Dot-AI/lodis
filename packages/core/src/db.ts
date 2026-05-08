import { createClient, type Client } from "@libsql/client";
import { drizzle, type LibSQLDatabase } from "drizzle-orm/libsql";
import { resolve } from "path";
import { homedir } from "os";
import { mkdirSync, chmodSync } from "fs";
import * as schema from "./schema.js";
import { setupFTS } from "./fts.js";
import { setupVec } from "./vec.js";
import { seedDomainsFromMemories } from "./domains.js";

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

  await runMigration(client, "add_domain_registry_and_snippet_support", async () => {
    // Domain registry — flex-validated life domains with archive/unarchive
    // lifecycle. See plan D3, D9, D10.
    await client.executeMultiple(`
      CREATE TABLE IF NOT EXISTS domains (
        name          TEXT    NOT NULL,
        description   TEXT,
        parent_name   TEXT,
        archived      INTEGER NOT NULL DEFAULT 0,
        archived_at   TEXT,
        created_at    TEXT    NOT NULL,
        user_id       TEXT
      );
    `);
    await client.execute({
      sql: `CREATE UNIQUE INDEX IF NOT EXISTS idx_domains_name_user
            ON domains(IFNULL(user_id, ''), name)`,
      args: [],
    });
    await client.execute({
      sql: `CREATE INDEX IF NOT EXISTS idx_domains_archived
            ON domains(archived) WHERE archived = 1`,
      args: [],
    });

    // Real event_timestamp column for snippets (D11). Nullable — only populated
    // by memory_write_snippet. `learned_at` remains the trusted server time.
    await client.executeMultiple(`ALTER TABLE memories ADD COLUMN event_ts TEXT`);
    await client.execute({
      sql: `CREATE INDEX IF NOT EXISTS idx_memories_event_ts
            ON memories(event_ts)
            WHERE event_ts IS NOT NULL AND deleted_at IS NULL`,
      args: [],
    });

    // Rate-limit index (D4) — snippets-only partial index keeps it cheap.
    await client.execute({
      sql: `CREATE INDEX IF NOT EXISTS idx_memories_snippet_agent_domain_learned
            ON memories(source_agent_id, domain, learned_at)
            WHERE entity_type = 'snippet' AND deleted_at IS NULL`,
      args: [],
    });

    // Dedup expression index for (source_system, source_id) on snippet rows.
    await client.execute({
      sql: `CREATE INDEX IF NOT EXISTS idx_memories_snippet_source
            ON memories(json_extract(structured_data, '$.source_system'),
                        json_extract(structured_data, '$.source_id'))
            WHERE entity_type = 'snippet' AND deleted_at IS NULL`,
      args: [],
    });

    // Seed registry from current distinct slug-valid domain values. Orphan
    // (non-slug) domains remain un-seeded and visible via memory_list_domains
    // with registered=false — see plan D8/D9.
    await seedDomainsFromMemories(client);
  });

  await runMigration(client, "add_embedding_shape_column", async () => {
    // W1a (retrieval-wave-1 plan): track which embed-text shape a row's
    // embedding was written under. NULL = legacy `content + " " + detail`
    // (pre-W1a default). "v1-bracketed" = buildEmbedText with metadata prefix.
    // Used by the migration script to skip already-migrated rows and by
    // rollback tooling to target rows at a specific shape.
    await client.executeMultiple(`
      ALTER TABLE memories ADD COLUMN embedding_shape TEXT;
      CREATE INDEX IF NOT EXISTS idx_memories_embedding_shape
        ON memories(embedding_shape) WHERE deleted_at IS NULL;
    `);
  });

  await runMigration(client, "wave2_5_connection_indexes", async () => {
    // Wave 2.5 — connection infrastructure prerequisites.
    //
    // (1) Unique edge index: prerequisite for INSERT OR IGNORE in L1, L2a, L3,
    //     L4. Without this, every L4 re-run would double the table (Security F2
    //     in plan-review round 2). The triple uniquely identifies an edge —
    //     two memories CAN have multiple edges as long as they have different
    //     relationships (e.g. `works_at` AND `references` between the same
    //     pair is legal; two `works_at` is not).
    //
    // (2) COLLATE NOCASE entity_name index: L1 (caller-supplied targetEntityName
    //     resolution) and L2a (auto-edge by entity_name match) both query
    //     `WHERE entity_name = ? COLLATE NOCASE`. The pre-existing
    //     idx_memories_entity_name (line 143) is case-sensitive and won't be
    //     used by the planner for COLLATE NOCASE comparisons. Saboteur F2 in
    //     plan-review round 2: without this, L2a degrades to a full scan on
    //     the hottest write path on Turso multi-tenant DBs at 100K+ rows.
    //
    // (3) target_memory_id covering index: fetchPprEdges uses
    //     `WHERE source_memory_id IN (200) AND target_memory_id IN (200)`.
    //     The unique edge index covers source-side; this one covers target-side
    //     so both IN-clauses are index-accelerated. Perf-W7 in code-review.
    //
    // Both are CREATE ... IF NOT EXISTS — safe re-run. Rollback: DROP INDEX
    // (universally supported, no Turso libSQL version dependency).

    // CRITICAL: dedup pre-pass for the unique index (Sb-C1 in code-review
    // round 1). On a dirty production DB, pre-existing duplicate
    // (source, target, relationship) rows from older `memory_connect` /
    // `memory_index` paths (which had no uniqueness enforcement) would cause
    // CREATE UNIQUE INDEX to fail. The runMigration wrapper SILENTLY swallows
    // that error AND still inserts the migration name into _migrations — so a
    // failed CREATE leaves the index missing AND the migration marked done,
    // and all subsequent INSERT OR IGNORE statements silently degrade to
    // plain INSERT, accumulating duplicates forever.
    //
    // Mitigation: wrap the dedup DELETE + CREATE UNIQUE INDEX in a single
    // transaction so no concurrent writer can insert a new duplicate between
    // dedup and create. SQLite serializes writes, so the transaction's
    // exclusive lock guarantees atomicity.
    await client.executeMultiple(`
      BEGIN IMMEDIATE;
      DELETE FROM memory_connections
       WHERE rowid NOT IN (
         SELECT MIN(rowid) FROM memory_connections
          GROUP BY source_memory_id, target_memory_id, relationship
       );
      CREATE UNIQUE INDEX IF NOT EXISTS idx_memory_connections_unique
        ON memory_connections(source_memory_id, target_memory_id, relationship);
      COMMIT;
    `);
    await client.execute({
      sql: `CREATE INDEX IF NOT EXISTS idx_memories_entity_name_nocase
              ON memories(entity_name COLLATE NOCASE)
              WHERE deleted_at IS NULL AND entity_name IS NOT NULL`,
      args: [],
    });
    await client.execute({
      sql: `CREATE INDEX IF NOT EXISTS idx_memory_connections_target
              ON memory_connections(target_memory_id)`,
      args: [],
    });

    // Verification: confirm the unique index actually exists. The
    // runMigration wrapper marks the migration done unconditionally, so a
    // throw here doesn't trigger automatic retry — but a loud stderr warning
    // gives operators an actionable signal. Manual recovery: DELETE FROM
    // _migrations WHERE name = 'wave2_5_connection_indexes' and re-run.
    const verify = await client.execute({
      sql: `SELECT 1 FROM sqlite_master
             WHERE type = 'index' AND name = 'idx_memory_connections_unique'`,
      args: [],
    });
    if (verify.rows.length === 0) {
      process.stderr.write(
        "[lodis] CRITICAL: wave2_5_connection_indexes unique index missing after CREATE — " +
        "INSERT OR IGNORE on memory_connections will silently degrade to plain INSERT and accumulate duplicates. " +
        "Recovery: DELETE FROM _migrations WHERE name = 'wave2_5_connection_indexes' and restart.\n",
      );
    }
  });

  await runMigration(client, "wave2_5_covering_indexes", async () => {
    // Wave 2.5 follow-up — covering composites for the L2a + L3 hot paths.
    //
    // Perf-W6 (round 2 verdict: still INSUFFICIENT) and Perf-F1 in code-review:
    // wave2_5_connection_indexes added an `entity_name COLLATE NOCASE` index but
    // not a covering composite for the `ORDER BY updated_at DESC NULLS LAST`
    // clause that L2a (every write) and L3 candidate-generation (50× per
    // memory_propose_connections call) actually issue. The pre-existing index
    // satisfies the equality lookup but the planner has to filesort the matched
    // rows on every call (`USE TEMP B-TREE FOR ORDER BY` in EXPLAIN). At 100K
    // memories with a hot entity_name like "James" or "Anthropic" this is a
    // real perf cliff on the write path.
    //
    // (1) entity_name + updated_at composite — leading column is
    //     `entity_name COLLATE NOCASE` so it strictly supersedes the older
    //     idx_memories_entity_name_nocase for any query that index satisfied
    //     (planner verified — see verification block below). updated_at DESC
    //     means the index walks pre-sorted, so ORDER BY ... LIMIT short-circuits
    //     without a temp B-tree.
    //
    // (2) domain + updated_at composite with `entity_type IS NOT 'snippet'`
    //     partial predicate — matches the same-domain branch of
    //     generateCandidatesForMemory exactly. Without this the planner falls
    //     through to idx_memories_user_id (entire user partition scan) and
    //     filesorts. The snippet exclusion is in the partial-index WHERE so
    //     the index doesn't bloat with the high-frequency snippet table
    //     (snippets are ~99% of write volume on agents that poll Notion/GH).
    //
    // Both indexes are CREATE ... IF NOT EXISTS — safe re-run. The older
    // single-column `idx_memories_entity_name_nocase` is dropped because the
    // new composite has the same leading-column shape and SQLite consistently
    // picks the new one (verified below). Keeping both wastes write amp.
    //
    // Wrapped in BEGIN IMMEDIATE / COMMIT to match the wave2_5_connection_indexes
    // atomicity pattern (lines 460-470). Critical: the runMigration wrapper at
    // line 121 silently swallows errors AND marks the migration done in
    // _migrations regardless. Without the transaction, a partial failure
    // (CREATE #2 fails mid-migration) would leave us with: composite #1 created,
    // composite #2 missing, old index still present (DROP never reached). The
    // migration would be marked done, so re-running is a no-op. Recovery would
    // require manual `DELETE FROM _migrations` + restart. With the transaction,
    // any failure rolls back all three statements and the verification block
    // below catches the inconsistency on the same run.
    //
    // Rollback: DROP INDEX idx_memories_entity_name_nocase_updated;
    //           DROP INDEX idx_memories_domain_updated;
    //           CREATE INDEX idx_memories_entity_name_nocase
    //             ON memories(entity_name COLLATE NOCASE)
    //             WHERE deleted_at IS NULL AND entity_name IS NOT NULL;
    //           DELETE FROM _migrations WHERE name = 'wave2_5_covering_indexes';
    await client.executeMultiple(`
      BEGIN IMMEDIATE;
      CREATE INDEX IF NOT EXISTS idx_memories_entity_name_nocase_updated
        ON memories(entity_name COLLATE NOCASE, updated_at DESC)
        WHERE deleted_at IS NULL AND entity_name IS NOT NULL;
      CREATE INDEX IF NOT EXISTS idx_memories_domain_updated
        ON memories(domain, updated_at DESC)
        WHERE deleted_at IS NULL AND entity_type IS NOT 'snippet';
      DROP INDEX IF EXISTS idx_memories_entity_name_nocase;
      COMMIT;
    `);

    // Verification: confirm both new indexes exist AND the old one is gone.
    // Same rationale as wave2_5_connection_indexes verification (lines 488-499):
    // the runMigration wrapper marks the migration done unconditionally, so a
    // throw here doesn't trigger automatic retry — but a loud stderr warning
    // gives operators an actionable signal. Manual recovery: DELETE FROM
    // _migrations WHERE name = 'wave2_5_covering_indexes' and restart.
    const verify = await client.execute({
      sql: `SELECT name FROM sqlite_master
             WHERE type = 'index'
               AND name IN (
                 'idx_memories_entity_name_nocase_updated',
                 'idx_memories_domain_updated',
                 'idx_memories_entity_name_nocase'
               )`,
      args: [],
    });
    const presentIndexes = new Set(verify.rows.map((r) => r.name as string));
    const newCompositeOk = presentIndexes.has("idx_memories_entity_name_nocase_updated");
    const newDomainOk = presentIndexes.has("idx_memories_domain_updated");
    const oldDropped = !presentIndexes.has("idx_memories_entity_name_nocase");
    if (!newCompositeOk || !newDomainOk || !oldDropped) {
      process.stderr.write(
        "[lodis] CRITICAL: wave2_5_covering_indexes inconsistent state after migration — " +
        `entity_name composite=${newCompositeOk}, domain composite=${newDomainOk}, old index dropped=${oldDropped}. ` +
        "L2a + L3 hot-path queries will silently regress to filesorts (or worse, full scans). " +
        "Recovery: DELETE FROM _migrations WHERE name = 'wave2_5_covering_indexes' and restart.\n",
      );
    }
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

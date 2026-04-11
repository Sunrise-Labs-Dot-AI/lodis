import type { Client } from "@libsql/client";
import { encrypt, decrypt } from "./crypto.js";

const BATCH_SIZE = 100;

// --- Export/Import types ---

export interface EngramsExportData {
  version: "1.0";
  exportedAt: string;
  memories: Record<string, unknown>[];
  connections: Record<string, unknown>[];
  events?: Record<string, unknown>[];
  pagination: { offset: number; limit: number; total: number; hasMore: boolean };
}

// Columns to include in export (everything except embedding which is binary/model-specific)
const MEMORY_EXPORT_COLUMNS = [
  "id", "content", "detail", "domain",
  "source_agent_id", "source_agent_name", "cross_agent_id", "cross_agent_name",
  "source_type", "source_description",
  "confidence", "confirmed_count", "corrected_count", "mistake_count", "used_count",
  "learned_at", "confirmed_at", "last_used_at", "deleted_at",
  "has_pii_flag", "entity_type", "entity_name", "structured_data", "summary",
  "permanence", "expires_at", "archived_at", "user_id", "updated_at",
] as const;

/**
 * Export memories as JSON for cross-server migration.
 * Paginated to keep payloads manageable for MCP tool results.
 * Excludes embeddings (binary, model-specific — regenerated on import).
 */
export async function exportMemories(
  client: Client,
  options: {
    limit?: number;
    offset?: number;
    userId?: string | null;
    includeEvents?: boolean;
    domain?: string;
  } = {},
): Promise<EngramsExportData> {
  const limit = Math.min(options.limit ?? 100, 500);
  const offset = options.offset ?? 0;

  // Build WHERE clause
  const conditions = ["deleted_at IS NULL"];
  const args: (string | number | null)[] = [];

  if (options.userId) {
    conditions.push("user_id = ?");
    args.push(options.userId);
  }
  if (options.domain) {
    conditions.push("domain = ?");
    args.push(options.domain);
  }

  const where = conditions.join(" AND ");

  // Get total count
  const countResult = await client.execute({
    sql: `SELECT COUNT(*) as cnt FROM memories WHERE ${where}`,
    args,
  });
  const total = (countResult.rows[0]?.cnt as number) ?? 0;

  // Get paginated memories
  const columns = MEMORY_EXPORT_COLUMNS.join(", ");
  const memoriesResult = await client.execute({
    sql: `SELECT ${columns} FROM memories WHERE ${where} ORDER BY learned_at ASC LIMIT ? OFFSET ?`,
    args: [...args, limit, offset],
  });

  const memories = memoriesResult.rows.map((row) => {
    const mem: Record<string, unknown> = {};
    for (const col of MEMORY_EXPORT_COLUMNS) {
      mem[col] = row[col] ?? null;
    }
    return mem;
  });

  // Get connections for exported memory IDs
  const memoryIds = memories.map((m) => m.id as string);
  let connections: Record<string, unknown>[] = [];
  if (memoryIds.length > 0) {
    const placeholders = memoryIds.map(() => "?").join(", ");
    const connResult = await client.execute({
      sql: `SELECT source_memory_id, target_memory_id, relationship, user_id, updated_at
            FROM memory_connections
            WHERE source_memory_id IN (${placeholders}) OR target_memory_id IN (${placeholders})`,
      args: [...memoryIds, ...memoryIds],
    });
    connections = connResult.rows.map((row) => ({
      source_memory_id: row.source_memory_id,
      target_memory_id: row.target_memory_id,
      relationship: row.relationship,
      user_id: row.user_id ?? null,
      updated_at: row.updated_at ?? null,
    }));
  }

  // Optionally get events
  let events: Record<string, unknown>[] | undefined;
  if (options.includeEvents && memoryIds.length > 0) {
    const placeholders = memoryIds.map(() => "?").join(", ");
    const eventsResult = await client.execute({
      sql: `SELECT id, memory_id, event_type, agent_id, agent_name, old_value, new_value, user_id, timestamp
            FROM memory_events WHERE memory_id IN (${placeholders})`,
      args: memoryIds,
    });
    events = eventsResult.rows.map((row) => ({
      id: row.id,
      memory_id: row.memory_id,
      event_type: row.event_type,
      agent_id: row.agent_id ?? null,
      agent_name: row.agent_name ?? null,
      old_value: row.old_value ?? null,
      new_value: row.new_value ?? null,
      user_id: row.user_id ?? null,
      timestamp: row.timestamp,
    }));
  }

  return {
    version: "1.0",
    exportedAt: new Date().toISOString(),
    memories,
    connections,
    ...(events ? { events } : {}),
    pagination: { offset, limit, total, hasMore: offset + limit < total },
  };
}

/**
 * Import memories from an Engrams export JSON.
 * Preserves all original metadata faithfully — no confidence reset, no entity re-extraction.
 * Deduplicates by memory ID (INSERT OR IGNORE). Safe to re-run.
 * Remaps user_id to the provided userId.
 */
export async function importFromExport(
  client: Client,
  data: { memories: Record<string, unknown>[]; connections?: Record<string, unknown>[]; events?: Record<string, unknown>[] },
  options: { userId?: string | null } = {},
): Promise<{ imported: number; skipped: number; connections: number; events: number }> {
  let imported = 0;
  let skipped = 0;
  let connectionsImported = 0;
  let eventsImported = 0;

  const memories = data.memories ?? [];
  if (memories.length === 0) {
    return { imported: 0, skipped: 0, connections: 0, events: 0 };
  }

  // Check which IDs already exist
  const incomingIds = memories.map((m) => m.id as string).filter(Boolean);
  const existingIds = new Set<string>();
  for (let i = 0; i < incomingIds.length; i += BATCH_SIZE) {
    const batch = incomingIds.slice(i, i + BATCH_SIZE);
    const placeholders = batch.map(() => "?").join(", ");
    const result = await client.execute({
      sql: `SELECT id FROM memories WHERE id IN (${placeholders})`,
      args: batch,
    });
    for (const row of result.rows) {
      existingIds.add(row.id as string);
    }
  }

  // Insert new memories
  for (let i = 0; i < memories.length; i += BATCH_SIZE) {
    const batch = memories.slice(i, i + BATCH_SIZE);
    for (const mem of batch) {
      const id = mem.id as string;
      if (!id || existingIds.has(id)) {
        skipped++;
        continue;
      }

      await client.execute({
        sql: `INSERT OR IGNORE INTO memories
          (id, content, detail, domain, source_agent_id, source_agent_name,
           cross_agent_id, cross_agent_name, source_type, source_description,
           confidence, confirmed_count, corrected_count, mistake_count, used_count,
           learned_at, confirmed_at, last_used_at, deleted_at,
           has_pii_flag, entity_type, entity_name, structured_data, summary,
           permanence, expires_at, archived_at, user_id, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        args: [
          id,
          (mem.content as string) ?? "",
          (mem.detail as string | null) ?? null,
          (mem.domain as string) ?? "general",
          (mem.source_agent_id as string) ?? "import",
          (mem.source_agent_name as string) ?? "memory_import",
          (mem.cross_agent_id as string | null) ?? null,
          (mem.cross_agent_name as string | null) ?? null,
          (mem.source_type as string) ?? "inferred",
          (mem.source_description as string | null) ?? null,
          (mem.confidence as number) ?? 0.7,
          (mem.confirmed_count as number) ?? 0,
          (mem.corrected_count as number) ?? 0,
          (mem.mistake_count as number) ?? 0,
          (mem.used_count as number) ?? 0,
          (mem.learned_at as string | null) ?? null,
          (mem.confirmed_at as string | null) ?? null,
          (mem.last_used_at as string | null) ?? null,
          (mem.deleted_at as string | null) ?? null,
          (mem.has_pii_flag as number) ?? 0,
          (mem.entity_type as string | null) ?? null,
          (mem.entity_name as string | null) ?? null,
          (mem.structured_data as string | null) ?? null,
          (mem.summary as string | null) ?? null,
          (mem.permanence as string | null) ?? null,
          (mem.expires_at as string | null) ?? null,
          (mem.archived_at as string | null) ?? null,
          options.userId ?? (mem.user_id as string | null) ?? null,
          (mem.updated_at as string | null) ?? null,
        ],
      });
      imported++;
    }
  }

  // Import connections — only where both endpoints exist
  const connections = data.connections ?? [];
  if (connections.length > 0) {
    // Build set of all memory IDs in the DB that are referenced by connections
    const referencedIds = new Set<string>();
    for (const conn of connections) {
      referencedIds.add(conn.source_memory_id as string);
      referencedIds.add(conn.target_memory_id as string);
    }
    const refArray = [...referencedIds];
    const validIds = new Set<string>();
    for (let i = 0; i < refArray.length; i += BATCH_SIZE) {
      const batch = refArray.slice(i, i + BATCH_SIZE);
      const placeholders = batch.map(() => "?").join(", ");
      const result = await client.execute({
        sql: `SELECT id FROM memories WHERE id IN (${placeholders})`,
        args: batch,
      });
      for (const row of result.rows) {
        validIds.add(row.id as string);
      }
    }

    for (const conn of connections) {
      const src = conn.source_memory_id as string;
      const tgt = conn.target_memory_id as string;
      if (!validIds.has(src) || !validIds.has(tgt)) continue;

      await client.execute({
        sql: `INSERT OR IGNORE INTO memory_connections
          (source_memory_id, target_memory_id, relationship, user_id, updated_at)
          VALUES (?, ?, ?, ?, ?)`,
        args: [
          src, tgt,
          (conn.relationship as string) ?? "related",
          options.userId ?? (conn.user_id as string | null) ?? null,
          (conn.updated_at as string | null) ?? null,
        ],
      });
      connectionsImported++;
    }
  }

  // Import events
  const events = data.events ?? [];
  if (events.length > 0) {
    for (const evt of events) {
      await client.execute({
        sql: `INSERT OR IGNORE INTO memory_events
          (id, memory_id, event_type, agent_id, agent_name, old_value, new_value, user_id, timestamp)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        args: [
          (evt.id as string) ?? null,
          (evt.memory_id as string) ?? null,
          (evt.event_type as string) ?? "imported",
          (evt.agent_id as string | null) ?? null,
          (evt.agent_name as string | null) ?? null,
          (evt.old_value as string | null) ?? null,
          (evt.new_value as string | null) ?? null,
          options.userId ?? (evt.user_id as string | null) ?? null,
          (evt.timestamp as string) ?? new Date().toISOString(),
        ],
      });
      eventsImported++;
    }
  }

  return { imported, skipped, connections: connectionsImported, events: eventsImported };
}

/**
 * Migrate all data from a local database to a cloud (Turso) database.
 * Encrypts content, detail, and structured_data fields.
 * Embeddings are copied as-is (not sensitive).
 * Idempotent via INSERT OR REPLACE.
 */
export async function migrateToCloud(
  localClient: Client,
  cloudClient: Client,
  encryptionKey: Buffer,
  onProgress?: (msg: string) => void,
): Promise<{ migrated: number }> {
  let migrated = 0;

  // Initialize schema on destination
  await initSchema(cloudClient);

  // --- Memories ---
  const memoriesResult = await localClient.execute({
    sql: `SELECT * FROM memories WHERE deleted_at IS NULL`,
    args: [],
  });
  const memories = memoriesResult.rows;
  onProgress?.(`Migrating ${memories.length} memories...`);

  for (let i = 0; i < memories.length; i += BATCH_SIZE) {
    const batch = memories.slice(i, i + BATCH_SIZE);
    for (const mem of batch) {
      const encContent = encrypt(mem.content as string, encryptionKey);
      const encDetail = mem.detail ? encrypt(mem.detail as string, encryptionKey) : null;
      const encStructured = mem.structured_data ? encrypt(mem.structured_data as string, encryptionKey) : null;

      await cloudClient.execute({
        sql: `INSERT OR REPLACE INTO memories
          (id, content, detail, domain, source_agent_id, source_agent_name,
           cross_agent_id, cross_agent_name, source_type, source_description,
           confidence, confirmed_count, corrected_count, mistake_count, used_count,
           learned_at, confirmed_at, last_used_at, deleted_at,
           has_pii_flag, entity_type, entity_name, structured_data, summary,
           permanence, expires_at, archived_at, embedding, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        args: [
          mem.id as string, encContent, encDetail,
          mem.domain as string, mem.source_agent_id as string, mem.source_agent_name as string,
          (mem.cross_agent_id as string | null) ?? null, (mem.cross_agent_name as string | null) ?? null,
          mem.source_type as string, (mem.source_description as string | null) ?? null,
          mem.confidence as number,
          mem.confirmed_count as number, mem.corrected_count as number,
          mem.mistake_count as number, mem.used_count as number,
          (mem.learned_at as string | null) ?? null, (mem.confirmed_at as string | null) ?? null,
          (mem.last_used_at as string | null) ?? null, (mem.deleted_at as string | null) ?? null,
          (mem.has_pii_flag as number) ?? 0, (mem.entity_type as string | null) ?? null,
          (mem.entity_name as string | null) ?? null, encStructured,
          (mem.summary as string | null) ?? null,
          (mem.permanence as string | null) ?? null,
          (mem.expires_at as string | null) ?? null,
          (mem.archived_at as string | null) ?? null,
          mem.embedding ?? null,
          (mem.updated_at as string | null) ?? null,
        ],
      });
      migrated++;
    }
    onProgress?.(`Migrated ${Math.min(i + BATCH_SIZE, memories.length)}/${memories.length} memories...`);
  }

  // --- Memory Connections ---
  const connectionsResult = await localClient.execute({
    sql: `SELECT * FROM memory_connections`,
    args: [],
  });
  const connections = connectionsResult.rows;
  onProgress?.(`Migrating ${connections.length} connections...`);

  for (let i = 0; i < connections.length; i += BATCH_SIZE) {
    const batch = connections.slice(i, i + BATCH_SIZE);
    for (const conn of batch) {
      await cloudClient.execute({
        sql: `INSERT OR REPLACE INTO memory_connections
          (source_memory_id, target_memory_id, relationship, updated_at)
          VALUES (?, ?, ?, ?)`,
        args: [
          conn.source_memory_id as string, conn.target_memory_id as string,
          conn.relationship as string, (conn.updated_at as string | null) ?? null,
        ],
      });
      migrated++;
    }
  }

  // --- Memory Events ---
  const eventsResult = await localClient.execute({
    sql: `SELECT * FROM memory_events`,
    args: [],
  });
  const events = eventsResult.rows;
  onProgress?.(`Migrating ${events.length} events...`);

  for (let i = 0; i < events.length; i += BATCH_SIZE) {
    const batch = events.slice(i, i + BATCH_SIZE);
    for (const evt of batch) {
      await cloudClient.execute({
        sql: `INSERT OR REPLACE INTO memory_events
          (id, memory_id, event_type, agent_id, agent_name, old_value, new_value, timestamp)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        args: [
          evt.id as string, evt.memory_id as string, evt.event_type as string,
          (evt.agent_id as string | null) ?? null, (evt.agent_name as string | null) ?? null,
          (evt.old_value as string | null) ?? null, (evt.new_value as string | null) ?? null,
          evt.timestamp as string,
        ],
      });
      migrated++;
    }
  }

  // --- Agent Permissions ---
  const permsResult = await localClient.execute({
    sql: `SELECT * FROM agent_permissions`,
    args: [],
  });
  const perms = permsResult.rows;
  onProgress?.(`Migrating ${perms.length} agent permissions...`);

  for (const perm of perms) {
    await cloudClient.execute({
      sql: `INSERT OR REPLACE INTO agent_permissions
        (agent_id, domain, can_read, can_write)
        VALUES (?, ?, ?, ?)`,
      args: [
        perm.agent_id as string, perm.domain as string,
        perm.can_read as number, perm.can_write as number,
      ],
    });
    migrated++;
  }

  // --- Engrams Meta ---
  const metaResult = await localClient.execute({
    sql: `SELECT * FROM engrams_meta`,
    args: [],
  });
  for (const meta of metaResult.rows) {
    await cloudClient.execute({
      sql: `INSERT OR REPLACE INTO engrams_meta (key, value) VALUES (?, ?)`,
      args: [meta.key as string, meta.value as string],
    });
    migrated++;
  }

  onProgress?.(`Migration complete: ${migrated} records migrated to cloud.`);
  return { migrated };
}

/**
 * Migrate all data from a cloud (Turso) database to a local database.
 * Decrypts content, detail, and structured_data fields.
 * Embeddings are copied as-is.
 * Idempotent via INSERT OR REPLACE.
 */
export async function migrateToLocal(
  cloudClient: Client,
  localClient: Client,
  encryptionKey: Buffer,
  onProgress?: (msg: string) => void,
): Promise<{ migrated: number }> {
  let migrated = 0;

  // Initialize schema on destination
  await initSchema(localClient);

  // --- Memories ---
  const memoriesResult = await cloudClient.execute({
    sql: `SELECT * FROM memories`,
    args: [],
  });
  const memories = memoriesResult.rows;
  onProgress?.(`Migrating ${memories.length} memories...`);

  for (let i = 0; i < memories.length; i += BATCH_SIZE) {
    const batch = memories.slice(i, i + BATCH_SIZE);
    for (const mem of batch) {
      const decContent = decrypt(mem.content as string, encryptionKey);
      const decDetail = mem.detail ? decrypt(mem.detail as string, encryptionKey) : null;
      const decStructured = mem.structured_data ? decrypt(mem.structured_data as string, encryptionKey) : null;

      await localClient.execute({
        sql: `INSERT OR REPLACE INTO memories
          (id, content, detail, domain, source_agent_id, source_agent_name,
           cross_agent_id, cross_agent_name, source_type, source_description,
           confidence, confirmed_count, corrected_count, mistake_count, used_count,
           learned_at, confirmed_at, last_used_at, deleted_at,
           has_pii_flag, entity_type, entity_name, structured_data, summary,
           permanence, expires_at, archived_at, embedding, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        args: [
          mem.id as string, decContent, decDetail,
          mem.domain as string, mem.source_agent_id as string, mem.source_agent_name as string,
          (mem.cross_agent_id as string | null) ?? null, (mem.cross_agent_name as string | null) ?? null,
          mem.source_type as string, (mem.source_description as string | null) ?? null,
          mem.confidence as number,
          mem.confirmed_count as number, mem.corrected_count as number,
          mem.mistake_count as number, mem.used_count as number,
          (mem.learned_at as string | null) ?? null, (mem.confirmed_at as string | null) ?? null,
          (mem.last_used_at as string | null) ?? null, (mem.deleted_at as string | null) ?? null,
          (mem.has_pii_flag as number) ?? 0, (mem.entity_type as string | null) ?? null,
          (mem.entity_name as string | null) ?? null, decStructured,
          (mem.summary as string | null) ?? null,
          (mem.permanence as string | null) ?? null,
          (mem.expires_at as string | null) ?? null,
          (mem.archived_at as string | null) ?? null,
          mem.embedding ?? null,
          (mem.updated_at as string | null) ?? null,
        ],
      });
      migrated++;
    }
    onProgress?.(`Migrated ${Math.min(i + BATCH_SIZE, memories.length)}/${memories.length} memories...`);
  }

  // --- Memory Connections ---
  const connectionsResult = await cloudClient.execute({
    sql: `SELECT * FROM memory_connections`,
    args: [],
  });
  for (const conn of connectionsResult.rows) {
    await localClient.execute({
      sql: `INSERT OR REPLACE INTO memory_connections
        (source_memory_id, target_memory_id, relationship, updated_at)
        VALUES (?, ?, ?, ?)`,
      args: [
        conn.source_memory_id as string, conn.target_memory_id as string,
        conn.relationship as string, (conn.updated_at as string | null) ?? null,
      ],
    });
    migrated++;
  }

  // --- Memory Events ---
  const eventsResult = await cloudClient.execute({
    sql: `SELECT * FROM memory_events`,
    args: [],
  });
  for (const evt of eventsResult.rows) {
    await localClient.execute({
      sql: `INSERT OR REPLACE INTO memory_events
        (id, memory_id, event_type, agent_id, agent_name, old_value, new_value, timestamp)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      args: [
        evt.id as string, evt.memory_id as string, evt.event_type as string,
        (evt.agent_id as string | null) ?? null, (evt.agent_name as string | null) ?? null,
        (evt.old_value as string | null) ?? null, (evt.new_value as string | null) ?? null,
        evt.timestamp as string,
      ],
    });
    migrated++;
  }

  // --- Agent Permissions ---
  const permsResult = await cloudClient.execute({
    sql: `SELECT * FROM agent_permissions`,
    args: [],
  });
  for (const perm of permsResult.rows) {
    await localClient.execute({
      sql: `INSERT OR REPLACE INTO agent_permissions
        (agent_id, domain, can_read, can_write)
        VALUES (?, ?, ?, ?)`,
      args: [
        perm.agent_id as string, perm.domain as string,
        perm.can_read as number, perm.can_write as number,
      ],
    });
    migrated++;
  }

  // --- Engrams Meta ---
  const metaResult = await cloudClient.execute({
    sql: `SELECT * FROM engrams_meta`,
    args: [],
  });
  for (const meta of metaResult.rows) {
    await localClient.execute({
      sql: `INSERT OR REPLACE INTO engrams_meta (key, value) VALUES (?, ?)`,
      args: [meta.key as string, meta.value as string],
    });
    migrated++;
  }

  onProgress?.(`Migration complete: ${migrated} records migrated to local.`);
  return { migrated };
}

/**
 * Initialize the full Engrams schema on a destination database.
 * Idempotent — safe to call multiple times.
 */
async function initSchema(client: Client): Promise<void> {
  await client.executeMultiple(`
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
      has_pii_flag INTEGER NOT NULL DEFAULT 0,
      entity_type TEXT,
      entity_name TEXT,
      structured_data TEXT,
      summary TEXT,
      permanence TEXT,
      expires_at TEXT,
      archived_at TEXT,
      embedding F32_BLOB(384),
      updated_at TEXT
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
      source_memory_id TEXT NOT NULL,
      target_memory_id TEXT NOT NULL,
      relationship TEXT NOT NULL,
      updated_at TEXT
    );

    CREATE TABLE IF NOT EXISTS memory_events (
      id TEXT PRIMARY KEY,
      memory_id TEXT NOT NULL,
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
  `);

  // FTS5
  await client.executeMultiple(`
    CREATE VIRTUAL TABLE IF NOT EXISTS memory_fts USING fts5(
      content,
      detail,
      source_agent_name,
      entity_name,
      content='memories',
      content_rowid='rowid',
      tokenize='porter unicode61'
    );
  `);

  // Vector index
  try {
    await client.execute({
      sql: `CREATE INDEX IF NOT EXISTS memories_vec_idx ON memories (libsql_vector_idx(embedding))`,
      args: [],
    });
  } catch {
    // Vector index may not be supported or may already exist
  }
}

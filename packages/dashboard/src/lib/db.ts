// db.ts — unified database layer using @libsql/client for both local and hosted modes

import { createClient, type Client } from "@libsql/client";
import { resolve } from "path";
import { homedir } from "os";
import { randomBytes } from "crypto";

// --- Types ---

export interface MemoryRow {
  id: string;
  content: string;
  detail: string | null;
  domain: string;
  source_agent_id: string;
  source_agent_name: string;
  cross_agent_id: string | null;
  cross_agent_name: string | null;
  source_type: string;
  source_description: string | null;
  confidence: number;
  confirmed_count: number;
  corrected_count: number;
  mistake_count: number;
  used_count: number;
  learned_at: string | null;
  confirmed_at: string | null;
  last_used_at: string | null;
  deleted_at: string | null;
  has_pii_flag: number;
  entity_type: string | null;
  entity_name: string | null;
  structured_data: string | null;
  permanence: string | null;
  expires_at: string | null;
  archived_at: string | null;
}

export interface EventRow {
  id: string;
  memory_id: string;
  event_type: string;
  agent_id: string | null;
  agent_name: string | null;
  old_value: string | null;
  new_value: string | null;
  timestamp: string;
}

export interface ConnectionRow {
  source_memory_id: string;
  target_memory_id: string;
  relationship: string;
}

export interface PermissionRow {
  agent_id: string;
  domain: string;
  can_read: number;
  can_write: number;
}

export interface GraphNode {
  id: string;
  content: string;
  entity_type: string | null;
  entity_name: string | null;
  domain: string;
  confidence: number;
  connectionCount: number;
}

export interface GraphEdge {
  source: string;
  target: string;
  relationship: string;
}

export interface EntityNode {
  entityName: string;
  entityType: string;
  memoryCount: number;
  avgConfidence: number;
  memoryIds: string[];
}

export interface EntityEdge {
  sourceEntity: string;
  targetEntity: string;
  connectionCount: number;
  relationships: string[];
}

// --- Client ---

let _client: Client | null = null;
let _initPromise: Promise<void> | null = null;

async function getClient(): Promise<Client> {
  if (!_client) {
    if (process.env.TURSO_DATABASE_URL) {
      _client = createClient({
        url: process.env.TURSO_DATABASE_URL,
        authToken: process.env.TURSO_AUTH_TOKEN,
      });
    } else {
      _client = createClient({
        url: "file:" + resolve(homedir(), ".engrams", "engrams.db"),
      });
    }
  }
  if (!_initPromise) {
    _initPromise = ensureSchema(_client);
  }
  await _initPromise;
  return _client;
}

async function ensureSchema(client: Client): Promise<void> {
  try {
    // Ensure core tables exist
    await client.executeMultiple(`
      CREATE TABLE IF NOT EXISTS memories (
        id TEXT PRIMARY KEY, content TEXT NOT NULL, detail TEXT,
        domain TEXT NOT NULL DEFAULT 'general',
        source_agent_id TEXT NOT NULL, source_agent_name TEXT NOT NULL,
        cross_agent_id TEXT, cross_agent_name TEXT,
        source_type TEXT NOT NULL, source_description TEXT,
        confidence REAL NOT NULL DEFAULT 0.7,
        confirmed_count INTEGER NOT NULL DEFAULT 0, corrected_count INTEGER NOT NULL DEFAULT 0,
        mistake_count INTEGER NOT NULL DEFAULT 0, used_count INTEGER NOT NULL DEFAULT 0,
        learned_at TEXT, confirmed_at TEXT, last_used_at TEXT, deleted_at TEXT
      );
      CREATE TABLE IF NOT EXISTS memory_connections (
        source_memory_id TEXT NOT NULL, target_memory_id TEXT NOT NULL, relationship TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS memory_events (
        id TEXT PRIMARY KEY, memory_id TEXT NOT NULL, event_type TEXT NOT NULL,
        agent_id TEXT, agent_name TEXT, old_value TEXT, new_value TEXT, timestamp TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS agent_permissions (
        agent_id TEXT NOT NULL, domain TEXT NOT NULL,
        can_read INTEGER NOT NULL DEFAULT 1, can_write INTEGER NOT NULL DEFAULT 1
      );
      CREATE TABLE IF NOT EXISTS user_settings (
        user_id TEXT PRIMARY KEY, tier TEXT NOT NULL DEFAULT 'free',
        byok_provider TEXT, byok_api_key_enc TEXT, byok_base_url TEXT,
        byok_extraction_model TEXT, byok_analysis_model TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE TABLE IF NOT EXISTS api_tokens (
        id TEXT PRIMARY KEY, user_id TEXT NOT NULL,
        token_hash TEXT NOT NULL UNIQUE, token_prefix TEXT NOT NULL,
        name TEXT NOT NULL, scopes TEXT NOT NULL DEFAULT 'read,write',
        expires_at TEXT, last_used_at TEXT, last_ip TEXT, revoked_at TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE TABLE IF NOT EXISTS engrams_meta (
        key TEXT PRIMARY KEY, value TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS _migrations (name TEXT PRIMARY KEY);
    `);

    // Run essential migrations (add columns the dashboard queries depend on)
    const migrations: [string, string][] = [
      ["add_has_pii_flag", "ALTER TABLE memories ADD COLUMN has_pii_flag INTEGER NOT NULL DEFAULT 0"],
      ["add_entity_columns", "ALTER TABLE memories ADD COLUMN entity_type TEXT; ALTER TABLE memories ADD COLUMN entity_name TEXT; ALTER TABLE memories ADD COLUMN structured_data TEXT"],
      ["add_updated_at", "ALTER TABLE memories ADD COLUMN updated_at TEXT; ALTER TABLE memory_connections ADD COLUMN updated_at TEXT"],
      ["add_user_id_columns", "ALTER TABLE memories ADD COLUMN user_id TEXT; ALTER TABLE memory_connections ADD COLUMN user_id TEXT; ALTER TABLE memory_events ADD COLUMN user_id TEXT; ALTER TABLE agent_permissions ADD COLUMN user_id TEXT"],
    ];

    for (const [name, sql] of migrations) {
      const exists = await client.execute({ sql: `SELECT 1 FROM _migrations WHERE name = ?`, args: [name] });
      if (exists.rows.length === 0) {
        try { await client.executeMultiple(sql); } catch { /* column may already exist */ }
        await client.execute({ sql: `INSERT OR IGNORE INTO _migrations (name) VALUES (?)`, args: [name] });
      }
    }
  } catch {
    // Non-fatal on first request — tables may already exist
  }
}

const isHosted = () => !!process.env.TURSO_DATABASE_URL;

/** Strip libsql Row class methods to produce a plain object safe for client components */
function plainObj<T>(row: unknown): T {
  return JSON.parse(JSON.stringify(row)) as T;
}

// --- Decryption helpers ---

// Cache for decrypt function
let _decryptFn: ((text: string, key: Buffer) => string) | null = null;
let _encryptionKey: Buffer | null = null;

async function getDecrypt(): Promise<{ fn: (text: string, key: Buffer) => string; key: Buffer } | null> {
  if (!isHosted() || !process.env.ENGRAMS_ENCRYPTION_KEY) return null;
  if (!_decryptFn) {
    const { decrypt } = await import("@engrams/core/crypto");
    _decryptFn = decrypt;
  }
  if (!_encryptionKey) {
    _encryptionKey = Buffer.from(process.env.ENGRAMS_ENCRYPTION_KEY, "base64");
  }
  return { fn: _decryptFn, key: _encryptionKey };
}

async function maybeDecrypt(text: string): Promise<string> {
  const d = await getDecrypt();
  if (!d) return text;
  try {
    return d.fn(text, d.key);
  } catch {
    return text; // Not encrypted — return as-is
  }
}

async function decryptRow<T extends { content: string; detail: string | null; structured_data?: string | null }>(row: T): Promise<T> {
  // Always produce a plain object (strips libsql Row class methods for RSC serialization)
  const plain = plainObj<T>(row);
  const d = await getDecrypt();
  if (!d) return plain;

  const tryDecrypt = (text: string): string => {
    try {
      return d.fn(text, d.key);
    } catch {
      return text; // Not encrypted — return as-is
    }
  };

  return {
    ...plain,
    content: tryDecrypt(plain.content),
    detail: plain.detail ? tryDecrypt(plain.detail) : null,
    ...(plain.structured_data !== undefined
      ? { structured_data: plain.structured_data ? tryDecrypt(plain.structured_data) : null }
      : {}),
  };
}

// --- Helpers ---

function generateId(): string {
  return randomBytes(16).toString("hex");
}

function now(): string {
  return new Date().toISOString();
}

function userFilter(userId?: string | null): { clause: string; args: string[] } {
  if (!userId) return { clause: "", args: [] };
  return { clause: " AND user_id = ?", args: [userId] };
}

// --- Read functions ---

export async function getMemories(opts?: {
  domain?: string;
  sortBy?: "confidence" | "recency" | "used" | "learned";
  search?: string;
  sourceType?: string;
  entityType?: string;
  permanence?: string;
  minConfidence?: number;
  maxConfidence?: number;
  unused?: boolean;
  needsReview?: boolean;
}, userId?: string | null): Promise<MemoryRow[]> {
  const client = await getClient();
  const uf = userFilter(userId);

  if (opts?.search) {
    // Try FTS first, fall back to LIKE
    try {
      const ftsResult = await client.execute({
        sql: `SELECT rowid FROM memory_fts WHERE memory_fts MATCH ? ORDER BY rank LIMIT 100`,
        args: [opts.search],
      });
      if (ftsResult.rows.length > 0) {
        const rowids = ftsResult.rows.map(r => r.rowid as number);
        const placeholders = rowids.map(() => "?").join(",");
        let sql = `SELECT * FROM memories WHERE rowid IN (${placeholders}) AND deleted_at IS NULL${uf.clause}`;
        const args: (string | number | null)[] = [...rowids, ...uf.args];
        sql = applyFilters(sql, args, opts);
        sql = applySort(sql, opts?.sortBy);
        const result = await client.execute({ sql, args });
        return Promise.all(result.rows.map(r => decryptRow(r as unknown as MemoryRow)));
      }
    } catch {
      // FTS not available (e.g., hosted mode) — fall back to LIKE
    }

    let sql = `SELECT * FROM memories WHERE deleted_at IS NULL AND content LIKE ?${uf.clause}`;
    const args: (string | number | null)[] = [`%${opts.search}%`, ...uf.args];
    sql = applyFilters(sql, args, opts);
    sql = applySort(sql, opts?.sortBy);
    const result = await client.execute({ sql, args });
    return Promise.all(result.rows.map(r => decryptRow(r as unknown as MemoryRow)));
  }

  let sql = `SELECT * FROM memories WHERE deleted_at IS NULL${uf.clause}`;
  const args: (string | number | null)[] = [...uf.args];
  sql = applyFilters(sql, args, opts);
  sql = applySort(sql, opts?.sortBy);
  const result = await client.execute({ sql, args });
  return Promise.all(result.rows.map(r => decryptRow(r as unknown as MemoryRow)));
}

function applyFilters(sql: string, args: (string | number | null)[], opts?: {
  domain?: string;
  sourceType?: string;
  entityType?: string;
  permanence?: string;
  minConfidence?: number;
  maxConfidence?: number;
  unused?: boolean;
  needsReview?: boolean;
}): string {
  if (opts?.domain) {
    sql += ` AND domain = ?`;
    args.push(opts.domain);
  }
  if (opts?.sourceType) {
    sql += ` AND source_type = ?`;
    args.push(opts.sourceType);
  }
  if (opts?.minConfidence !== undefined) {
    sql += ` AND confidence >= ?`;
    args.push(opts.minConfidence);
  }
  if (opts?.maxConfidence !== undefined) {
    sql += ` AND confidence <= ?`;
    args.push(opts.maxConfidence);
  }
  if (opts?.unused) {
    sql += ` AND used_count = 0`;
  }
  if (opts?.entityType) {
    sql += ` AND entity_type = ?`;
    args.push(opts.entityType);
  }
  if (opts?.permanence) {
    sql += ` AND permanence = ?`;
    args.push(opts.permanence);
  }
  if (opts?.needsReview) {
    sql += ` AND confirmed_count = 0 AND source_type = 'inferred'`;
  }
  return sql;
}

function applySort(sql: string, sortBy?: string): string {
  switch (sortBy) {
    case "recency": return sql + ` ORDER BY learned_at DESC`;
    case "used": return sql + ` ORDER BY used_count DESC, confidence DESC`;
    case "learned": return sql + ` ORDER BY learned_at ASC`;
    default: return sql + ` ORDER BY confidence DESC`;
  }
}

export async function getMemoryById(id: string, userId?: string | null): Promise<MemoryRow | undefined> {
  const client = await getClient();
  const uf = userFilter(userId);
  const result = await client.execute({
    sql: `SELECT * FROM memories WHERE id = ? AND deleted_at IS NULL${uf.clause}`,
    args: [id, ...uf.args],
  });
  if (result.rows.length === 0) return undefined;
  return await decryptRow(result.rows[0] as unknown as MemoryRow);
}

export async function getMemoryEvents(memoryId: string, userId?: string | null): Promise<EventRow[]> {
  const client = await getClient();
  const uf = userFilter(userId);
  const result = await client.execute({
    sql: `SELECT me.* FROM memory_events me JOIN memories m ON m.id = me.memory_id WHERE me.memory_id = ? AND m.deleted_at IS NULL${uf.clause.replace("user_id", "m.user_id")} ORDER BY me.timestamp DESC`,
    args: [memoryId, ...uf.args],
  });
  return result.rows.map(r => plainObj<EventRow>(r));
}

export async function getMemoryConnections(memoryId: string, userId?: string | null): Promise<{
  outgoing: (ConnectionRow & { content: string })[];
  incoming: (ConnectionRow & { content: string })[];
}> {
  const client = await getClient();
  const uf = userFilter(userId);
  const muf = { clause: uf.clause.replace("user_id", "m.user_id"), args: uf.args };
  const outgoing = await client.execute({
    sql: `SELECT mc.*, m.content FROM memory_connections mc
          JOIN memories m ON m.id = mc.target_memory_id
          WHERE mc.source_memory_id = ? AND m.deleted_at IS NULL${muf.clause}`,
    args: [memoryId, ...muf.args],
  });
  const incoming = await client.execute({
    sql: `SELECT mc.*, m.content FROM memory_connections mc
          JOIN memories m ON m.id = mc.source_memory_id
          WHERE mc.target_memory_id = ? AND m.deleted_at IS NULL${muf.clause}`,
    args: [memoryId, ...muf.args],
  });

  const decryptContent = async (r: unknown) => {
    const row = plainObj<ConnectionRow & { content: string }>(r);
    return { ...row, content: await maybeDecrypt(row.content) };
  };

  return {
    outgoing: await Promise.all(outgoing.rows.map(decryptContent)),
    incoming: await Promise.all(incoming.rows.map(decryptContent)),
  };
}

export async function getDomains(userId?: string | null): Promise<{ domain: string; count: number }[]> {
  const client = await getClient();
  const uf = userFilter(userId);
  const result = await client.execute({
    sql: `SELECT domain, COUNT(*) as count FROM memories WHERE deleted_at IS NULL${uf.clause} GROUP BY domain ORDER BY count DESC`,
    args: [...uf.args],
  });
  return result.rows.map(r => plainObj<{ domain: string; count: number }>(r));
}

export async function getAgentPermissions(userId?: string | null): Promise<PermissionRow[]> {
  const client = await getClient();
  const uf = userFilter(userId);
  const result = await client.execute({
    sql: `SELECT * FROM agent_permissions WHERE 1=1${uf.clause} ORDER BY agent_id, domain`,
    args: [...uf.args],
  });
  return result.rows.map(r => plainObj<PermissionRow>(r));
}

export async function getAgents(userId?: string | null): Promise<{ agent_id: string; agent_name: string }[]> {
  const client = await getClient();
  const uf = userFilter(userId);
  const result = await client.execute({
    sql: `SELECT DISTINCT source_agent_id as agent_id, source_agent_name as agent_name
     FROM memories WHERE deleted_at IS NULL${uf.clause} ORDER BY agent_name`,
    args: [...uf.args],
  });
  return result.rows.map(r => plainObj<{ agent_id: string; agent_name: string }>(r));
}

export async function getDbStats(userId?: string | null): Promise<{
  totalMemories: number;
  totalDomains: number;
  dbSizeBytes: number;
}> {
  const client = await getClient();
  const uf = userFilter(userId);
  const memResult = await client.execute({ sql: `SELECT COUNT(*) as c FROM memories WHERE deleted_at IS NULL${uf.clause}`, args: [...uf.args] });
  const domResult = await client.execute({ sql: `SELECT COUNT(DISTINCT domain) as c FROM memories WHERE deleted_at IS NULL${uf.clause}`, args: [...uf.args] });

  let dbSizeBytes = 0;
  if (!isHosted()) {
    try {
      const { statSync } = require("fs");
      const { size } = statSync(resolve(homedir(), ".engrams", "engrams.db"));
      dbSizeBytes = size;
    } catch { /* ignore */ }
  }

  return {
    totalMemories: memResult.rows[0].c as number,
    totalDomains: domResult.rows[0].c as number,
    dbSizeBytes,
  };
}

export async function getSourceTypes(userId?: string | null): Promise<string[]> {
  const client = await getClient();
  const uf = userFilter(userId);
  const result = await client.execute({ sql: `SELECT DISTINCT source_type FROM memories WHERE deleted_at IS NULL${uf.clause} ORDER BY source_type`, args: [...uf.args] });
  return result.rows.map(r => r.source_type as string);
}

export async function getEntityTypes(userId?: string | null): Promise<string[]> {
  const client = await getClient();
  const uf = userFilter(userId);
  try {
    const result = await client.execute({ sql: `SELECT DISTINCT entity_type FROM memories WHERE entity_type IS NOT NULL AND deleted_at IS NULL${uf.clause} ORDER BY entity_type`, args: [...uf.args] });
    return result.rows.map(r => r.entity_type as string);
  } catch {
    return [];
  }
}

export async function getGraphData(userId?: string | null): Promise<{ nodes: GraphNode[]; edges: GraphEdge[] }> {
  const client = await getClient();
  const uf = userFilter(userId);
  const muf = { clause: uf.clause.replace("user_id", "m.user_id"), args: uf.args };

  const nodesResult = await client.execute({
    sql: `
    SELECT m.id, m.content, m.entity_type, m.entity_name, m.domain, m.confidence,
      (SELECT COUNT(*) FROM memory_connections mc
       WHERE mc.source_memory_id = m.id OR mc.target_memory_id = m.id) as connectionCount
    FROM memories m
    WHERE m.deleted_at IS NULL${muf.clause} AND m.id IN (
      SELECT source_memory_id FROM memory_connections
      UNION
      SELECT target_memory_id FROM memory_connections
    )
    ORDER BY connectionCount DESC
    LIMIT 200
  `,
    args: [...muf.args],
  });

  const nodes = await Promise.all(nodesResult.rows.map(async r => {
    const row = plainObj<GraphNode & { content: string }>(r);
    return { ...row, content: await maybeDecrypt(row.content) };
  }));

  // If no connected nodes, show top memories by confidence
  if (nodes.length === 0) {
    const fallback = await client.execute({
      sql: `
      SELECT m.id, m.content, m.entity_type, m.entity_name, m.domain, m.confidence, 0 as connectionCount
      FROM memories m WHERE m.deleted_at IS NULL${muf.clause}
      ORDER BY m.confidence DESC LIMIT 50
    `,
      args: [...muf.args],
    });
    const fallbackNodes = await Promise.all(fallback.rows.map(async r => {
      const row = plainObj<GraphNode & { content: string }>(r);
      return { ...row, content: await maybeDecrypt(row.content) };
    }));
    return { nodes: fallbackNodes, edges: [] };
  }

  const m1uf = { clause: uf.clause.replace("user_id", "m1.user_id"), args: uf.args };
  const m2uf = { clause: uf.clause.replace("user_id", "m2.user_id"), args: uf.args };
  const edgesResult = await client.execute({
    sql: `
    SELECT mc.source_memory_id as source, mc.target_memory_id as target, mc.relationship
    FROM memory_connections mc
    JOIN memories m1 ON m1.id = mc.source_memory_id AND m1.deleted_at IS NULL${m1uf.clause}
    JOIN memories m2 ON m2.id = mc.target_memory_id AND m2.deleted_at IS NULL${m2uf.clause}
  `,
    args: [...m1uf.args, ...m2uf.args],
  });

  return { nodes, edges: edgesResult.rows.map(r => plainObj<GraphEdge>(r)) };
}

export async function getEntityGraphData(userId?: string | null): Promise<{
  entities: EntityNode[];
  edges: EntityEdge[];
  uncategorized: GraphNode[];
}> {
  const client = await getClient();
  const uf = userFilter(userId);

  const rawEntities = await client.execute({
    sql: `
    SELECT entity_name as entityName, entity_type as entityType,
           COUNT(*) as memoryCount, AVG(confidence) as avgConfidence,
           GROUP_CONCAT(id) as memoryIdsCsv
    FROM memories
    WHERE deleted_at IS NULL AND entity_name IS NOT NULL${uf.clause}
    GROUP BY entity_name, entity_type
    ORDER BY memoryCount DESC
  `,
    args: [...uf.args],
  });

  const entities = rawEntities.rows.map(e => ({
    entityName: e.entityName as string,
    entityType: e.entityType as string,
    memoryCount: e.memoryCount as number,
    avgConfidence: e.avgConfidence as number,
    memoryIds: (e.memoryIdsCsv as string).split(","),
  }));

  const m1uf = { clause: uf.clause.replace("user_id", "m1.user_id"), args: uf.args };
  const m2uf = { clause: uf.clause.replace("user_id", "m2.user_id"), args: uf.args };
  const rawEdges = await client.execute({
    sql: `
    SELECT
      m1.entity_name as sourceEntity,
      m2.entity_name as targetEntity,
      COUNT(*) as connectionCount,
      GROUP_CONCAT(DISTINCT mc.relationship) as relationshipsCsv
    FROM memory_connections mc
    JOIN memories m1 ON m1.id = mc.source_memory_id AND m1.deleted_at IS NULL${m1uf.clause}
    JOIN memories m2 ON m2.id = mc.target_memory_id AND m2.deleted_at IS NULL${m2uf.clause}
    WHERE m1.entity_name IS NOT NULL AND m2.entity_name IS NOT NULL
      AND m1.entity_name != m2.entity_name
    GROUP BY m1.entity_name, m2.entity_name
  `,
    args: [...m1uf.args, ...m2uf.args],
  });

  const edges = rawEdges.rows.map(e => ({
    sourceEntity: e.sourceEntity as string,
    targetEntity: e.targetEntity as string,
    connectionCount: e.connectionCount as number,
    relationships: (e.relationshipsCsv as string).split(","),
  }));

  const uncatResult = await client.execute({
    sql: `
    SELECT id, content, entity_type, entity_name, domain, confidence, 0 as connectionCount
    FROM memories WHERE deleted_at IS NULL AND entity_name IS NULL${uf.clause}
    ORDER BY confidence DESC LIMIT 30
  `,
    args: [...uf.args],
  });

  const uncategorized = await Promise.all(uncatResult.rows.map(async r => {
    const row = plainObj<GraphNode & { content: string }>(r);
    return { ...row, content: await maybeDecrypt(row.content) };
  }));

  return { entities, edges, uncategorized };
}

export async function getTotalMemoryCount(userId?: string | null): Promise<number> {
  const client = await getClient();
  const uf = userFilter(userId);
  const result = await client.execute({
    sql: `SELECT COUNT(*) as count FROM memories WHERE deleted_at IS NULL${uf.clause}`,
    args: [...uf.args],
  });
  return result.rows[0].count as number;
}

export async function getUnreviewedCount(userId?: string | null): Promise<number> {
  const client = await getClient();
  const uf = userFilter(userId);
  const result = await client.execute({
    sql: `SELECT COUNT(*) as count FROM memories WHERE confirmed_count = 0 AND source_type = 'inferred' AND deleted_at IS NULL${uf.clause}`,
    args: [...uf.args],
  });
  return result.rows[0].count as number;
}

export async function getAllMemoriesForExport(userId?: string | null): Promise<MemoryRow[]> {
  const client = await getClient();
  const uf = userFilter(userId);
  const result = await client.execute({
    sql: `SELECT * FROM memories WHERE deleted_at IS NULL${uf.clause} ORDER BY domain, confidence DESC`,
    args: [...uf.args],
  });
  return Promise.all(result.rows.map(r => decryptRow(r as unknown as MemoryRow)));
}

export async function getAllConnectionsForExport(userId?: string | null): Promise<ConnectionRow[]> {
  const client = await getClient();
  const uf = userFilter(userId);
  const mcuf = { clause: uf.clause.replace("user_id", "mc.user_id"), args: uf.args };
  const result = await client.execute({
    sql: `SELECT mc.source_memory_id, mc.target_memory_id, mc.relationship
          FROM memory_connections mc
          JOIN memories m1 ON m1.id = mc.source_memory_id AND m1.deleted_at IS NULL
          JOIN memories m2 ON m2.id = mc.target_memory_id AND m2.deleted_at IS NULL${mcuf.clause}`,
    args: [...mcuf.args],
  });
  return result.rows as unknown as ConnectionRow[];
}

export async function importMemories(
  data: { memories: Record<string, unknown>[]; connections?: Record<string, unknown>[] },
  userId?: string | null,
): Promise<{ imported: number; skipped: number; connections: number }> {
  const client = await getClient();
  let imported = 0;
  let skipped = 0;
  let connectionsImported = 0;

  const memories = data.memories ?? [];
  if (memories.length === 0) return { imported: 0, skipped: 0, connections: 0 };

  // Disable FK checks for bulk import
  await client.execute({ sql: "PRAGMA foreign_keys = OFF", args: [] });

  try {
    // Check existing IDs
    const incomingIds = memories.map((m) => m.id as string).filter(Boolean);
    const existingIds = new Set<string>();
    for (let i = 0; i < incomingIds.length; i += 50) {
      const batch = incomingIds.slice(i, i + 50);
      const placeholders = batch.map(() => "?").join(", ");
      const result = await client.execute({
        sql: `SELECT id FROM memories WHERE id IN (${placeholders})`,
        args: batch,
      });
      for (const row of result.rows) existingIds.add(row.id as string);
    }

    // Insert memories
    for (const mem of memories) {
      const id = mem.id as string;
      if (!id || existingIds.has(id)) { skipped++; continue; }

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
          (mem.source_agent_name as string) ?? "dashboard_import",
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
          userId ?? (mem.user_id as string | null) ?? null,
          (mem.updated_at as string | null) ?? null,
        ],
      });
      imported++;
    }

    // Import connections where both endpoints exist
    const connections = data.connections ?? [];
    if (connections.length > 0) {
      const refIds = new Set<string>();
      for (const c of connections) {
        refIds.add(c.source_memory_id as string);
        refIds.add(c.target_memory_id as string);
      }
      const validIds = new Set<string>();
      const refArray = [...refIds];
      for (let i = 0; i < refArray.length; i += 50) {
        const batch = refArray.slice(i, i + 50);
        const placeholders = batch.map(() => "?").join(", ");
        const result = await client.execute({
          sql: `SELECT id FROM memories WHERE id IN (${placeholders})`,
          args: batch,
        });
        for (const row of result.rows) validIds.add(row.id as string);
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
            userId ?? (conn.user_id as string | null) ?? null,
            (conn.updated_at as string | null) ?? null,
          ],
        });
        connectionsImported++;
      }
    }
  } finally {
    await client.execute({ sql: "PRAGMA foreign_keys = ON", args: [] });
  }

  return { imported, skipped, connections: connectionsImported };
}

// --- Write operations ---

export async function deleteMemoryById(id: string, userId?: string | null): Promise<boolean> {
  const client = await getClient();
  const uf = userFilter(userId);
  const timestamp = now();
  const result = await client.execute({
    sql: `UPDATE memories SET deleted_at = ? WHERE id = ? AND deleted_at IS NULL${uf.clause}`,
    args: [timestamp, id, ...uf.args],
  });
  if (result.rowsAffected > 0) {
    await client.execute({
      sql: `INSERT INTO memory_events (id, memory_id, event_type, agent_name, new_value, timestamp) VALUES (?, ?, 'removed', 'dashboard', ?, ?)`,
      args: [generateId(), id, JSON.stringify({ reason: "deleted via dashboard" }), timestamp],
    });
  }
  return result.rowsAffected > 0;
}

export async function confirmMemoryById(id: string, userId?: string | null): Promise<{ newConfidence: number } | null> {
  const client = await getClient();
  const uf = userFilter(userId);
  const existing = await client.execute({
    sql: `SELECT confidence, confirmed_count FROM memories WHERE id = ? AND deleted_at IS NULL${uf.clause}`,
    args: [id, ...uf.args],
  });
  if (existing.rows.length === 0) return null;

  const row = existing.rows[0];
  const newConfidence = 0.99;
  const timestamp = now();
  await client.execute({
    sql: `UPDATE memories SET confidence = ?, confirmed_count = ?, confirmed_at = ? WHERE id = ?${uf.clause}`,
    args: [newConfidence, (row.confirmed_count as number) + 1, timestamp, id, ...uf.args],
  });
  await client.execute({
    sql: `INSERT INTO memory_events (id, memory_id, event_type, agent_name, old_value, new_value, timestamp) VALUES (?, ?, 'confirmed', 'dashboard', ?, ?, ?)`,
    args: [generateId(), id, JSON.stringify({ confidence: row.confidence }), JSON.stringify({ confidence: newConfidence }), timestamp],
  });
  return { newConfidence };
}

export async function flagMemoryById(id: string, userId?: string | null): Promise<{ newConfidence: number } | null> {
  const client = await getClient();
  const uf = userFilter(userId);
  const existing = await client.execute({
    sql: `SELECT confidence, mistake_count FROM memories WHERE id = ? AND deleted_at IS NULL${uf.clause}`,
    args: [id, ...uf.args],
  });
  if (existing.rows.length === 0) return null;

  const row = existing.rows[0];
  const newConfidence = Math.max((row.confidence as number) - 0.15, 0.10);
  const timestamp = now();
  await client.execute({
    sql: `UPDATE memories SET confidence = ?, mistake_count = ? WHERE id = ?${uf.clause}`,
    args: [newConfidence, (row.mistake_count as number) + 1, id, ...uf.args],
  });
  await client.execute({
    sql: `INSERT INTO memory_events (id, memory_id, event_type, agent_name, old_value, new_value, timestamp) VALUES (?, ?, 'confidence_changed', 'dashboard', ?, ?, ?)`,
    args: [generateId(), id, JSON.stringify({ confidence: row.confidence }), JSON.stringify({ confidence: newConfidence, flaggedAsMistake: true }), timestamp],
  });
  return { newConfidence };
}

export async function correctMemoryById(id: string, content: string, detail?: string | null, userId?: string | null): Promise<{ newConfidence: number } | null> {
  const client = await getClient();
  const uf = userFilter(userId);
  const existing = await client.execute({
    sql: `SELECT content, detail, confidence, corrected_count FROM memories WHERE id = ? AND deleted_at IS NULL${uf.clause}`,
    args: [id, ...uf.args],
  });
  if (existing.rows.length === 0) return null;

  const row = existing.rows[0];
  const newConfidence = Math.min(Math.max(row.confidence as number, 0.85), 0.99);
  const timestamp = now();
  const newDetail = detail !== undefined ? detail : row.detail;
  await client.execute({
    sql: `UPDATE memories SET content = ?, detail = ?, confidence = ?, corrected_count = ? WHERE id = ?${uf.clause}`,
    args: [content, newDetail as string | null, newConfidence, (row.corrected_count as number) + 1, id, ...uf.args],
  });
  await client.execute({
    sql: `INSERT INTO memory_events (id, memory_id, event_type, agent_name, old_value, new_value, timestamp) VALUES (?, ?, 'corrected', 'dashboard', ?, ?, ?)`,
    args: [generateId(), id, JSON.stringify({ content: row.content, detail: row.detail }), JSON.stringify({ content, detail: newDetail, confidence: newConfidence }), timestamp],
  });
  return { newConfidence };
}

export async function scrubMemoryById(id: string, redactedContent: string, redactedDetail: string | null, redactFn: (text: string) => { redacted: string }, userId?: string | null): Promise<boolean> {
  const client = await getClient();
  const uf = userFilter(userId);
  const existing = await client.execute({
    sql: `SELECT content, detail FROM memories WHERE id = ? AND deleted_at IS NULL${uf.clause}`,
    args: [id, ...uf.args],
  });
  if (existing.rows.length === 0) return false;

  const row = existing.rows[0];
  const timestamp = now();
  await client.execute({
    sql: `UPDATE memories SET content = ?, detail = ?, has_pii_flag = 0 WHERE id = ?${uf.clause}`,
    args: [redactedContent, redactedDetail, id, ...uf.args],
  });
  await client.execute({
    sql: `INSERT INTO memory_events (id, memory_id, event_type, agent_name, old_value, new_value, timestamp) VALUES (?, ?, 'corrected', 'dashboard:scrub', ?, ?, ?)`,
    args: [generateId(), id, JSON.stringify({ content: "[REDACTED]" }), JSON.stringify({ content: redactedContent, detail: redactedDetail }), timestamp],
  });

  // Scrub PII from event history for this memory
  const events = await client.execute({
    sql: `SELECT id, old_value, new_value FROM memory_events WHERE memory_id = ?`,
    args: [id],
  });
  for (const evt of events.rows) {
    let changed = false;
    let oldVal = evt.old_value as string | null;
    let newVal = evt.new_value as string | null;
    if (oldVal) {
      const scrubbed = redactFn(oldVal).redacted;
      if (scrubbed !== oldVal) { oldVal = scrubbed; changed = true; }
    }
    if (newVal) {
      const scrubbed = redactFn(newVal).redacted;
      if (scrubbed !== newVal) { newVal = scrubbed; changed = true; }
    }
    if (changed) {
      await client.execute({
        sql: `UPDATE memory_events SET old_value = ?, new_value = ? WHERE id = ?`,
        args: [oldVal, newVal, evt.id as string],
      });
    }
  }

  return true;
}

export async function splitMemoryById(
  id: string,
  parts: { content: string; detail?: string | null }[],
  userId?: string | null,
): Promise<{ newIds: string[] } | null> {
  const client = await getClient();
  const uf = userFilter(userId);
  const existing = await client.execute({
    sql: `SELECT * FROM memories WHERE id = ? AND deleted_at IS NULL${uf.clause}`,
    args: [id, ...uf.args],
  });
  if (existing.rows.length === 0) return null;

  const row = plainObj<MemoryRow>(existing.rows[0]);
  const timestamp = now();
  const newIds: string[] = [];

  for (const part of parts) {
    const newId = generateId();
    newIds.push(newId);
    const confidence = Math.min((row.confidence || 0.7) + 0.05, 0.99);

    await client.execute({
      sql: `INSERT INTO memories (id, content, detail, domain, source_agent_id, source_agent_name, source_type, source_description, confidence, learned_at, user_id)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      args: [newId, part.content, part.detail ?? null, row.domain, row.source_agent_id, row.source_agent_name, row.source_type, row.source_description, confidence, timestamp, userId ?? null],
    });

    await client.execute({
      sql: `INSERT INTO memory_events (id, memory_id, event_type, agent_name, new_value, timestamp) VALUES (?, ?, 'created', 'dashboard', ?, ?)`,
      args: [generateId(), newId, JSON.stringify({ content: part.content, splitFrom: id }), timestamp],
    });
  }

  // Connect new memories
  for (let i = 0; i < newIds.length; i++) {
    for (let j = i + 1; j < newIds.length; j++) {
      await client.execute({
        sql: `INSERT INTO memory_connections (source_memory_id, target_memory_id, relationship, user_id) VALUES (?, ?, 'related', ?)`,
        args: [newIds[i], newIds[j], userId ?? null],
      });
    }
  }

  // Soft-delete original
  await client.execute({
    sql: `UPDATE memories SET deleted_at = ? WHERE id = ?${uf.clause}`,
    args: [timestamp, id, ...uf.args],
  });
  await client.execute({
    sql: `INSERT INTO memory_events (id, memory_id, event_type, agent_name, new_value, timestamp) VALUES (?, ?, 'removed', 'dashboard', ?, ?)`,
    args: [generateId(), id, JSON.stringify({ reason: "split", splitInto: newIds }), timestamp],
  });

  return { newIds };
}

export async function clearAllMemories(userId?: string | null): Promise<void> {
  const client = await getClient();
  const uf = userFilter(userId);
  const timestamp = now();
  await client.execute({
    sql: `UPDATE memories SET deleted_at = ? WHERE deleted_at IS NULL${uf.clause}`,
    args: [timestamp, ...uf.args],
  });
}

export interface MemoryUpdateFields {
  content?: string;
  detail?: string | null;
  domain?: string;
  entityType?: string | null;
  entityName?: string | null;
  structuredData?: string | null;
}

const fieldColumnMap: Record<keyof MemoryUpdateFields, string> = {
  content: "content",
  detail: "detail",
  domain: "domain",
  entityType: "entity_type",
  entityName: "entity_name",
  structuredData: "structured_data",
};

export async function directUpdateMemory(id: string, fields: MemoryUpdateFields, userId?: string | null): Promise<void> {
  const setClauses: string[] = [];
  const args: (string | null)[] = [];
  for (const [key, col] of Object.entries(fieldColumnMap)) {
    if (key in fields) {
      setClauses.push(`${col} = ?`);
      const val = (fields as Record<string, string | null | undefined>)[key];
      args.push(val ?? null);
    }
  }
  if (setClauses.length === 0) return;
  args.push(id);
  const client = await getClient();
  const uf = userFilter(userId);
  await client.execute({
    sql: `UPDATE memories SET ${setClauses.join(", ")} WHERE id = ? AND deleted_at IS NULL${uf.clause}`,
    args: [...args, ...uf.args],
  });
}

export async function pinMemoryById(id: string, userId?: string | null): Promise<boolean> {
  const client = await getClient();
  const uf = userFilter(userId);
  const existing = await client.execute({
    sql: `SELECT confidence, permanence FROM memories WHERE id = ? AND deleted_at IS NULL${uf.clause}`,
    args: [id, ...uf.args],
  });
  if (existing.rows.length === 0) return false;

  const row = existing.rows[0];
  const newConfidence = Math.max(row.confidence as number, 0.95);
  const timestamp = now();
  await client.execute({
    sql: `UPDATE memories SET permanence = 'canonical', confidence = ? WHERE id = ?${uf.clause}`,
    args: [newConfidence, id, ...uf.args],
  });
  await client.execute({
    sql: `INSERT INTO memory_events (id, memory_id, event_type, agent_name, old_value, new_value, timestamp) VALUES (?, ?, 'confidence_changed', 'dashboard', ?, ?, ?)`,
    args: [generateId(), id, JSON.stringify({ permanence: row.permanence, confidence: row.confidence }), JSON.stringify({ permanence: "canonical", confidence: newConfidence }), timestamp],
  });
  return true;
}

export async function archiveMemoryById(id: string, userId?: string | null): Promise<boolean> {
  const client = await getClient();
  const uf = userFilter(userId);
  const existing = await client.execute({
    sql: `SELECT permanence FROM memories WHERE id = ? AND deleted_at IS NULL${uf.clause}`,
    args: [id, ...uf.args],
  });
  if (existing.rows.length === 0) return false;

  const row = existing.rows[0];
  const timestamp = now();
  await client.execute({
    sql: `UPDATE memories SET permanence = 'archived', archived_at = ? WHERE id = ?${uf.clause}`,
    args: [timestamp, id, ...uf.args],
  });
  await client.execute({
    sql: `INSERT INTO memory_events (id, memory_id, event_type, agent_name, old_value, new_value, timestamp) VALUES (?, ?, 'confidence_changed', 'dashboard', ?, ?, ?)`,
    args: [generateId(), id, JSON.stringify({ permanence: row.permanence }), JSON.stringify({ permanence: "archived" }), timestamp],
  });
  return true;
}

export async function getArchivedMemories(opts?: {
  search?: string;
  sortBy?: "archived" | "confidence" | "learned";
}, userId?: string | null): Promise<MemoryRow[]> {
  const client = await getClient();
  const uf = userFilter(userId);

  let sql: string;
  const args: (string | number | null)[] = [...uf.args];

  if (opts?.search) {
    sql = `SELECT * FROM memories WHERE deleted_at IS NULL AND permanence = 'archived' AND content LIKE ?${uf.clause}`;
    args.splice(0, 0, `%${opts.search}%`);
  } else {
    sql = `SELECT * FROM memories WHERE deleted_at IS NULL AND permanence = 'archived'${uf.clause}`;
  }

  switch (opts?.sortBy) {
    case "confidence": sql += ` ORDER BY confidence DESC`; break;
    case "learned": sql += ` ORDER BY learned_at ASC`; break;
    default: sql += ` ORDER BY archived_at DESC`; break;
  }

  const result = await client.execute({ sql, args });
  return Promise.all(result.rows.map(r => decryptRow(r as unknown as MemoryRow)));
}

export async function bulkRestoreMemories(ids: string[], userId?: string | null): Promise<number> {
  const client = await getClient();
  const uf = userFilter(userId);
  let restored = 0;
  for (const id of ids) {
    const ok = await restoreMemoryById(id, userId);
    if (ok) restored++;
  }
  return restored;
}

export async function restoreMemoryById(id: string, userId?: string | null): Promise<boolean> {
  const client = await getClient();
  const uf = userFilter(userId);
  const existing = await client.execute({
    sql: `SELECT permanence FROM memories WHERE id = ? AND deleted_at IS NULL${uf.clause}`,
    args: [id, ...uf.args],
  });
  if (existing.rows.length === 0) return false;

  const row = existing.rows[0];
  const timestamp = now();
  await client.execute({
    sql: `UPDATE memories SET permanence = NULL, archived_at = NULL WHERE id = ?${uf.clause}`,
    args: [id, ...uf.args],
  });
  await client.execute({
    sql: `INSERT INTO memory_events (id, memory_id, event_type, agent_name, old_value, new_value, timestamp) VALUES (?, ?, 'confidence_changed', 'dashboard', ?, ?, ?)`,
    args: [generateId(), id, JSON.stringify({ permanence: row.permanence }), JSON.stringify({ permanence: null }), timestamp],
  });
  return true;
}

// --- Entity Profiles ---

export interface EntityProfileRow {
  id: string;
  entity_name: string;
  entity_type: string;
  summary: string;
  memory_ids: string;
  token_count: number;
  generated_at: string;
  user_id: string | null;
}

export async function getEntityProfile(entityName: string, userId?: string | null): Promise<EntityProfileRow | null> {
  const client = await getClient();
  const uf = userFilter(userId);
  const result = await client.execute({
    sql: `SELECT * FROM memory_summaries WHERE entity_name = ?${uf.clause} LIMIT 1`,
    args: [entityName, ...uf.args],
  });
  return result.rows[0] ? plainObj<EntityProfileRow>(result.rows[0]) : null;
}

export async function getMemoriesByEntityName(entityName: string, userId?: string | null): Promise<MemoryRow[]> {
  const client = await getClient();
  const uf = userFilter(userId);
  const result = await client.execute({
    sql: `SELECT * FROM memories WHERE entity_name = ? COLLATE NOCASE AND deleted_at IS NULL${uf.clause} ORDER BY confidence DESC, learned_at DESC`,
    args: [entityName, ...uf.args],
  });
  return result.rows.map(r => plainObj<MemoryRow>(r));
}

export async function getEntityConnections(entityName: string, userId?: string | null): Promise<{ name: string; type: string; relationship: string }[]> {
  const client = await getClient();
  const uf = userFilter(userId);
  const result = await client.execute({
    sql: `SELECT DISTINCT m2.entity_name as name, m2.entity_type as type, mc.relationship
          FROM memory_connections mc
          JOIN memories m1 ON mc.source_memory_id = m1.id
          JOIN memories m2 ON mc.target_memory_id = m2.id
          WHERE m1.entity_name = ? COLLATE NOCASE AND m1.deleted_at IS NULL AND m2.deleted_at IS NULL${uf.clause}
          UNION
          SELECT DISTINCT m1.entity_name as name, m1.entity_type as type, mc.relationship
          FROM memory_connections mc
          JOIN memories m1 ON mc.source_memory_id = m1.id
          JOIN memories m2 ON mc.target_memory_id = m2.id
          WHERE m2.entity_name = ? COLLATE NOCASE AND m1.deleted_at IS NULL AND m2.deleted_at IS NULL${uf.clause}`,
    args: [entityName, ...uf.args, entityName, ...uf.args],
  });
  return result.rows.map(r => plainObj<{ name: string; type: string; relationship: string }>(r));
}

// --- Document Index ---

export interface IndexedDocumentRow extends MemoryRow {
  parsed_data?: {
    source_system: string;
    location: string;
    last_indexed_at: string;
    mime_type?: string;
    file_size?: number;
    source_last_modified?: string;
    tags?: string[];
    parent_folder?: string;
    url?: string;
  };
}

export async function getIndexedDocuments(opts?: {
  search?: string;
  source_system?: string;
  sortBy?: "indexed" | "title" | "source_modified";
}, userId?: string | null): Promise<IndexedDocumentRow[]> {
  const client = await getClient();
  const uf = userFilter(userId);

  let sql = `SELECT * FROM memories WHERE entity_type = 'resource' AND deleted_at IS NULL AND structured_data LIKE '%"type":"document"%'${uf.clause}`;
  const args: (string | number | null)[] = [...uf.args];

  if (opts?.search) {
    sql += ` AND content LIKE ?`;
    args.push(`%${opts.search}%`);
  }

  switch (opts?.sortBy) {
    case "title": sql += ` ORDER BY entity_name ASC`; break;
    case "source_modified": sql += ` ORDER BY updated_at DESC`; break;
    default: sql += ` ORDER BY updated_at DESC`; break;
  }

  const result = await client.execute({ sql, args });
  const rows = await Promise.all(result.rows.map(r => decryptRow(plainObj<MemoryRow>(r))));

  // Parse structured_data and filter by source_system
  const docs: IndexedDocumentRow[] = [];
  for (const row of rows) {
    const doc: IndexedDocumentRow = { ...row };
    if (row.structured_data) {
      try {
        const sd = JSON.parse(row.structured_data);
        if (sd.type === "document") {
          if (opts?.source_system && sd.source_system !== opts.source_system) continue;
          doc.parsed_data = {
            source_system: sd.source_system,
            location: sd.location,
            last_indexed_at: sd.last_indexed_at,
            mime_type: sd.mime_type,
            file_size: sd.file_size,
            source_last_modified: sd.source_last_modified,
            tags: sd.tags,
            parent_folder: sd.parent_folder,
            url: sd.url,
          };
        }
      } catch { /* skip malformed */ }
    }
    docs.push(doc);
  }

  return docs;
}

export async function getIndexSourceSystems(userId?: string | null): Promise<string[]> {
  const client = await getClient();
  const uf = userFilter(userId);
  const result = await client.execute({
    sql: `SELECT structured_data FROM memories WHERE entity_type = 'resource' AND deleted_at IS NULL AND structured_data LIKE '%"type":"document"%'${uf.clause}`,
    args: [...uf.args],
  });
  const systems = new Set<string>();
  for (const row of result.rows) {
    try {
      const sd = JSON.parse(row.structured_data as string);
      if (sd.type === "document" && sd.source_system) systems.add(sd.source_system);
    } catch { /* skip */ }
  }
  return [...systems].sort();
}

// --- Cleanup persistence ---

let cleanupTableReady = false;

async function ensureCleanupTable(client: Client): Promise<void> {
  if (cleanupTableReady) return;
  await client.execute({
    sql: `CREATE TABLE IF NOT EXISTS cleanup_dismissals (
      id TEXT PRIMARY KEY,
      user_id TEXT,
      suggestion_key TEXT NOT NULL,
      suggestion_type TEXT NOT NULL,
      action TEXT NOT NULL,
      resolution_note TEXT,
      created_at TEXT NOT NULL,
      UNIQUE(user_id, suggestion_key)
    )`,
    args: [],
  });
  cleanupTableReady = true;
}

export async function getLastModified(userId?: string | null): Promise<string | null> {
  const client = await getClient();
  const key = userId ? `last_modified:${userId}` : "last_modified";
  const result = await client.execute({
    sql: `SELECT value FROM engrams_meta WHERE key = ?`,
    args: [key],
  });
  if (result.rows.length > 0) return result.rows[0].value as string;
  // Fallback to global last_modified
  const fallback = await client.execute({
    sql: `SELECT value FROM engrams_meta WHERE key = 'last_modified'`,
    args: [],
  });
  return fallback.rows.length > 0 ? (fallback.rows[0].value as string) : null;
}

export async function getCachedScanResult(userId?: string | null): Promise<{
  scannedAt: string;
  lastModifiedAt: string;
  result: import("./cleanup").ScanResult;
} | null> {
  const client = await getClient();
  const key = userId ? `cleanup_cache:${userId}` : "cleanup_cache:_default";
  const row = await client.execute({
    sql: `SELECT value FROM engrams_meta WHERE key = ?`,
    args: [key],
  });
  if (row.rows.length === 0) return null;
  try {
    return JSON.parse(row.rows[0].value as string);
  } catch {
    return null;
  }
}

export async function setCachedScanResult(
  result: import("./cleanup").ScanResult,
  lastModifiedAt: string,
  userId?: string | null,
): Promise<void> {
  const client = await getClient();
  const key = userId ? `cleanup_cache:${userId}` : "cleanup_cache:_default";
  const value = JSON.stringify({
    scannedAt: new Date().toISOString(),
    lastModifiedAt,
    result,
  });
  await client.execute({
    sql: `INSERT OR REPLACE INTO engrams_meta (key, value) VALUES (?, ?)`,
    args: [key, value],
  });
}

export async function dismissSuggestion(
  suggestionKey: string,
  suggestionType: string,
  action: "dismissed" | "resolved",
  resolutionNote?: string,
  userId?: string | null,
): Promise<void> {
  const client = await getClient();
  await ensureCleanupTable(client);
  const id = generateId();
  const userVal = userId ?? "_default";
  await client.execute({
    sql: `INSERT OR REPLACE INTO cleanup_dismissals (id, user_id, suggestion_key, suggestion_type, action, resolution_note, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?)`,
    args: [id, userVal, suggestionKey, suggestionType, action, resolutionNote ?? null, new Date().toISOString()],
  });
}

export async function getDismissedKeys(userId?: string | null): Promise<Set<string>> {
  const client = await getClient();
  await ensureCleanupTable(client);
  const userVal = userId ?? "_default";
  const result = await client.execute({
    sql: `SELECT suggestion_key FROM cleanup_dismissals WHERE user_id = ?`,
    args: [userVal],
  });
  return new Set(result.rows.map(r => r.suggestion_key as string));
}

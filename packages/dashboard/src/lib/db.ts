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

function getClient(): Client {
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
  return _client;
}

const isHosted = () => !!process.env.TURSO_DATABASE_URL;

// --- Decryption helpers ---

// Cache for decrypt function
let _decryptFn: ((text: string, key: Buffer) => string) | null = null;
let _encryptionKey: Buffer | null = null;

async function getDecrypt(): Promise<{ fn: (text: string, key: Buffer) => string; key: Buffer } | null> {
  if (!isHosted() || !process.env.ENGRAMS_ENCRYPTION_KEY) return null;
  if (!_decryptFn) {
    const core = await import("@engrams/core");
    _decryptFn = core.decrypt;
  }
  if (!_encryptionKey) {
    _encryptionKey = Buffer.from(process.env.ENGRAMS_ENCRYPTION_KEY, "base64");
  }
  return { fn: _decryptFn, key: _encryptionKey };
}

async function maybeDecrypt(text: string): Promise<string> {
  const d = await getDecrypt();
  if (!d) return text;
  return d.fn(text, d.key);
}

async function decryptRow<T extends { content: string; detail: string | null; structured_data?: string | null }>(row: T): Promise<T> {
  const d = await getDecrypt();
  if (!d) return row;
  return {
    ...row,
    content: d.fn(row.content, d.key),
    detail: row.detail ? d.fn(row.detail, d.key) : null,
    ...(row.structured_data !== undefined
      ? { structured_data: row.structured_data ? d.fn(row.structured_data, d.key) : null }
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

// --- Read functions ---

export async function getMemories(opts?: {
  domain?: string;
  sortBy?: "confidence" | "recency" | "used" | "learned";
  search?: string;
  sourceType?: string;
  entityType?: string;
  minConfidence?: number;
  maxConfidence?: number;
  unused?: boolean;
  needsReview?: boolean;
}): Promise<MemoryRow[]> {
  const client = getClient();

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
        let sql = `SELECT * FROM memories WHERE rowid IN (${placeholders}) AND deleted_at IS NULL`;
        const args: (string | number | null)[] = [...rowids];
        sql = applyFilters(sql, args, opts);
        sql = applySort(sql, opts?.sortBy);
        const result = await client.execute({ sql, args });
        return Promise.all(result.rows.map(r => decryptRow(r as unknown as MemoryRow)));
      }
    } catch {
      // FTS not available (e.g., hosted mode) — fall back to LIKE
    }

    let sql = `SELECT * FROM memories WHERE deleted_at IS NULL AND content LIKE ?`;
    const args: (string | number | null)[] = [`%${opts.search}%`];
    sql = applyFilters(sql, args, opts);
    sql = applySort(sql, opts?.sortBy);
    const result = await client.execute({ sql, args });
    return Promise.all(result.rows.map(r => decryptRow(r as unknown as MemoryRow)));
  }

  let sql = `SELECT * FROM memories WHERE deleted_at IS NULL`;
  const args: (string | number | null)[] = [];
  sql = applyFilters(sql, args, opts);
  sql = applySort(sql, opts?.sortBy);
  const result = await client.execute({ sql, args });
  return Promise.all(result.rows.map(r => decryptRow(r as unknown as MemoryRow)));
}

function applyFilters(sql: string, args: (string | number | null)[], opts?: {
  domain?: string;
  sourceType?: string;
  entityType?: string;
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

export async function getMemoryById(id: string): Promise<MemoryRow | undefined> {
  const client = getClient();
  const result = await client.execute({
    sql: `SELECT * FROM memories WHERE id = ? AND deleted_at IS NULL`,
    args: [id],
  });
  if (result.rows.length === 0) return undefined;
  return await decryptRow(result.rows[0] as unknown as MemoryRow);
}

export async function getMemoryEvents(memoryId: string): Promise<EventRow[]> {
  const client = getClient();
  const result = await client.execute({
    sql: `SELECT * FROM memory_events WHERE memory_id = ? ORDER BY timestamp DESC`,
    args: [memoryId],
  });
  return result.rows as unknown as EventRow[];
}

export async function getMemoryConnections(memoryId: string): Promise<{
  outgoing: (ConnectionRow & { content: string })[];
  incoming: (ConnectionRow & { content: string })[];
}> {
  const client = getClient();
  const outgoing = await client.execute({
    sql: `SELECT mc.*, m.content FROM memory_connections mc
          JOIN memories m ON m.id = mc.target_memory_id
          WHERE mc.source_memory_id = ? AND m.deleted_at IS NULL`,
    args: [memoryId],
  });
  const incoming = await client.execute({
    sql: `SELECT mc.*, m.content FROM memory_connections mc
          JOIN memories m ON m.id = mc.source_memory_id
          WHERE mc.target_memory_id = ? AND m.deleted_at IS NULL`,
    args: [memoryId],
  });

  const decryptContent = async (r: unknown) => {
    const row = r as ConnectionRow & { content: string };
    return { ...row, content: await maybeDecrypt(row.content) };
  };

  return {
    outgoing: await Promise.all(outgoing.rows.map(decryptContent)),
    incoming: await Promise.all(incoming.rows.map(decryptContent)),
  };
}

export async function getDomains(): Promise<{ domain: string; count: number }[]> {
  const client = getClient();
  const result = await client.execute(
    `SELECT domain, COUNT(*) as count FROM memories WHERE deleted_at IS NULL GROUP BY domain ORDER BY count DESC`,
  );
  return result.rows as unknown as { domain: string; count: number }[];
}

export async function getAgentPermissions(): Promise<PermissionRow[]> {
  const client = getClient();
  const result = await client.execute(
    `SELECT * FROM agent_permissions ORDER BY agent_id, domain`,
  );
  return result.rows as unknown as PermissionRow[];
}

export async function getAgents(): Promise<{ agent_id: string; agent_name: string }[]> {
  const client = getClient();
  const result = await client.execute(
    `SELECT DISTINCT source_agent_id as agent_id, source_agent_name as agent_name
     FROM memories WHERE deleted_at IS NULL ORDER BY agent_name`,
  );
  return result.rows as unknown as { agent_id: string; agent_name: string }[];
}

export async function getDbStats(): Promise<{
  totalMemories: number;
  totalDomains: number;
  dbSizeBytes: number;
}> {
  const client = getClient();
  const memResult = await client.execute(`SELECT COUNT(*) as c FROM memories WHERE deleted_at IS NULL`);
  const domResult = await client.execute(`SELECT COUNT(DISTINCT domain) as c FROM memories WHERE deleted_at IS NULL`);

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

export async function getSourceTypes(): Promise<string[]> {
  const client = getClient();
  const result = await client.execute(`SELECT DISTINCT source_type FROM memories WHERE deleted_at IS NULL ORDER BY source_type`);
  return result.rows.map(r => r.source_type as string);
}

export async function getEntityTypes(): Promise<string[]> {
  const client = getClient();
  try {
    const result = await client.execute(`SELECT DISTINCT entity_type FROM memories WHERE entity_type IS NOT NULL AND deleted_at IS NULL ORDER BY entity_type`);
    return result.rows.map(r => r.entity_type as string);
  } catch {
    return [];
  }
}

export async function getGraphData(): Promise<{ nodes: GraphNode[]; edges: GraphEdge[] }> {
  const client = getClient();

  const nodesResult = await client.execute(`
    SELECT m.id, m.content, m.entity_type, m.entity_name, m.domain, m.confidence,
      (SELECT COUNT(*) FROM memory_connections mc
       WHERE mc.source_memory_id = m.id OR mc.target_memory_id = m.id) as connectionCount
    FROM memories m
    WHERE m.deleted_at IS NULL AND m.id IN (
      SELECT source_memory_id FROM memory_connections
      UNION
      SELECT target_memory_id FROM memory_connections
    )
    ORDER BY connectionCount DESC
    LIMIT 200
  `);

  const nodes = await Promise.all(nodesResult.rows.map(async r => {
    const row = r as unknown as GraphNode & { content: string };
    return { ...row, content: await maybeDecrypt(row.content) };
  }));

  // If no connected nodes, show top memories by confidence
  if (nodes.length === 0) {
    const fallback = await client.execute(`
      SELECT m.id, m.content, m.entity_type, m.entity_name, m.domain, m.confidence, 0 as connectionCount
      FROM memories m WHERE m.deleted_at IS NULL
      ORDER BY m.confidence DESC LIMIT 50
    `);
    const fallbackNodes = await Promise.all(fallback.rows.map(async r => {
      const row = r as unknown as GraphNode & { content: string };
      return { ...row, content: await maybeDecrypt(row.content) };
    }));
    return { nodes: fallbackNodes, edges: [] };
  }

  const edgesResult = await client.execute(`
    SELECT mc.source_memory_id as source, mc.target_memory_id as target, mc.relationship
    FROM memory_connections mc
    JOIN memories m1 ON m1.id = mc.source_memory_id AND m1.deleted_at IS NULL
    JOIN memories m2 ON m2.id = mc.target_memory_id AND m2.deleted_at IS NULL
  `);

  return { nodes, edges: edgesResult.rows as unknown as GraphEdge[] };
}

export async function getEntityGraphData(): Promise<{
  entities: EntityNode[];
  edges: EntityEdge[];
  uncategorized: GraphNode[];
}> {
  const client = getClient();

  const rawEntities = await client.execute(`
    SELECT entity_name as entityName, entity_type as entityType,
           COUNT(*) as memoryCount, AVG(confidence) as avgConfidence,
           GROUP_CONCAT(id) as memoryIdsCsv
    FROM memories
    WHERE deleted_at IS NULL AND entity_name IS NOT NULL
    GROUP BY entity_name, entity_type
    ORDER BY memoryCount DESC
  `);

  const entities = rawEntities.rows.map(e => ({
    entityName: e.entityName as string,
    entityType: e.entityType as string,
    memoryCount: e.memoryCount as number,
    avgConfidence: e.avgConfidence as number,
    memoryIds: (e.memoryIdsCsv as string).split(","),
  }));

  const rawEdges = await client.execute(`
    SELECT
      m1.entity_name as sourceEntity,
      m2.entity_name as targetEntity,
      COUNT(*) as connectionCount,
      GROUP_CONCAT(DISTINCT mc.relationship) as relationshipsCsv
    FROM memory_connections mc
    JOIN memories m1 ON m1.id = mc.source_memory_id AND m1.deleted_at IS NULL
    JOIN memories m2 ON m2.id = mc.target_memory_id AND m2.deleted_at IS NULL
    WHERE m1.entity_name IS NOT NULL AND m2.entity_name IS NOT NULL
      AND m1.entity_name != m2.entity_name
    GROUP BY m1.entity_name, m2.entity_name
  `);

  const edges = rawEdges.rows.map(e => ({
    sourceEntity: e.sourceEntity as string,
    targetEntity: e.targetEntity as string,
    connectionCount: e.connectionCount as number,
    relationships: (e.relationshipsCsv as string).split(","),
  }));

  const uncatResult = await client.execute(`
    SELECT id, content, entity_type, entity_name, domain, confidence, 0 as connectionCount
    FROM memories WHERE deleted_at IS NULL AND entity_name IS NULL
    ORDER BY confidence DESC LIMIT 30
  `);

  const uncategorized = await Promise.all(uncatResult.rows.map(async r => {
    const row = r as unknown as GraphNode & { content: string };
    return { ...row, content: await maybeDecrypt(row.content) };
  }));

  return { entities, edges, uncategorized };
}

export async function getTotalMemoryCount(): Promise<number> {
  const client = getClient();
  const result = await client.execute(
    `SELECT COUNT(*) as count FROM memories WHERE deleted_at IS NULL`,
  );
  return result.rows[0].count as number;
}

export async function getUnreviewedCount(): Promise<number> {
  const client = getClient();
  const result = await client.execute(
    `SELECT COUNT(*) as count FROM memories WHERE confirmed_count = 0 AND source_type = 'inferred' AND deleted_at IS NULL`,
  );
  return result.rows[0].count as number;
}

export async function getAllMemoriesForExport(): Promise<MemoryRow[]> {
  const client = getClient();
  const result = await client.execute(
    `SELECT * FROM memories WHERE deleted_at IS NULL ORDER BY domain, confidence DESC`,
  );
  return Promise.all(result.rows.map(r => decryptRow(r as unknown as MemoryRow)));
}

// --- Write operations ---

export async function deleteMemoryById(id: string): Promise<boolean> {
  const client = getClient();
  const timestamp = now();
  const result = await client.execute({
    sql: `UPDATE memories SET deleted_at = ? WHERE id = ? AND deleted_at IS NULL`,
    args: [timestamp, id],
  });
  if (result.rowsAffected > 0) {
    await client.execute({
      sql: `INSERT INTO memory_events (id, memory_id, event_type, agent_name, new_value, timestamp) VALUES (?, ?, 'removed', 'dashboard', ?, ?)`,
      args: [generateId(), id, JSON.stringify({ reason: "deleted via dashboard" }), timestamp],
    });
  }
  return result.rowsAffected > 0;
}

export async function confirmMemoryById(id: string): Promise<{ newConfidence: number } | null> {
  const client = getClient();
  const existing = await client.execute({
    sql: `SELECT confidence, confirmed_count FROM memories WHERE id = ? AND deleted_at IS NULL`,
    args: [id],
  });
  if (existing.rows.length === 0) return null;

  const row = existing.rows[0];
  const newConfidence = 0.99;
  const timestamp = now();
  await client.execute({
    sql: `UPDATE memories SET confidence = ?, confirmed_count = ?, confirmed_at = ? WHERE id = ?`,
    args: [newConfidence, (row.confirmed_count as number) + 1, timestamp, id],
  });
  await client.execute({
    sql: `INSERT INTO memory_events (id, memory_id, event_type, agent_name, old_value, new_value, timestamp) VALUES (?, ?, 'confirmed', 'dashboard', ?, ?, ?)`,
    args: [generateId(), id, JSON.stringify({ confidence: row.confidence }), JSON.stringify({ confidence: newConfidence }), timestamp],
  });
  return { newConfidence };
}

export async function flagMemoryById(id: string): Promise<{ newConfidence: number } | null> {
  const client = getClient();
  const existing = await client.execute({
    sql: `SELECT confidence, mistake_count FROM memories WHERE id = ? AND deleted_at IS NULL`,
    args: [id],
  });
  if (existing.rows.length === 0) return null;

  const row = existing.rows[0];
  const newConfidence = Math.max((row.confidence as number) - 0.15, 0.10);
  const timestamp = now();
  await client.execute({
    sql: `UPDATE memories SET confidence = ?, mistake_count = ? WHERE id = ?`,
    args: [newConfidence, (row.mistake_count as number) + 1, id],
  });
  await client.execute({
    sql: `INSERT INTO memory_events (id, memory_id, event_type, agent_name, old_value, new_value, timestamp) VALUES (?, ?, 'confidence_changed', 'dashboard', ?, ?, ?)`,
    args: [generateId(), id, JSON.stringify({ confidence: row.confidence }), JSON.stringify({ confidence: newConfidence, flaggedAsMistake: true }), timestamp],
  });
  return { newConfidence };
}

export async function correctMemoryById(id: string, content: string, detail?: string | null): Promise<{ newConfidence: number } | null> {
  const client = getClient();
  const existing = await client.execute({
    sql: `SELECT content, detail, confidence, corrected_count FROM memories WHERE id = ? AND deleted_at IS NULL`,
    args: [id],
  });
  if (existing.rows.length === 0) return null;

  const row = existing.rows[0];
  const newConfidence = Math.min(Math.max(row.confidence as number, 0.85), 0.99);
  const timestamp = now();
  const newDetail = detail !== undefined ? detail : row.detail;
  await client.execute({
    sql: `UPDATE memories SET content = ?, detail = ?, confidence = ?, corrected_count = ? WHERE id = ?`,
    args: [content, newDetail as string | null, newConfidence, (row.corrected_count as number) + 1, id],
  });
  await client.execute({
    sql: `INSERT INTO memory_events (id, memory_id, event_type, agent_name, old_value, new_value, timestamp) VALUES (?, ?, 'corrected', 'dashboard', ?, ?, ?)`,
    args: [generateId(), id, JSON.stringify({ content: row.content, detail: row.detail }), JSON.stringify({ content, detail: newDetail, confidence: newConfidence }), timestamp],
  });
  return { newConfidence };
}

export async function scrubMemoryById(id: string, redactedContent: string, redactedDetail: string | null, redactFn: (text: string) => { redacted: string }): Promise<boolean> {
  const client = getClient();
  const existing = await client.execute({
    sql: `SELECT content, detail FROM memories WHERE id = ? AND deleted_at IS NULL`,
    args: [id],
  });
  if (existing.rows.length === 0) return false;

  const row = existing.rows[0];
  const timestamp = now();
  await client.execute({
    sql: `UPDATE memories SET content = ?, detail = ?, has_pii_flag = 0 WHERE id = ?`,
    args: [redactedContent, redactedDetail, id],
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
): Promise<{ newIds: string[] } | null> {
  const client = getClient();
  const existing = await client.execute({
    sql: `SELECT * FROM memories WHERE id = ? AND deleted_at IS NULL`,
    args: [id],
  });
  if (existing.rows.length === 0) return null;

  const row = existing.rows[0] as unknown as MemoryRow;
  const timestamp = now();
  const newIds: string[] = [];

  for (const part of parts) {
    const newId = generateId();
    newIds.push(newId);
    const confidence = Math.min((row.confidence || 0.7) + 0.05, 0.99);

    await client.execute({
      sql: `INSERT INTO memories (id, content, detail, domain, source_agent_id, source_agent_name, source_type, source_description, confidence, learned_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      args: [newId, part.content, part.detail ?? null, row.domain, row.source_agent_id, row.source_agent_name, row.source_type, row.source_description, confidence, timestamp],
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
        sql: `INSERT INTO memory_connections (source_memory_id, target_memory_id, relationship) VALUES (?, ?, 'related')`,
        args: [newIds[i], newIds[j]],
      });
    }
  }

  // Soft-delete original
  await client.execute({
    sql: `UPDATE memories SET deleted_at = ? WHERE id = ?`,
    args: [timestamp, id],
  });
  await client.execute({
    sql: `INSERT INTO memory_events (id, memory_id, event_type, agent_name, new_value, timestamp) VALUES (?, ?, 'removed', 'dashboard', ?, ?)`,
    args: [generateId(), id, JSON.stringify({ reason: "split", splitInto: newIds }), timestamp],
  });

  return { newIds };
}

export async function clearAllMemories(): Promise<void> {
  const client = getClient();
  const timestamp = now();
  await client.execute({
    sql: `UPDATE memories SET deleted_at = ? WHERE deleted_at IS NULL`,
    args: [timestamp],
  });
}

export async function directUpdateMemory(id: string, content: string, detail: string | null): Promise<void> {
  const client = getClient();
  await client.execute({
    sql: `UPDATE memories SET content = ?, detail = ? WHERE id = ? AND deleted_at IS NULL`,
    args: [content, detail, id],
  });
}

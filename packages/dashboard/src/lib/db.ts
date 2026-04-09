import Database from "better-sqlite3";
import { resolve } from "path";
import { homedir } from "os";

let readDb: Database.Database | null = null;
let writeDb: Database.Database | null = null;
let _hasEntityColumns: boolean | null = null;

function hasEntityColumns(db: Database.Database): boolean {
  if (_hasEntityColumns !== null) return _hasEntityColumns;
  try {
    db.prepare(`SELECT entity_type FROM memories LIMIT 0`).run();
    _hasEntityColumns = true;
  } catch {
    _hasEntityColumns = false;
  }
  return _hasEntityColumns;
}

function getDbPath(): string {
  return resolve(homedir(), ".engrams", "engrams.db");
}

export function getReadDb(): Database.Database {
  if (!readDb) {
    readDb = new Database(getDbPath(), { readonly: true });
    readDb.pragma("journal_mode = WAL");
  }
  return readDb;
}

export function getWriteDb(): Database.Database {
  if (!writeDb) {
    writeDb = new Database(getDbPath());
    writeDb.pragma("journal_mode = WAL");
    writeDb.pragma("foreign_keys = ON");
  }
  return writeDb;
}

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

export function getMemories(opts?: {
  domain?: string;
  sortBy?: "confidence" | "recency" | "used" | "learned";
  search?: string;
  sourceType?: string;
  entityType?: string;
  minConfidence?: number;
  maxConfidence?: number;
  unused?: boolean;
}): MemoryRow[] {
  const db = getReadDb();

  function applyFilters(q: string, params: unknown[]): { q: string; params: unknown[] } {
    if (opts?.domain) {
      q += ` AND domain = ?`;
      params.push(opts.domain);
    }
    if (opts?.sourceType) {
      q += ` AND source_type = ?`;
      params.push(opts.sourceType);
    }
    if (opts?.minConfidence !== undefined) {
      q += ` AND confidence >= ?`;
      params.push(opts.minConfidence);
    }
    if (opts?.maxConfidence !== undefined) {
      q += ` AND confidence <= ?`;
      params.push(opts.maxConfidence);
    }
    if (opts?.unused) {
      q += ` AND used_count = 0`;
    }
    if (opts?.entityType && hasEntityColumns(db)) {
      q += ` AND entity_type = ?`;
      params.push(opts.entityType);
    }
    return { q, params };
  }

  function applySort(q: string): string {
    switch (opts?.sortBy) {
      case "recency": return q + ` ORDER BY learned_at DESC`;
      case "used": return q + ` ORDER BY used_count DESC, confidence DESC`;
      case "learned": return q + ` ORDER BY learned_at ASC`;
      default: return q + ` ORDER BY confidence DESC`;
    }
  }

  if (opts?.search) {
    const ftsRows = db
      .prepare(
        `SELECT rowid FROM memory_fts WHERE memory_fts MATCH ? ORDER BY rank LIMIT 100`,
      )
      .all(opts.search) as { rowid: number }[];

    if (ftsRows.length === 0) return [];

    const rowids = ftsRows.map((r) => r.rowid);
    const placeholders = rowids.map(() => "?").join(",");
    let q = `SELECT * FROM memories WHERE rowid IN (${placeholders}) AND deleted_at IS NULL`;
    let params: unknown[] = [...rowids];
    ({ q, params } = applyFilters(q, params));
    q = applySort(q);
    return db.prepare(q).all(...params) as MemoryRow[];
  }

  let q = `SELECT * FROM memories WHERE deleted_at IS NULL`;
  let params: unknown[] = [];
  ({ q, params } = applyFilters(q, params));
  q = applySort(q);
  return db.prepare(q).all(...params) as MemoryRow[];
}

export function getEntityTypes(): string[] {
  const db = getReadDb();
  try {
    const rows = db
      .prepare(`SELECT DISTINCT entity_type FROM memories WHERE entity_type IS NOT NULL AND deleted_at IS NULL ORDER BY entity_type`)
      .all() as { entity_type: string }[];
    return rows.map((r) => r.entity_type);
  } catch {
    // Column may not exist yet if migrations haven't run
    return [];
  }
}

export function getSourceTypes(): string[] {
  const db = getReadDb();
  const rows = db
    .prepare(`SELECT DISTINCT source_type FROM memories WHERE deleted_at IS NULL ORDER BY source_type`)
    .all() as { source_type: string }[];
  return rows.map((r) => r.source_type);
}

export function getMemoryById(id: string): MemoryRow | undefined {
  const db = getReadDb();
  return db
    .prepare(`SELECT * FROM memories WHERE id = ? AND deleted_at IS NULL`)
    .get(id) as MemoryRow | undefined;
}

export function getMemoryEvents(memoryId: string): EventRow[] {
  const db = getReadDb();
  return db
    .prepare(
      `SELECT * FROM memory_events WHERE memory_id = ? ORDER BY timestamp DESC`,
    )
    .all(memoryId) as EventRow[];
}

export function getMemoryConnections(memoryId: string): {
  outgoing: (ConnectionRow & { content: string })[];
  incoming: (ConnectionRow & { content: string })[];
} {
  const db = getReadDb();
  const outgoing = db
    .prepare(
      `SELECT mc.*, m.content FROM memory_connections mc
       JOIN memories m ON m.id = mc.target_memory_id
       WHERE mc.source_memory_id = ? AND m.deleted_at IS NULL`,
    )
    .all(memoryId) as (ConnectionRow & { content: string })[];

  const incoming = db
    .prepare(
      `SELECT mc.*, m.content FROM memory_connections mc
       JOIN memories m ON m.id = mc.source_memory_id
       WHERE mc.target_memory_id = ? AND m.deleted_at IS NULL`,
    )
    .all(memoryId) as (ConnectionRow & { content: string })[];

  return { outgoing, incoming };
}

export function getDomains(): { domain: string; count: number }[] {
  const db = getReadDb();
  return db
    .prepare(
      `SELECT domain, COUNT(*) as count FROM memories WHERE deleted_at IS NULL GROUP BY domain ORDER BY count DESC`,
    )
    .all() as { domain: string; count: number }[];
}

export function getAgentPermissions(): PermissionRow[] {
  const db = getReadDb();
  return db
    .prepare(`SELECT * FROM agent_permissions ORDER BY agent_id, domain`)
    .all() as PermissionRow[];
}

export function getAgents(): { agent_id: string; agent_name: string }[] {
  const db = getReadDb();
  return db
    .prepare(
      `SELECT DISTINCT source_agent_id as agent_id, source_agent_name as agent_name
       FROM memories WHERE deleted_at IS NULL ORDER BY agent_name`,
    )
    .all() as { agent_id: string; agent_name: string }[];
}

export function getDbStats(): {
  totalMemories: number;
  totalDomains: number;
  dbSizeBytes: number;
} {
  const db = getReadDb();
  const totalMemories = (
    db
      .prepare(`SELECT COUNT(*) as c FROM memories WHERE deleted_at IS NULL`)
      .get() as { c: number }
  ).c;
  const totalDomains = (
    db
      .prepare(
        `SELECT COUNT(DISTINCT domain) as c FROM memories WHERE deleted_at IS NULL`,
      )
      .get() as { c: number }
  ).c;

  const { size } = require("fs").statSync(
    resolve(homedir(), ".engrams", "engrams.db"),
  );
  return { totalMemories, totalDomains, dbSizeBytes: size };
}

export function getAllMemoriesForExport(): MemoryRow[] {
  const db = getReadDb();
  return db
    .prepare(`SELECT * FROM memories WHERE deleted_at IS NULL ORDER BY domain, confidence DESC`)
    .all() as MemoryRow[];
}

// --- Write operations ---

function generateId(): string {
  return require("crypto").randomBytes(16).toString("hex");
}

function now(): string {
  return new Date().toISOString();
}

export function deleteMemoryById(id: string): boolean {
  const db = getWriteDb();
  const timestamp = now();
  const result = db
    .prepare(`UPDATE memories SET deleted_at = ? WHERE id = ? AND deleted_at IS NULL`)
    .run(timestamp, id);
  if (result.changes > 0) {
    db.prepare(
      `INSERT INTO memory_events (id, memory_id, event_type, agent_name, new_value, timestamp) VALUES (?, ?, 'removed', 'dashboard', ?, ?)`,
    ).run(generateId(), id, JSON.stringify({ reason: "deleted via dashboard" }), timestamp);
  }
  return result.changes > 0;
}

export function confirmMemoryById(id: string): { newConfidence: number } | null {
  const db = getWriteDb();
  const existing = db
    .prepare(`SELECT confidence, confirmed_count FROM memories WHERE id = ? AND deleted_at IS NULL`)
    .get(id) as { confidence: number; confirmed_count: number } | undefined;
  if (!existing) return null;

  const newConfidence = 0.99;
  const timestamp = now();
  db.prepare(
    `UPDATE memories SET confidence = ?, confirmed_count = ?, confirmed_at = ? WHERE id = ?`,
  ).run(newConfidence, existing.confirmed_count + 1, timestamp, id);
  db.prepare(
    `INSERT INTO memory_events (id, memory_id, event_type, agent_name, old_value, new_value, timestamp) VALUES (?, ?, 'confirmed', 'dashboard', ?, ?, ?)`,
  ).run(generateId(), id, JSON.stringify({ confidence: existing.confidence }), JSON.stringify({ confidence: newConfidence }), timestamp);
  return { newConfidence };
}

export function flagMemoryById(id: string): { newConfidence: number } | null {
  const db = getWriteDb();
  const existing = db
    .prepare(`SELECT confidence, mistake_count FROM memories WHERE id = ? AND deleted_at IS NULL`)
    .get(id) as { confidence: number; mistake_count: number } | undefined;
  if (!existing) return null;

  const newConfidence = Math.max(existing.confidence - 0.15, 0.10);
  const timestamp = now();
  db.prepare(
    `UPDATE memories SET confidence = ?, mistake_count = ? WHERE id = ?`,
  ).run(newConfidence, existing.mistake_count + 1, id);
  db.prepare(
    `INSERT INTO memory_events (id, memory_id, event_type, agent_name, old_value, new_value, timestamp) VALUES (?, ?, 'confidence_changed', 'dashboard', ?, ?, ?)`,
  ).run(generateId(), id, JSON.stringify({ confidence: existing.confidence }), JSON.stringify({ confidence: newConfidence, flaggedAsMistake: true }), timestamp);
  return { newConfidence };
}

export function correctMemoryById(id: string, content: string, detail?: string | null): { newConfidence: number } | null {
  const db = getWriteDb();
  const existing = db
    .prepare(`SELECT content, detail, confidence, corrected_count FROM memories WHERE id = ? AND deleted_at IS NULL`)
    .get(id) as { content: string; detail: string | null; confidence: number; corrected_count: number } | undefined;
  if (!existing) return null;

  const newConfidence = Math.min(Math.max(existing.confidence, 0.85), 0.99);
  const timestamp = now();
  const newDetail = detail !== undefined ? detail : existing.detail;
  db.prepare(
    `UPDATE memories SET content = ?, detail = ?, confidence = ?, corrected_count = ? WHERE id = ?`,
  ).run(content, newDetail, newConfidence, existing.corrected_count + 1, id);
  db.prepare(
    `INSERT INTO memory_events (id, memory_id, event_type, agent_name, old_value, new_value, timestamp) VALUES (?, ?, 'corrected', 'dashboard', ?, ?, ?)`,
  ).run(generateId(), id, JSON.stringify({ content: existing.content, detail: existing.detail }), JSON.stringify({ content, detail: newDetail, confidence: newConfidence }), timestamp);
  return { newConfidence };
}

export function splitMemoryById(
  id: string,
  parts: { content: string; detail?: string | null }[],
): { newIds: string[] } | null {
  const db = getWriteDb();
  const existing = db
    .prepare(`SELECT * FROM memories WHERE id = ? AND deleted_at IS NULL`)
    .get(id) as MemoryRow | undefined;
  if (!existing) return null;

  const timestamp = now();
  const newIds: string[] = [];

  for (const part of parts) {
    const newId = generateId();
    newIds.push(newId);
    const confidence = Math.min((existing.confidence || 0.7) + 0.05, 0.99);

    db.prepare(
      `INSERT INTO memories (id, content, detail, domain, source_agent_id, source_agent_name, source_type, source_description, confidence, learned_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      newId,
      part.content,
      part.detail ?? null,
      existing.domain,
      existing.source_agent_id,
      existing.source_agent_name,
      existing.source_type,
      existing.source_description,
      confidence,
      timestamp,
    );

    db.prepare(
      `INSERT INTO memory_events (id, memory_id, event_type, agent_name, new_value, timestamp) VALUES (?, ?, 'created', 'dashboard', ?, ?)`,
    ).run(generateId(), newId, JSON.stringify({ content: part.content, splitFrom: id }), timestamp);
  }

  // Connect new memories to each other
  for (let i = 0; i < newIds.length; i++) {
    for (let j = i + 1; j < newIds.length; j++) {
      db.prepare(
        `INSERT INTO memory_connections (source_memory_id, target_memory_id, relationship) VALUES (?, ?, 'related')`,
      ).run(newIds[i], newIds[j]);
    }
  }

  // Soft-delete original
  db.prepare(`UPDATE memories SET deleted_at = ? WHERE id = ?`).run(timestamp, id);
  db.prepare(
    `INSERT INTO memory_events (id, memory_id, event_type, agent_name, new_value, timestamp) VALUES (?, ?, 'removed', 'dashboard', ?, ?)`,
  ).run(generateId(), id, JSON.stringify({ reason: "split", splitInto: newIds }), timestamp);

  return { newIds };
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

export function getGraphData(): { nodes: GraphNode[]; edges: GraphEdge[] } {
  const db = getReadDb();

  const connectedIds = db.prepare(`
    SELECT DISTINCT id FROM memories
    WHERE deleted_at IS NULL AND id IN (
      SELECT source_memory_id FROM memory_connections
      UNION
      SELECT target_memory_id FROM memory_connections
    )
  `).all() as { id: string }[];

  const entityTypeCol = hasEntityColumns(db)
    ? "m.entity_type, m.entity_name"
    : "NULL as entity_type, NULL as entity_name";

  const nodes = connectedIds.length > 0
    ? db.prepare(`
        SELECT m.id, m.content, ${entityTypeCol}, m.domain, m.confidence,
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
      `).all() as GraphNode[]
    : db.prepare(`
        SELECT m.id, m.content, ${entityTypeCol}, m.domain, m.confidence, 0 as connectionCount
        FROM memories m WHERE m.deleted_at IS NULL
        ORDER BY m.confidence DESC LIMIT 50
      `).all() as GraphNode[];

  const edges = db.prepare(`
    SELECT mc.source_memory_id as source, mc.target_memory_id as target, mc.relationship
    FROM memory_connections mc
    JOIN memories m1 ON m1.id = mc.source_memory_id AND m1.deleted_at IS NULL
    JOIN memories m2 ON m2.id = mc.target_memory_id AND m2.deleted_at IS NULL
  `).all() as GraphEdge[];

  return { nodes, edges };
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

export function getEntityGraphData(): {
  entities: EntityNode[];
  edges: EntityEdge[];
  uncategorized: GraphNode[];
} {
  const db = getReadDb();

  if (!hasEntityColumns(db)) {
    return { entities: [], edges: [], uncategorized: [] };
  }

  const rawEntities = db.prepare(`
    SELECT entity_name as entityName, entity_type as entityType,
           COUNT(*) as memoryCount, AVG(confidence) as avgConfidence,
           GROUP_CONCAT(id) as memoryIdsCsv
    FROM memories
    WHERE deleted_at IS NULL AND entity_name IS NOT NULL
    GROUP BY entity_name, entity_type
    ORDER BY memoryCount DESC
  `).all() as (EntityNode & { memoryIdsCsv: string })[];

  const entities = rawEntities.map((e) => ({
    entityName: e.entityName,
    entityType: e.entityType,
    memoryCount: e.memoryCount,
    avgConfidence: e.avgConfidence,
    memoryIds: e.memoryIdsCsv.split(","),
  }));

  const rawEdges = db.prepare(`
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
  `).all() as (EntityEdge & { relationshipsCsv: string })[];

  const edges = rawEdges.map((e) => ({
    sourceEntity: e.sourceEntity,
    targetEntity: e.targetEntity,
    connectionCount: e.connectionCount,
    relationships: e.relationshipsCsv.split(","),
  }));

  const uncategorized = db.prepare(`
    SELECT id, content, entity_type, entity_name, domain, confidence, 0 as connectionCount
    FROM memories WHERE deleted_at IS NULL AND entity_name IS NULL
    ORDER BY confidence DESC LIMIT 30
  `).all() as GraphNode[];

  return { entities, edges, uncategorized };
}

export function clearAllMemories(): void {
  const db = getWriteDb();
  const timestamp = now();
  db.prepare(`UPDATE memories SET deleted_at = ? WHERE deleted_at IS NULL`).run(timestamp);
}

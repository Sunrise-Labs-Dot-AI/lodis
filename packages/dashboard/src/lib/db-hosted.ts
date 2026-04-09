import { createClient, type Client } from "@libsql/client";
import { decrypt } from "@engrams/core";
import type { MemoryRow, EventRow, ConnectionRow, GraphNode, GraphEdge, EntityNode, EntityEdge } from "./db-local";

let tursoClient: Client | null = null;

function getTursoClient(): Client {
  if (!tursoClient) {
    if (!process.env.TURSO_DATABASE_URL || !process.env.TURSO_AUTH_TOKEN) {
      throw new Error("TURSO_DATABASE_URL and TURSO_AUTH_TOKEN required for hosted mode");
    }
    tursoClient = createClient({
      url: process.env.TURSO_DATABASE_URL,
      authToken: process.env.TURSO_AUTH_TOKEN,
    });
  }
  return tursoClient;
}

function getHostedKey(): Buffer {
  const key = process.env.ENGRAMS_ENCRYPTION_KEY;
  if (!key) throw new Error("ENGRAMS_ENCRYPTION_KEY required for hosted mode");
  return Buffer.from(key, "base64");
}

function decryptRow<T extends { content: string; detail: string | null; structured_data?: string | null }>(row: T): T {
  const key = getHostedKey();
  return {
    ...row,
    content: decrypt(row.content, key),
    detail: row.detail ? decrypt(row.detail, key) : null,
    ...(row.structured_data !== undefined
      ? { structured_data: row.structured_data ? decrypt(row.structured_data, key) : null }
      : {}),
  };
}

export async function getMemoriesHosted(opts?: {
  domain?: string;
  sortBy?: "confidence" | "recency" | "used" | "learned";
  search?: string;
  sourceType?: string;
  entityType?: string;
  minConfidence?: number;
  maxConfidence?: number;
  unused?: boolean;
}): Promise<MemoryRow[]> {
  const client = getTursoClient();
  let sql = `SELECT * FROM memories WHERE deleted_at IS NULL`;
  const args: (string | number | null)[] = [];

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
  if (opts?.search) {
    sql += ` AND content LIKE ?`;
    args.push(`%${opts.search}%`);
  }

  switch (opts?.sortBy) {
    case "recency": sql += ` ORDER BY learned_at DESC`; break;
    case "used": sql += ` ORDER BY used_count DESC, confidence DESC`; break;
    case "learned": sql += ` ORDER BY learned_at ASC`; break;
    default: sql += ` ORDER BY confidence DESC`; break;
  }

  const result = await client.execute({ sql, args });
  return result.rows.map((row) => decryptRow(row as unknown as MemoryRow));
}

export async function getMemoryByIdHosted(id: string): Promise<MemoryRow | undefined> {
  const client = getTursoClient();
  const result = await client.execute({
    sql: `SELECT * FROM memories WHERE id = ? AND deleted_at IS NULL`,
    args: [id],
  });
  if (result.rows.length === 0) return undefined;
  return decryptRow(result.rows[0] as unknown as MemoryRow);
}

export async function getMemoryEventsHosted(memoryId: string): Promise<EventRow[]> {
  const client = getTursoClient();
  const result = await client.execute({
    sql: `SELECT * FROM memory_events WHERE memory_id = ? ORDER BY timestamp DESC`,
    args: [memoryId],
  });
  return result.rows as unknown as EventRow[];
}

export async function getMemoryConnectionsHosted(memoryId: string): Promise<{
  outgoing: (ConnectionRow & { content: string })[];
  incoming: (ConnectionRow & { content: string })[];
}> {
  const client = getTursoClient();
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

  const key = getHostedKey();
  return {
    outgoing: outgoing.rows.map((r) => {
      const row = r as unknown as ConnectionRow & { content: string };
      return { ...row, content: decrypt(row.content, key) };
    }),
    incoming: incoming.rows.map((r) => {
      const row = r as unknown as ConnectionRow & { content: string };
      return { ...row, content: decrypt(row.content, key) };
    }),
  };
}

export async function getDbStatsHosted(): Promise<{
  totalMemories: number;
  totalDomains: number;
  dbSizeBytes: number;
}> {
  const client = getTursoClient();
  const memResult = await client.execute(`SELECT COUNT(*) as c FROM memories WHERE deleted_at IS NULL`);
  const domResult = await client.execute(`SELECT COUNT(DISTINCT domain) as c FROM memories WHERE deleted_at IS NULL`);
  return {
    totalMemories: memResult.rows[0].c as number,
    totalDomains: domResult.rows[0].c as number,
    dbSizeBytes: 0, // Not applicable for remote DB
  };
}

export async function getGraphDataHosted(): Promise<{ nodes: GraphNode[]; edges: GraphEdge[] }> {
  const client = getTursoClient();
  const key = getHostedKey();

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

  const nodes = nodesResult.rows.map((r) => {
    const row = r as unknown as GraphNode & { content: string };
    return { ...row, content: decrypt(row.content, key) };
  });

  const edgesResult = await client.execute(`
    SELECT mc.source_memory_id as source, mc.target_memory_id as target, mc.relationship
    FROM memory_connections mc
    JOIN memories m1 ON m1.id = mc.source_memory_id AND m1.deleted_at IS NULL
    JOIN memories m2 ON m2.id = mc.target_memory_id AND m2.deleted_at IS NULL
  `);

  return { nodes, edges: edgesResult.rows as unknown as GraphEdge[] };
}

export async function getEntityGraphDataHosted(): Promise<{
  entities: EntityNode[];
  edges: EntityEdge[];
  uncategorized: GraphNode[];
}> {
  const client = getTursoClient();
  const key = getHostedKey();

  const rawEntities = await client.execute(`
    SELECT entity_name as entityName, entity_type as entityType,
           COUNT(*) as memoryCount, AVG(confidence) as avgConfidence,
           GROUP_CONCAT(id) as memoryIdsCsv
    FROM memories
    WHERE deleted_at IS NULL AND entity_name IS NOT NULL
    GROUP BY entity_name, entity_type
    ORDER BY memoryCount DESC
  `);

  const entities = rawEntities.rows.map((e) => ({
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

  const edges = rawEdges.rows.map((e) => ({
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

  const uncategorized = uncatResult.rows.map((r) => {
    const row = r as unknown as GraphNode & { content: string };
    return { ...row, content: decrypt(row.content, key) };
  });

  return { entities, edges, uncategorized };
}

export async function getSourceTypesHosted(): Promise<string[]> {
  const client = getTursoClient();
  const result = await client.execute(`SELECT DISTINCT source_type FROM memories WHERE deleted_at IS NULL ORDER BY source_type`);
  return result.rows.map((r) => r.source_type as string);
}

export async function getEntityTypesHosted(): Promise<string[]> {
  const client = getTursoClient();
  const result = await client.execute(`SELECT DISTINCT entity_type FROM memories WHERE entity_type IS NOT NULL AND deleted_at IS NULL ORDER BY entity_type`);
  return result.rows.map((r) => r.entity_type as string);
}

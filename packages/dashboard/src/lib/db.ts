// db.ts — facade that routes to local (better-sqlite3) or hosted (Turso) backend

// Re-export all types from db-local
export type {
  MemoryRow,
  EventRow,
  ConnectionRow,
  PermissionRow,
  GraphNode,
  GraphEdge,
  EntityNode,
  EntityEdge,
} from "./db-local";

import type {
  MemoryRow,
  EventRow,
  ConnectionRow,
  PermissionRow,
  GraphNode,
  GraphEdge,
  EntityNode,
  EntityEdge,
} from "./db-local";

const isHosted = (): boolean => !!process.env.TURSO_DATABASE_URL;

// --- getReadDb / getWriteDb (used by cleanup.ts and db-actions.ts) ---

import type Database from "better-sqlite3";

export function getReadDb(): Database.Database {
  if (isHosted()) {
    throw new Error("getReadDb is not available in hosted mode. Use the async facade functions instead.");
  }
  const { getReadDb: localGetReadDb } = require("./db-local") as typeof import("./db-local");
  return localGetReadDb();
}

export function getWriteDb(): Database.Database {
  if (isHosted()) {
    throw new Error("getWriteDb is not available in hosted mode. Use the async facade functions instead.");
  }
  const { getWriteDb: localGetWriteDb } = require("./db-local") as typeof import("./db-local");
  return localGetWriteDb();
}

// --- Helper: lazily load Turso client for inline implementations ---

function getTursoClient() {
  const { createClient } = require("@libsql/client") as typeof import("@libsql/client");
  if (!process.env.TURSO_DATABASE_URL || !process.env.TURSO_AUTH_TOKEN) {
    throw new Error("TURSO_DATABASE_URL and TURSO_AUTH_TOKEN required for hosted mode");
  }
  return createClient({
    url: process.env.TURSO_DATABASE_URL,
    authToken: process.env.TURSO_AUTH_TOKEN,
  });
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
  if (isHosted()) {
    const { getMemoriesHosted } = await import("./db-hosted");
    return getMemoriesHosted(opts);
  }
  const { getMemories: local } = await import("./db-local");
  return Promise.resolve(local(opts));
}

export async function getMemoryById(id: string): Promise<MemoryRow | undefined> {
  if (isHosted()) {
    const { getMemoryByIdHosted } = await import("./db-hosted");
    return getMemoryByIdHosted(id);
  }
  const { getMemoryById: local } = await import("./db-local");
  return Promise.resolve(local(id));
}

export async function getMemoryEvents(memoryId: string): Promise<EventRow[]> {
  if (isHosted()) {
    const { getMemoryEventsHosted } = await import("./db-hosted");
    return getMemoryEventsHosted(memoryId);
  }
  const { getMemoryEvents: local } = await import("./db-local");
  return Promise.resolve(local(memoryId));
}

export async function getMemoryConnections(memoryId: string): Promise<{
  outgoing: (ConnectionRow & { content: string })[];
  incoming: (ConnectionRow & { content: string })[];
}> {
  if (isHosted()) {
    const { getMemoryConnectionsHosted } = await import("./db-hosted");
    return getMemoryConnectionsHosted(memoryId);
  }
  const { getMemoryConnections: local } = await import("./db-local");
  return Promise.resolve(local(memoryId));
}

export async function getDomains(): Promise<{ domain: string; count: number }[]> {
  if (isHosted()) {
    const client = getTursoClient();
    const result = await client.execute(
      `SELECT domain, COUNT(*) as count FROM memories WHERE deleted_at IS NULL GROUP BY domain ORDER BY count DESC`,
    );
    return result.rows as unknown as { domain: string; count: number }[];
  }
  const { getDomains: local } = await import("./db-local");
  return Promise.resolve(local());
}

export async function getAgentPermissions(): Promise<PermissionRow[]> {
  if (isHosted()) {
    const client = getTursoClient();
    const result = await client.execute(
      `SELECT * FROM agent_permissions ORDER BY agent_id, domain`,
    );
    return result.rows as unknown as PermissionRow[];
  }
  const { getAgentPermissions: local } = await import("./db-local");
  return Promise.resolve(local());
}

export async function getAgents(): Promise<{ agent_id: string; agent_name: string }[]> {
  if (isHosted()) {
    const client = getTursoClient();
    const result = await client.execute(
      `SELECT DISTINCT source_agent_id as agent_id, source_agent_name as agent_name
       FROM memories WHERE deleted_at IS NULL ORDER BY agent_name`,
    );
    return result.rows as unknown as { agent_id: string; agent_name: string }[];
  }
  const { getAgents: local } = await import("./db-local");
  return Promise.resolve(local());
}

export async function getDbStats(): Promise<{
  totalMemories: number;
  totalDomains: number;
  dbSizeBytes: number;
}> {
  if (isHosted()) {
    const { getDbStatsHosted } = await import("./db-hosted");
    return getDbStatsHosted();
  }
  const { getDbStats: local } = await import("./db-local");
  return Promise.resolve(local());
}

export async function getSourceTypes(): Promise<string[]> {
  if (isHosted()) {
    const { getSourceTypesHosted } = await import("./db-hosted");
    return getSourceTypesHosted();
  }
  const { getSourceTypes: local } = await import("./db-local");
  return Promise.resolve(local());
}

export async function getEntityTypes(): Promise<string[]> {
  if (isHosted()) {
    const { getEntityTypesHosted } = await import("./db-hosted");
    return getEntityTypesHosted();
  }
  const { getEntityTypes: local } = await import("./db-local");
  return Promise.resolve(local());
}

export async function getGraphData(): Promise<{ nodes: GraphNode[]; edges: GraphEdge[] }> {
  if (isHosted()) {
    const { getGraphDataHosted } = await import("./db-hosted");
    return getGraphDataHosted();
  }
  const { getGraphData: local } = await import("./db-local");
  return Promise.resolve(local());
}

export async function getEntityGraphData(): Promise<{
  entities: EntityNode[];
  edges: EntityEdge[];
  uncategorized: GraphNode[];
}> {
  if (isHosted()) {
    const { getEntityGraphDataHosted } = await import("./db-hosted");
    return getEntityGraphDataHosted();
  }
  const { getEntityGraphData: local } = await import("./db-local");
  return Promise.resolve(local());
}

export async function getTotalMemoryCount(): Promise<number> {
  if (isHosted()) {
    const client = getTursoClient();
    const result = await client.execute(
      `SELECT COUNT(*) as count FROM memories WHERE deleted_at IS NULL`,
    );
    return result.rows[0].count as number;
  }
  const { getTotalMemoryCount: local } = await import("./db-local");
  return Promise.resolve(local());
}

export async function getUnreviewedCount(): Promise<number> {
  if (isHosted()) {
    const client = getTursoClient();
    const result = await client.execute(
      `SELECT COUNT(*) as count FROM memories WHERE confirmed_count = 0 AND source_type = 'inferred' AND deleted_at IS NULL`,
    );
    return result.rows[0].count as number;
  }
  const { getUnreviewedCount: local } = await import("./db-local");
  return Promise.resolve(local());
}

export async function getAllMemoriesForExport(): Promise<MemoryRow[]> {
  if (isHosted()) {
    const client = getTursoClient();
    const { decrypt } = await import("@engrams/core");
    const key = process.env.ENGRAMS_ENCRYPTION_KEY;
    if (!key) throw new Error("ENGRAMS_ENCRYPTION_KEY required for hosted mode");
    const keyBuf = Buffer.from(key, "base64");
    const result = await client.execute(
      `SELECT * FROM memories WHERE deleted_at IS NULL ORDER BY domain, confidence DESC`,
    );
    return result.rows.map((row) => {
      const r = row as unknown as MemoryRow;
      return {
        ...r,
        content: decrypt(r.content, keyBuf),
        detail: r.detail ? decrypt(r.detail, keyBuf) : null,
        structured_data: r.structured_data ? decrypt(r.structured_data, keyBuf) : null,
      };
    });
  }
  const { getAllMemoriesForExport: local } = await import("./db-local");
  return Promise.resolve(local());
}

// --- Write operations ---

export async function deleteMemoryById(id: string): Promise<boolean> {
  if (isHosted()) {
    throw new Error("Write operations not supported in hosted dashboard");
  }
  const { deleteMemoryById: local } = await import("./db-local");
  return Promise.resolve(local(id));
}

export async function confirmMemoryById(id: string): Promise<{ newConfidence: number } | null> {
  if (isHosted()) {
    throw new Error("Write operations not supported in hosted dashboard");
  }
  const { confirmMemoryById: local } = await import("./db-local");
  return Promise.resolve(local(id));
}

export async function flagMemoryById(id: string): Promise<{ newConfidence: number } | null> {
  if (isHosted()) {
    throw new Error("Write operations not supported in hosted dashboard");
  }
  const { flagMemoryById: local } = await import("./db-local");
  return Promise.resolve(local(id));
}

export async function correctMemoryById(id: string, content: string, detail?: string | null): Promise<{ newConfidence: number } | null> {
  if (isHosted()) {
    throw new Error("Write operations not supported in hosted dashboard");
  }
  const { correctMemoryById: local } = await import("./db-local");
  return Promise.resolve(local(id, content, detail));
}

export async function splitMemoryById(
  id: string,
  parts: { content: string; detail?: string | null }[],
): Promise<{ newIds: string[] } | null> {
  if (isHosted()) {
    throw new Error("Write operations not supported in hosted dashboard");
  }
  const { splitMemoryById: local } = await import("./db-local");
  return Promise.resolve(local(id, parts));
}

export async function clearAllMemories(): Promise<void> {
  if (isHosted()) {
    throw new Error("Write operations not supported in hosted dashboard");
  }
  const { clearAllMemories: local } = await import("./db-local");
  return Promise.resolve(local());
}

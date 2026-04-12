import type { Client } from "@libsql/client";

export interface EntityProfile {
  id: string;
  entityName: string;
  entityType: string;
  summary: string;
  memoryIds: string[];
  tokenCount: number;
  generatedAt: string;
  userId: string | null;
}

/**
 * Retrieve an existing entity profile, or return null if none exists.
 * No longer generates profiles server-side — the client LLM should
 * generate summaries and store them via saveProfile().
 */
export async function getOrGenerateProfile(
  client: Client,
  entityName: string,
  entityType?: string,
  options?: { regenerate?: boolean; userId?: string },
): Promise<EntityProfile | null> {
  const userId = options?.userId ?? null;

  if (options?.regenerate) return null; // caller should generate + saveProfile

  return getProfile(client, entityName, entityType, userId);
}

/**
 * Save a client-generated entity profile summary.
 */
export async function saveProfile(
  client: Client,
  entityName: string,
  entityType: string,
  summary: string,
  memoryIds: string[],
  userId?: string | null,
): Promise<EntityProfile> {
  const profile: EntityProfile = {
    id: generateHexId(),
    entityName,
    entityType,
    summary,
    memoryIds,
    tokenCount: Math.ceil(summary.length / 4),
    generatedAt: new Date().toISOString(),
    userId: userId ?? null,
  };

  await client.execute({
    sql: `INSERT INTO memory_summaries (id, entity_name, entity_type, summary, memory_ids, token_count, generated_at, user_id)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(entity_name, entity_type, user_id) DO UPDATE SET
            summary = excluded.summary,
            memory_ids = excluded.memory_ids,
            token_count = excluded.token_count,
            generated_at = excluded.generated_at`,
    args: [
      profile.id,
      profile.entityName,
      profile.entityType,
      profile.summary,
      JSON.stringify(profile.memoryIds),
      profile.tokenCount,
      profile.generatedAt,
      profile.userId,
    ],
  });

  return profile;
}

/**
 * Retrieve an existing entity profile without generating a new one.
 */
export async function getProfile(
  client: Client,
  entityName: string,
  entityType?: string,
  userId?: string | null,
): Promise<EntityProfile | null> {
  const conditions = [`entity_name = ?`];
  const args: (string | null)[] = [entityName];

  if (entityType) {
    conditions.push(`entity_type = ?`);
    args.push(entityType);
  }

  if (userId) {
    conditions.push(`user_id = ?`);
    args.push(userId);
  } else {
    conditions.push(`(user_id IS NULL OR user_id = '')`);
  }

  const result = await client.execute({
    sql: `SELECT * FROM memory_summaries WHERE ${conditions.join(" AND ")} LIMIT 1`,
    args,
  });

  if (result.rows.length === 0) return null;

  const row = result.rows[0];
  return {
    id: row.id as string,
    entityName: row.entity_name as string,
    entityType: row.entity_type as string,
    summary: row.summary as string,
    memoryIds: JSON.parse(row.memory_ids as string) as string[],
    tokenCount: row.token_count as number,
    generatedAt: row.generated_at as string,
    userId: (row.user_id as string | null) ?? null,
  };
}

/**
 * Check if a profile is stale (>24h old) and should be regenerated.
 */
export function isProfileStale(profile: EntityProfile, maxAgeMs = 24 * 60 * 60 * 1000): boolean {
  const generatedAt = new Date(profile.generatedAt).getTime();
  return Date.now() - generatedAt > maxAgeMs;
}

/**
 * List all entity profiles, optionally filtered by type.
 */
export async function listProfiles(
  client: Client,
  options?: { entityType?: string; userId?: string | null },
): Promise<EntityProfile[]> {
  const conditions: string[] = [];
  const args: (string | null)[] = [];

  if (options?.entityType) {
    conditions.push(`entity_type = ?`);
    args.push(options.entityType);
  }

  if (options?.userId) {
    conditions.push(`user_id = ?`);
    args.push(options.userId);
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

  const result = await client.execute({
    sql: `SELECT * FROM memory_summaries ${where} ORDER BY entity_name ASC`,
    args,
  });

  return result.rows.map((row) => ({
    id: row.id as string,
    entityName: row.entity_name as string,
    entityType: row.entity_type as string,
    summary: row.summary as string,
    memoryIds: JSON.parse(row.memory_ids as string) as string[],
    tokenCount: row.token_count as number,
    generatedAt: row.generated_at as string,
    userId: (row.user_id as string | null) ?? null,
  }));
}

function generateHexId(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

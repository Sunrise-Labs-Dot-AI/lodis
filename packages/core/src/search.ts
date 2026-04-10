import type { Client } from "@libsql/client";
import { searchFTS } from "./fts.js";
import { searchVec } from "./vec.js";
import { generateEmbedding } from "./embeddings.js";

const RRF_K = 60;

export interface SearchResult {
  id: string;
  score: number;
  memory: Record<string, unknown>;
}

export interface ExpandedResult extends SearchResult {
  connected: {
    memory: Record<string, unknown>;
    relationship: string;
    depth: number;
    similarity: number;
  }[];
}

// --- Helpers ---

async function getStoredEmbedding(client: Client, memoryId: string): Promise<Float32Array | null> {
  const result = await client.execute({
    sql: `SELECT embedding FROM memories WHERE id = ?`,
    args: [memoryId],
  });
  if (result.rows.length === 0) return null;
  const row = result.rows[0];
  if (!row.embedding) return null;
  // libsql returns F32_BLOB as ArrayBuffer
  const buf = row.embedding as ArrayBuffer;
  return new Float32Array(buf);
}

function cosineSimilarity(a: Float32Array, b: Float32Array): number {
  let dot = 0, normA = 0, normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

function recencyBoost(learnedAt: string | null): number {
  if (!learnedAt) return 1.0;
  const ageMs = Date.now() - new Date(learnedAt).getTime();
  const ageDays = ageMs / (1000 * 60 * 60 * 24);
  // Decay from 1.1 (today) to 1.0 (30+ days old)
  return 1.0 + Math.max(0, 0.1 * (1 - ageDays / 30));
}

// --- Graph Expansion ---

async function expandConnections(
  client: Client,
  results: SearchResult[],
  queryEmbedding: Float32Array | null,
  maxDepth: number,
  similarityThreshold: number,
  userId?: string | null,
): Promise<ExpandedResult[]> {
  if (!queryEmbedding) {
    return results.map((r) => ({ ...r, connected: [] }));
  }

  const seen = new Set<string>(results.map((r) => r.id));

  const expanded: ExpandedResult[] = [];
  for (const result of results) {
    const connected: ExpandedResult["connected"] = [];
    const queue: { memoryId: string; depth: number }[] = [{ memoryId: result.id, depth: 0 }];

    while (queue.length > 0) {
      const { memoryId, depth } = queue.shift()!;
      if (depth >= maxDepth) continue;

      // Get outgoing + incoming connections
      const outgoingResult = await client.execute({
        sql: `SELECT mc.target_memory_id as id, mc.relationship, m.*
             FROM memory_connections mc
             JOIN memories m ON m.id = mc.target_memory_id
             WHERE mc.source_memory_id = ? AND m.deleted_at IS NULL${userId ? ' AND m.user_id = ?' : ''}`,
        args: userId ? [memoryId, userId] : [memoryId],
      });

      const incomingResult = await client.execute({
        sql: `SELECT mc.source_memory_id as id, mc.relationship, m.*
             FROM memory_connections mc
             JOIN memories m ON m.id = mc.source_memory_id
             WHERE mc.target_memory_id = ? AND m.deleted_at IS NULL${userId ? ' AND m.user_id = ?' : ''}`,
        args: userId ? [memoryId, userId] : [memoryId],
      });

      const allConns = [
        ...outgoingResult.rows.map((r) => r as unknown as Record<string, unknown> & { id: string; relationship: string }),
        ...incomingResult.rows.map((r) => r as unknown as Record<string, unknown> & { id: string; relationship: string }),
      ];

      for (const conn of allConns) {
        if (seen.has(conn.id)) continue;
        seen.add(conn.id);

        // Check semantic similarity to query
        const embedding = await getStoredEmbedding(client, conn.id);
        if (!embedding) continue;

        const similarity = cosineSimilarity(queryEmbedding, embedding);
        if (similarity < similarityThreshold) continue;

        connected.push({
          memory: conn,
          relationship: conn.relationship,
          depth: depth + 1,
          similarity,
        });

        queue.push({ memoryId: conn.id, depth: depth + 1 });
      }
    }

    // Stable sort: similarity desc, then ID asc
    connected.sort((a, b) => {
      const simDiff = b.similarity - a.similarity;
      if (Math.abs(simDiff) > 1e-10) return simDiff;
      return (a.memory.id as string).localeCompare(b.memory.id as string);
    });

    expanded.push({ ...result, connected });
  }

  return expanded;
}

// --- Result Cache ---

const resultCache = new Map<string, { results: ExpandedResult[]; lastModified: string }>();

// --- Main Search ---

export async function hybridSearch(
  client: Client,
  query: string,
  options: {
    userId?: string | null;
    domain?: string;
    entityType?: string;
    entityName?: string;
    minConfidence?: number;
    limit?: number;
    expand?: boolean;
    maxDepth?: number;
    similarityThreshold?: number;
  } = {},
): Promise<{ results: ExpandedResult[]; cached: boolean }> {
  const userId = options.userId ?? null;
  const limit = options.limit ?? 20;
  const expand = options.expand ?? true;
  const maxDepth = options.maxDepth ?? 3;
  const similarityThreshold = options.similarityThreshold ?? 0.5;
  const fetchLimit = limit * 3;

  // --- Check result cache ---
  const cacheKey = JSON.stringify({ query, userId, ...options });
  const currentLastModifiedResult = await client.execute({
    sql: `SELECT value FROM engrams_meta WHERE key = 'last_modified'`,
    args: [],
  });
  const currentLastModified = currentLastModifiedResult.rows[0] as unknown as { value: string } | undefined;

  const cachedEntry = resultCache.get(cacheKey);
  if (cachedEntry && cachedEntry.lastModified === currentLastModified?.value) {
    return { results: cachedEntry.results, cached: true };
  }

  // 1. FTS5 keyword search -> resolve rowids to memory IDs
  const ftsIds: string[] = [];
  try {
    const ftsResults = await searchFTS(client, query, fetchLimit);
    if (ftsResults.length > 0) {
      const rowids = ftsResults.map((r) => r.rowid);
      const placeholders = rowids.map(() => "?").join(",");
      const rowsResult = await client.execute({
        sql: `SELECT id FROM memories WHERE rowid IN (${placeholders}) AND deleted_at IS NULL${userId ? ' AND user_id = ?' : ''}`,
        args: userId ? [...rowids, userId] : rowids,
      });
      ftsIds.push(...rowsResult.rows.map((r) => r.id as string));
    }
  } catch {
    // FTS5 failure — continue with vector search only
  }

  // 2. Vector similarity search (if libsql vector is available)
  const vecIds: string[] = [];
  let queryEmbedding: Float32Array | null = null;
  try {
    queryEmbedding = await generateEmbedding(query);
    const vecResults = await searchVec(client, queryEmbedding, fetchLimit);
    vecIds.push(...vecResults.map((r) => r.memory_id));
  } catch {
    // Embedding or vector search not available — FTS5 only
  }

  // 3. Reciprocal Rank Fusion
  const scores = new Map<string, number>();

  ftsIds.forEach((id, rank) => {
    scores.set(id, (scores.get(id) ?? 0) + 1 / (RRF_K + rank + 1));
  });

  vecIds.forEach((id, rank) => {
    scores.set(id, (scores.get(id) ?? 0) + 1 / (RRF_K + rank + 1));
  });

  // 4. Apply confidence weighting and recency boost
  for (const [id, rawScore] of scores.entries()) {
    const memResult = await client.execute({
      sql: `SELECT confidence, learned_at FROM memories WHERE id = ? AND deleted_at IS NULL${userId ? ' AND user_id = ?' : ''}`,
      args: userId ? [id, userId] : [id],
    });
    const mem = memResult.rows[0] as unknown as { confidence: number; learned_at: string | null } | undefined;
    if (mem) {
      // Confidence boost: 0.5x (confidence=0) to 1.0x (confidence=1.0)
      const confidenceBoost = 0.5 + (mem.confidence as number) * 0.5;
      // Recency boost: 1.1x (today) to 1.0x (30+ days)
      const recency = recencyBoost(mem.learned_at as string | null);
      scores.set(id, rawScore * confidenceBoost * recency);
    }
  }

  // 5. Sort by RRF score with stable tie-breaking, fetch full memories
  const rankedIds = [...scores.keys()];
  rankedIds.sort((a, b) => {
    const scoreDiff = scores.get(b)! - scores.get(a)!;
    if (Math.abs(scoreDiff) > 1e-10) return scoreDiff;
    return a.localeCompare(b); // Deterministic tie-break
  });

  const topIds = rankedIds.slice(0, limit);
  if (topIds.length === 0) {
    return { results: [], cached: false };
  }

  const placeholders = topIds.map(() => "?").join(",");
  let sql = `SELECT * FROM memories WHERE id IN (${placeholders}) AND deleted_at IS NULL`;
  const params: unknown[] = [...topIds];

  if (userId) {
    sql += ` AND user_id = ?`;
    params.push(userId);
  }

  if (options.domain) {
    sql += ` AND domain = ?`;
    params.push(options.domain);
  }
  if (options.entityType) {
    sql += ` AND entity_type = ?`;
    params.push(options.entityType);
  }
  if (options.entityName) {
    sql += ` AND entity_name = ? COLLATE NOCASE`;
    params.push(options.entityName);
  }
  if (options.minConfidence !== undefined) {
    sql += ` AND confidence >= ?`;
    params.push(options.minConfidence);
  }

  const rowsResult = await client.execute({
    sql,
    args: params as Array<string | number | null>,
  });
  const rows = rowsResult.rows as unknown as Record<string, unknown>[];

  // Preserve RRF ranking order
  const rowMap = new Map(rows.map((r) => [r.id as string, r]));
  const searchResults: SearchResult[] = topIds
    .filter((id) => rowMap.has(id))
    .map((id) => ({
      id,
      score: scores.get(id)!,
      memory: rowMap.get(id)!,
    }));

  // 6. Graph expansion
  let expandedResults: ExpandedResult[];
  if (expand) {
    expandedResults = await expandConnections(client, searchResults, queryEmbedding, maxDepth, similarityThreshold, userId);
  } else {
    expandedResults = searchResults.map((r) => ({ ...r, connected: [] }));
  }

  // 7. Store in result cache
  if (currentLastModified) {
    resultCache.set(cacheKey, { results: expandedResults, lastModified: currentLastModified.value });
  }

  return { results: expandedResults, cached: false };
}

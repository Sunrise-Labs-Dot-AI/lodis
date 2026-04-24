import type { Client } from "@libsql/client";
import { searchFTS } from "./fts.js";
import { searchVec } from "./vec.js";
import { generateEmbedding } from "./embeddings.js";
import { extractSignalTerms, type QueryExtractionMode } from "./query-extraction.js";

/**
 * Narrower projection of QueryExtractionResult for public return shape.
 * Deliberately OMITS `effectiveQuery` (the extracted short form) to prevent
 * PII from the user's query from ending up in caller-side logs that stringify
 * the whole return (e.g. `console.log(await hybridSearch(...))`). Per
 * code-review Saboteur-7 on PR #84. Internal callsites that need
 * effectiveQuery (e.g. cache key) compute it locally.
 */
export interface HybridSearchExtractionSummary {
  mode: QueryExtractionMode;
  originalTokens: number;
}

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

async function getEmbeddingDistance(
  client: Client,
  memoryId: string,
  queryEmbedding: Float32Array,
): Promise<number | null> {
  const result = await client.execute({
    sql: `SELECT vector_distance_cos(embedding, vector(?)) as distance FROM memories WHERE id = ? AND embedding IS NOT NULL`,
    args: [JSON.stringify(Array.from(queryEmbedding)), memoryId],
  });
  if (result.rows.length === 0 || result.rows[0].distance == null) return null;
  return result.rows[0].distance as number;
}

function recencyBoost(learnedAt: string | null): number {
  if (!learnedAt) return 1.0;
  const ageMs = Date.now() - new Date(learnedAt).getTime();
  const ageDays = ageMs / (1000 * 60 * 60 * 24);
  // Decay from 1.1 (today) to 1.0 (30+ days old)
  return 1.0 + Math.max(0, 0.1 * (1 - ageDays / 30));
}

/**
 * Utility-based ranking boost from agent feedback.
 * Gated behind LODIS_UTILITY_RANKING=1.
 *
 * Formula: 1 + 0.08*ln(referenced+1) - 0.05*ln(noise+1), clamped to [0.7, 1.5].
 *
 * Noise penalty only applies when noise_count >= 3 AND noise spans >= 2 distinct
 * retrievals — one bad session should not demote a memory. The distinct-retrieval
 * count is looked up on-demand via context_retrievals.noise_memory_ids_json.
 */
export async function utilityBoost(
  client: Client,
  memoryId: string,
  referencedCount: number,
  noiseCount: number,
): Promise<number> {
  let boost = 1 + 0.08 * Math.log(referencedCount + 1);

  if (noiseCount >= 3) {
    // Count distinct retrievals that flagged this memory as noise
    const r = await client.execute({
      sql: `SELECT COUNT(*) as c FROM context_retrievals
            WHERE noise_memory_ids_json IS NOT NULL
              AND noise_memory_ids_json LIKE ?`,
      args: [`%"${memoryId}"%`],
    });
    const distinctRetrievals = ((r.rows[0] as unknown as { c: number } | undefined)?.c) ?? 0;
    if (distinctRetrievals >= 2) {
      boost -= 0.05 * Math.log(noiseCount + 1);
    }
  }

  return Math.max(0.7, Math.min(1.5, boost));
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

        // Check semantic similarity to query via SQL distance function
        const distance = await getEmbeddingDistance(client, conn.id, queryEmbedding);
        if (distance == null) continue;

        const similarity = 1 - distance;
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
): Promise<{ results: ExpandedResult[]; cached: boolean; extraction: HybridSearchExtractionSummary }> {
  const userId = options.userId ?? null;
  const limit = options.limit ?? 20;
  const expand = options.expand ?? true;
  const maxDepth = options.maxDepth ?? 3;
  const similarityThreshold = options.similarityThreshold ?? 0.5;
  const fetchLimit = limit * 3;

  // --- Query preprocessing ---
  // Long natural-language questions (e.g. MRCR needle questions) flood FTS5
  // with common tokens and dilute the vector embedding. When enabled, extract
  // signal terms for retrieval but keep the ORIGINAL query for the caller
  // (e.g. context-packing passes original to the reranker, which benefits
  // from full question context). Env-gated (opt-in in v1). See query-extraction.ts.
  const extraction = extractSignalTerms(query);
  const effectiveQuery = extraction.effectiveQuery;
  // Narrow projection for public return — hides effectiveQuery so callers
  // can't accidentally log the rewritten query (PII risk, Saboteur-7).
  const extractionSummary: HybridSearchExtractionSummary = {
    mode: extraction.mode,
    originalTokens: extraction.originalTokens,
  };

  // --- Check result cache ---
  // Cache key includes BOTH effectiveQuery AND original query to avoid
  // collisions: two distinct long queries that collapse to the same short
  // form must NOT share a cache slot (would serve one query's results for
  // another).
  //
  // Keys are built in a FIXED, EXPLICIT order (no `...options` spread) so two
  // callers passing `{limit: 10, domain: "work"}` vs `{domain: "work", limit: 10}`
  // produce the SAME serialized key. Object-literal spread preserves caller
  // order, which differs across refactors — a silent cache-bloat risk that
  // spreads into stale hits at scale (Saboteur-3 on PR #84).
  const cacheKey = JSON.stringify({
    originalQuery: query,
    effectiveQuery,
    userId: userId ?? null,
    domain: options.domain ?? null,
    entityType: options.entityType ?? null,
    entityName: options.entityName ?? null,
    minConfidence: options.minConfidence ?? null,
    limit,
    expand,
    maxDepth,
    similarityThreshold,
  });
  const currentLastModifiedResult = await client.execute({
    sql: `SELECT value FROM lodis_meta WHERE key = 'last_modified'`,
    args: [],
  });
  const currentLastModified = currentLastModifiedResult.rows[0] as unknown as { value: string } | undefined;

  const cachedEntry = resultCache.get(cacheKey);
  if (cachedEntry && cachedEntry.lastModified === currentLastModified?.value) {
    return { results: cachedEntry.results, cached: true, extraction: extractionSummary };
  }

  // 1. FTS5 keyword search -> resolve rowids to memory IDs.
  // Pass the FULL original query, not the extraction-short-form. Rationale:
  //   - BM25 (via FTS5) self-weights low-IDF tokens toward zero, so keeping
  //     stopwords doesn't dilute the signal — they just don't contribute.
  //     Classical IR has been comfortable with bag-of-words verbose queries
  //     since TREC; modern benchmarks reproduce the effect.
  //   - Dense search below gets `effectiveQuery` for the OPPOSITE reason:
  //     bi-encoder embeddings (all-MiniLM-L6-v2, 384d) average across tokens,
  //     so extraneous words literally pull the vector toward the corpus
  //     centroid. Measured on MRCR: an 80-word needle question put the
  //     relevant memories at hybrid ranks 18/35/188; the short form
  //     "Marin Tiburon Redwood" put them at 1/2/5.
  //   - The split is the cheap fix. See handoff-retrieval-research-2026-04-24.md
  //     §Split-Query-Treatment for the referenced literature.
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
    queryEmbedding = await generateEmbedding(effectiveQuery);
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

  // 4. Apply confidence weighting, recency boost, and optional utility boost
  const utilityRankingEnabled = process.env.LODIS_UTILITY_RANKING === "1";
  for (const [id, rawScore] of scores.entries()) {
    const memResult = await client.execute({
      sql: `SELECT confidence, learned_at, referenced_count, noise_count FROM memories WHERE id = ? AND deleted_at IS NULL${userId ? ' AND user_id = ?' : ''}`,
      args: userId ? [id, userId] : [id],
    });
    const mem = memResult.rows[0] as unknown as {
      confidence: number;
      learned_at: string | null;
      referenced_count: number;
      noise_count: number;
    } | undefined;
    if (mem) {
      const confidenceBoost = 0.5 + (mem.confidence as number) * 0.5;
      const recency = recencyBoost(mem.learned_at as string | null);
      let finalScore = rawScore * confidenceBoost * recency;
      if (utilityRankingEnabled) {
        const uBoost = await utilityBoost(
          client,
          id,
          mem.referenced_count ?? 0,
          mem.noise_count ?? 0,
        );
        finalScore *= uBoost;
      }
      scores.set(id, finalScore);
    }
  }

  // 5. Sort by RRF score with stable tie-breaking, fetch full memories
  const rankedIds = [...scores.keys()];
  rankedIds.sort((a, b) => {
    const scoreDiff = scores.get(b)! - scores.get(a)!;
    if (Math.abs(scoreDiff) > 1e-10) return scoreDiff;
    return a.localeCompare(b); // Deterministic tie-break
  });

  // When filters are present, fetch more candidates so post-filter results
  // aren't starved by higher-ranked results from other domains/types
  const hasFilters = !!(options.domain || options.entityType || options.entityName || options.minConfidence !== undefined);
  const candidateLimit = hasFilters ? rankedIds.length : limit;
  const topIds = rankedIds.slice(0, candidateLimit);
  if (topIds.length === 0) {
    return { results: [], cached: false, extraction: extractionSummary };
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

  // Preserve RRF ranking order, then trim to requested limit after filtering
  const rowMap = new Map(rows.map((r) => [r.id as string, r]));
  const searchResults: SearchResult[] = topIds
    .filter((id) => rowMap.has(id))
    .slice(0, limit)
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

  return { results: expandedResults, cached: false, extraction: extractionSummary };
}

import { resolve } from "path";
import { homedir } from "os";
import type { Client } from "@libsql/client";
import { insertEmbedding } from "./vec.js";

export const EMBEDDING_DIM = 384;

const MODEL_ID = "Xenova/all-MiniLM-L6-v2";

// -----------------------------------------------------------------------------
// W1a: contextual embedding enrichment (retrieval-wave-1 plan)
// -----------------------------------------------------------------------------
// The legacy embed text is `content + (detail ? " " + detail : "")`. For many
// memories the content is a bare fact ("Magda Meeting Notes — Nov 2025 ...")
// without the metadata tokens that disambiguate what the memory is ABOUT.
// Pre-flight A/B (scripts/w1a-prefix-shape-ab.mjs + w1a-vec-side-ab.mjs) showed
// prepending `[entity_name] [entity_type] [domain] [tags]` to the embed text
// moves both (a) cross-encoder reranker scores and (b) vec cosine similarity
// toward the query on the 3 MRCR ceiling-miss cases (n4 nanny, n5 Engrams
// infra, n7 Magda). Net positive: median +0.30 rerank Δ, +0.022 cosine Δ.
// The "bracketed" form is deliberately structural rather than natural-prose —
// easier for the caller to reason about; works with both FTS5 tokenization
// and bi-encoder pooling since each bracketed chunk is word-boundary-clean.

/**
 * Extract tag strings from a memory's structured_data column.
 * Canonical home is DocumentIndexData (entity_type="resource" via memory_index);
 * other entity types return [] harmlessly since their structured_data schemas
 * don't include a `tags` field. Sanitizes log-injection characters and caps
 * at 16 tags to bound the prefix length.
 */
export function extractTags(
  sd: string | Record<string, unknown> | null | undefined,
): string[] {
  if (!sd) return [];
  let obj: unknown;
  if (typeof sd === "string") {
    try { obj = JSON.parse(sd); } catch { return []; }
  } else {
    obj = sd;
  }
  if (!obj || typeof obj !== "object") return [];
  const tags = (obj as Record<string, unknown>).tags;
  if (!Array.isArray(tags)) return [];
  return tags
    .filter((t): t is string => typeof t === "string")
    .map((t) => t.replace(/[\r\n\x1b\[\]{}]/g, "").trim())
    .filter((t) => t.length > 0)
    .slice(0, 16);
}

/** Fields used by buildEmbedText. Matches the relevant subset of the memories
 *  schema; callers can pass either a full row or a projection. */
export interface EmbedTextInput {
  content: string;
  detail: string | null;
  entity_name?: string | null;
  entity_type?: string | null;
  domain?: string | null;
  structured_data?: string | Record<string, unknown> | null;
}

/**
 * Build the text fed to the embedder when the v1-bracketed shape is enabled.
 * Prepends available metadata in brackets before the legacy content+detail.
 * See module comment above for the rationale. Sanitizes bracket-breaking
 * characters in entity_name so a malformed name can't break the token
 * boundary of the prefix.
 */
export function buildEmbedText(memory: EmbedTextInput): string {
  const parts: string[] = [];
  const sanitize = (s: string) => s.replace(/[\r\n\x1b\[\]{}]/g, "").trim();
  if (memory.entity_name) parts.push(`[${sanitize(memory.entity_name)}]`);
  if (memory.entity_type) parts.push(`[${memory.entity_type}]`);
  if (memory.domain) parts.push(`[${memory.domain}]`);
  const tags = extractTags(memory.structured_data);
  if (tags.length > 0) parts.push(`[${tags.join(", ")}]`);
  parts.push(memory.content);
  if (memory.detail) parts.push(memory.detail);
  return parts.join(" ");
}

/** Legacy embed text — `content + (detail ? " " + detail : "")`. Kept as a
 *  named helper so both the runtime write path and the migration script
 *  produce byte-identical text for the "legacy" shape target. */
export function legacyEmbedText(memory: EmbedTextInput): string {
  return memory.content + (memory.detail ? " " + memory.detail : "");
}

/**
 * Resolve whether the v1-bracketed shape is active for a runtime write.
 * DISABLED wins over ENABLED (matches reranker env pattern). Default off
 * in v1; flip after bench-scope validation per the retrieval-wave-1 plan.
 */
export function contextualEmbeddingsEnabled(): boolean {
  if (process.env.LODIS_CONTEXTUAL_EMBEDDINGS_DISABLED === "1") return false;
  return process.env.LODIS_CONTEXTUAL_EMBEDDINGS_ENABLED === "1";
}

/** Canonical shape labels stored in memories.embedding_shape. */
export type EmbeddingShape = "legacy" | "v1-bracketed";

/** The current shape for runtime writes, per env. */
export function currentEmbeddingShape(): EmbeddingShape {
  return contextualEmbeddingsEnabled() ? "v1-bracketed" : "legacy";
}

/** Given a shape + memory, produce the text to feed to generateEmbedding. */
export function embedTextForShape(shape: EmbeddingShape, memory: EmbedTextInput): string {
  return shape === "v1-bracketed" ? buildEmbedText(memory) : legacyEmbedText(memory);
}


// Use dynamic import + type assertion to avoid TS2590 (union too complex) from @huggingface/transformers
type Embedder = (text: string, options: { pooling: string; normalize: boolean }) => Promise<{ data: ArrayLike<number> }>;
let embedder: Embedder | null = null;

export async function getEmbedder(): Promise<Embedder> {
  if (!embedder) {
    const { pipeline } = await import("@huggingface/transformers");
    const cacheDir = resolve(homedir(), ".lodis", "models");
    const model = await (pipeline as Function)("feature-extraction", MODEL_ID, {
      cache_dir: cacheDir,
      dtype: "q8",
    });
    embedder = model as Embedder;
  }
  return embedder;
}

// --- LRU Embedding Cache ---
const CACHE_MAX = 100;
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

interface CacheEntry {
  embedding: Float32Array;
  timestamp: number;
}

const embeddingCache = new Map<string, CacheEntry>();

export async function generateEmbedding(text: string): Promise<Float32Array> {
  // Check cache
  const cached = embeddingCache.get(text);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
    return cached.embedding;
  }

  const model = await getEmbedder();
  const output = await model(text, { pooling: "mean", normalize: true });
  const embedding = new Float32Array(output.data as Float64Array);

  // Store in cache, evict oldest if full
  if (embeddingCache.size >= CACHE_MAX) {
    const oldestKey = embeddingCache.keys().next().value;
    if (oldestKey) embeddingCache.delete(oldestKey);
  }
  embeddingCache.set(text, { embedding, timestamp: Date.now() });

  return embedding;
}

export async function generateEmbeddings(texts: string[]): Promise<Float32Array[]> {
  const model = await getEmbedder();
  const results: Float32Array[] = [];
  for (let i = 0; i < texts.length; i += 32) {
    const batch = texts.slice(i, i + 32);
    for (const text of batch) {
      const output = await model(text, { pooling: "mean", normalize: true });
      results.push(new Float32Array(output.data as Float64Array));
    }
  }
  return results;
}

export async function backfillEmbeddings(client: Client): Promise<number> {
  // Only fills rows with NULL embeddings (e.g. post-import before vec was set
  // up). Does NOT re-embed existing rows — use regenerateEmbeddings for that.
  // Uses the currently-enabled shape (legacy by default; v1-bracketed when
  // LODIS_CONTEXTUAL_EMBEDDINGS_ENABLED=1).
  const shape = currentEmbeddingShape();
  const result = await client.execute({
    sql: `SELECT id, content, detail, domain, entity_name, entity_type, structured_data
          FROM memories
          WHERE deleted_at IS NULL AND embedding IS NULL`,
    args: [],
  });

  const missing = result.rows as unknown as Array<EmbedTextInput & { id: string }>;

  let count = 0;
  for (const mem of missing) {
    try {
      const text = embedTextForShape(shape, mem);
      const embedding = await generateEmbedding(text);
      await insertEmbedding(client, mem.id, embedding);
      await client.execute({
        sql: `UPDATE memories SET embedding_shape = ? WHERE id = ?`,
        args: [shape, mem.id],
      });
      count++;
    } catch {
      // Per-memory failure is non-fatal — continue backfilling
    }
  }

  return count;
}

export interface RegenerateEmbeddingsOptions {
  /** Target shape for the new embeddings. "v1-bracketed" enables W1a; "legacy" is the rollback path. */
  shape: EmbeddingShape;
  /** Restrict to specific memory IDs. Mutually exclusive with `domain` and `all`. */
  ids?: string[];
  /** Restrict to a specific domain. Mutually exclusive with `ids`. */
  domain?: string;
  /** Restrict to a specific userId (Clerk user_id). Omit for local-mode (NULL user_id). */
  userId?: string | null;
  /** Skip rows already at target shape. Defaults to true. Set to false to force-regenerate. */
  skipAlreadyShape?: boolean;
  /** Batch size per SELECT page. Default 500. Pagination uses `ORDER BY id LIMIT ... OFFSET ...`
   *  which is stable under concurrent inserts (new row IDs go wherever they go in the hex-sorted
   *  order, not shifting earlier pages). */
  batchSize?: number;
  /** Progress callback fired after each memory is processed (success or fail). */
  onProgress?: (done: number, total: number, currentId: string, status: "ok" | "skipped" | "failed") => void;
}

export interface RegenerateEmbeddingsResult {
  processed: number;
  skipped: number;
  failed: number;
  errors: Array<{ id: string; error: string }>;
  /** The shape requested — echoed back for caller convenience. */
  shape: EmbeddingShape;
}

/**
 * Re-generate embeddings for existing memories using the specified embed-text
 * shape. This is the W1a migration entry point AND the rollback entry point:
 * call with `shape: "v1-bracketed"` to migrate forward, `shape: "legacy"` to
 * revert.
 *
 * Not exposed as an MCP tool by design — the migration script calls this
 * directly via core, avoiding both the `memory_list` pagination question and
 * the write-amplification DoS surface that an `all: true` MCP tool would
 * create.
 *
 * Filter semantics: `ids` | `domain` | (neither → all rows for userId).
 * Always scoped by `deleted_at IS NULL` and the supplied `userId`.
 *
 * Per-row:
 *   1. Check embedding_shape; skip if already matches target (unless skipAlreadyShape=false).
 *   2. Compute text via embedTextForShape(shape, row).
 *   3. generateEmbedding(text) — hits the LRU cache if text is byte-identical.
 *   4. insertEmbedding(client, id, embedding) — upsert into vec table.
 *   5. UPDATE memories SET embedding_shape = <shape> WHERE id = <id>.
 *
 * Failures are per-row and non-fatal; aggregate counts + error list returned.
 */
export async function regenerateEmbeddings(
  client: Client,
  opts: RegenerateEmbeddingsOptions,
): Promise<RegenerateEmbeddingsResult> {
  const batchSize = Math.max(1, opts.batchSize ?? 500);
  const skipAlreadyShape = opts.skipAlreadyShape ?? true;
  const userId = opts.userId === undefined ? null : opts.userId;

  // Build the WHERE clause once. Scoped by userId if supplied (or explicitly NULL
  // for local mode). If ids supplied, match those specifically.
  const whereClauses: string[] = [`deleted_at IS NULL`];
  const whereArgs: Array<string | null> = [];
  if (userId === null) {
    whereClauses.push(`user_id IS NULL`);
  } else {
    whereClauses.push(`user_id = ?`);
    whereArgs.push(userId);
  }
  if (opts.domain) {
    whereClauses.push(`domain = ?`);
    whereArgs.push(opts.domain);
  }
  if (opts.ids && opts.ids.length > 0) {
    const placeholders = opts.ids.map(() => "?").join(",");
    whereClauses.push(`id IN (${placeholders})`);
    whereArgs.push(...opts.ids);
  }
  const whereSql = whereClauses.join(" AND ");

  // Count total for progress reporting.
  const totalResult = await client.execute({
    sql: `SELECT COUNT(*) AS c FROM memories WHERE ${whereSql}`,
    args: whereArgs,
  });
  const total = Number((totalResult.rows[0] as unknown as { c: number }).c);

  const errors: Array<{ id: string; error: string }> = [];
  let processed = 0;
  let skipped = 0;
  let failed = 0;
  let done = 0;

  // Paginate by (id ASC, LIMIT, OFFSET). Hex IDs are insertion-order-independent,
  // so OFFSET is stable even under concurrent writes.
  for (let offset = 0; ; offset += batchSize) {
    const page = await client.execute({
      sql: `SELECT id, content, detail, domain, entity_name, entity_type, structured_data, embedding_shape
            FROM memories
            WHERE ${whereSql}
            ORDER BY id ASC
            LIMIT ? OFFSET ?`,
      args: [...whereArgs, batchSize, offset],
    });
    const rows = page.rows as unknown as Array<
      EmbedTextInput & { id: string; embedding_shape: string | null }
    >;
    if (rows.length === 0) break;

    for (const row of rows) {
      try {
        if (skipAlreadyShape && row.embedding_shape === opts.shape) {
          skipped++;
          opts.onProgress?.(++done, total, row.id, "skipped");
          continue;
        }
        const text = embedTextForShape(opts.shape, row);
        const embedding = await generateEmbedding(text);
        await insertEmbedding(client, row.id, embedding);
        await client.execute({
          sql: `UPDATE memories SET embedding_shape = ? WHERE id = ?`,
          args: [opts.shape, row.id],
        });
        processed++;
        opts.onProgress?.(++done, total, row.id, "ok");
      } catch (err) {
        failed++;
        errors.push({
          id: row.id,
          error: err instanceof Error ? err.message : String(err),
        });
        opts.onProgress?.(++done, total, row.id, "failed");
      }
    }

    // Short-circuit: if page came back smaller than batchSize, we're done.
    if (rows.length < batchSize) break;
  }

  return { processed, skipped, failed, errors, shape: opts.shape };
}

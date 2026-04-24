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
    .map((t) => t.replace(/[\x00-\x1f\x7f\u2028\u2029\[\]{}]/g, "").trim())
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
  // Strip: all C0 controls (\x00-\x1f), DEL (\x7f), Unicode line/paragraph
  // separators, and brackets/braces. Per Saboteur-9 / Security-2 on PR #86:
  // the earlier regex missed null bytes (which corrupt some tokenizers/log
  // parsers) and control chars that can break downstream text handling.
  const sanitize = (s: string) => s.replace(/[\x00-\x1f\x7f\u2028\u2029\[\]{}]/g, "").trim();
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
  /** Batch size per SELECT page. Default 500. Pagination is **keyset-based**
   *  (`WHERE id > ? ORDER BY id ASC LIMIT ?`) — stable under concurrent inserts.
   *  Per Saboteur-4 on PR #86: OFFSET pagination was unsafe because new row IDs
   *  (random hex) can slot in before the current offset, shifting all later
   *  rows down by one — so the next page would skip a row. Keyset fixes this. */
  batchSize?: number;
  /** Progress callback fired after each memory is processed (success or fail). */
  onProgress?: (done: number, total: number, currentId: string, status: "ok" | "skipped" | "failed") => void;
  /** Abort the run when a single batch's failure rate exceeds this ratio (of
   *  non-skipped attempts). Default 0.1 (10%). Set to 1 to disable the gate.
   *  Per Saboteur-5 on PR #86: the old post-loop gate could let a systemic
   *  failure (embedder OOM, Modal outage, corrupted vec table) burn through
   *  an entire corpus before exit. Per-batch gating catches it early. */
  failureRateThreshold?: number;
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
 *      NULL embedding_shape is treated as "legacy" for this check (per Saboteur-1).
 *   2. Compute text via embedTextForShape(shape, row).
 *   3. generateEmbedding(text) — hits the LRU cache if text is byte-identical.
 *   4. insertEmbedding(client, id, embedding) — upsert into vec table.
 *   5. UPDATE memories SET embedding_shape = <shape> WHERE id = <id>.
 *
 * Failures are per-row and non-fatal; aggregate counts + error list returned.
 * If a single batch's failure rate exceeds `failureRateThreshold` (default
 * 10%) after ≥20 attempts, the run aborts early with an `<batch-abort>`
 * entry in `errors`. This prevents a systemic issue (embedder OOM, DB dead)
 * from burning through the entire corpus before exit.
 *
 * **Does NOT write `memory_events` rows.** Migration audit is deliberately
 * external — the caller script archives IDs + status + error messages to a
 * mode-0600 local JSON file. Reasons: (a) re-embedding is non-semantic — no
 * user-visible content changes; (b) at scale (~2k rows per migration) the
 * events table would get N synchronous writes doubling the migration wall
 * time. If in-DB audit becomes necessary, add a separate `embedding_events`
 * table rather than polluting `memory_events` with non-content changes.
 */
export async function regenerateEmbeddings(
  client: Client,
  opts: RegenerateEmbeddingsOptions,
): Promise<RegenerateEmbeddingsResult> {
  const batchSize = Math.max(1, opts.batchSize ?? 500);
  const skipAlreadyShape = opts.skipAlreadyShape ?? true;
  const userId = opts.userId === undefined ? null : opts.userId;
  const failureRateThreshold = opts.failureRateThreshold ?? 0.1;

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
  let aborted = false;

  // Keyset pagination: `WHERE id > ? ORDER BY id ASC LIMIT ?`. Stable under
  // concurrent inserts — new rows may slot in at random hex positions, but
  // they don't shift the cursor we hold. Per Saboteur-4 on PR #86.
  let cursor: string | null = null;
  while (!aborted) {
    const pageWhere = cursor === null ? whereSql : `${whereSql} AND id > ?`;
    const pageArgs: Array<string | null | number> = cursor === null
      ? [...whereArgs, batchSize]
      : [...whereArgs, cursor, batchSize];
    const page = await client.execute({
      sql: `SELECT id, content, detail, domain, entity_name, entity_type, structured_data, embedding_shape
            FROM memories
            WHERE ${pageWhere}
            ORDER BY id ASC
            LIMIT ?`,
      args: pageArgs as Array<string | number | null>,
    });
    const rows = page.rows as unknown as Array<
      EmbedTextInput & { id: string; embedding_shape: string | null }
    >;
    if (rows.length === 0) break;

    // Per-batch failure tracking for the abort gate.
    let batchProcessed = 0;
    let batchFailed = 0;

    for (const row of rows) {
      try {
        // NULL embedding_shape = legacy by convention (pre-W1a column default).
        // Normalize for the skip comparison so a rollback to "legacy" correctly
        // treats NULL rows as already-at-target — otherwise rollback would
        // re-process every pre-W1a row needlessly AND overwrite the NULL
        // sentinel (destroying the "never migrated" discriminator). Per
        // Saboteur-1 on PR #86.
        const effectiveRowShape: EmbeddingShape = row.embedding_shape === null || row.embedding_shape === undefined
          ? "legacy"
          : (row.embedding_shape as EmbeddingShape);
        if (skipAlreadyShape && effectiveRowShape === opts.shape) {
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
        batchProcessed++;
        opts.onProgress?.(++done, total, row.id, "ok");
      } catch (err) {
        failed++;
        batchFailed++;
        errors.push({
          id: row.id,
          error: err instanceof Error ? err.message : String(err),
        });
        opts.onProgress?.(++done, total, row.id, "failed");
      }
    }

    // Advance the cursor to the last row's id regardless of success — if a
    // row fails we don't retry it in this run; it stays NULL/old-shape and
    // gets picked up by the next invocation's skip-check.
    cursor = rows[rows.length - 1].id;

    // Per-batch failure gate. Runs AFTER the batch so per-row errors are
    // recorded and the operator's archive file reflects actual damage, but
    // BEFORE the next batch so we don't burn through the whole corpus on
    // a systemic failure (embedder OOM, DB connection dead, etc.).
    // Only gate when we have enough signal — 20 attempted rows minimum.
    const batchAttempted = batchProcessed + batchFailed;
    if (batchAttempted >= 20 && batchFailed / batchAttempted > failureRateThreshold) {
      aborted = true;
      errors.push({
        id: `<batch-abort>`,
        error: `Per-batch failure rate ${(batchFailed / batchAttempted * 100).toFixed(1)}% exceeded threshold ${(failureRateThreshold * 100).toFixed(1)}%. Aborting after ${done}/${total} rows processed.`,
      });
      break;
    }

    if (rows.length < batchSize) break;
  }

  return { processed, skipped, failed, errors, shape: opts.shape };
}

import type { Client, InStatement } from "@libsql/client";
import { randomBytes } from "crypto";
import { generateEmbeddings, embedTextForShape, currentEmbeddingShape, type EmbeddingShape } from "./embeddings.js";
import { searchVec } from "./vec.js";
import { getInitialConfidence, parseTTL } from "./confidence.js";
import { detectSensitiveData } from "./pii.js";
import { bumpLastModified } from "./db.js";
import type { SourceType, EntityType } from "./types.js";

const VALID_ENTITY_TYPES: EntityType[] = [
  "person",
  "organization",
  "place",
  "project",
  "preference",
  "event",
  "goal",
  "fact",
  "lesson",
  "routine",
  "skill",
  "resource",
  "decision",
  "snippet",
];

export interface BulkEntry {
  content: string;
  detail?: string;
  domain?: string;
  sourceType?: SourceType;
  sourceDescription?: string;
  entityType?: EntityType;
  entityName?: string;
  structuredData?: Record<string, unknown>;
  permanence?: "canonical" | "active" | "ephemeral";
  ttl?: string;
}

export interface BulkInsertOptions {
  sourceAgentId: string;
  sourceAgentName: string;
  userId?: string | null;
  skipDedup?: boolean;
  dedupThreshold?: number;
  batchSize?: number;
  vecAvailable: boolean;
  onProgress?: (done: number, total: number) => void;
}

export type BulkStatus = "written" | "failed" | "skipped";

export interface BulkResultEntry {
  index: number;
  status: BulkStatus;
  id?: string;
  entityName?: string;
  error?: string;
  reason?: string;
}

export interface BulkInsertResult {
  written: number;
  failed: number;
  skipped: number;
  results: BulkResultEntry[];
  durationMs: number;
}

interface PreparedEntry {
  index: number;
  id: string;
  content: string;
  detail: string | null;
  domain: string;
  sourceType: SourceType;
  sourceDescription: string | null;
  confidence: number;
  learnedAt: string;
  hasPiiFlag: number;
  entityType: EntityType | null;
  entityName: string | null;
  structuredData: string | null;
  permanence: string | null;
  expiresAt: string | null;
  embeddingText: string;
  embedding: Float32Array | null;
}

function generateId(): string {
  return randomBytes(16).toString("hex");
}

function nowIso(): string {
  return new Date().toISOString();
}

/**
 * Bulk insert memories without the interactive dedup flow used by memory_write.
 * Designed for imports from canonical external sources (contacts, exports) where
 * the caller has already deduped against its own source.
 *
 * - Embeddings are generated in one pass via generateEmbeddings().
 * - Inserts are chunked into libsql client.batch() transactions so a failure in
 *   one chunk does not corrupt others.
 * - When skipDedup=false, each entry's embedding is vec-searched and entries
 *   scoring >= dedupThreshold against an existing memory are marked "skipped".
 * - Permission checks are the caller's responsibility.
 */
export async function bulkInsertMemories(
  client: Client,
  entries: BulkEntry[],
  opts: BulkInsertOptions,
): Promise<BulkInsertResult> {
  const start = Date.now();
  const skipDedup = opts.skipDedup ?? true;
  const dedupThreshold = opts.dedupThreshold ?? 0.7;
  const batchSize = Math.max(1, opts.batchSize ?? 100);
  const userId = opts.userId ?? null;

  // Resolve the embed shape ONCE for this entire call. Per Saboteur-2 on
  // PR #86: calling currentEmbeddingShape() separately in the prep loop and
  // the INSERT loop allows the env flag to flip mid-run (multi-process envs
  // or dynamic-config reloads) — the embed text would be built under shape A
  // but the row's embedding_shape column would record shape B, producing a
  // shape-vector mismatch that the migration script would skip silently.
  const shape: EmbeddingShape = currentEmbeddingShape();

  const results: BulkResultEntry[] = [];
  const prepared: PreparedEntry[] = [];

  // --- 1. Validate + normalize ---
  for (let i = 0; i < entries.length; i++) {
    const e = entries[i];
    try {
      if (!e.content || typeof e.content !== "string" || e.content.trim().length === 0) {
        results.push({ index: i, status: "failed", error: "content is required" });
        continue;
      }
      if (e.entityType && !VALID_ENTITY_TYPES.includes(e.entityType)) {
        results.push({ index: i, status: "failed", error: `invalid entity_type: "${e.entityType}"` });
        continue;
      }

      const sourceType: SourceType = e.sourceType ?? "observed";
      const detail = e.detail ?? null;
      // Embed text uses the call-level shape snapshot. PII detection runs on
      // the raw content+detail so metadata brackets don't false-positive.
      // See embeddings.ts W1a module comment.
      const rawText = e.content + (detail ? " " + detail : "");
      const embeddingText = embedTextForShape(shape, {
        content: e.content,
        detail,
        entity_name: e.entityName ?? null,
        entity_type: e.entityType ?? null,
        domain: e.domain ?? "general",
        structured_data: e.structuredData ?? null,
      });
      const hasPii = detectSensitiveData(rawText).length > 0 ? 1 : 0;

      let permanence: string | null = e.permanence ?? null;
      let expiresAt: string | null = null;
      if (e.ttl) {
        expiresAt = parseTTL(e.ttl);
        if (!permanence) permanence = "ephemeral";
      }

      prepared.push({
        index: i,
        id: generateId(),
        content: e.content,
        detail,
        domain: e.domain ?? "general",
        sourceType,
        sourceDescription: e.sourceDescription ?? null,
        confidence: getInitialConfidence(sourceType),
        learnedAt: nowIso(),
        hasPiiFlag: hasPii,
        entityType: e.entityType ?? null,
        entityName: e.entityName ?? null,
        structuredData: e.structuredData ? JSON.stringify(e.structuredData) : null,
        permanence,
        expiresAt,
        embeddingText,
        embedding: null,
      });
    } catch (err) {
      results.push({
        index: i,
        status: "failed",
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  // --- 2. Embeddings (one pass) ---
  if (opts.vecAvailable && prepared.length > 0) {
    try {
      const embeddings = await generateEmbeddings(prepared.map((p) => p.embeddingText));
      for (let i = 0; i < prepared.length; i++) {
        prepared[i].embedding = embeddings[i] ?? null;
      }
    } catch {
      // Non-fatal — rows still insert without embeddings
    }
  }

  // --- 3. Optional dedup (vec-only) ---
  let toInsert = prepared;
  if (!skipDedup && opts.vecAvailable) {
    toInsert = [];
    for (const p of prepared) {
      if (!p.embedding) {
        toInsert.push(p);
        continue;
      }
      try {
        const matches = await searchVec(client, p.embedding, 1);
        const top = matches[0];
        if (top && 1 - top.distance >= dedupThreshold) {
          results.push({
            index: p.index,
            status: "skipped",
            reason: "similar_found",
            entityName: p.entityName ?? undefined,
          });
          continue;
        }
      } catch {
        // vec search failure is non-fatal; fall through to insert
      }
      toInsert.push(p);
    }
  }

  // --- 4. Chunked transactional inserts ---
  const total = toInsert.length;
  let done = 0;
  for (let start = 0; start < toInsert.length; start += batchSize) {
    const chunk = toInsert.slice(start, start + batchSize);
    const stmts: InStatement[] = [];

    // `shape` resolved once at top of bulkInsertMemories (see comment there).
    for (const p of chunk) {
      stmts.push({
        sql: `INSERT INTO memories (
          id, content, detail, domain,
          source_agent_id, source_agent_name,
          source_type, source_description,
          confidence, learned_at, has_pii_flag,
          entity_type, entity_name, structured_data,
          permanence, expires_at, user_id, embedding_shape
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        args: [
          p.id,
          p.content,
          p.detail,
          p.domain,
          opts.sourceAgentId,
          opts.sourceAgentName,
          p.sourceType,
          p.sourceDescription,
          p.confidence,
          p.learnedAt,
          p.hasPiiFlag,
          p.entityType,
          p.entityName,
          p.structuredData,
          p.permanence,
          p.expiresAt,
          userId,
          shape,
        ],
      });

      if (p.embedding) {
        stmts.push({
          sql: `UPDATE memories SET embedding = vector(?) WHERE id = ?`,
          args: [JSON.stringify(Array.from(p.embedding)), p.id],
        });
      }

      stmts.push({
        sql: `INSERT INTO memory_events (
          id, memory_id, event_type, agent_id, agent_name, new_value, user_id, timestamp
        ) VALUES (?, ?, 'created', ?, ?, ?, ?, ?)`,
        args: [
          generateId(),
          p.id,
          opts.sourceAgentId,
          opts.sourceAgentName,
          JSON.stringify({ content: p.content, domain: p.domain }),
          userId,
          p.learnedAt,
        ],
      });
    }

    try {
      await client.batch(stmts, "write");
      for (const p of chunk) {
        results.push({
          index: p.index,
          status: "written",
          id: p.id,
          entityName: p.entityName ?? undefined,
        });
      }
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      for (const p of chunk) {
        results.push({
          index: p.index,
          status: "failed",
          error: `chunk transaction failed: ${errMsg}`,
        });
      }
    }

    done += chunk.length;
    opts.onProgress?.(done, total);
  }

  // --- 5. Finalize ---
  if (results.some((r) => r.status === "written")) {
    try {
      await bumpLastModified(client);
    } catch {
      // non-fatal
    }
  }

  results.sort((a, b) => a.index - b.index);

  const written = results.filter((r) => r.status === "written").length;
  const failed = results.filter((r) => r.status === "failed").length;
  const skipped = results.filter((r) => r.status === "skipped").length;

  return {
    written,
    failed,
    skipped,
    results,
    durationMs: Date.now() - start,
  };
}

// ---------------------------------------------------------------------------
// Bulk remove (soft-delete)
// ---------------------------------------------------------------------------

export interface BulkRemoveFilter {
  domain?: string;
  entityName?: string;
  ids?: string[];
}

export interface BulkRemoveResolvedTarget {
  id: string;
  domain: string;
}

export interface BulkRemoveTargets {
  targets: BulkRemoveResolvedTarget[];
  byDomain: Record<string, number>;
  sampleIds: string[];
}

export interface BulkRemoveOptions {
  sourceAgentId?: string | null;
  sourceAgentName?: string | null;
  userId?: string | null;
  reason?: string | null;
  batchSize?: number;
}

export type BulkRemoveStatus = "removed" | "failed";

export interface BulkRemoveResultEntry {
  id: string;
  status: BulkRemoveStatus;
  error?: string;
}

export interface BulkRemoveResult {
  removed: number;
  failed: number;
  results: BulkRemoveResultEntry[];
  byDomain: Record<string, number>;
  durationMs: number;
}

const ID_SHAPE_RE = /^[0-9a-f]{32}$/i;

function sanitizeReason(reason: string | null | undefined): string | null {
  if (!reason) return null;
  return reason.replace(/[\r\n\x00-\x1f\x7f]/g, " ").slice(0, 500);
}

/**
 * Resolve the set of memories that match a bulk-remove filter — without
 * touching them. Read-only. Used by the MCP wrapper to (1) cheap-check the
 * scope before any mutation, (2) get the per-domain breakdown so it can
 * permission-check each unique domain, and (3) power the dryRun response.
 *
 * The query always scopes by `user_id` and excludes already soft-deleted
 * rows (`deleted_at IS NULL`). At least one of `domain` / `entityName` /
 * `ids` must be present — empty filters throw to defeat accidental match-all.
 *
 * `maxToScan` caps the SELECT at `maxToScan + 1` rows. The +1 row signals
 * overflow without forcing the caller to count separately. The MCP wrapper
 * uses this to refuse runaway scopes (default 10K).
 */
export async function resolveBulkRemoveTargets(
  client: Client,
  filter: BulkRemoveFilter,
  opts: { userId?: string | null; maxToScan?: number } = {},
): Promise<BulkRemoveTargets & { overflowed: boolean }> {
  const userId = opts.userId ?? null;
  const maxToScan = Math.max(1, opts.maxToScan ?? 10_000);

  const hasDomain = typeof filter.domain === "string" && filter.domain.length > 0;
  const hasEntityName = typeof filter.entityName === "string" && filter.entityName.length > 0;
  const hasIds = Array.isArray(filter.ids) && filter.ids.length > 0;

  if (!hasDomain && !hasEntityName && !hasIds) {
    throw new Error(
      "bulkRemoveMemories: filter requires at least one of `domain`, `entityName`, or `ids`. Refusing to match all memories.",
    );
  }

  if (hasIds) {
    const ids = filter.ids!;
    if (ids.length > 5000) {
      throw new Error(`bulkRemoveMemories: ids[] is capped at 5000 (got ${ids.length}).`);
    }
    for (const id of ids) {
      if (typeof id !== "string" || !ID_SHAPE_RE.test(id)) {
        throw new Error(`bulkRemoveMemories: ids[] must contain 32-char hex strings (got ${JSON.stringify(id)}).`);
      }
    }
  }

  const where: string[] = ["deleted_at IS NULL"];
  const args: (string | number | null)[] = [];

  if (userId) {
    where.push("user_id = ?");
    args.push(userId);
  }
  if (hasDomain) {
    where.push("domain = ?");
    args.push(filter.domain!);
  }
  if (hasEntityName) {
    where.push("LOWER(entity_name) = LOWER(?)");
    args.push(filter.entityName!);
  }
  if (hasIds) {
    const placeholders = filter.ids!.map(() => "?").join(",");
    where.push(`id IN (${placeholders})`);
    for (const id of filter.ids!) args.push(id);
  }

  // +1 to detect overflow without a second COUNT query.
  args.push(maxToScan + 1);

  const sql = `SELECT id, domain FROM memories WHERE ${where.join(" AND ")} LIMIT ?`;
  const rows = (await client.execute({ sql, args })).rows as unknown as { id: string; domain: string }[];

  const overflowed = rows.length > maxToScan;
  const targets: BulkRemoveResolvedTarget[] = (overflowed ? rows.slice(0, maxToScan) : rows).map((r) => ({
    id: r.id,
    domain: r.domain,
  }));

  const byDomain: Record<string, number> = {};
  for (const t of targets) {
    byDomain[t.domain] = (byDomain[t.domain] ?? 0) + 1;
  }

  return {
    targets,
    byDomain,
    sampleIds: targets.slice(0, 10).map((t) => t.id),
    overflowed,
  };
}

/**
 * Soft-delete a list of pre-resolved memory IDs in chunked transactions.
 *
 * Mirrors the per-row semantics of single-row `memory_remove`:
 *  - Sets `deleted_at = now()` on the row
 *  - Inserts a `memory_events` row with `event_type='removed'` and the reason
 *  - User-scopes both writes via `user_id`
 *  - Bumps `lodis_meta.last_modified` once at the end (cache invalidation)
 *
 * Per-chunk transactions via `client.batch(stmts, "write")` — a chunk failure
 * isolates to that chunk; other chunks still commit. Failed-chunk ids land in
 * `results[]` with `status='failed'` and the error message.
 *
 * Permission checks are the caller's responsibility — by the time we get the
 * id list, the caller has already gated each unique domain via checkPermission.
 *
 * The caller passes pre-resolved ids (from `resolveBulkRemoveTargets`) so this
 * function never matches-all and never silently expands scope. Empty ids[] is
 * a no-op (returns zero counts).
 */
export async function bulkRemoveMemories(
  client: Client,
  targets: BulkRemoveResolvedTarget[],
  opts: BulkRemoveOptions = {},
): Promise<BulkRemoveResult> {
  const start = Date.now();
  const userId = opts.userId ?? null;
  const batchSize = Math.max(1, Math.min(500, opts.batchSize ?? 100));
  const reason = sanitizeReason(opts.reason);
  const sourceAgentId = opts.sourceAgentId ?? null;
  const sourceAgentName = opts.sourceAgentName ?? null;

  const results: BulkRemoveResultEntry[] = [];
  const byDomain: Record<string, number> = {};

  if (targets.length === 0) {
    return { removed: 0, failed: 0, results, byDomain, durationMs: Date.now() - start };
  }

  const newValue = JSON.stringify({ reason });

  for (let off = 0; off < targets.length; off += batchSize) {
    const chunk = targets.slice(off, off + batchSize);
    const timestamp = nowIso();
    const stmts: InStatement[] = [];

    const idPlaceholders = chunk.map(() => "?").join(",");
    // userId comparison uses IFNULL so NULL == NULL matches; same shape as
    // domains.ts so multi-tenant + single-tenant tests both work.
    stmts.push({
      sql: `UPDATE memories SET deleted_at = ?
            WHERE id IN (${idPlaceholders})
              AND deleted_at IS NULL
              AND IFNULL(user_id, '') = IFNULL(?, '')`,
      args: [timestamp, ...chunk.map((c) => c.id), userId],
    });

    for (const c of chunk) {
      stmts.push({
        sql: `INSERT INTO memory_events (
          id, memory_id, event_type, agent_id, agent_name, new_value, user_id, timestamp
        ) VALUES (?, ?, 'removed', ?, ?, ?, ?, ?)`,
        args: [generateId(), c.id, sourceAgentId, sourceAgentName, newValue, userId, timestamp],
      });
    }

    try {
      await client.batch(stmts, "write");
      for (const c of chunk) {
        results.push({ id: c.id, status: "removed" });
        byDomain[c.domain] = (byDomain[c.domain] ?? 0) + 1;
      }
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      for (const c of chunk) {
        results.push({ id: c.id, status: "failed", error: `chunk transaction failed: ${errMsg}` });
      }
    }
  }

  const removed = results.filter((r) => r.status === "removed").length;
  const failed = results.filter((r) => r.status === "failed").length;

  if (removed > 0) {
    try {
      await bumpLastModified(client);
    } catch {
      // non-fatal
    }
  }

  return { removed, failed, results, byDomain, durationMs: Date.now() - start };
}

import type { Client, InStatement } from "@libsql/client";
import { randomBytes } from "crypto";
import { generateEmbeddings } from "./embeddings.js";
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
      const embeddingText = e.content + (detail ? " " + detail : "");
      const hasPii = detectSensitiveData(embeddingText).length > 0 ? 1 : 0;

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

    for (const p of chunk) {
      stmts.push({
        sql: `INSERT INTO memories (
          id, content, detail, domain,
          source_agent_id, source_agent_name,
          source_type, source_description,
          confidence, learned_at, has_pii_flag,
          entity_type, entity_name, structured_data,
          permanence, expires_at, user_id
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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

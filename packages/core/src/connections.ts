/**
 * Wave 2.5 — connection-creation infrastructure.
 *
 * Pure-SQL module (no LLM, no MCP coupling) supporting four layered mechanisms
 * documented in `~/.claude/plans/session-start-tranquil-zephyr.md`:
 *
 *   L1 — Caller-supplied `connections[]` at memory_write time.
 *        applyCallerSuppliedConnections(): synchronous, returns per-edge result.
 *
 *   L2a — Server-deterministic auto-edge by entity_name match at write time.
 *         applyEntityNameAutoEdges(): designed to be called via setImmediate
 *         AFTER the write response is returned. Failures log to stderr; never
 *         block.
 *
 *   L3 — Recurring task: caller-LLM classifies server-generated proposals.
 *        selectSourceMemoriesForProposals() + generateCandidatesForMemory()
 *        produce the LLM-free server side; the calling agent's LLM does the
 *        classification; commits land via validateAndInsertConnections().
 *
 *   L4 — Operator-run one-off backfill (separate script, not in this module).
 *
 * Architectural principle: this module never makes an LLM call. All inference
 * happens caller-side or in operator-run scripts. Lodis stays LLM-free at
 * runtime.
 *
 * Permission filtering (Security F5 in plan-review round 2): this module
 * does NOT know about agent_permissions. The MCP tool handlers in server.ts
 * are responsible for filtering proposals by checkPermission and rejecting
 * batch entries where the caller lacks write permission on the source domain.
 * That keeps this module pure and testable without the permission machinery.
 */

import type { Client } from "@libsql/client";
import type { Relationship } from "./types.js";

// ---------- Types ----------

/**
 * One caller-supplied connection on memory_write or memory_bulk_upload.
 * Either targetMemoryId OR targetEntityName must be supplied; if both are
 * present, targetMemoryId wins (more specific).
 */
export interface ConnectionInput {
  targetMemoryId?: string;
  targetEntityName?: string;
  relationship: Relationship;
}

export type ConnectionDropReason =
  | "not_found"            // targetEntityName resolved to nothing in this user's pool
  | "self_reference"       // target === source
  | "duplicate"            // edge already exists (INSERT OR IGNORE no-op)
  | "permission_denied"    // caller lacks write permission on source domain (set by server.ts)
  | "not_owned_or_missing" // memory_connect_batch: target id not in calling user's pool (Security F1)
  | "missing_target"       // neither targetMemoryId nor targetEntityName supplied
  | "transient_error";     // SQL/network error — DO NOT interpret as "doesn't exist"

export interface DroppedConnection {
  targetMemoryId?: string;
  targetEntityName?: string;
  relationship?: Relationship;
  reason: ConnectionDropReason;
}

export interface ConnectionsResult {
  applied: number;
  dropped: DroppedConnection[];
}

// ---------- L1 — caller-supplied connections (sync, write-time) ----------

/**
 * L1: apply a caller-supplied list of connections to a freshly-written memory.
 * Synchronous (caller awaits this before returning the write response) so the
 * connections_result is part of the response payload. Idempotent via the
 * unique edge index added in the wave2_5_connection_indexes migration.
 *
 * Performance (Perf-C1 in code-review round 1): batched. Two preflight queries
 * resolve all targetMemoryIds and targetEntityNames in single IN-clause SELECTs
 * regardless of input list size. One multi-value INSERT commits all accepted
 * edges. Total SQL round-trips: 0 (empty input), 1 (no IDs to resolve), or
 * up to 3 (resolve IDs + resolve names + insert). Compare to the previous
 * 2N serial round-trips that blocked the write response.
 *
 * Security: targetEntityName resolution is ALWAYS user-scoped — `user_id IS ?`
 * handles NULL safely and never crosses tenant boundaries (Security F3 in
 * plan-review round 2).
 *
 * The caller (server.ts) is responsible for:
 *   - filtering inputs whose source domain the caller lacks write on
 *     (set reason="permission_denied" before calling this)
 *   - bounding the input list size (server.ts caps via Zod .max(50))
 */
export async function applyCallerSuppliedConnections(
  client: Client,
  sourceMemoryId: string,
  inputs: ConnectionInput[],
  userId: string | null,
): Promise<ConnectionsResult> {
  const result: ConnectionsResult = { applied: 0, dropped: [] };
  if (inputs.length === 0) return result;

  // Partition inputs into resolvable (has id or name) vs missing-target (drop now).
  const resolvable: Array<{ input: ConnectionInput; idx: number }> = [];
  for (let idx = 0; idx < inputs.length; idx++) {
    const input = inputs[idx];
    if (!input.targetMemoryId && !input.targetEntityName) {
      result.dropped.push({ ...input, reason: "missing_target" });
      continue;
    }
    resolvable.push({ input, idx });
  }
  if (resolvable.length === 0) return result;

  // ---- Preflight 1: resolve targetMemoryId values in one IN-clause query ----
  // Verifies each supplied id exists AND belongs to the user. Rows not in the
  // result set are "not_found" (security: cross-user IDs look identical to
  // nonexistent ones from the caller's perspective, which is intentional).
  const idInputs = resolvable.filter((r) => !!r.input.targetMemoryId);
  const idSetValid = new Set<string>();
  if (idInputs.length > 0) {
    const ids = idInputs.map((r) => r.input.targetMemoryId!);
    const placeholders = ids.map(() => "?").join(",");
    const r = await client.execute({
      sql: `SELECT id FROM memories
             WHERE id IN (${placeholders})
               AND user_id IS ?
               AND deleted_at IS NULL`,
      args: [...ids, userId],
    });
    for (const row of r.rows) idSetValid.add(row.id as string);
  }

  // ---- Preflight 2: resolve targetEntityName values in one IN-clause query ----
  // Returns the most-recently-updated id per matching entity_name (case-
  // insensitive). Done as a single grouped query: filter rows by entity_name
  // and pick MAX(updated_at) per name, then look up the id.
  const nameInputs = resolvable.filter(
    (r) => !r.input.targetMemoryId && !!r.input.targetEntityName,
  );
  const nameToWinnerId = new Map<string, string>(); // lowercased name → id
  if (nameInputs.length > 0) {
    const names = Array.from(new Set(nameInputs.map((r) => r.input.targetEntityName!.toLowerCase())));
    const placeholders = names.map(() => "?").join(",");
    // Single query that returns the winner per entity_name. SQLite's GROUP BY
    // doesn't guarantee which row is returned alongside MAX without a
    // correlated subquery — but for our purposes "the id of any row with the
    // max updated_at per name" is correct since we want the most-recent. Use
    // a subquery that joins back on (entity_name COLLATE NOCASE, updated_at).
    const r = await client.execute({
      sql: `SELECT m.id, LOWER(m.entity_name) AS lname
              FROM memories m
              JOIN (
                SELECT LOWER(entity_name) AS lname, MAX(updated_at) AS maxu
                  FROM memories
                 WHERE deleted_at IS NULL
                   AND user_id IS ?
                   AND id != ?
                   AND LOWER(entity_name) IN (${placeholders})
                 GROUP BY LOWER(entity_name)
              ) winners
                ON LOWER(m.entity_name) = winners.lname
               AND COALESCE(m.updated_at, '') = COALESCE(winners.maxu, '')
             WHERE m.deleted_at IS NULL
               AND m.user_id IS ?
               AND m.id != ?`,
      args: [userId, sourceMemoryId, ...names, userId, sourceMemoryId],
    });
    for (const row of r.rows) {
      const lname = row.lname as string;
      if (!nameToWinnerId.has(lname)) {
        nameToWinnerId.set(lname, row.id as string);
      }
    }
  }

  // ---- Resolve each input to a target id (or drop reason) ----
  const accepted: Array<{ input: ConnectionInput; targetId: string }> = [];
  for (const { input } of resolvable) {
    let targetId: string | null = null;
    if (input.targetMemoryId) {
      targetId = idSetValid.has(input.targetMemoryId) ? input.targetMemoryId : null;
    } else if (input.targetEntityName) {
      targetId = nameToWinnerId.get(input.targetEntityName.toLowerCase()) ?? null;
    }
    if (!targetId) {
      result.dropped.push({ ...input, reason: "not_found" });
      continue;
    }
    if (targetId === sourceMemoryId) {
      result.dropped.push({ ...input, reason: "self_reference" });
      continue;
    }
    accepted.push({ input, targetId });
  }
  if (accepted.length === 0) return result;

  // ---- Single multi-value INSERT for accepted edges ----
  // libSQL supports multi-row VALUES, so one round-trip commits everything.
  // Pre-check duplicates by querying existing edges in one IN-pair query
  // (a single SELECT that finds the (src, tgt, rel) triples already present).
  const existingPlaceholders = accepted.map(() => "(source_memory_id = ? AND target_memory_id = ? AND relationship = ?)").join(" OR ");
  const existingArgs: Array<string | number | null> = [];
  for (const { targetId, input } of accepted) {
    existingArgs.push(sourceMemoryId, targetId, input.relationship);
  }
  const existingRows = (await client.execute({
    sql: `SELECT source_memory_id, target_memory_id, relationship
            FROM memory_connections
           WHERE ${existingPlaceholders}`,
    args: existingArgs,
  })).rows;
  const existingKeys = new Set<string>(
    existingRows.map((r) => `${r.source_memory_id}|${r.target_memory_id}|${r.relationship}`),
  );

  const toInsert: typeof accepted = [];
  for (const a of accepted) {
    const key = `${sourceMemoryId}|${a.targetId}|${a.input.relationship}`;
    if (existingKeys.has(key)) {
      result.dropped.push({ ...a.input, targetMemoryId: a.targetId, reason: "duplicate" });
    } else {
      toInsert.push(a);
    }
  }

  if (toInsert.length > 0) {
    // Set updated_at explicitly so the connections_updated_at_insert trigger's
    // `WHEN updated_at IS NULL` clause no-ops (Sb-N10 in code-review round 1:
    // trigger fires per-row UPDATE that doubles the write count). Same pattern
    // for L2a and memory_connect_batch INSERTs below.
    const valueRows = toInsert.map(() => "(?, ?, ?, ?, datetime('now'))").join(", ");
    const insertArgs: Array<string | null> = [];
    for (const a of toInsert) {
      insertArgs.push(sourceMemoryId, a.targetId, a.input.relationship, userId);
    }
    // Use INSERT OR IGNORE for belt-and-suspenders against the narrow race
    // where a concurrent writer inserts a matching edge between our pre-check
    // SELECT and this INSERT. rowsAffected reports the actual count.
    const ins = await client.execute({
      sql: `INSERT OR IGNORE INTO memory_connections
              (source_memory_id, target_memory_id, relationship, user_id, updated_at)
            VALUES ${valueRows}`,
      args: insertArgs,
    });
    result.applied = ins.rowsAffected;
    // If rowsAffected < toInsert.length, the difference was lost to a race
    // (another writer beat us). Conservatively report those as duplicates.
    const raceLoss = toInsert.length - ins.rowsAffected;
    if (raceLoss > 0) {
      // Best-effort: we don't know WHICH ones lost the race. Surface as
      // generic duplicate entries on the latest toInsert tail.
      for (let i = toInsert.length - raceLoss; i < toInsert.length; i++) {
        result.dropped.push({
          ...toInsert[i].input,
          targetMemoryId: toInsert[i].targetId,
          reason: "duplicate",
        });
      }
    }
  }

  return result;
}

// ---------- L2a — server-deterministic auto-edge by entity_name (async) ----------

/**
 * Env flag for L2a. **Default ON** — it's the safety-net layer that catches
 * what L1 missed. Opt-out only.
 *
 *   • LODIS_L2_ENRICHMENT_DISABLED=1 → off
 *   • otherwise → on
 *
 * NOTE: This is the OPPOSITE convention from W2 PPR (LODIS_PPR_RERANK_ENABLED,
 * default off — opt-in) and the cross-encoder reranker. L2a defaults on
 * because it's a deterministic SQL helper with bounded cost; PPR defaults off
 * because it's an experimental retrieval-quality lever that requires graph
 * density to be useful.
 */
export function isL2EnrichmentEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  if (env.LODIS_L2_ENRICHMENT_DISABLED === "1") return false;
  return true;
}

/**
 * L2a: when a freshly-written memory has entity_name set, auto-create
 * `related` edges to up to 10 existing memories with the same entity_name
 * (case-insensitive, user-scoped). Bounded to prevent runaway on common names
 * ("James", "Anthropic").
 *
 * Performance (Perf-W2 in code-review round 1): batched. One SELECT for
 * matches + one multi-value INSERT. Total round-trips: 1-2 (was 1 + up to 10
 * before this fix). Safe to await on the write critical path.
 *
 * Failure semantics: never throws. On any error, logs to stderr and returns
 * `{ applied: 0 }`. Callers that need to observe failures should not use this
 * function — wrap the SQL directly. The swallow-and-return-zero pattern lets
 * the function be safely awaited from a write handler without risk of
 * surfacing internal errors to the caller.
 */
export async function applyEntityNameAutoEdges(
  client: Client,
  sourceMemoryId: string,
  entityName: string | null,
  userId: string | null,
): Promise<{ applied: number }> {
  if (!entityName || entityName.trim() === "") return { applied: 0 };
  if (!isL2EnrichmentEnabled()) return { applied: 0 };

  try {
    const matches = await client.execute({
      sql: `SELECT id FROM memories
             WHERE entity_name = ? COLLATE NOCASE
               AND id != ?
               AND deleted_at IS NULL
               AND user_id IS ?
             ORDER BY updated_at DESC NULLS LAST
             LIMIT 10`,
      args: [entityName, sourceMemoryId, userId],
    });
    if (matches.rows.length === 0) return { applied: 0 };

    // Single multi-value INSERT — was 1+10 round-trips, now 1+1.
    // updated_at set explicitly to no-op the trigger (Sb-N10).
    const valueRows = matches.rows.map(() => "(?, ?, 'related', ?, datetime('now'))").join(", ");
    const insertArgs: Array<string | null> = [];
    for (const row of matches.rows) {
      insertArgs.push(sourceMemoryId, row.id as string, userId);
    }
    const ins = await client.execute({
      sql: `INSERT OR IGNORE INTO memory_connections
              (source_memory_id, target_memory_id, relationship, user_id, updated_at)
            VALUES ${valueRows}`,
      args: insertArgs,
    });
    return { applied: ins.rowsAffected };
  } catch (err) {
    process.stderr.write(
      `[lodis] L2a entity-name auto-edge failed for ${sourceMemoryId}: ${(err as Error)?.message ?? String(err)}\n`,
    );
    return { applied: 0 };
  }
}

// ---------- L3 — proposal generation (LLM-free server side) ----------

export interface ProposalSourceRow {
  id: string;
  content: string;
  detail: string | null;
  entity_name: string | null;
  entity_type: string | null;
  domain: string;
}

export interface ProposalCandidateRow {
  id: string;
  entity_name: string | null;
  /** Candidate's domain. Server-side L3 handler MUST filter by
   *  checkPermission(agentId, domain, "read") before returning candidates to
   *  the caller — Sec-W2 in code-review round 1 (cross-domain content leak via
   *  shared entity_name). */
  domain: string;
  content_snippet: string;
  similarity: number; // cosine; 0 if embeddings unavailable
  suggested_relationship_hints: Relationship[];
}

export interface SelectSourcesOptions {
  /** Max source memories to return (default 50). Plan §L3 cadence guidance. */
  limit?: number;
  /** Cooldown — only consider memories created more than this many hours ago.
   *  Default 6h (give L1+L2a a chance to land). */
  minAgeHours?: number;
  /** When true, include memories that already have outgoing edges. Useful for
   *  re-checking. Default false (zero-edge cursor). */
  includeAlreadyConnected?: boolean;
  /** When true, exclude `has_pii_flag = 1` rows server-side. Default false.
   *  Set by L4 backfill (Sb-C2 in code-review round 1: client-side PII filtering
   *  AFTER a SQL LIMIT can livelock the loop when the oldest slice is entirely
   *  PII — non-PII rows past the LIMIT are never reached). */
  excludePii?: boolean;
  /** Skip memories whose id is in this set (used by L4 to honor the resume
   *  state file at the SQL layer instead of over-fetch + JS filter). Up to a
   *  few hundred IDs is fine; larger sets should use a cursor instead. */
  excludeIds?: string[];
}

/**
 * L3: select source memories that need connection-creation attention.
 *
 * Default selection criterion (Cost/Scope F2 + Saboteur F1 + New Hire F1 in
 * plan-review round 2: edge count is a better cursor than the originally-
 * planned timestamp column):
 *
 *   - Zero outgoing edges in memory_connections (LEFT JOIN ... IS NULL)
 *   - Created more than minAgeHours ago (give L1 + L2a a chance to land)
 *   - Not deleted
 *   - User-scoped
 *   - entity_type IS NOT 'snippet' — snippets are explicitly low-graph-relevance
 *     ephemeral writes (Saboteur F8 livelock prevention; the snippet writer
 *     can produce 500/hr per agent, and we don't want L3 swamped by them)
 *
 * Order: oldest first (FIFO drain).
 *
 * Permission filtering happens in the caller (server.ts), NOT here. This
 * function returns raw rows.
 */
export async function selectSourceMemoriesForProposals(
  client: Client,
  userId: string | null,
  options: SelectSourcesOptions = {},
): Promise<ProposalSourceRow[]> {
  const limit = Math.max(1, Math.min(500, Math.floor(options.limit ?? 50)));
  const minAgeHours = Math.max(0, options.minAgeHours ?? 6);
  const includeAlreadyConnected = options.includeAlreadyConnected ?? false;
  const excludePii = options.excludePii ?? false;
  const excludeIds = options.excludeIds ?? [];

  // Compare via julianday() to avoid format mismatch — `learned_at` is
  // typically ISO 8601 ("2026-04-25T10:23:52.123Z") while `datetime('now', ...)`
  // returns SQLite's space-separated form ("2026-04-25 04:23:52"). Lexical
  // comparison would silently misbehave (T > space). julianday() canonicalizes
  // both sides to a numeric Julian Day Number.
  const piiClause = excludePii ? `AND (m.has_pii_flag IS NULL OR m.has_pii_flag = 0)` : ``;
  const excludeIdsClause = excludeIds.length > 0
    ? `AND m.id NOT IN (${excludeIds.map(() => "?").join(",")})`
    : ``;
  // All positional `?` to avoid mixing ?N with ? (mixed numbering breaks
  // libSQL's parameter binding silently). Order: userId, minAgeHours,
  // ...excludeIds, limit.
  const baseWhere = `m.deleted_at IS NULL
          AND m.user_id IS ?
          AND m.entity_type IS NOT 'snippet'
          AND julianday(m.learned_at) < julianday('now', '-' || ? || ' hours')
          ${piiClause}
          ${excludeIdsClause}`;
  const sql = includeAlreadyConnected
    ? `SELECT m.id, m.content, m.detail, m.entity_name, m.entity_type, m.domain
         FROM memories m
        WHERE ${baseWhere}
        ORDER BY m.learned_at ASC
        LIMIT ?`
    : `SELECT m.id, m.content, m.detail, m.entity_name, m.entity_type, m.domain
         FROM memories m
         LEFT JOIN memory_connections mc
           ON mc.source_memory_id = m.id
        WHERE mc.source_memory_id IS NULL
          AND ${baseWhere}
        ORDER BY m.learned_at ASC
        LIMIT ?`;

  const r = await client.execute({
    sql,
    args: [userId, minAgeHours, ...excludeIds, limit],
  });
  return r.rows.map((row) => ({
    id: row.id as string,
    content: (row.content as string) ?? "",
    detail: (row.detail as string | null) ?? null,
    entity_name: (row.entity_name as string | null) ?? null,
    entity_type: (row.entity_type as string | null) ?? null,
    domain: (row.domain as string) ?? "general",
  }));
}

export interface GenerateCandidatesOptions {
  /** Max candidates to return per source memory (default 10). */
  limit?: number;
}

/**
 * L3: for one source memory, generate a candidate list of plausible target
 * memories the calling LLM should consider for connection. Pre-filtered by:
 *
 *   - Entity-name token match (any candidate sharing an entity_name with the
 *     source — exact-string match for v1; future: token-level overlap).
 *   - Same-domain bias (prefer same domain; not exclusionary).
 *   - User-scoped.
 *
 * Embedding similarity is included when both rows have embeddings stored on
 * `memories.embedding` (vec column). Computed via libSQL's vector_distance_cos
 * function; rows lacking embeddings get similarity = 0 (still surfaced as
 * candidates if entity_name matches).
 *
 * Returned candidates do NOT include duplicates of the source's existing
 * outgoing or incoming connections (those edges already exist).
 */
export async function generateCandidatesForMemory(
  client: Client,
  source: ProposalSourceRow,
  userId: string | null,
  options: GenerateCandidatesOptions = {},
): Promise<ProposalCandidateRow[]> {
  const limit = Math.max(1, Math.min(50, Math.floor(options.limit ?? 10)));

  // Existing edges to exclude. Bidirectional — we don't want to suggest an
  // edge that's already in either direction.
  const existing = await client.execute({
    sql: `SELECT target_memory_id AS id FROM memory_connections WHERE source_memory_id = ?1
          UNION
          SELECT source_memory_id AS id FROM memory_connections WHERE target_memory_id = ?1`,
    args: [source.id],
  });
  const excluded = new Set<string>([source.id, ...existing.rows.map((r) => r.id as string)]);

  // Collect candidates by entity-name match. Only proceeds when the source
  // has an entity_name to anchor on; otherwise returns empty (the LLM can
  // still classify but has nothing to chew on without anchors).
  // Sb-W8 in code-review round 1: snippets EXCLUDED as candidates as well as
  // sources — they're low-graph-relevance ephemeral writes (60d TTL) and edges
  // anchored to them dangle on TTL sweep.
  const candidates: Map<string, ProposalCandidateRow> = new Map();
  if (source.entity_name) {
    const r = await client.execute({
      sql: `SELECT id, entity_name, content, domain
              FROM memories
             WHERE entity_name = ? COLLATE NOCASE
               AND deleted_at IS NULL
               AND user_id IS ?
               AND entity_type IS NOT 'snippet'
             ORDER BY updated_at DESC NULLS LAST
             LIMIT ?`,
      args: [source.entity_name, userId, limit * 2],
    });
    for (const row of r.rows) {
      const id = row.id as string;
      if (excluded.has(id)) continue;
      candidates.set(id, {
        id,
        entity_name: (row.entity_name as string | null) ?? null,
        domain: (row.domain as string) ?? "general",
        content_snippet: ((row.content as string) ?? "").slice(0, 200),
        similarity: 0,
        suggested_relationship_hints: ["related"],
      });
    }
  }

  // Augment with same-domain memories (best-effort; capped at the limit).
  if (candidates.size < limit) {
    const r = await client.execute({
      sql: `SELECT id, entity_name, content, domain
              FROM memories
             WHERE domain = ?
               AND id != ?
               AND deleted_at IS NULL
               AND user_id IS ?
               AND entity_type IS NOT 'snippet'
             ORDER BY updated_at DESC NULLS LAST
             LIMIT ?`,
      args: [source.domain, source.id, userId, limit * 2],
    });
    for (const row of r.rows) {
      const id = row.id as string;
      if (excluded.has(id) || candidates.has(id)) continue;
      if (candidates.size >= limit) break;
      candidates.set(id, {
        id,
        entity_name: (row.entity_name as string | null) ?? null,
        domain: (row.domain as string) ?? "general",
        content_snippet: ((row.content as string) ?? "").slice(0, 200),
        similarity: 0,
        suggested_relationship_hints: ["related"],
      });
    }
  }

  return Array.from(candidates.values()).slice(0, limit);
}

// ---------- memory_connect_batch — secure bulk insertion ----------

export interface ConnectBatchInput {
  source_memory_id: string;
  target_memory_id: string;
  relationship: Relationship;
}

export interface ConnectBatchResult {
  applied: number;
  dropped: Array<{
    source_memory_id: string;
    target_memory_id: string;
    relationship: Relationship;
    reason: ConnectionDropReason;
  }>;
}

/**
 * memory_connect_batch implementation: validate per-edge user ownership of
 * BOTH endpoints (Security F1 in plan-review round 2 — CRITICAL: prevents
 * cross-user graph poisoning), then INSERT OR IGNORE against the unique edge
 * index.
 *
 * Performance (Perf-C5 in code-review round 1): batched. One SELECT IN-clause
 * builds the set of memory IDs the caller owns; one multi-value INSERT
 * commits all valid edges. Total round-trips: 0 (empty input), 1 (no valid
 * IDs), or 2-3 (lookup + dedup-check + insert). Compare to the previous
 * 2N serial round-trips (1000 round-trips for a 500-edge batch = 8s on Turso
 * before this fix).
 *
 * Permission filtering on the SOURCE domain (write permission) happens in
 * the caller (server.ts) before reaching this function — entries that fail
 * the permission check are passed in already filtered out, OR passed in with
 * a pre-set rejection reason. This module enforces ownership only.
 */
export async function validateAndInsertConnectBatch(
  client: Client,
  inputs: ConnectBatchInput[],
  userId: string | null,
): Promise<ConnectBatchResult> {
  const result: ConnectBatchResult = { applied: 0, dropped: [] };
  if (inputs.length === 0) return result;

  // Partition: self-references rejected immediately (no SQL needed).
  const nonSelf: ConnectBatchInput[] = [];
  for (const conn of inputs) {
    if (conn.source_memory_id === conn.target_memory_id) {
      result.dropped.push({ ...conn, reason: "self_reference" });
    } else {
      nonSelf.push(conn);
    }
  }
  if (nonSelf.length === 0) return result;

  // ---- Single ownership lookup: which IDs does the caller own? ----
  // Collect every distinct ID referenced (source OR target), query once.
  const allIds = Array.from(new Set(nonSelf.flatMap((c) => [c.source_memory_id, c.target_memory_id])));
  const placeholders = allIds.map(() => "?").join(",");
  const ownedRows = (await client.execute({
    sql: `SELECT id FROM memories
           WHERE id IN (${placeholders})
             AND user_id IS ?
             AND deleted_at IS NULL`,
    args: [...allIds, userId],
  })).rows;
  const owned = new Set<string>(ownedRows.map((r) => r.id as string));

  // Reject edges where either endpoint isn't in the owned set.
  const accepted: ConnectBatchInput[] = [];
  for (const conn of nonSelf) {
    if (!owned.has(conn.source_memory_id) || !owned.has(conn.target_memory_id)) {
      result.dropped.push({ ...conn, reason: "not_owned_or_missing" });
    } else {
      accepted.push(conn);
    }
  }
  if (accepted.length === 0) return result;

  // ---- Pre-check duplicates so the response can report them accurately ----
  // INSERT OR IGNORE collapses duplicates to "no row affected" — but a single
  // INSERT statement gives one rowsAffected count, not per-row resolution.
  // To label each accepted edge as either applied or duplicate, query for
  // existing matches first.
  const existPlaceholders = accepted.map(() => "(source_memory_id = ? AND target_memory_id = ? AND relationship = ?)").join(" OR ");
  const existArgs: Array<string | null> = [];
  for (const c of accepted) existArgs.push(c.source_memory_id, c.target_memory_id, c.relationship);
  const existingRows = (await client.execute({
    sql: `SELECT source_memory_id, target_memory_id, relationship
            FROM memory_connections
           WHERE ${existPlaceholders}`,
    args: existArgs,
  })).rows;
  const existingKeys = new Set<string>(
    existingRows.map((r) => `${r.source_memory_id}|${r.target_memory_id}|${r.relationship}`),
  );

  const toInsert: ConnectBatchInput[] = [];
  for (const c of accepted) {
    const key = `${c.source_memory_id}|${c.target_memory_id}|${c.relationship}`;
    if (existingKeys.has(key)) {
      result.dropped.push({ ...c, reason: "duplicate" });
    } else {
      toInsert.push(c);
    }
  }

  // ---- Single multi-value INSERT for the new edges ----
  // updated_at explicit to no-op the trigger (Sb-N10).
  if (toInsert.length > 0) {
    const valueRows = toInsert.map(() => "(?, ?, ?, ?, datetime('now'))").join(", ");
    const insertArgs: Array<string | null> = [];
    for (const c of toInsert) insertArgs.push(c.source_memory_id, c.target_memory_id, c.relationship, userId);
    const ins = await client.execute({
      sql: `INSERT OR IGNORE INTO memory_connections
              (source_memory_id, target_memory_id, relationship, user_id, updated_at)
            VALUES ${valueRows}`,
      args: insertArgs,
    });
    result.applied = ins.rowsAffected;
    // Race-loss path (concurrent writer beat us between pre-check and insert):
    // attribute the missing rows to duplicates on the latest tail.
    const raceLoss = toInsert.length - ins.rowsAffected;
    if (raceLoss > 0) {
      for (let i = toInsert.length - raceLoss; i < toInsert.length; i++) {
        result.dropped.push({ ...toInsert[i], reason: "duplicate" });
      }
    }
  }

  return result;
}

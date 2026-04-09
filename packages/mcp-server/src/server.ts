import { McpServer, ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { eq, and, isNull, desc, sql, gte } from "drizzle-orm";
import { randomBytes } from "crypto";
import {
  createDatabase,
  searchFTS,
  memories,
  memoryConnections,
  memoryEvents,
  agentPermissions,
  getInitialConfidence,
  applyConfirm,
  applyCorrect,
  applyMistake,
  applyUsed,
  generateEmbedding,
  insertEmbedding,
  searchVec,
  hybridSearch,
  backfillEmbeddings,
  bumpLastModified,
  detectSensitiveData,
  redactSensitiveData,
  extractEntity,
  applyConfidenceDecay,
  deriveKeys,
  loadCredentials,
  sync,
  resolveLLMProvider,
  parseLLMJson,
  validateExtraction,
  loadConfig,
  saveConfig,
} from "@engrams/core";
import type { SourceType, Relationship, EntityType, EncryptionKeys, LLMProvider } from "@engrams/core";

function generateId(): string {
  return randomBytes(16).toString("hex");
}

function now(): string {
  return new Date().toISOString();
}

function textResult(data: unknown) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }],
  };
}

export async function startServer() {
  const server = new McpServer({
    name: "engrams",
    version: "0.1.0",
  });

  const { db, sqlite, vecAvailable } = createDatabase();

  // Throttled confidence decay — runs at most once per hour
  let lastDecayRun = 0;
  const DECAY_THROTTLE_MS = 60 * 60 * 1000;
  function maybeRunDecay() {
    const now = Date.now();
    if (now - lastDecayRun > DECAY_THROTTLE_MS) {
      applyConfidenceDecay(sqlite);
      lastDecayRun = now;
    }
  }

  // Resolve LLM providers — separate tiers for extraction (cheap) vs analysis (capable)
  let extractionProvider: LLMProvider | null = resolveLLMProvider("extraction");
  let analysisProvider: LLMProvider | null = resolveLLMProvider("analysis");

  // Backfill embeddings for existing memories (async, best-effort)
  if (vecAvailable) {
    backfillEmbeddings(sqlite).then((count) => {
      if (count > 0) process.stderr.write(`[engrams] Backfilled embeddings for ${count} memories\n`);
    }).catch(() => {})
  }

  // --- Instructions Resource ---

  server.resource("memory-instructions", "memory://instructions", async (uri) => {
    return {
      contents: [
        {
          uri: uri.href,
          mimeType: "text/plain",
          text: `# Engrams — Memory Guidelines

You have access to Engrams, a persistent memory system shared across all AI tools this user connects. Memories you save here are available in future conversations and across other tools (Claude Code, Cursor, Claude Desktop, etc.).

## When to save a memory
- User states a preference ("I prefer morning meetings", "I use vim keybindings")
- User corrects you or provides factual context about themselves ("I'm a PM, not an engineer", "My team uses pnpm, not npm")
- User shares information useful across future conversations (goals, relationships, routines, project context)
- You observe a consistent pattern in the user's behavior (inferred, lower confidence)
- Another agent shared knowledge relevant to this conversation (cross-agent)

## When NOT to save a memory
- Ephemeral task details ("fix the bug on line 42") — these don't persist across conversations
- Information already in the codebase or git history — read the source of truth instead
- Debugging steps or temporary workarounds
- Anything the user asks you not to remember

## How to use memories
- Search Engrams at the start of conversations when context about the user would help
- Before asking the user a question, check if the answer is already in memory
- When a memory helps you give a better response, use it but don't narrate that you searched
- If you act on a memory and the user confirms it was helpful, call memory_confirm
- If you act on a memory and it was wrong, call memory_flag_mistake
- If the user corrects a memory, call memory_correct with the updated content

## Source types
- "stated": User explicitly told you (highest initial confidence: 0.90)
- "observed": You noticed from the user's actions (0.75)
- "inferred": You deduced from context (0.65)
- "cross-agent": Another agent shared this (0.70)

## Domains
Organize memories by life domain: general, work, health, finance, relationships, daily-life, learning, creative, or any domain that fits. Use consistent domain names.`,
        },
      ],
    };
  });

  // --- Tools ---

  // Similarity threshold for dedup (cosine similarity, 0-1). 0.7 catches near-duplicates
  // and contradictions but won't fire on merely topically related memories.
  const WRITE_SIMILARITY_THRESHOLD = 0.7;

  server.tool(
    "memory_write",
    "Store a new memory. If a similar memory already exists, returns the existing memory and resolution options instead of writing immediately. Call again with 'resolution' and 'existing_memory_id' to resolve. Pass resolution: 'keep_both' to skip dedup check and force a new memory.",
    {
      content: z.string().describe("The memory content"),
      domain: z.string().optional().describe("Life domain (default: general)"),
      detail: z.string().optional().describe("Extended context"),
      sourceAgentId: z.string().describe("Your agent ID"),
      sourceAgentName: z.string().describe("Your agent name"),
      sourceType: z.enum(["stated", "inferred", "observed", "cross-agent"]).describe("How this memory was acquired"),
      sourceDescription: z.string().optional().describe("Description of source"),
      entityType: z.enum(["person", "organization", "place", "project", "preference", "event", "goal", "fact"]).optional().describe("Entity classification. If omitted, auto-classification runs in background."),
      entityName: z.string().optional().describe("Canonical entity name (e.g. 'Sarah Chen', not 'my manager Sarah'). Helps with dedup."),
      structuredData: z.record(z.unknown()).optional().describe("Type-specific structured fields (schema depends on entityType)"),
      force: z.boolean().optional().describe("Deprecated — use resolution: 'keep_both' instead"),
      resolution: z.enum(["update", "correct", "add_detail", "keep_both", "skip"]).optional().describe("How to resolve a similarity match"),
      existingMemoryId: z.string().optional().describe("ID of existing memory to act on (required for update/correct/add_detail)"),
    },
    async (params) => {
      // --- Phase 2: Resolution of a previous similar_found response ---
      if (params.resolution && params.resolution !== "keep_both") {
        if (params.resolution === "skip") {
          return textResult({ status: "skipped", message: "No changes made" });
        }

        if (!params.existingMemoryId) {
          return textResult({ error: "existing_memory_id is required for resolution: " + params.resolution });
        }

        const existing = db
          .select()
          .from(memories)
          .where(and(eq(memories.id, params.existingMemoryId), isNull(memories.deletedAt)))
          .get();

        if (!existing) {
          return textResult({ error: "Existing memory not found or deleted" });
        }

        const timestamp = now();

        if (params.resolution === "update") {
          const newConfidence = Math.min(existing.confidence + 0.02, 0.99);
          db.update(memories)
            .set({
              content: params.content,
              detail: params.detail ?? existing.detail,
              confidence: newConfidence,
            })
            .where(eq(memories.id, params.existingMemoryId))
            .run();

          // Re-embed
          if (vecAvailable) {
            try {
              const detail = params.detail ?? existing.detail;
              const embeddingText = params.content + (detail ? " " + detail : "");
              const embedding = await generateEmbedding(embeddingText);
              insertEmbedding(sqlite, params.existingMemoryId, embedding);
            } catch { /* non-fatal */ }
          }

          db.insert(memoryEvents).values({
            id: generateId(),
            memoryId: params.existingMemoryId,
            eventType: "updated",
            agentId: params.sourceAgentId,
            agentName: params.sourceAgentName,
            oldValue: JSON.stringify({ content: existing.content, detail: existing.detail }),
            newValue: JSON.stringify({ content: params.content, detail: params.detail ?? existing.detail }),
            timestamp,
          }).run();

          bumpLastModified(sqlite);

          return textResult({
            status: "updated",
            id: params.existingMemoryId,
            previousConfidence: existing.confidence,
            newConfidence,
          });
        }

        if (params.resolution === "correct") {
          const newConfidence = Math.min(Math.max(existing.confidence, 0.85), 0.99);
          db.update(memories)
            .set({
              content: params.content,
              detail: params.detail ?? existing.detail,
              confidence: newConfidence,
              correctedCount: existing.correctedCount + 1,
            })
            .where(eq(memories.id, params.existingMemoryId))
            .run();

          // Re-embed
          if (vecAvailable) {
            try {
              const detail = params.detail ?? existing.detail;
              const embeddingText = params.content + (detail ? " " + detail : "");
              const embedding = await generateEmbedding(embeddingText);
              insertEmbedding(sqlite, params.existingMemoryId, embedding);
            } catch { /* non-fatal */ }
          }

          db.insert(memoryEvents).values({
            id: generateId(),
            memoryId: params.existingMemoryId,
            eventType: "corrected",
            agentId: params.sourceAgentId,
            agentName: params.sourceAgentName,
            oldValue: JSON.stringify({ content: existing.content, confidence: existing.confidence }),
            newValue: JSON.stringify({ content: params.content, confidence: newConfidence }),
            timestamp,
          }).run();

          bumpLastModified(sqlite);

          return textResult({
            status: "corrected",
            id: params.existingMemoryId,
            previousConfidence: existing.confidence,
            newConfidence,
            correctedCount: existing.correctedCount + 1,
          });
        }

        if (params.resolution === "add_detail") {
          const separator = existing.detail ? "\n" : "";
          const newDetail = (existing.detail ?? "") + separator + params.content;
          db.update(memories)
            .set({ detail: newDetail })
            .where(eq(memories.id, params.existingMemoryId))
            .run();

          // Re-embed
          if (vecAvailable) {
            try {
              const embeddingText = existing.content + " " + newDetail;
              const embedding = await generateEmbedding(embeddingText);
              insertEmbedding(sqlite, params.existingMemoryId, embedding);
            } catch { /* non-fatal */ }
          }

          db.insert(memoryEvents).values({
            id: generateId(),
            memoryId: params.existingMemoryId,
            eventType: "updated",
            agentId: params.sourceAgentId,
            agentName: params.sourceAgentName,
            oldValue: JSON.stringify({ detail: existing.detail }),
            newValue: JSON.stringify({ detail: newDetail }),
            timestamp,
          }).run();

          bumpLastModified(sqlite);

          return textResult({
            status: "detail_appended",
            id: params.existingMemoryId,
            newDetail,
          });
        }
      }

      // --- Phase 1: Similarity check (unless keep_both or force) ---
      const skipDedup = params.resolution === "keep_both" || params.force;
      let embedding: Float32Array | null = null;

      if (!skipDedup) {
        const embeddingText = params.content + (params.detail ? " " + params.detail : "");

        if (vecAvailable) {
          try {
            embedding = await generateEmbedding(embeddingText);
            const similar = searchVec(sqlite, embedding, 3);
            const closeMatches = similar.filter((s) => (1 - s.distance) >= WRITE_SIMILARITY_THRESHOLD);

            if (closeMatches.length > 0) {
              const matchedMemories = closeMatches
                .map((m) => {
                  const row = sqlite
                    .prepare(`SELECT * FROM memories WHERE id = ? AND deleted_at IS NULL`)
                    .get(m.memory_id) as Record<string, unknown> | undefined;
                  if (!row) return null;
                  return {
                    id: row.id as string,
                    content: row.content as string,
                    detail: row.detail as string | null,
                    confidence: row.confidence as number,
                    similarity: Math.round((1 - m.distance) * 100) / 100,
                  };
                })
                .filter(Boolean);

              if (matchedMemories.length > 0) {
                return textResult({
                  status: "similar_found",
                  proposed: {
                    content: params.content,
                    detail: params.detail ?? null,
                    domain: params.domain ?? "general",
                  },
                  similar: matchedMemories,
                  options: [
                    "update — replace the existing memory's content with the new content",
                    "correct — existing was wrong; update it and boost confidence to min(max(existing, 0.85), 0.99)",
                    "add_detail — append new content to the existing memory's detail field",
                    "keep_both — store as a new memory (not a duplicate)",
                    "skip — existing memory is already accurate, don't write anything",
                  ],
                  message: "Similar memory found. Respond with memory_write again including resolution and existingMemoryId to proceed.",
                });
              }
            }
          } catch {
            // Vector search failed — fall through to insert
          }
        } else {
          // FTS5 fallback dedup
          const dedupResults = searchFTS(sqlite, params.content, 3);
          if (dedupResults.length > 0) {
            const rowids = dedupResults.map((r) => r.rowid);
            const placeholders = rowids.map(() => "?").join(",");
            const existing = sqlite
              .prepare(
                `SELECT * FROM memories WHERE rowid IN (${placeholders}) AND deleted_at IS NULL`,
              )
              .all(...rowids) as Record<string, unknown>[];

            if (existing.length > 0) {
              return textResult({
                status: "similar_found",
                proposed: {
                  content: params.content,
                  detail: params.detail ?? null,
                  domain: params.domain ?? "general",
                },
                similar: existing.map((e) => ({
                  id: e.id as string,
                  content: e.content as string,
                  detail: e.detail as string | null,
                  confidence: e.confidence as number,
                  similarity: null, // FTS5 doesn't provide cosine similarity
                })),
                options: [
                  "update — replace the existing memory's content with the new content",
                  "correct — existing was wrong; update it and boost confidence to min(max(existing, 0.85), 0.99)",
                  "add_detail — append new content to the existing memory's detail field",
                  "keep_both — store as a new memory (not a duplicate)",
                  "skip — existing memory is already accurate, don't write anything",
                ],
                message: "Similar memory found. Respond with memory_write again including resolution and existingMemoryId to proceed.",
              });
            }
          }
        }

        // Entity-aware dedup: check by entity_name + entity_type
        if (params.entityName && params.entityType) {
          const entityMatches = sqlite
            .prepare(
              `SELECT * FROM memories
               WHERE entity_type = ? AND entity_name = ? COLLATE NOCASE
               AND deleted_at IS NULL`,
            )
            .all(params.entityType, params.entityName) as Record<string, unknown>[];

          if (entityMatches.length > 0) {
            return textResult({
              status: "similar_found",
              proposed: {
                content: params.content,
                detail: params.detail ?? null,
                domain: params.domain ?? "general",
              },
              similar: entityMatches.map((e) => ({
                id: e.id as string,
                content: e.content as string,
                detail: e.detail as string | null,
                confidence: e.confidence as number,
                similarity: null,
                entity_match: true,
              })),
              options: [
                "update — replace the existing memory's content with the new content",
                "correct — existing was wrong; update it and boost confidence to min(max(existing, 0.85), 0.99)",
                "add_detail — append new content to the existing memory's detail field",
                "keep_both — store as a new memory (not a duplicate)",
                "skip — existing memory is already accurate, don't write anything",
              ],
              message: `Existing memory found for ${params.entityType} "${params.entityName}". Respond with memory_write again including resolution and existingMemoryId to proceed.`,
            });
          }
        }
      }

      // --- Insert new memory ---
      const VALID_ENTITY_TYPES = ["person", "organization", "place", "project", "preference", "event", "goal", "fact"];
      if (params.entityType && !VALID_ENTITY_TYPES.includes(params.entityType)) {
        return textResult({ error: `Invalid entity_type: "${params.entityType}". Must be one of: ${VALID_ENTITY_TYPES.join(", ")}` });
      }

      const id = generateId();
      const confidence = getInitialConfidence(params.sourceType as SourceType);
      const timestamp = now();

      // PII detection
      const piiText = params.content + (params.detail ? " " + params.detail : "");
      const piiMatches = detectSensitiveData(piiText);
      const hasPii = piiMatches.length > 0;

      db.insert(memories)
        .values({
          id,
          content: params.content,
          detail: params.detail ?? null,
          domain: params.domain ?? "general",
          sourceAgentId: params.sourceAgentId,
          sourceAgentName: params.sourceAgentName,
          sourceType: params.sourceType,
          sourceDescription: params.sourceDescription ?? null,
          confidence,
          learnedAt: timestamp,
          hasPiiFlag: hasPii ? 1 : 0,
          entityType: params.entityType ?? null,
          entityName: params.entityName ?? null,
          structuredData: params.structuredData ? JSON.stringify(params.structuredData) : null,
        })
        .run();

      // Store embedding (reuse from dedup or generate fresh)
      if (vecAvailable) {
        try {
          if (!embedding) {
            const embeddingText = params.content + (params.detail ? " " + params.detail : "");
            embedding = await generateEmbedding(embeddingText);
          }
          insertEmbedding(sqlite, id, embedding);
        } catch {
          // Embedding failure is non-fatal
        }
      }

      db.insert(memoryEvents)
        .values({
          id: generateId(),
          memoryId: id,
          eventType: "created",
          agentId: params.sourceAgentId,
          agentName: params.sourceAgentName,
          newValue: JSON.stringify({ content: params.content, domain: params.domain ?? "general" }),
          timestamp,
        })
        .run();

      // Background entity extraction (fire-and-forget) when entityType not provided
      if (!params.entityType && extractionProvider) {
        (async () => {
          try {
            // Gather existing entity names for normalization
            const existingNames = sqlite
              .prepare(`SELECT DISTINCT entity_name FROM memories WHERE entity_name IS NOT NULL AND deleted_at IS NULL`)
              .all() as { entity_name: string }[];

            const extraction = await extractEntity(
              extractionProvider!,
              params.content,
              params.detail ?? null,
              existingNames.map((r) => r.entity_name),
            );

            const validation = validateExtraction(extraction);
            if (!validation.valid) {
              process.stderr.write(`[engrams] Entity extraction failed validation: ${validation.error}\n`);
              return;
            }

            // Race condition guard: only update if entity_type hasn't been set yet
            const current = sqlite
              .prepare(`SELECT entity_type FROM memories WHERE id = ? AND deleted_at IS NULL`)
              .get(id) as { entity_type: string | null } | undefined;

            if (!current || current.entity_type) return;

            // Update in a transaction for safety
            sqlite.transaction(() => {
              sqlite.prepare(
                `UPDATE memories SET entity_type = ?, entity_name = ?, structured_data = ? WHERE id = ? AND entity_type IS NULL AND deleted_at IS NULL`,
              ).run(
                extraction.entity_type,
                extraction.entity_name,
                JSON.stringify(extraction.structured_data),
                id,
              );

              // Auto-create suggested connections
              for (const conn of extraction.suggested_connections) {
                const target = sqlite
                  .prepare(`SELECT id FROM memories WHERE entity_name = ? COLLATE NOCASE AND deleted_at IS NULL LIMIT 1`)
                  .get(conn.target_entity_name) as { id: string } | undefined;

                if (target && target.id !== id) {
                  sqlite.prepare(
                    `INSERT INTO memory_connections (source_memory_id, target_memory_id, relationship) VALUES (?, ?, ?)`,
                  ).run(id, target.id, conn.relationship);
                }
              }
            })();

            bumpLastModified(sqlite);
          } catch {
            // Background extraction failure is non-fatal
          }
        })();
      }

      // Proactive split detection
      const fullText = params.content + (params.detail ? " " + params.detail : "");
      const sentences = fullText.split(/(?<=[.!?])\s+/).filter((s) => s.length > 10);
      let splitSuggestion: { should_split: boolean; parts?: { content: string; detail?: string }[] } | null = null;

      if (sentences.length >= 3 && extractionProvider) {
        try {
          const splitPrompt = `Analyze this memory and determine if it contains multiple distinct topics that should be stored separately. Only suggest splitting if the topics are genuinely independent (would be searched for separately).

Memory content: ${JSON.stringify(params.content)}
Memory detail: ${JSON.stringify(params.detail ?? null)}

Respond with ONLY valid JSON:
- If it should NOT be split: {"should_split": false}
- If it SHOULD be split: {"should_split": true, "parts": [{"content": "...", "detail": "..."}, ...]}

Each part should have a concise "content" (one sentence) and optional "detail". Do not split if the content is a single coherent topic.`;
          const text = await extractionProvider.complete(splitPrompt, { maxTokens: 512, json: true });
          splitSuggestion = parseLLMJson(text);
        } catch {
          // LLM call failed — skip split suggestion
        }
      }

      bumpLastModified(sqlite);

      const result: Record<string, unknown> = {
        id,
        confidence,
        domain: params.domain ?? "general",
        created: true,
        entityType: params.entityType ?? null,
        entityName: params.entityName ?? null,
      };
      if (!params.entityType && extractionProvider) {
        result._background_classification = "running";
      }
      if (hasPii) {
        result._pii_detected = [...new Set(piiMatches.map((m) => m.type))];
      }
      if (splitSuggestion?.should_split && splitSuggestion.parts) {
        result.split_suggested = true;
        result.suggested_parts = splitSuggestion.parts;
        result.message = "This memory appears to contain multiple distinct topics. Consider calling memory_split to separate them.";
      }

      return textResult(result);
    },
  );

  server.tool(
    "memory_search",
    "Search the user's persistent memory for relevant context. Call this at the start of conversations or before answering questions where prior knowledge about the user would help. Also call before asking the user something — the answer may already be in memory.",
    {
      query: z.string().describe("Search query"),
      domain: z.string().optional().describe("Filter by domain"),
      entityType: z.enum(["person", "organization", "place", "project", "preference", "event", "goal", "fact"]).optional().describe("Filter by entity type"),
      entityName: z.string().optional().describe("Filter by entity name (case-insensitive)"),
      minConfidence: z.number().optional().describe("Minimum confidence threshold"),
      limit: z.number().optional().describe("Max results (default 20)"),
      expand: z.boolean().optional().describe("Include connected memories (default true)"),
      maxDepth: z.number().optional().describe("Max graph expansion depth (default 3)"),
      similarityThreshold: z.number().optional().describe("Min similarity for connected memories (default 0.5)"),
    },
    async (params) => {
      maybeRunDecay();
      const limit = params.limit ?? 20;

      const { results: searchResults, cached: wasCached } = await hybridSearch(sqlite, params.query, {
        domain: params.domain,
        entityType: params.entityType,
        entityName: params.entityName,
        minConfidence: params.minConfidence,
        limit,
        expand: params.expand,
        maxDepth: params.maxDepth,
        similarityThreshold: params.similarityThreshold,
      });

      if (searchResults.length === 0) {
        const totalCount = (sqlite.prepare("SELECT COUNT(*) as count FROM memories WHERE deleted_at IS NULL").get() as { count: number }).count;
        const onboarding_hint = totalCount < 5
          ? "Your memory database is nearly empty. Call memory_onboard with your list of available tools to run a guided setup."
          : undefined;
        return textResult({ memories: [], count: 0, totalConnected: 0, cached: wasCached, ...(onboarding_hint ? { onboarding_hint } : {}) });
      }

      // --- Auto-track usage: bump used_count and last_used_at on returned memories ---
      const timestamp = now();
      const updateStmt = sqlite.prepare(
        `UPDATE memories SET used_count = used_count + 1, last_used_at = ? WHERE id = ?`,
      );
      const insertEventStmt = sqlite.prepare(
        `INSERT INTO memory_events (id, memory_id, event_type, timestamp) VALUES (?, ?, 'used', ?)`,
      );
      const batchUpdate = sqlite.transaction(() => {
        for (const r of searchResults) {
          updateStmt.run(timestamp, r.memory.id);
          insertEventStmt.run(generateId(), r.memory.id, timestamp);
        }
      });
      batchUpdate();

      return textResult({
        memories: searchResults.map((r) => ({
          ...r.memory,
          _searchScore: r.score,
          _connected: r.connected.map((c) => ({
            ...c.memory,
            _relationship: c.relationship,
            _depth: c.depth,
            _similarity: c.similarity,
          })),
        })),
        count: searchResults.length,
        totalConnected: searchResults.reduce((sum, r) => sum + r.connected.length, 0),
        cached: wasCached,
      });
    },
  );

  server.tool(
    "memory_update",
    "Update an existing memory's content, detail, or domain",
    {
      id: z.string().describe("Memory ID to update"),
      content: z.string().optional().describe("New content"),
      detail: z.string().optional().describe("New detail"),
      domain: z.string().optional().describe("New domain"),
      agentId: z.string().optional().describe("Your agent ID"),
      agentName: z.string().optional().describe("Your agent name"),
    },
    async (params) => {
      const existing = db
        .select()
        .from(memories)
        .where(and(eq(memories.id, params.id), isNull(memories.deletedAt)))
        .get();

      if (!existing) {
        return textResult({ error: "Memory not found or deleted" });
      }

      const updates: Record<string, unknown> = {};
      if (params.content !== undefined) updates.content = params.content;
      if (params.detail !== undefined) updates.detail = params.detail;
      if (params.domain !== undefined) updates.domain = params.domain;

      if (Object.keys(updates).length === 0) {
        return textResult({ error: "No fields to update" });
      }

      db.update(memories).set(updates).where(eq(memories.id, params.id)).run();

      // Re-embed if content changed
      if (params.content !== undefined && vecAvailable) {
        try {
          const detail = params.detail ?? existing.detail;
          const embeddingText = params.content + (detail ? " " + detail : "");
          const embedding = await generateEmbedding(embeddingText);
          insertEmbedding(sqlite, params.id, embedding);
        } catch {
          // Non-fatal
        }
      }

      db.insert(memoryEvents)
        .values({
          id: generateId(),
          memoryId: params.id,
          eventType: "confidence_changed",
          agentId: params.agentId ?? null,
          agentName: params.agentName ?? null,
          oldValue: JSON.stringify({
            content: existing.content,
            detail: existing.detail,
            domain: existing.domain,
          }),
          newValue: JSON.stringify(updates),
          timestamp: now(),
        })
        .run();

      bumpLastModified(sqlite);

      return textResult({ id: params.id, updated: true, changes: updates });
    },
  );

  server.tool(
    "memory_remove",
    "Delete a memory the user no longer wants stored. Call when the user explicitly asks to forget something.",
    {
      id: z.string().describe("Memory ID to remove"),
      reason: z.string().optional().describe("Reason for removal"),
      agentId: z.string().optional().describe("Your agent ID"),
      agentName: z.string().optional().describe("Your agent name"),
    },
    async (params) => {
      const existing = db
        .select()
        .from(memories)
        .where(and(eq(memories.id, params.id), isNull(memories.deletedAt)))
        .get();

      if (!existing) {
        return textResult({ error: "Memory not found or already deleted" });
      }

      const timestamp = now();
      db.update(memories)
        .set({ deletedAt: timestamp })
        .where(eq(memories.id, params.id))
        .run();

      db.insert(memoryEvents)
        .values({
          id: generateId(),
          memoryId: params.id,
          eventType: "removed",
          agentId: params.agentId ?? null,
          agentName: params.agentName ?? null,
          newValue: JSON.stringify({ reason: params.reason }),
          timestamp,
        })
        .run();

      bumpLastModified(sqlite);

      return textResult({ id: params.id, removed: true });
    },
  );

  server.tool(
    "memory_confirm",
    "Confirm a memory is still accurate. Call this when you act on a memory and the user validates it was correct, or when the user reaffirms something you already know.",
    {
      id: z.string().describe("Memory ID to confirm"),
      agentId: z.string().optional().describe("Your agent ID"),
      agentName: z.string().optional().describe("Your agent name"),
    },
    async (params) => {
      const existing = db
        .select()
        .from(memories)
        .where(and(eq(memories.id, params.id), isNull(memories.deletedAt)))
        .get();

      if (!existing) {
        return textResult({ error: "Memory not found or deleted" });
      }

      const newConfidence = applyConfirm(existing.confidence);
      const timestamp = now();

      db.update(memories)
        .set({
          confidence: newConfidence,
          confirmedCount: existing.confirmedCount + 1,
          confirmedAt: timestamp,
        })
        .where(eq(memories.id, params.id))
        .run();

      db.insert(memoryEvents)
        .values({
          id: generateId(),
          memoryId: params.id,
          eventType: "confirmed",
          agentId: params.agentId ?? null,
          agentName: params.agentName ?? null,
          oldValue: JSON.stringify({ confidence: existing.confidence }),
          newValue: JSON.stringify({ confidence: newConfidence }),
          timestamp,
        })
        .run();

      bumpLastModified(sqlite);

      return textResult({
        id: params.id,
        confirmed: true,
        previousConfidence: existing.confidence,
        newConfidence,
        confirmedCount: existing.confirmedCount + 1,
      });
    },
  );

  server.tool(
    "memory_correct",
    "Replace a memory's content with corrected information. Call this when the user says a memory is wrong and provides the right answer. Resets confidence to 0.50.",
    {
      id: z.string().describe("Memory ID to correct"),
      content: z.string().describe("The corrected content"),
      agentId: z.string().optional().describe("Your agent ID"),
      agentName: z.string().optional().describe("Your agent name"),
    },
    async (params) => {
      const existing = db
        .select()
        .from(memories)
        .where(and(eq(memories.id, params.id), isNull(memories.deletedAt)))
        .get();

      if (!existing) {
        return textResult({ error: "Memory not found or deleted" });
      }

      const newConfidence = applyCorrect();
      const timestamp = now();

      db.update(memories)
        .set({
          content: params.content,
          confidence: newConfidence,
          correctedCount: existing.correctedCount + 1,
        })
        .where(eq(memories.id, params.id))
        .run();

      // Re-embed with corrected content
      if (vecAvailable) {
        try {
          const embedding = await generateEmbedding(params.content);
          insertEmbedding(sqlite, params.id, embedding);
        } catch {
          // Non-fatal
        }
      }

      db.insert(memoryEvents)
        .values({
          id: generateId(),
          memoryId: params.id,
          eventType: "corrected",
          agentId: params.agentId ?? null,
          agentName: params.agentName ?? null,
          oldValue: JSON.stringify({ content: existing.content, confidence: existing.confidence }),
          newValue: JSON.stringify({ content: params.content, confidence: newConfidence }),
          timestamp,
        })
        .run();

      bumpLastModified(sqlite);

      return textResult({
        id: params.id,
        corrected: true,
        previousConfidence: existing.confidence,
        newConfidence,
        correctedCount: existing.correctedCount + 1,
      });
    },
  );

  server.tool(
    "memory_flag_mistake",
    "Flag a memory as wrong or outdated. Call this when you act on a memory and the outcome was incorrect, or when the user says a memory is no longer true. Degrades confidence by 0.15.",
    {
      id: z.string().describe("Memory ID to flag"),
      agentId: z.string().optional().describe("Your agent ID"),
      agentName: z.string().optional().describe("Your agent name"),
    },
    async (params) => {
      const existing = db
        .select()
        .from(memories)
        .where(and(eq(memories.id, params.id), isNull(memories.deletedAt)))
        .get();

      if (!existing) {
        return textResult({ error: "Memory not found or deleted" });
      }

      const newConfidence = applyMistake(existing.confidence);
      const timestamp = now();

      db.update(memories)
        .set({
          confidence: newConfidence,
          mistakeCount: existing.mistakeCount + 1,
        })
        .where(eq(memories.id, params.id))
        .run();

      db.insert(memoryEvents)
        .values({
          id: generateId(),
          memoryId: params.id,
          eventType: "confidence_changed",
          agentId: params.agentId ?? null,
          agentName: params.agentName ?? null,
          oldValue: JSON.stringify({ confidence: existing.confidence }),
          newValue: JSON.stringify({ confidence: newConfidence, flaggedAsMistake: true }),
          timestamp,
        })
        .run();

      bumpLastModified(sqlite);

      return textResult({
        id: params.id,
        flagged: true,
        previousConfidence: existing.confidence,
        newConfidence,
        mistakeCount: existing.mistakeCount + 1,
      });
    },
  );

  server.tool(
    "memory_connect",
    "Create a relationship between two memories",
    {
      sourceMemoryId: z.string().describe("Source memory ID"),
      targetMemoryId: z.string().describe("Target memory ID"),
      relationship: z
        .enum(["influences", "supports", "contradicts", "related", "learned-together", "works_at", "involves", "located_at", "part_of", "about"])
        .describe("Type of relationship"),
    },
    async (params) => {
      if (params.sourceMemoryId === params.targetMemoryId) {
        return textResult({ error: "Cannot connect a memory to itself" });
      }

      const source = db.select().from(memories).where(eq(memories.id, params.sourceMemoryId)).get();
      const target = db.select().from(memories).where(eq(memories.id, params.targetMemoryId)).get();

      if (!source || !target) {
        return textResult({ error: "One or both memories not found" });
      }

      db.insert(memoryConnections)
        .values({
          sourceMemoryId: params.sourceMemoryId,
          targetMemoryId: params.targetMemoryId,
          relationship: params.relationship,
        })
        .run();

      bumpLastModified(sqlite);

      return textResult({
        connected: true,
        sourceMemoryId: params.sourceMemoryId,
        targetMemoryId: params.targetMemoryId,
        relationship: params.relationship,
      });
    },
  );

  server.tool(
    "memory_split",
    "Split a memory that contains multiple distinct facts into separate memories. Call this when a memory covers more than one topic or would be more useful as individual pieces. Each new memory inherits the original's domain and source metadata, and the originals are connected with 'related' relationships.",
    {
      id: z.string().describe("Memory ID to split"),
      parts: z
        .array(
          z.object({
            content: z.string().describe("Content for this part"),
            detail: z.string().optional().describe("Optional detail for this part"),
            domain: z.string().optional().describe("Override domain for this part"),
          }),
        )
        .min(2)
        .describe("The separate memories to create from the original"),
      agentId: z.string().optional().describe("Your agent ID"),
      agentName: z.string().optional().describe("Your agent name"),
    },
    async (params) => {
      const existing = db
        .select()
        .from(memories)
        .where(and(eq(memories.id, params.id), isNull(memories.deletedAt)))
        .get();

      if (!existing) {
        return textResult({ error: "Memory not found or deleted" });
      }

      const timestamp = now();
      const newIds: string[] = [];

      // Create new memories from parts
      for (const part of params.parts) {
        const newId = generateId();
        newIds.push(newId);

        db.insert(memories)
          .values({
            id: newId,
            content: part.content,
            detail: part.detail ?? null,
            domain: part.domain ?? existing.domain,
            sourceAgentId: existing.sourceAgentId,
            sourceAgentName: existing.sourceAgentName,
            sourceType: existing.sourceType,
            sourceDescription: existing.sourceDescription,
            confidence: Math.min(existing.confidence + 0.05, 0.99),
            learnedAt: timestamp,
          })
          .run();

        // Embed the new memory
        if (vecAvailable) {
          try {
            const embeddingText = part.content + (part.detail ? " " + part.detail : "");
            const embedding = await generateEmbedding(embeddingText);
            insertEmbedding(sqlite, newId, embedding);
          } catch {
            // Non-fatal
          }
        }

        db.insert(memoryEvents)
          .values({
            id: generateId(),
            memoryId: newId,
            eventType: "created",
            agentId: params.agentId ?? null,
            agentName: params.agentName ?? null,
            newValue: JSON.stringify({ content: part.content, splitFrom: params.id }),
            timestamp,
          })
          .run();
      }

      // Connect all new memories to each other
      for (let i = 0; i < newIds.length; i++) {
        for (let j = i + 1; j < newIds.length; j++) {
          db.insert(memoryConnections)
            .values({
              sourceMemoryId: newIds[i],
              targetMemoryId: newIds[j],
              relationship: "related",
            })
            .run();
        }
      }

      // Soft-delete the original
      db.update(memories)
        .set({ deletedAt: timestamp })
        .where(eq(memories.id, params.id))
        .run();

      db.insert(memoryEvents)
        .values({
          id: generateId(),
          memoryId: params.id,
          eventType: "removed",
          agentId: params.agentId ?? null,
          agentName: params.agentName ?? null,
          newValue: JSON.stringify({ reason: "split", splitInto: newIds }),
          timestamp,
        })
        .run();

      bumpLastModified(sqlite);

      return textResult({
        split: true,
        originalId: params.id,
        newMemories: newIds,
        count: newIds.length,
      });
    },
  );

  server.tool(
    "memory_scrub",
    "Scan a memory for sensitive data (PII, API keys, etc.) and optionally redact it. Use this to check memories before sharing or to clean up accidentally stored secrets.",
    {
      id: z.string().describe("Memory ID to scan"),
      redact: z.boolean().optional().describe("Replace detected PII with redaction tokens (default false)"),
    },
    async (params) => {
      const existing = db
        .select()
        .from(memories)
        .where(and(eq(memories.id, params.id), isNull(memories.deletedAt)))
        .get();

      if (!existing) {
        return textResult({ error: "Memory not found or deleted" });
      }

      const fullText = existing.content + (existing.detail ? " " + existing.detail : "");
      const matches = detectSensitiveData(fullText);

      if (params.redact && matches.length > 0) {
        const { redacted: redactedContent } = redactSensitiveData(existing.content);
        const redactedDetail = existing.detail
          ? redactSensitiveData(existing.detail).redacted
          : null;

        db.update(memories)
          .set({
            content: redactedContent,
            detail: redactedDetail,
            hasPiiFlag: 0,
          })
          .where(eq(memories.id, params.id))
          .run();

        // Re-embed with redacted content
        if (vecAvailable) {
          try {
            const embeddingText = redactedContent + (redactedDetail ? " " + redactedDetail : "");
            const embedding = await generateEmbedding(embeddingText);
            insertEmbedding(sqlite, params.id, embedding);
          } catch {
            // Non-fatal
          }
        }

        db.insert(memoryEvents)
          .values({
            id: generateId(),
            memoryId: params.id,
            eventType: "corrected",
            agentName: "engrams:scrub",
            oldValue: JSON.stringify({ content: existing.content, detail: existing.detail }),
            newValue: JSON.stringify({ content: redactedContent, detail: redactedDetail }),
            timestamp: now(),
          })
          .run();

        bumpLastModified(sqlite);

        return textResult({
          id: params.id,
          scrubbed: true,
          detected: matches.map((m) => ({ type: m.type, start: m.start, end: m.end })),
          redactedContent,
          redactedDetail,
        });
      }

      return textResult({
        id: params.id,
        detected: matches.map((m) => ({ type: m.type, start: m.start, end: m.end })),
        hasPii: matches.length > 0,
        count: matches.length,
      });
    },
  );

  server.tool(
    "memory_get_connections",
    "Get all connections for a memory",
    {
      memoryId: z.string().describe("Memory ID to get connections for"),
    },
    async (params) => {
      const outgoing = db
        .select()
        .from(memoryConnections)
        .where(eq(memoryConnections.sourceMemoryId, params.memoryId))
        .all();

      const incoming = db
        .select()
        .from(memoryConnections)
        .where(eq(memoryConnections.targetMemoryId, params.memoryId))
        .all();

      return textResult({
        memoryId: params.memoryId,
        outgoing,
        incoming,
        totalConnections: outgoing.length + incoming.length,
      });
    },
  );

  server.tool(
    "memory_list_domains",
    "List all memory domains with counts",
    {},
    async () => {
      const results = sqlite
        .prepare(
          `SELECT domain, COUNT(*) as count FROM memories WHERE deleted_at IS NULL GROUP BY domain ORDER BY count DESC`,
        )
        .all() as { domain: string; count: number }[];

      return textResult({ domains: results });
    },
  );

  server.tool(
    "memory_list",
    "Browse the user's memories by domain. Use this to show the user what you know about them in a specific area, or to review memories before a task.",
    {
      domain: z.string().optional().describe("Filter by domain"),
      entityType: z.enum(["person", "organization", "place", "project", "preference", "event", "goal", "fact"]).optional().describe("Filter by entity type"),
      entityName: z.string().optional().describe("Filter by entity name (case-insensitive)"),
      sortBy: z.enum(["confidence", "recency"]).optional().describe("Sort order (default: confidence)"),
      limit: z.number().optional().describe("Max results (default 20)"),
      offset: z.number().optional().describe("Offset for pagination"),
    },
    async (params) => {
      maybeRunDecay();
      const limit = params.limit ?? 20;
      const offset = params.offset ?? 0;
      const sortBy = params.sortBy ?? "confidence";

      let query = `SELECT * FROM memories WHERE deleted_at IS NULL`;
      const queryParams: unknown[] = [];

      if (params.domain) {
        query += ` AND domain = ?`;
        queryParams.push(params.domain);
      }

      if (params.entityType) {
        query += ` AND entity_type = ?`;
        queryParams.push(params.entityType);
      }

      if (params.entityName) {
        query += ` AND entity_name = ? COLLATE NOCASE`;
        queryParams.push(params.entityName);
      }

      if (sortBy === "confidence") {
        query += ` ORDER BY confidence DESC`;
      } else {
        query += ` ORDER BY learned_at DESC`;
      }

      query += ` LIMIT ? OFFSET ?`;
      queryParams.push(limit, offset);

      const results = sqlite.prepare(query).all(...queryParams);

      const countQuery = params.domain
        ? sqlite
            .prepare(`SELECT COUNT(*) as total FROM memories WHERE deleted_at IS NULL AND domain = ?`)
            .get(params.domain) as { total: number }
        : (sqlite
            .prepare(`SELECT COUNT(*) as total FROM memories WHERE deleted_at IS NULL`)
            .get() as { total: number });

      return textResult({
        memories: results,
        count: results.length,
        total: countQuery.total,
        offset,
        limit,
      });
    },
  );

  server.tool(
    "memory_classify",
    "Batch-classify untyped memories using entity extraction. Runs in the background and returns progress. Use this to backfill entity types on existing memories.",
    {
      limit: z.number().optional().describe("Max memories to classify (default 50)"),
      domain: z.string().optional().describe("Only classify memories in this domain"),
    },
    async (params) => {
      if (!extractionProvider) {
        return textResult({ error: "No LLM provider configured. Set ANTHROPIC_API_KEY, OPENAI_API_KEY, or configure ~/.engrams/config.json" });
      }

      const classifyLimit = params.limit ?? 50;
      let query = `SELECT id, content, detail FROM memories WHERE entity_type IS NULL AND deleted_at IS NULL`;
      const queryParams: unknown[] = [];

      if (params.domain) {
        query += ` AND domain = ?`;
        queryParams.push(params.domain);
      }
      query += ` LIMIT ?`;
      queryParams.push(classifyLimit);

      const untyped = sqlite.prepare(query).all(...queryParams) as { id: string; content: string; detail: string | null }[];

      if (untyped.length === 0) {
        return textResult({ status: "complete", classified: 0, message: "No untyped memories found" });
      }

      // Gather existing entity names for normalization
      const existingNames = sqlite
        .prepare(`SELECT DISTINCT entity_name FROM memories WHERE entity_name IS NOT NULL AND deleted_at IS NULL`)
        .all() as { entity_name: string }[];
      const nameList = existingNames.map((r) => r.entity_name);

      let classified = 0;
      let errors = 0;

      for (const mem of untyped) {
        try {
          const extraction = await extractEntity(extractionProvider!, mem.content, mem.detail, nameList);

          const validation = validateExtraction(extraction);
          if (!validation.valid) {
            errors++;
            continue;
          }

          sqlite.transaction(() => {
            sqlite.prepare(
              `UPDATE memories SET entity_type = ?, entity_name = ?, structured_data = ? WHERE id = ? AND entity_type IS NULL AND deleted_at IS NULL`,
            ).run(
              extraction.entity_type,
              extraction.entity_name,
              JSON.stringify(extraction.structured_data),
              mem.id,
            );

            // Auto-create connections
            for (const conn of extraction.suggested_connections) {
              const target = sqlite
                .prepare(`SELECT id FROM memories WHERE entity_name = ? COLLATE NOCASE AND deleted_at IS NULL LIMIT 1`)
                .get(conn.target_entity_name) as { id: string } | undefined;

              if (target && target.id !== mem.id) {
                sqlite.prepare(
                  `INSERT INTO memory_connections (source_memory_id, target_memory_id, relationship) VALUES (?, ?, ?)`,
                ).run(mem.id, target.id, conn.relationship);
              }
            }
          })();

          classified++;
          if (extraction.entity_name) nameList.push(extraction.entity_name);
        } catch {
          errors++;
        }

        // Rate limiting: 200ms delay between API calls
        if (classified + errors < untyped.length) {
          await new Promise((resolve) => setTimeout(resolve, 200));
        }
      }

      if (classified > 0) bumpLastModified(sqlite);

      return textResult({
        status: "complete",
        classified,
        errors,
        remaining: Math.max(0, (sqlite.prepare(`SELECT COUNT(*) as c FROM memories WHERE entity_type IS NULL AND deleted_at IS NULL`).get() as { c: number }).c),
      });
    },
  );

  server.tool(
    "memory_list_entities",
    "List all known entities grouped by type. Useful for discovering what the system knows about people, organizations, projects, etc.",
    {
      entityType: z.enum(["person", "organization", "place", "project", "preference", "event", "goal", "fact"]).optional().describe("Filter to a specific entity type"),
    },
    async (params) => {
      let query = `SELECT entity_type, entity_name, COUNT(*) as memory_count
        FROM memories
        WHERE entity_type IS NOT NULL AND entity_name IS NOT NULL AND deleted_at IS NULL`;
      const queryParams: unknown[] = [];

      if (params.entityType) {
        query += ` AND entity_type = ?`;
        queryParams.push(params.entityType);
      }

      query += ` GROUP BY entity_type, entity_name ORDER BY entity_type, memory_count DESC`;

      const rows = sqlite.prepare(query).all(...queryParams) as { entity_type: string; entity_name: string; memory_count: number }[];

      // Group by type
      const grouped: Record<string, { name: string; count: number }[]> = {};
      for (const row of rows) {
        if (!grouped[row.entity_type]) grouped[row.entity_type] = [];
        grouped[row.entity_type].push({ name: row.entity_name, count: row.memory_count });
      }

      return textResult({
        entities: grouped,
        totalEntities: rows.length,
        totalMemoriesWithEntities: rows.reduce((sum, r) => sum + r.memory_count, 0),
      });
    },
  );

  server.tool(
    "memory_set_permissions",
    "Set per-agent read/write permissions for a domain",
    {
      agentId: z.string().describe("Agent ID"),
      domain: z.string().describe("Domain (* for all)"),
      canRead: z.boolean().optional().describe("Allow reading (default true)"),
      canWrite: z.boolean().optional().describe("Allow writing (default true)"),
    },
    async (params) => {
      const existing = db
        .select()
        .from(agentPermissions)
        .where(
          and(
            eq(agentPermissions.agentId, params.agentId),
            eq(agentPermissions.domain, params.domain),
          ),
        )
        .get();

      const canRead = params.canRead !== undefined ? (params.canRead ? 1 : 0) : 1;
      const canWrite = params.canWrite !== undefined ? (params.canWrite ? 1 : 0) : 1;

      if (existing) {
        db.update(agentPermissions)
          .set({ canRead, canWrite })
          .where(
            and(
              eq(agentPermissions.agentId, params.agentId),
              eq(agentPermissions.domain, params.domain),
            ),
          )
          .run();
      } else {
        db.insert(agentPermissions)
          .values({
            agentId: params.agentId,
            domain: params.domain,
            canRead,
            canWrite,
          })
          .run();
      }

      return textResult({
        agentId: params.agentId,
        domain: params.domain,
        canRead: !!canRead,
        canWrite: !!canWrite,
        updated: true,
      });
    },
  );

  // --- LLM Configuration ---

  server.tool(
    "memory_configure",
    "Configure Engrams settings. Currently supports LLM provider setup for entity extraction, correction, and splitting.",
    {
      llm_provider: z.enum(["anthropic", "openai", "ollama"]).describe("LLM provider to use"),
      llm_api_key: z.string().optional().describe("API key for the provider. Not needed for Ollama."),
      llm_base_url: z.string().optional().describe("Custom base URL for OpenAI-compatible endpoints or Ollama."),
      llm_extraction_model: z.string().optional().describe("Model for entity extraction (high-volume, cheap). Defaults: anthropic=claude-haiku-4-5, openai=gpt-4o-mini, ollama=llama3.2"),
      llm_analysis_model: z.string().optional().describe("Model for correction/splitting (user-initiated, capable). Defaults: anthropic=claude-sonnet-4-5, openai=gpt-4o, ollama=llama3.2"),
    },
    async (params) => {
      const config = loadConfig();
      config.llm = {
        provider: params.llm_provider,
        apiKey: params.llm_api_key || undefined,
        baseUrl: params.llm_base_url || undefined,
        models: {
          extraction: params.llm_extraction_model || undefined,
          analysis: params.llm_analysis_model || undefined,
        },
      };
      saveConfig(config);

      // Re-resolve providers with new config
      extractionProvider = resolveLLMProvider("extraction");
      analysisProvider = resolveLLMProvider("analysis");

      // Test connection
      try {
        if (extractionProvider) {
          await extractionProvider.complete("Say ok", { maxTokens: 10 });
        }
        return textResult({
          status: "configured",
          provider: params.llm_provider,
          extraction_model: params.llm_extraction_model || "(default)",
          analysis_model: params.llm_analysis_model || "(default)",
        });
      } catch (err) {
        return textResult({
          status: "configured_with_error",
          provider: params.llm_provider,
          error: `Config saved but connection test failed: ${err instanceof Error ? err.message : "Unknown error"}`,
        });
      }
    },
  );

  // --- Onboarding ---

  server.tool(
    "memory_onboard",
    "Get a personalized onboarding plan to seed your memory database. Returns a structured action plan based on your current memory state. Call this when the user is new or asks to set up their memory. The plan tells you which connected tools to scan and what interview questions to ask — execute each step using the tools available to you.",
    {
      available_tools: z.array(z.string()).optional().describe("List of MCP tool names you have access to (e.g. ['gcal_list_events', 'gmail_search_messages', 'github_list_repos']). This helps generate a targeted plan."),
      skip_scan: z.boolean().optional().describe("Skip the tool scan phase and go straight to interview. Default false."),
      skip_interview: z.boolean().optional().describe("Skip the interview phase. Useful if re-running just the scan. Default false."),
    },
    async (params) => {
      // 1. Assess current state
      const memoryCount = sqlite.prepare("SELECT COUNT(*) as count FROM memories WHERE deleted_at IS NULL").get() as { count: number };
      const entityCounts = sqlite.prepare(`
        SELECT entity_type, COUNT(*) as count
        FROM memories
        WHERE entity_type IS NOT NULL AND deleted_at IS NULL
        GROUP BY entity_type
      `).all() as { entity_type: string; count: number }[];
      const domainCounts = sqlite.prepare(`
        SELECT domain, COUNT(*) as count
        FROM memories
        WHERE deleted_at IS NULL
        GROUP BY domain
      `).all() as { domain: string; count: number }[];

      const totalMemories = memoryCount.count;
      const entityMap = Object.fromEntries(entityCounts.map(e => [e.entity_type, e.count]));
      const domainMap = Object.fromEntries(domainCounts.map(d => [d.domain, d.count]));

      // 2. Categorize available tools
      const tools = params.available_tools || [];
      const hasCalendar = tools.some(t => /gcal|calendar|cal_list|list_events/i.test(t));
      const hasEmail = tools.some(t => /gmail|email|mail|search_messages/i.test(t));
      const hasGitHub = tools.some(t => /github|gh_|list_repos|list_prs/i.test(t));
      const hasSlack = tools.some(t => /slack|channel|send_message/i.test(t));
      const hasNotes = tools.some(t => /note|notion|obsidian/i.test(t));

      // 3. Build the plan
      const plan: string[] = [];

      // Header with current state
      if (totalMemories === 0) {
        plan.push("# Onboarding Plan — Fresh Start");
        plan.push("");
        plan.push("Your memory database is empty. Let's fix that. This plan will seed your memories from connected tools and a short conversation.");
      } else if (totalMemories < 20) {
        plan.push("# Onboarding Plan — Early Stage");
        plan.push("");
        plan.push(`You have ${totalMemories} memories so far. Let's enrich your knowledge graph with more context from your tools.`);
      } else {
        plan.push("# Onboarding Plan — Enrichment");
        plan.push("");
        plan.push(`You have ${totalMemories} memories across ${Object.keys(domainMap).length} domains. Here's what could be filled in.`);
        if (entityCounts.length > 0) {
          plan.push("");
          plan.push("Current entity coverage:");
          for (const e of entityCounts) {
            plan.push(`- ${e.entity_type}: ${e.count}`);
          }
        }
        const allTypes = ["person", "organization", "place", "project", "preference", "event", "goal"];
        const missing = allTypes.filter(t => !entityMap[t]);
        if (missing.length > 0) {
          plan.push("");
          plan.push(`Missing entity types: ${missing.join(", ")}. The scan and interview below will help fill these gaps.`);
        }
      }

      // Phase 1: Tool scan
      if (!params.skip_scan) {
        plan.push("");
        plan.push("---");
        plan.push("");
        plan.push("## Phase 1: Silent Scan");
        plan.push("");
        plan.push("Scan the user's connected tools to extract people, projects, events, and context. Do this BEFORE the interview — the interview will be much better with this context.");
        plan.push("");
        plan.push("**Important:** For each piece of information you extract, call `memory_write` with appropriate `domain`, `source_type: \"inferred\"`, and `source_description` noting which tool it came from. The system will automatically classify entities and create connections.");
        plan.push("");
        plan.push("**Dedup:** Before writing, call `memory_search` with the key terms to check if a similar memory already exists. If it does, skip or use `memory_update` to enrich it.");

        if (hasCalendar) {
          plan.push("");
          plan.push("### Calendar (available)");
          plan.push("");
          plan.push("1. Fetch events from the past 30 days");
          plan.push("2. Identify **recurring meetings** — these reveal team structure, projects, and key relationships");
          plan.push("   - For each recurring meeting: write a memory about what it is, who attends, and its cadence");
          plan.push("   - Extract each unique attendee as a person memory (name, how they relate to the user)");
          plan.push("3. Identify **project-related events** — standups, retros, planning sessions reveal active projects");
          plan.push("   - Write a memory for each distinct project you can identify");
          plan.push("4. Look for **1:1 meetings** — these are the user's closest collaborators");
          plan.push("5. Note any upcoming events in the next 7 days that suggest deadlines or goals");
          plan.push("");
          plan.push("Expected yield: 15-30 memories (people, projects, events, organizations)");
        }

        if (hasEmail) {
          plan.push("");
          plan.push("### Email (available)");
          plan.push("");
          plan.push("1. Search recent emails (past 14 days) for threads with the most back-and-forth — these are active topics");
          plan.push("2. Identify **key contacts** — people the user emails most frequently");
          plan.push("   - Cross-reference with calendar attendees to enrich existing person memories");
          plan.push("3. Look for **commitments and action items** — 'I'll send this by Friday', 'Let's schedule...', 'Following up on...'");
          plan.push("   - Write as event or goal memories");
          plan.push("4. Identify **external organizations** — clients, vendors, partners mentioned in email");
          plan.push("5. **DO NOT** read email body content in detail. Scan subjects, senders, and thread summaries only. Respect privacy.");
          plan.push("");
          plan.push("Expected yield: 10-20 memories (people, organizations, goals, events)");
        }

        if (hasGitHub) {
          plan.push("");
          plan.push("### GitHub (available)");
          plan.push("");
          plan.push("1. List the user's recent repositories (past 90 days of activity)");
          plan.push("2. For each active repo: write a project memory with the repo name, language/stack, and the user's role");
          plan.push("3. Check recent PRs for **collaborators** — frequent reviewers and co-authors are key people");
          plan.push("4. Note the **tech stack** across repos — languages, frameworks, tools. Write as preference/fact memories");
          plan.push("5. Look for any README descriptions that explain what projects do");
          plan.push("");
          plan.push("Expected yield: 10-20 memories (projects, people, preferences, facts)");
        }

        if (hasSlack) {
          plan.push("");
          plan.push("### Slack/Messaging (available)");
          plan.push("");
          plan.push("1. List channels the user is active in — channel names often map to projects or teams");
          plan.push("2. Identify **DM contacts** — frequent DM partners are close collaborators");
          plan.push("3. Note channel topics/descriptions for project context");
          plan.push("4. **DO NOT** read message history in detail. Use channel metadata only.");
          plan.push("");
          plan.push("Expected yield: 5-15 memories (projects, people, organizations)");
        }

        if (hasNotes) {
          plan.push("");
          plan.push("### Notes/Docs (available)");
          plan.push("");
          plan.push("1. Search for recent documents the user has edited");
          plan.push("2. Document titles and summaries reveal active projects and interests");
          plan.push("3. Look for any documents that look like personal notes, goals, or planning docs");
          plan.push("");
          plan.push("Expected yield: 5-10 memories (projects, goals, facts)");
        }

        // File-based sources (always available)
        plan.push("");
        plan.push("### Local Files (always available)");
        plan.push("");
        plan.push("Check for and read these files if they exist:");
        plan.push("");
        plan.push("- `~/.gitconfig` — user's name, email, identity. Write as a person memory about the user.");
        plan.push("- `~/.claude/CLAUDE.md` or any `CLAUDE.md` in the working directory — existing instructions and preferences. Each instruction is a preference memory.");
        plan.push("- `~/.claude/memory/` or `~/.claude/projects/*/memory/` — Claude Code auto-memory files. Parse each line/section as a separate memory. These are high-quality since the user or their AI already curated them.");
        plan.push("- `.cursorrules` or `.windsurfrules` in the working directory — coding preferences. Each rule is a preference memory.");
        plan.push("- `~/.config/` — scan for tool configs that reveal preferences (editor settings, shell aliases, etc.). Be selective — only extract meaningful preferences, not every config line.");
        plan.push("");
        plan.push("Expected yield: 5-15 memories (preferences, person, facts)");

        if (!hasCalendar && !hasEmail && !hasGitHub && !hasSlack && !hasNotes) {
          plan.push("");
          plan.push("### No connected tools detected");
          plan.push("");
          plan.push("You didn't list any calendar, email, GitHub, or notes tools. That's fine — the Local Files scan and the interview will still seed a solid foundation. If you do have connected tools, call `memory_onboard` again with `available_tools` listing your tool names for a richer scan.");
        }
      }

      // Phase 2: Informed interview
      if (!params.skip_interview) {
        plan.push("");
        plan.push("---");
        plan.push("");
        plan.push("## Phase 2: Informed Interview");
        plan.push("");
        plan.push("After the scan, you have a base of extracted context. Now have a SHORT conversation with the user to fill in meaning, relationships, and preferences that tools can't surface.");
        plan.push("");
        plan.push("**Rules:**");
        plan.push("- Reference what you learned in the scan. Don't ask questions you already have answers to.");
        plan.push("- Ask ONE question at a time. Wait for the answer before the next question.");
        plan.push("- Write memories immediately after each answer — don't batch them.");
        plan.push("- 5-7 questions max. Respect the user's time.");
        plan.push("- Tailor questions to what's MISSING, not what you already know.");
        plan.push("");

        if (totalMemories > 0 || !params.skip_scan) {
          plan.push("### Suggested questions (adapt based on what the scan found):");
          plan.push("");
          plan.push("1. **Confirm and enrich key relationships:** \"I found [names] across your calendar/email. Who are the most important people in your day-to-day — your direct team, your manager, key stakeholders?\"");
          plan.push("   → Write person memories with relationship_to_user and connect them to projects/orgs");
          plan.push("");
          plan.push("2. **Clarify project priorities:** \"I see you're involved in [projects]. What's your main focus right now? Are any of these winding down or just starting?\"");
          plan.push("   → Update project memories with status, write goal memories for priorities");
          plan.push("");
          plan.push("3. **Organizational context:** \"What does [organization] do? What's your role there?\"");
          plan.push("   → Write/enrich organization and person memories");
          plan.push("");
          plan.push("4. **Work preferences:** \"Any strong preferences for how I should work with you? Communication style, code conventions, things that bug you?\"");
          plan.push("   → Write preference memories with strength: strong");
          plan.push("");
          plan.push("5. **Goals:** \"What are you working toward right now — professionally or personally?\"");
          plan.push("   → Write goal memories with timeline and status");
          plan.push("");
          plan.push("6. **Fill entity gaps:** If the scan didn't surface certain entity types (places, events, facts), ask about them specifically.");
          plan.push("   → e.g., \"Where are you based?\" → place memory");
          plan.push("   → e.g., \"Any upcoming deadlines or milestones?\" → event memories");
          plan.push("");
          plan.push("7. **Catch-all:** \"Anything else I should know about you that would help me be more useful?\"");
          plan.push("   → Write whatever comes up");
        } else {
          plan.push("### Cold start questions (no scan data available):");
          plan.push("");
          plan.push("1. \"Tell me about yourself — name, what you do, where you're based.\"");
          plan.push("   → person + organization + place memories");
          plan.push("");
          plan.push("2. \"What are you working on right now?\"");
          plan.push("   → project memories");
          plan.push("");
          plan.push("3. \"Who do you work with most closely?\"");
          plan.push("   → person memories with relationships");
          plan.push("");
          plan.push("4. \"What tools and technologies do you use daily?\"");
          plan.push("   → preference and fact memories");
          plan.push("");
          plan.push("5. \"Any strong preferences for how I should communicate or work with you?\"");
          plan.push("   → preference memories");
          plan.push("");
          plan.push("6. \"What are your current goals or priorities?\"");
          plan.push("   → goal memories");
          plan.push("");
          plan.push("7. \"Anything else I should remember?\"");
          plan.push("   → catch-all");
        }
      }

      // Phase 3: Review prompt
      plan.push("");
      plan.push("---");
      plan.push("");
      plan.push("## Phase 3: Review");
      plan.push("");
      plan.push("After scanning and interviewing, tell the user:");
      plan.push("");
      plan.push("\"I've seeded your memory with [N] memories from [sources]. You can review and correct them at **localhost:3838** — anything I got wrong, click to edit or remove. Confirming memories boosts their confidence score.\"");
      plan.push("");
      plan.push("If the dashboard has a review queue or unreviewed filter, mention it specifically.");

      // Log the onboarding event
      sqlite.prepare(`
        INSERT INTO memory_events (id, memory_id, event_type, agent_id, agent_name, new_value, timestamp)
        VALUES (?, 'system', 'onboard_started', ?, ?, ?, ?)
      `).run(
        generateId(),
        "unknown",
        "unknown",
        JSON.stringify({
          memory_count: totalMemories,
          tools_detected: { calendar: hasCalendar, email: hasEmail, github: hasGitHub, slack: hasSlack, notes: hasNotes },
        }),
        now(),
      );

      return textResult(plan.join("\n"));
    },
  );

  server.tool(
    "memory_import",
    "Import memories from a known format. Parses the source, deduplicates against existing memories, and writes new ones. Supported sources: claude-memory (MEMORY.md files), chatgpt-export (OpenAI memory export JSON), cursorrules (.cursorrules files), gitconfig (.gitconfig), plaintext (one memory per line).",
    {
      source_type: z.enum(["claude-memory", "chatgpt-export", "cursorrules", "gitconfig", "plaintext"]).describe("The format of the source data"),
      content: z.string().describe("The raw content to import. For file-based sources, pass the file contents."),
      domain: z.string().optional().describe("Domain to assign to imported memories. Default: 'general'."),
    },
    async (params) => {
      const domain = params.domain ?? "general";

      // Parse into individual memory strings based on source type
      let entries: { content: string; detail?: string }[] = [];

      switch (params.source_type) {
        case "claude-memory": {
          // MEMORY.md format: each line starting with "- " is a memory
          entries = params.content
            .split("\n")
            .filter(line => line.trim().startsWith("- "))
            .map(line => {
              const text = line.replace(/^-\s*/, "").trim();
              const tagMatch = text.match(/^\[([^\]]+)\]\s*(.+)/);
              if (tagMatch) {
                return { content: tagMatch[2], detail: `Topic: ${tagMatch[1]}` };
              }
              return { content: text };
            })
            .filter(e => e.content.length > 5);
          break;
        }

        case "chatgpt-export": {
          try {
            const parsed = JSON.parse(params.content);
            const items = Array.isArray(parsed) ? parsed : parsed.memories || parsed.results || [];
            entries = items
              .map((item: unknown) => {
                const text = typeof item === "string" ? item : (item as Record<string, string>).memory || (item as Record<string, string>).content || "";
                return { content: text };
              })
              .filter((e: { content: string }) => e.content.length > 5);
          } catch {
            return textResult({ error: "Failed to parse ChatGPT export JSON. Expected an array of { memory: string } objects." });
          }
          break;
        }

        case "cursorrules": {
          entries = params.content
            .split(/\n\n+/)
            .flatMap(block => {
              if (block.includes("\n- ")) {
                return block.split("\n- ").map(line => ({
                  content: line.replace(/^-\s*/, "").trim(),
                  detail: "Imported from .cursorrules",
                }));
              }
              return [{ content: block.trim(), detail: "Imported from .cursorrules" }];
            })
            .filter(e => e.content.length > 5);
          break;
        }

        case "gitconfig": {
          const nameMatch = params.content.match(/name\s*=\s*(.+)/i);
          const emailMatch = params.content.match(/email\s*=\s*(.+)/i);
          const editorMatch = params.content.match(/editor\s*=\s*(.+)/i);

          if (nameMatch) {
            entries.push({
              content: `User's name is ${nameMatch[1].trim()}`,
              detail: emailMatch ? `Email: ${emailMatch[1].trim()}` : undefined,
            });
          }
          if (editorMatch) {
            entries.push({
              content: `Prefers ${editorMatch[1].trim()} as git editor`,
              detail: "From .gitconfig",
            });
          }
          const aliasSection = params.content.match(/\[alias\]([\s\S]*?)(?=\n\[|$)/i);
          if (aliasSection) {
            entries.push({
              content: "Has custom git aliases configured",
              detail: `Aliases: ${aliasSection[1].trim().split("\n").slice(0, 5).join("; ")}`,
            });
          }
          break;
        }

        case "plaintext": {
          entries = params.content
            .split("\n")
            .map(line => line.trim())
            .filter(line => line.length > 5)
            .map(line => ({ content: line }));
          break;
        }
      }

      if (entries.length === 0) {
        return textResult({ imported: 0, message: "No valid entries found in the provided content." });
      }

      // Deduplicate against existing memories
      let imported = 0;
      let skipped = 0;
      const results: { content: string; status: "imported" | "skipped_duplicate" }[] = [];
      const importedIds: string[] = [];

      for (const entry of entries) {
        // Quick dedup: search for similar content via FTS
        const searchTerms = entry.content
          .split(/\s+/)
          .filter(w => w.length > 3)
          // Strip FTS5 special characters/operators
          .map(w => w.replace(/['"(){}*:^~]/g, ""))
          .filter(w => !/^(AND|OR|NOT|NEAR)$/i.test(w))
          .slice(0, 5)
          .join(" ");

        if (searchTerms.length > 0) {
          try {
            const existing = sqlite.prepare(`
              SELECT m.id, m.content FROM memories m
              JOIN memory_fts fts ON fts.rowid = m.rowid
              WHERE memory_fts MATCH ? AND m.deleted_at IS NULL
              LIMIT 3
            `).all(searchTerms) as { id: string; content: string }[];

            const entryWords = new Set(entry.content.toLowerCase().split(/\s+/).filter(w => w.length > 3));
            const isDuplicate = existing.some(ex => {
              const exWords = ex.content.toLowerCase().split(/\s+/).filter(w => w.length > 3);
              const overlap = exWords.filter(w => entryWords.has(w)).length;
              return overlap / Math.max(entryWords.size, 1) > 0.6;
            });

            if (isDuplicate) {
              skipped++;
              results.push({ content: entry.content.slice(0, 80), status: "skipped_duplicate" });
              continue;
            }
          } catch {
            // FTS syntax error — skip dedup check, proceed with import
          }
        }

        // PII detection
        const piiText = entry.content + (entry.detail ? " " + entry.detail : "");
        const piiMatches = detectSensitiveData(piiText);

        // Write the memory via Drizzle ORM (FTS triggers handle indexing automatically)
        const id = generateId();
        const timestamp = now();

        db.insert(memories)
          .values({
            id,
            content: entry.content,
            detail: entry.detail ?? null,
            domain,
            sourceAgentId: "import",
            sourceAgentName: "memory_import",
            sourceType: "inferred",
            sourceDescription: `Imported from ${params.source_type}`,
            confidence: 0.5,
            learnedAt: timestamp,
            hasPiiFlag: piiMatches.length > 0 ? 1 : 0,
          })
          .run();

        // Store embedding if available
        if (vecAvailable) {
          try {
            const embeddingText = entry.content + (entry.detail ? " " + entry.detail : "");
            const emb = await generateEmbedding(embeddingText);
            insertEmbedding(sqlite, id, emb);
          } catch {
            // Non-fatal
          }
        }

        db.insert(memoryEvents)
          .values({
            id: generateId(),
            memoryId: id,
            eventType: "created",
            agentId: "import",
            agentName: "memory_import",
            newValue: JSON.stringify({ content: entry.content, domain, importedFrom: params.source_type }),
            timestamp,
          })
          .run();

        imported++;
        importedIds.push(id);
        results.push({ content: entry.content.slice(0, 80), status: "imported" });
      }

      // Fire-and-forget entity extraction for imported memories
      if (extractionProvider && importedIds.length > 0) {
        (async () => {
          try {
            const existingNames = sqlite
              .prepare(`SELECT DISTINCT entity_name FROM memories WHERE entity_name IS NOT NULL AND deleted_at IS NULL`)
              .all() as { entity_name: string }[];
            const names = existingNames.map((r) => r.entity_name);

            for (const id of importedIds) {
              try {
                const mem = sqlite
                  .prepare(`SELECT content, detail, entity_type FROM memories WHERE id = ? AND deleted_at IS NULL`)
                  .get(id) as { content: string; detail: string | null; entity_type: string | null } | undefined;

                if (!mem || mem.entity_type) continue;

                const extraction = await extractEntity(
                  extractionProvider!,
                  mem.content,
                  mem.detail,
                  names,
                );

                const validation = validateExtraction(extraction);
                if (!validation.valid) continue;

                sqlite.transaction(() => {
                  sqlite.prepare(
                    `UPDATE memories SET entity_type = ?, entity_name = ?, structured_data = ? WHERE id = ? AND entity_type IS NULL AND deleted_at IS NULL`,
                  ).run(extraction.entity_type, extraction.entity_name, JSON.stringify(extraction.structured_data), id);

                  for (const conn of extraction.suggested_connections) {
                    const target = sqlite
                      .prepare(`SELECT id FROM memories WHERE entity_name = ? COLLATE NOCASE AND deleted_at IS NULL LIMIT 1`)
                      .get(conn.target_entity_name) as { id: string } | undefined;

                    if (target && target.id !== id) {
                      sqlite.prepare(
                        `INSERT INTO memory_connections (source_memory_id, target_memory_id, relationship) VALUES (?, ?, ?)`,
                      ).run(id, target.id, conn.relationship);
                    }
                  }
                })();

                if (extraction.entity_name) names.push(extraction.entity_name);
              } catch {
                // Individual extraction failure is non-fatal
              }
            }
            bumpLastModified(sqlite);
          } catch {
            // Background extraction failure is non-fatal
          }
        })();
      }

      // Log the import event
      sqlite.prepare(`
        INSERT INTO memory_events (id, memory_id, event_type, new_value, timestamp)
        VALUES (?, 'system', 'import', ?, ?)
      `).run(
        generateId(),
        JSON.stringify({ source_type: params.source_type, imported, skipped, total_entries: entries.length }),
        now(),
      );

      bumpLastModified(sqlite);

      return textResult({
        imported,
        skipped_duplicates: skipped,
        total_parsed: entries.length,
        note: imported > 0
          ? `Imported ${imported} memories at confidence 0.5 (unreviewed). Confirm them in the dashboard or via memory_confirm to boost confidence.`
          : "All entries were duplicates of existing memories.",
      });
    },
  );

  // --- Cloud Sync ---

  // Cache derived keys in memory for auto-sync after first manual sync
  let cachedSyncKeys: EncryptionKeys | null = null;

  server.tool(
    "memory_sync",
    "Sync memories with cloud. Requires Pro tier setup (passphrase + Turso credentials in ~/.engrams/credentials.json). Push local changes and pull remote changes.",
    {
      passphrase: z.string().describe("Your encryption passphrase. Required on first sync or after restart."),
    },
    async (params) => {
      const creds = loadCredentials();
      if (!creds?.tursoUrl || !creds?.tursoAuthToken) {
        return textResult({ error: "Cloud sync not configured. Set tursoUrl and tursoAuthToken in ~/.engrams/credentials.json or via the dashboard settings." });
      }

      const salt = Buffer.from(creds.salt, "base64");
      const keys = deriveKeys(params.passphrase, salt);
      cachedSyncKeys = keys;

      const result = await sync(sqlite, {
        tursoUrl: creds.tursoUrl,
        tursoAuthToken: creds.tursoAuthToken,
        keys,
      }, creds.deviceId);

      bumpLastModified(sqlite);
      return textResult({ status: "synced", ...result });
    },
  );

  // Optional auto-sync (if Turso is configured)
  const syncCreds = loadCredentials();
  if (syncCreds?.tursoUrl && syncCreds?.tursoAuthToken) {
    const SYNC_INTERVAL = 5 * 60 * 1000; // 5 minutes

    setInterval(async () => {
      if (!cachedSyncKeys) return; // Can't sync until passphrase is provided
      try {
        await sync(sqlite, {
          tursoUrl: syncCreds.tursoUrl!,
          tursoAuthToken: syncCreds.tursoAuthToken!,
          keys: cachedSyncKeys,
        }, syncCreds.deviceId);
      } catch {
        // Silent failure — sync is best-effort
      }
    }, SYNC_INTERVAL);
  }

  // --- Resources ---

  server.resource("memory-index", "memory://index", async (uri) => {
    const domains = sqlite
      .prepare(
        `SELECT domain, COUNT(*) as count FROM memories WHERE deleted_at IS NULL GROUP BY domain`,
      )
      .all() as { domain: string; count: number }[];

    const totalResult = sqlite
      .prepare(`SELECT COUNT(*) as total FROM memories WHERE deleted_at IS NULL`)
      .get() as { total: number };

    const confidenceDist = sqlite
      .prepare(`
        SELECT
          SUM(CASE WHEN confidence >= 0.9 THEN 1 ELSE 0 END) as high,
          SUM(CASE WHEN confidence >= 0.5 AND confidence < 0.9 THEN 1 ELSE 0 END) as medium,
          SUM(CASE WHEN confidence < 0.5 THEN 1 ELSE 0 END) as low
        FROM memories WHERE deleted_at IS NULL
      `)
      .get() as { high: number; medium: number; low: number };

    return {
      contents: [
        {
          uri: uri.href,
          mimeType: "application/json",
          text: JSON.stringify(
            { total: totalResult.total, domains, confidenceDistribution: confidenceDist },
            null,
            2,
          ),
        },
      ],
    };
  });

  server.resource(
    "memory-domain",
    new ResourceTemplate("memory://domain/{name}", { list: undefined }),
    async (uri, params) => {
      const name = params.name as string;
      const results = sqlite
        .prepare(
          `SELECT * FROM memories WHERE deleted_at IS NULL AND domain = ? ORDER BY confidence DESC`,
        )
        .all(name);

      return {
        contents: [
          {
            uri: uri.href,
            mimeType: "application/json",
            text: JSON.stringify({ domain: name, memories: results }, null, 2),
          },
        ],
      };
    },
  );

  server.resource("memory-recent", "memory://recent", async (uri) => {
    const results = sqlite
      .prepare(
        `SELECT * FROM memories WHERE deleted_at IS NULL ORDER BY learned_at DESC LIMIT 20`,
      )
      .all();

    return {
      contents: [
        {
          uri: uri.href,
          mimeType: "application/json",
          text: JSON.stringify({ memories: results, count: results.length }, null, 2),
        },
      ],
    };
  });

  // --- Start ---

  // Start HTTP API for dashboard mutations (opt-in via --http flag or ENGRAMS_HTTP=1)
  if (process.argv.includes("--http") || process.env.ENGRAMS_HTTP === "1") {
    const { startHttpApi } = await import("./http.js");
    startHttpApi(db, sqlite);
  }

  const transport = new StdioServerTransport();
  await server.connect(transport);
}

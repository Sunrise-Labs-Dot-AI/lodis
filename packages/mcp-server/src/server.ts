import { McpServer, ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { eq, and, isNull, desc, sql, gte } from "drizzle-orm";
import { randomBytes } from "crypto";
import Anthropic from "@anthropic-ai/sdk";
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
} from "@engrams/core";
import type { SourceType, Relationship } from "@engrams/core";

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
      }

      // --- Insert new memory ---
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

      // Proactive split detection
      const fullText = params.content + (params.detail ? " " + params.detail : "");
      const sentences = fullText.split(/(?<=[.!?])\s+/).filter((s) => s.length > 10);
      let splitSuggestion: { should_split: boolean; parts?: { content: string; detail?: string }[] } | null = null;

      if (sentences.length >= 3 && process.env.ANTHROPIC_API_KEY) {
        try {
          const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
          const resp = await client.messages.create({
            model: "claude-haiku-4-5-20251001",
            max_tokens: 512,
            messages: [
              {
                role: "user",
                content: `Analyze this memory and determine if it contains multiple distinct topics that should be stored separately. Only suggest splitting if the topics are genuinely independent (would be searched for separately).

Memory content: ${JSON.stringify(params.content)}
Memory detail: ${JSON.stringify(params.detail ?? null)}

Respond with ONLY valid JSON:
- If it should NOT be split: {"should_split": false}
- If it SHOULD be split: {"should_split": true, "parts": [{"content": "...", "detail": "..."}, ...]}

Each part should have a concise "content" (one sentence) and optional "detail". Do not split if the content is a single coherent topic.`,
              },
            ],
          });
          const text = resp.content[0].type === "text" ? resp.content[0].text : "";
          splitSuggestion = JSON.parse(text);
        } catch {
          // LLM call failed — skip split suggestion
        }
      }

      bumpLastModified(sqlite);

      const result: Record<string, unknown> = { id, confidence, domain: params.domain ?? "general", created: true };
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
      minConfidence: z.number().optional().describe("Minimum confidence threshold"),
      limit: z.number().optional().describe("Max results (default 20)"),
      expand: z.boolean().optional().describe("Include connected memories (default true)"),
      maxDepth: z.number().optional().describe("Max graph expansion depth (default 3)"),
      similarityThreshold: z.number().optional().describe("Min similarity for connected memories (default 0.5)"),
    },
    async (params) => {
      const limit = params.limit ?? 20;

      const { results: searchResults, cached: wasCached } = await hybridSearch(sqlite, params.query, {
        domain: params.domain,
        minConfidence: params.minConfidence,
        limit,
        expand: params.expand,
        maxDepth: params.maxDepth,
        similarityThreshold: params.similarityThreshold,
      });

      if (searchResults.length === 0) {
        return textResult({ memories: [], count: 0, totalConnected: 0, cached: wasCached });
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
        .enum(["influences", "supports", "contradicts", "related", "learned-together"])
        .describe("Type of relationship"),
    },
    async (params) => {
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
      sortBy: z.enum(["confidence", "recency"]).optional().describe("Sort order (default: confidence)"),
      limit: z.number().optional().describe("Max results (default 20)"),
      offset: z.number().optional().describe("Offset for pagination"),
    },
    async (params) => {
      const limit = params.limit ?? 20;
      const offset = params.offset ?? 0;
      const sortBy = params.sortBy ?? "confidence";

      let query = `SELECT * FROM memories WHERE deleted_at IS NULL`;
      const queryParams: unknown[] = [];

      if (params.domain) {
        query += ` AND domain = ?`;
        queryParams.push(params.domain);
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

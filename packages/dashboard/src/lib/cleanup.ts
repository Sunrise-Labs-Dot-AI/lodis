import { getMemories, getReadDb, type MemoryRow } from "./db";

// --- Types ---

export type SuggestionType = "merge" | "split" | "contradiction" | "stale" | "update";

export interface CleanupSuggestion {
  type: SuggestionType;
  memoryIds: string[];
  description: string;
  proposedAction: string;
  /** For merge: which memory to keep (set by LLM on expand) */
  keepId?: string;
  /** For split: proposed parts (set by LLM on expand) */
  parts?: { content: string; detail: string | null }[];
  /** For contradiction: the conflicting statements (set by LLM on expand) */
  conflicts?: { id: string; statement: string }[];
  /** Memories included in this suggestion (populated during scan) */
  memories?: { id: string; content: string; detail: string | null; domain: string; confidence: number }[];
  /** Whether LLM has enriched this suggestion */
  expanded?: boolean;
}

// --- Algorithmic detection (zero API cost) ---

/** Stale: low confidence, never used, learned 30+ days ago */
function findStale(memories: MemoryRow[]): CleanupSuggestion[] {
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
  return memories
    .filter(
      (m) =>
        m.confidence < 0.5 &&
        m.used_count === 0 &&
        m.learned_at !== null &&
        m.learned_at < thirtyDaysAgo,
    )
    .map((m) => ({
      type: "stale" as const,
      memoryIds: [m.id],
      description: `${(m.confidence * 100).toFixed(0)}% confidence, never used, learned over 30 days ago`,
      proposedAction: "Confirm if still accurate, or delete",
      memories: [{ id: m.id, content: m.content, detail: m.detail, domain: m.domain, confidence: m.confidence }],
      expanded: true,
    }));
}

/** Temporal/outdated: regex for date patterns and temporal language */
const TEMPORAL_PATTERNS = [
  /\bnext\s+(monday|tuesday|wednesday|thursday|friday|saturday|sunday|week|month)\b/i,
  /\bthis\s+(week|month|quarter|sprint)\b/i,
  /\bcurrently\s/i,
  /\bright\s+now\b/i,
  /\bat\s+the\s+moment\b/i,
  /\b(january|february|march|april|may|june|july|august|september|october|november|december)\s+\d{1,2}(,?\s+20\d{2})?\b/i,
  /\b20\d{2}-\d{2}-\d{2}\b/,
  /\btoday\b/i,
  /\btomorrow\b/i,
  /\byesterday\b/i,
];

function findTemporal(memories: MemoryRow[]): CleanupSuggestion[] {
  const results: CleanupSuggestion[] = [];
  for (const m of memories) {
    const text = m.content + (m.detail ? " " + m.detail : "");
    const matched = TEMPORAL_PATTERNS.find((p) => p.test(text));
    if (matched) {
      const matchStr = text.match(matched)?.[0] ?? "";
      results.push({
        type: "update",
        memoryIds: [m.id],
        description: `Contains temporal language ("${matchStr}") that may be outdated`,
        proposedAction: "Review and correct or delete if no longer accurate",
        memories: [{ id: m.id, content: m.content, detail: m.detail, domain: m.domain, confidence: m.confidence }],
        expanded: true,
      });
    }
  }
  return results;
}

/** Split candidates: memories with 3+ sentences or multiple semicolons */
function findSplitCandidates(memories: MemoryRow[]): CleanupSuggestion[] {
  const results: CleanupSuggestion[] = [];
  for (const m of memories) {
    const text = m.content + (m.detail ? " " + m.detail : "");
    const sentences = text.split(/[.!?]+/).filter((s) => s.trim().length > 10);
    const semicolons = text.split(";").filter((s) => s.trim().length > 10);
    if (sentences.length >= 3 || semicolons.length >= 3) {
      results.push({
        type: "split",
        memoryIds: [m.id],
        description: `Covers ${Math.max(sentences.length, semicolons.length)} topics — may be better as separate memories`,
        proposedAction: "Click expand to see proposed split",
        memories: [{ id: m.id, content: m.content, detail: m.detail, domain: m.domain, confidence: m.confidence }],
        expanded: false, // needs LLM to propose parts
      });
    }
  }
  return results;
}

/**
 * Duplicate clusters: use embeddings (cosine similarity) to find groups of
 * near-identical memories. Requires sqlite-vec extension loaded on the DB.
 */
function findDuplicateClusters(memories: MemoryRow[]): CleanupSuggestion[] {
  const db = getReadDb();

  // Check if memory_embeddings table exists and has data
  let hasVec = false;
  try {
    const row = db.prepare(`SELECT COUNT(*) as c FROM memory_embeddings`).get() as { c: number } | undefined;
    hasVec = !!row && row.c > 0;
  } catch {
    // sqlite-vec not loaded or table doesn't exist
  }

  if (!hasVec) return [];

  // Load sqlite-vec extension so we can query
  try {
    const sqliteVec = require("sqlite-vec");
    sqliteVec.load(db);
  } catch {
    return []; // Can't load extension — skip vector-based dedup
  }

  // For each memory, find its nearest neighbor by cosine distance
  const memMap = new Map(memories.map((m) => [m.id, m]));
  const clustered = new Set<string>();
  const results: CleanupSuggestion[] = [];

  for (const m of memories) {
    if (clustered.has(m.id)) continue;

    let neighbors: { memory_id: string; distance: number }[];
    try {
      neighbors = db
        .prepare(
          `SELECT e2.memory_id, vec_distance_cosine(e1.embedding, e2.embedding) as distance
           FROM memory_embeddings e1, memory_embeddings e2
           WHERE e1.memory_id = ? AND e2.memory_id != e1.memory_id AND distance < 0.3
           ORDER BY distance LIMIT 5`,
        )
        .all(m.id) as { memory_id: string; distance: number }[];
    } catch {
      // Fallback: use MATCH syntax
      try {
        const embedding = db
          .prepare(`SELECT embedding FROM memory_embeddings WHERE memory_id = ?`)
          .get(m.id) as { embedding: Buffer } | undefined;
        if (!embedding) continue;
        neighbors = db
          .prepare(
            `SELECT memory_id, distance FROM memory_embeddings WHERE embedding MATCH ? AND memory_id != ? ORDER BY distance LIMIT 5`,
          )
          .all(embedding.embedding, m.id) as { memory_id: string; distance: number }[];
        neighbors = neighbors.filter((n) => n.distance < 0.3);
      } catch {
        continue;
      }
    }

    const cluster = neighbors
      .filter((n) => memMap.has(n.memory_id) && !clustered.has(n.memory_id))
      .map((n) => n.memory_id);

    if (cluster.length === 0) continue;

    const allIds = [m.id, ...cluster];
    for (const id of allIds) clustered.add(id);

    const clusterMemories = allIds
      .map((id) => memMap.get(id)!)
      .map((mem) => ({
        id: mem.id,
        content: mem.content,
        detail: mem.detail,
        domain: mem.domain,
        confidence: mem.confidence,
      }));

    results.push({
      type: "merge",
      memoryIds: allIds,
      description: `${allIds.length} memories express similar information`,
      proposedAction: "Click expand to have Sonnet pick the best version",
      memories: clusterMemories,
      expanded: false, // needs LLM to pick which to keep
    });
  }

  return results;
}

/**
 * Contradiction candidates: within each domain, find memory pairs with
 * moderate similarity (0.3-0.6 cosine distance) — similar topic but
 * different enough to potentially conflict.
 */
function findContradictionCandidates(memories: MemoryRow[]): CleanupSuggestion[] {
  const db = getReadDb();

  let hasVec = false;
  try {
    const row = db.prepare(`SELECT COUNT(*) as c FROM memory_embeddings`).get() as { c: number } | undefined;
    hasVec = !!row && row.c > 0;
  } catch {}

  if (!hasVec) return [];

  const memMap = new Map(memories.map((m) => [m.id, m]));
  const seen = new Set<string>();
  const results: CleanupSuggestion[] = [];

  // Group by domain to reduce noise
  const byDomain = new Map<string, MemoryRow[]>();
  for (const m of memories) {
    const arr = byDomain.get(m.domain) || [];
    arr.push(m);
    byDomain.set(m.domain, arr);
  }

  for (const [, domainMemories] of byDomain) {
    if (domainMemories.length < 2) continue;

    for (const m of domainMemories) {
      try {
        const embedding = db
          .prepare(`SELECT embedding FROM memory_embeddings WHERE memory_id = ?`)
          .get(m.id) as { embedding: Buffer } | undefined;
        if (!embedding) continue;

        const neighbors = db
          .prepare(
            `SELECT memory_id, distance FROM memory_embeddings WHERE embedding MATCH ? AND memory_id != ? ORDER BY distance LIMIT 10`,
          )
          .all(embedding.embedding, m.id) as { memory_id: string; distance: number }[];

        // Moderate similarity: same topic area but different content
        const candidates = neighbors.filter(
          (n) =>
            n.distance >= 0.3 &&
            n.distance < 0.6 &&
            memMap.has(n.memory_id) &&
            memMap.get(n.memory_id)!.domain === m.domain,
        );

        for (const c of candidates) {
          const key = [m.id, c.memory_id].sort().join("|");
          if (seen.has(key)) continue;
          seen.add(key);

          const other = memMap.get(c.memory_id)!;
          results.push({
            type: "contradiction",
            memoryIds: [m.id, c.memory_id],
            description: `Same domain ("${m.domain}"), similar topic but different assertions`,
            proposedAction: "Click expand to check if these conflict",
            memories: [
              { id: m.id, content: m.content, detail: m.detail, domain: m.domain, confidence: m.confidence },
              { id: other.id, content: other.content, detail: other.detail, domain: other.domain, confidence: other.confidence },
            ],
            expanded: false, // needs LLM to determine if actually contradictory
          });
        }
      } catch {
        continue;
      }
    }
  }

  return results;
}

// --- Main scan (zero API cost) ---

const TYPE_PRIORITY: Record<SuggestionType, number> = {
  contradiction: 0,
  merge: 1,
  split: 2,
  stale: 3,
  update: 4,
};

export function scanForSuggestions(): CleanupSuggestion[] {
  const memories = getMemories();
  if (memories.length === 0) return [];

  const suggestions = [
    ...findDuplicateClusters(memories),
    ...findContradictionCandidates(memories),
    ...findSplitCandidates(memories),
    ...findStale(memories),
    ...findTemporal(memories),
  ];

  suggestions.sort((a, b) => TYPE_PRIORITY[a.type] - TYPE_PRIORITY[b.type]);
  return suggestions;
}

// --- LLM expansion (on-demand, per suggestion) ---

import { parseLLMJson } from "@engrams/core";
import type { LLMProvider } from "@engrams/core";

export async function expandMergeSuggestion(
  suggestion: CleanupSuggestion,
  provider: LLMProvider,
): Promise<CleanupSuggestion> {
  if (!suggestion.memories || suggestion.memories.length < 2) return suggestion;

  const prompt = `These memories express similar information. Pick the single best-worded one to keep. Return ONLY a JSON object: {"keepId": "id_of_best", "reason": "why"}

Memories:
${suggestion.memories.map((m) => `- ID: ${m.id}\n  Content: ${JSON.stringify(m.content)}\n  Detail: ${JSON.stringify(m.detail)}`).join("\n\n")}`;

  const text = await provider.complete(prompt, { maxTokens: 512, json: true });
  try {
    const result = parseLLMJson<{ keepId: string; reason: string }>(text);
    if (suggestion.memoryIds.includes(result.keepId)) {
      return {
        ...suggestion,
        keepId: result.keepId,
        description: result.reason,
        proposedAction: "Keep the best version, delete duplicates",
        expanded: true,
      };
    }
  } catch {}
  // Fallback: pick highest confidence
  const best = suggestion.memories.reduce((a, b) => (a.confidence >= b.confidence ? a : b));
  return { ...suggestion, keepId: best.id, expanded: true };
}

export async function expandSplitSuggestion(
  suggestion: CleanupSuggestion,
  provider: LLMProvider,
): Promise<CleanupSuggestion> {
  if (!suggestion.memories || suggestion.memories.length < 1) return suggestion;
  const mem = suggestion.memories[0];

  const prompt = `This memory covers multiple topics. Split it into the minimum number of independent memories.

Content: ${JSON.stringify(mem.content)}
Detail: ${JSON.stringify(mem.detail)}

Each memory should have a clear "content" (one sentence) and optional "detail". Return ONLY a JSON array: [{"content": "...", "detail": "..." or null}, ...]`;

  const text = await provider.complete(prompt, { maxTokens: 1024, json: true });
  try {
    const parts = parseLLMJson<{ content: string; detail: string | null }[]>(text);
    if (Array.isArray(parts) && parts.length >= 2) {
      return { ...suggestion, parts, expanded: true };
    }
  } catch {}
  return { ...suggestion, expanded: true, parts: undefined };
}

export async function expandContradictionSuggestion(
  suggestion: CleanupSuggestion,
  provider: LLMProvider,
): Promise<CleanupSuggestion> {
  if (!suggestion.memories || suggestion.memories.length < 2) return suggestion;

  const prompt = `Do these two memories contradict each other? If yes, return {"contradicts": true, "explanation": "...", "conflicts": [{"id": "id1", "statement": "what it claims"}, {"id": "id2", "statement": "what it claims"}]}. If they don't actually conflict, return {"contradicts": false}.

Memory 1 (${suggestion.memories[0].id}): ${JSON.stringify(suggestion.memories[0].content)}
Memory 2 (${suggestion.memories[1].id}): ${JSON.stringify(suggestion.memories[1].content)}

Return ONLY JSON.`;

  const text = await provider.complete(prompt, { maxTokens: 512, json: true });
  try {
    const result = parseLLMJson<{ contradicts: boolean; explanation?: string; conflicts?: { id: string; statement: string }[] }>(text);
    if (result.contradicts === false) {
      return { ...suggestion, expanded: true, description: "Not a contradiction (false positive)", proposedAction: "Dismiss" };
    }
    if (result.contradicts && result.conflicts) {
      return {
        ...suggestion,
        description: result.explanation ?? suggestion.description,
        conflicts: result.conflicts,
        expanded: true,
      };
    }
  } catch {}
  return { ...suggestion, expanded: true };
}

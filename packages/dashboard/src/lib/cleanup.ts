import { getMemories, type MemoryRow } from "./db";

// Inline PII detection patterns (avoids @engrams/core import issues in hosted environments)
const PII_PATTERNS: { type: string; pattern: RegExp }[] = [
  { type: "ssn", pattern: /\b\d{3}-\d{2}-\d{4}\b/g },
  { type: "credit_card", pattern: /\b(?:\d[ -]*?){13,19}\b/g },
  { type: "api_key", pattern: /\b(?:sk-[a-zA-Z0-9]{20,}|ghp_[a-zA-Z0-9]{36,}|xoxb-[a-zA-Z0-9-]+|xoxp-[a-zA-Z0-9-]+|AKIA[A-Z0-9]{16}|rk_live_[a-zA-Z0-9]+|rk_test_[a-zA-Z0-9]+|pk_live_[a-zA-Z0-9]+|pk_test_[a-zA-Z0-9]+)\b/g },
  { type: "email", pattern: /\b[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}\b/g },
  { type: "phone", pattern: /(?:\+?1[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}\b/g },
  { type: "ip_address", pattern: /\b(?:(?:25[0-5]|2[0-4]\d|[01]?\d\d?)\.){3}(?:25[0-5]|2[0-4]\d|[01]?\d\d?)\b/g },
];

function detectPii(text: string): string[] {
  const types: Set<string> = new Set();
  for (const { type, pattern } of PII_PATTERNS) {
    pattern.lastIndex = 0;
    if (type === "credit_card") {
      let m: RegExpExecArray | null;
      while ((m = pattern.exec(text)) !== null) {
        const digits = m[0].replace(/[^0-9]/g, "");
        if (digits.length >= 13 && digits.length <= 19) types.add(type);
      }
    } else if (type === "phone") {
      let m: RegExpExecArray | null;
      while ((m = pattern.exec(text)) !== null) {
        const digits = m[0].replace(/[^0-9]/g, "");
        if (digits.length >= 10) types.add(type);
      }
    } else {
      if (pattern.test(text)) types.add(type);
    }
  }
  return [...types];
}

// --- Types ---

export type SuggestionType = "merge" | "split" | "contradiction" | "stale" | "update" | "pii" | "promote" | "expired" | "stale_project";

export interface CleanupSuggestion {
  type: SuggestionType;
  memoryIds: string[];
  description: string;
  proposedAction: string;
  keepId?: string;
  parts?: { content: string; detail: string | null }[];
  conflicts?: { id: string; statement: string }[];
  memories?: { id: string; content: string; detail: string | null; domain: string; confidence: number; entity_type?: string | null }[];
  piiTypes?: string[];
  expanded?: boolean;
}

export interface HealthScore {
  overall: number; // 0-100
  totalMemories: number;
  factors: {
    name: string;
    score: number; // 0-100
    detail: string;
  }[];
  autoHandled: {
    temporalDegraded: number;
    staleDegrading: number;
    description: string;
  };
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
      memories: [{ id: m.id, content: m.content, detail: m.detail, domain: m.domain, confidence: m.confidence, entity_type: m.entity_type }],
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

function countTemporal(memories: MemoryRow[]): number {
  let count = 0;
  for (const m of memories) {
    const text = m.content + (m.detail ? " " + m.detail : "");
    if (TEMPORAL_PATTERNS.some((p) => p.test(text))) count++;
  }
  return count;
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
        memories: [{ id: m.id, content: m.content, detail: m.detail, domain: m.domain, confidence: m.confidence, entity_type: m.entity_type }],
        expanded: false,
      });
    }
  }
  return results;
}

/**
 * Duplicate clusters: text-based bigram Jaccard similarity to find
 * near-identical memories.
 */
function findDuplicateClusters(memories: MemoryRow[]): CleanupSuggestion[] {
  if (memories.length < 2) return [];

  function bigrams(text: string): Set<string> {
    const words = text.toLowerCase().split(/\s+/).filter(w => w.length > 2);
    const set = new Set<string>();
    for (let i = 0; i < words.length - 1; i++) {
      set.add(words[i] + " " + words[i + 1]);
    }
    return set;
  }

  function jaccard(a: Set<string>, b: Set<string>): number {
    if (a.size === 0 || b.size === 0) return 0;
    let intersection = 0;
    for (const item of a) {
      if (b.has(item)) intersection++;
    }
    return intersection / (a.size + b.size - intersection);
  }

  const memBigrams = memories.map(m => ({
    id: m.id,
    bigrams: bigrams(m.content + (m.detail ? " " + m.detail : "")),
  }));

  const clustered = new Set<string>();
  const results: CleanupSuggestion[] = [];

  for (let i = 0; i < memBigrams.length; i++) {
    if (clustered.has(memBigrams[i].id)) continue;

    const cluster: string[] = [];
    for (let j = i + 1; j < memBigrams.length; j++) {
      if (clustered.has(memBigrams[j].id)) continue;
      const similarity = jaccard(memBigrams[i].bigrams, memBigrams[j].bigrams);
      if (similarity > 0.5) {
        cluster.push(memBigrams[j].id);
      }
    }

    if (cluster.length === 0) continue;

    const allIds = [memBigrams[i].id, ...cluster];
    for (const id of allIds) clustered.add(id);

    const memMap = new Map(memories.map(m => [m.id, m]));
    const clusterMemories = allIds
      .map(id => memMap.get(id)!)
      .map(mem => ({
        id: mem.id,
        content: mem.content,
        detail: mem.detail,
        domain: mem.domain,
        confidence: mem.confidence,
        entity_type: mem.entity_type,
      }));

    results.push({
      type: "merge",
      memoryIds: allIds,
      description: `${allIds.length} memories express similar information`,
      proposedAction: "Click expand to have Sonnet pick the best version",
      memories: clusterMemories,
      expanded: false,
    });
  }

  return results;
}

/**
 * Contradiction candidates: within each domain, find memory pairs with
 * moderate text similarity — same topic but different enough to potentially conflict.
 */
function findContradictionCandidates(memories: MemoryRow[]): CleanupSuggestion[] {
  function wordSet(text: string): Set<string> {
    return new Set(text.toLowerCase().split(/\s+/).filter(w => w.length > 3));
  }

  function wordOverlap(a: Set<string>, b: Set<string>): number {
    if (a.size === 0 || b.size === 0) return 0;
    let intersection = 0;
    for (const item of a) {
      if (b.has(item)) intersection++;
    }
    return intersection / Math.min(a.size, b.size);
  }

  const byDomain = new Map<string, MemoryRow[]>();
  for (const m of memories) {
    const arr = byDomain.get(m.domain) || [];
    arr.push(m);
    byDomain.set(m.domain, arr);
  }

  const seen = new Set<string>();
  const results: CleanupSuggestion[] = [];

  for (const [, domainMemories] of byDomain) {
    if (domainMemories.length < 2) continue;

    const memWords = domainMemories.map(m => ({
      mem: m,
      words: wordSet(m.content + (m.detail ? " " + m.detail : "")),
    }));

    for (let i = 0; i < memWords.length; i++) {
      for (let j = i + 1; j < memWords.length; j++) {
        const key = [memWords[i].mem.id, memWords[j].mem.id].sort().join("|");
        if (seen.has(key)) continue;

        const overlap = wordOverlap(memWords[i].words, memWords[j].words);
        if (overlap >= 0.3 && overlap < 0.7) {
          seen.add(key);
          results.push({
            type: "contradiction",
            memoryIds: [memWords[i].mem.id, memWords[j].mem.id],
            description: `Same domain ("${memWords[i].mem.domain}"), similar topic but different assertions`,
            proposedAction: "Click expand to check if these conflict",
            memories: [
              { id: memWords[i].mem.id, content: memWords[i].mem.content, detail: memWords[i].mem.detail, domain: memWords[i].mem.domain, confidence: memWords[i].mem.confidence, entity_type: memWords[i].mem.entity_type },
              { id: memWords[j].mem.id, content: memWords[j].mem.content, detail: memWords[j].mem.detail, domain: memWords[j].mem.domain, confidence: memWords[j].mem.confidence, entity_type: memWords[j].mem.entity_type },
            ],
            expanded: false,
          });
        }
      }
    }
  }

  return results;
}

/** PII: memories containing sensitive data (SSNs, API keys, emails, etc.) */
function findPiiMemories(memories: MemoryRow[]): CleanupSuggestion[] {
  const results: CleanupSuggestion[] = [];
  for (const m of memories) {
    const text = m.content + (m.detail ? " " + m.detail : "");
    const types = detectPii(text);
    if (types.length === 0) continue;
    const typeLabels = types.map((t) => t.replace(/_/g, " ")).join(", ");
    results.push({
      type: "pii",
      memoryIds: [m.id],
      description: `Contains sensitive data: ${typeLabels}`,
      proposedAction: "Redact the sensitive data or delete the memory",
      memories: [{ id: m.id, content: m.content, detail: m.detail, domain: m.domain, confidence: m.confidence, entity_type: m.entity_type }],
      piiTypes: types,
      expanded: true,
    });
  }
  return results;
}

/** Promote to canonical: confirmed 3+ times, confidence >= 0.95, not already canonical */
function findPromoteCandidates(memories: MemoryRow[]): CleanupSuggestion[] {
  return memories
    .filter(
      (m) =>
        m.confirmed_count >= 3 &&
        m.confidence >= 0.95 &&
        m.permanence !== "canonical",
    )
    .map((m) => ({
      type: "promote" as const,
      memoryIds: [m.id],
      description: `Confirmed ${m.confirmed_count}x with ${(m.confidence * 100).toFixed(0)}% confidence — candidate for canonical status`,
      proposedAction: "Pin as canonical (decay-immune permanent knowledge)",
      memories: [{ id: m.id, content: m.content, detail: m.detail, domain: m.domain, confidence: m.confidence, entity_type: m.entity_type }],
      expanded: true,
    }));
}

/** Expired ephemeral: past TTL, should be cleaned up */
function findExpiredEphemeral(memories: MemoryRow[]): CleanupSuggestion[] {
  const now = new Date().toISOString();
  return memories
    .filter(
      (m) =>
        m.expires_at !== null &&
        m.expires_at < now &&
        m.permanence === "ephemeral",
    )
    .map((m) => ({
      type: "expired" as const,
      memoryIds: [m.id],
      description: `Ephemeral memory expired — TTL passed`,
      proposedAction: "Delete expired memory",
      memories: [{ id: m.id, content: m.content, detail: m.detail, domain: m.domain, confidence: m.confidence, entity_type: m.entity_type }],
      expanded: true,
    }));
}

/** Stale project context: project-type entity, 90+ days idle, offer archive */
function findStaleProjectContext(memories: MemoryRow[]): CleanupSuggestion[] {
  const ninetyDaysAgo = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString();
  return memories
    .filter(
      (m) =>
        m.entity_type === "project" &&
        m.permanence !== "archived" &&
        m.permanence !== "canonical" &&
        m.used_count === 0 &&
        m.confirmed_count === 0 &&
        m.learned_at !== null &&
        m.learned_at < ninetyDaysAgo,
    )
    .map((m) => ({
      type: "stale_project" as const,
      memoryIds: [m.id],
      description: `Project context idle for 90+ days, never used or confirmed`,
      proposedAction: "Archive to keep but deprioritize, or delete",
      memories: [{ id: m.id, content: m.content, detail: m.detail, domain: m.domain, confidence: m.confidence, entity_type: m.entity_type }],
      expanded: true,
    }));
}

// --- Health Score ---

function computeHealthScore(memories: MemoryRow[], suggestions: CleanupSuggestion[]): HealthScore {
  const total = memories.length;
  if (total === 0) {
    return {
      overall: 100,
      totalMemories: 0,
      factors: [],
      autoHandled: { temporalDegraded: 0, staleDegrading: 0, description: "No memories to maintain." },
    };
  }

  // Factor 1: Privacy (no sensitive data exposed)
  const piiCount = suggestions.filter(s => s.type === "pii").length;
  const privacyScore = piiCount === 0 ? 100 : Math.max(0, 100 - piiCount * 25); // Each PII memory costs 25 points

  // Factor 2: Redundancy (fewer duplicates = better)
  const mergeCount = suggestions.filter(s => s.type === "merge").reduce((sum, s) => sum + s.memoryIds.length - 1, 0);
  const redundancyPct = mergeCount / total;
  const redundancyScore = Math.max(0, 100 - redundancyPct * 500); // 20% redundancy = 0 score

  // Factor 3: Classification coverage (entity types assigned)
  const classified = memories.filter(m => m.entity_type != null).length;
  const classifiedPct = classified / total;
  const classificationScore = Math.min(100, classifiedPct * 120); // 83% = 100 score

  // Factor 4: Engagement (memories actually being used)
  const engaged = memories.filter(m => m.used_count > 0 || m.confirmed_count > 0).length;
  const engagedPct = engaged / total;
  const engagementScore = Math.min(100, engagedPct * 200); // 50% engaged = 100 score

  // Factor 5: Freshness (not too many stale temporal references)
  const temporalCount = countTemporal(memories);
  const fourteenDaysAgo = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString();
  const staleTemporalCount = memories.filter(m => {
    if (!m.learned_at || m.learned_at > fourteenDaysAgo) return false;
    const text = m.content + (m.detail ? " " + m.detail : "");
    return TEMPORAL_PATTERNS.some(p => p.test(text));
  }).length;
  const freshnessScore = temporalCount === 0 ? 100 : Math.max(0, 100 - (staleTemporalCount / temporalCount) * 100);

  // Factor 6: Signal quality (contradictions indicate confusion)
  const contradictionCount = suggestions.filter(s => s.type === "contradiction").length;
  const contradictionScore = Math.max(0, 100 - contradictionCount * 15); // Each costs 15 points

  const overall = Math.round(
    privacyScore * 0.20 +
    redundancyScore * 0.20 +
    classificationScore * 0.10 +
    engagementScore * 0.15 +
    freshnessScore * 0.15 +
    contradictionScore * 0.20
  );

  // Count auto-handled items
  const staleDegrading = memories.filter(m => m.used_count === 0 && m.confirmed_count === 0 && m.confidence < 0.9).length;

  const autoHandledParts: string[] = [];
  if (staleTemporalCount > 0) autoHandledParts.push(`${staleTemporalCount} temporal memories degraded`);
  if (staleDegrading > 0) autoHandledParts.push(`${staleDegrading} unused memories decaying`);

  return {
    overall: Math.min(100, Math.max(0, overall)),
    totalMemories: total,
    factors: [
      { name: "Privacy", score: Math.round(privacyScore), detail: piiCount === 0 ? "No sensitive data detected" : `${piiCount} ${piiCount === 1 ? "memory contains" : "memories contain"} sensitive data` },
      { name: "Uniqueness", score: Math.round(redundancyScore), detail: mergeCount === 0 ? "No duplicates detected" : `${mergeCount} redundant memories found` },
      { name: "Classification", score: Math.round(classificationScore), detail: `${classified}/${total} memories have entity types` },
      { name: "Engagement", score: Math.round(engagementScore), detail: `${engaged}/${total} memories have been used or confirmed` },
      { name: "Freshness", score: Math.round(freshnessScore), detail: staleTemporalCount === 0 ? "No stale temporal references" : `${staleTemporalCount} stale temporal references` },
      { name: "Consistency", score: Math.round(contradictionScore), detail: contradictionCount === 0 ? "No contradictions detected" : `${contradictionCount} potential contradictions` },
    ],
    autoHandled: {
      temporalDegraded: staleTemporalCount,
      staleDegrading,
      description: autoHandledParts.length > 0
        ? `The system is automatically handling: ${autoHandledParts.join(", ")}.`
        : "Nothing to auto-handle right now.",
    },
  };
}

// --- Main scan ---

const TYPE_PRIORITY: Record<SuggestionType, number> = {
  pii: 0,
  expired: 1,
  contradiction: 2,
  merge: 3,
  split: 4,
  stale: 5,
  stale_project: 6,
  promote: 7,
  update: 8,
};

export interface ScanResult {
  health: HealthScore;
  /** Only genuine judgment calls — contradictions and ambiguous merges */
  actionable: CleanupSuggestion[];
  /** All suggestions for reference */
  allSuggestions: CleanupSuggestion[];
}

export async function scanForSuggestions(userId?: string | null): Promise<ScanResult> {
  const memories = await getMemories(undefined, userId);
  if (memories.length === 0) {
    return {
      health: computeHealthScore([], []),
      actionable: [],
      allSuggestions: [],
    };
  }

  const allSuggestions = [
    ...findPiiMemories(memories),
    ...findExpiredEphemeral(memories),
    ...findDuplicateClusters(memories),
    ...findContradictionCandidates(memories),
    ...findSplitCandidates(memories),
    ...findStale(memories),
    ...findStaleProjectContext(memories),
    ...findPromoteCandidates(memories),
  ];

  allSuggestions.sort((a, b) => TYPE_PRIORITY[a.type] - TYPE_PRIORITY[b.type]);

  const health = computeHealthScore(memories, allSuggestions);

  // Actionable = only things that need human judgment
  // PII always needs human input — user decides redact vs delete
  // Contradictions always need human input
  // Merges need human input (auto-merge handles the obvious ones on write)
  // Splits with 3+ sentences may need review
  // Stale items are auto-handled by decay — only surface if severely stale
  const actionable = allSuggestions
    .filter(s => s.type === "pii" || s.type === "expired" || s.type === "contradiction" || s.type === "merge" || s.type === "split" || s.type === "stale" || s.type === "stale_project" || s.type === "promote")
    .slice(0, 10); // Max 10 actionable items (PII/expired get priority via sort order)

  return { health, actionable, allSuggestions };
}

// --- LLM expansion (on-demand, per suggestion) ---

import { parseLLMJson } from "@engrams/core/llm-utils";
import type { LLMProvider } from "@engrams/core/llm";

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

import type { Client } from "@libsql/client";
import { hybridSearch, type ExpandedResult } from "./search.js";
import { effectivePermanence } from "./confidence.js";
import { getProfile } from "./entity-profiles.js";
import { rerank } from "./reranker.js";

// --- Token estimation ---

/** Conservative estimate: ~4 chars per token for English text */
function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

// --- Reranker input text (mirrors the embeddings.ts concat convention) ---

function memoryRerankText(r: ExpandedResult): string {
  const content = (r.memory.content as string | null) ?? "";
  const detail = r.memory.detail as string | null;
  return detail ? `${content} ${detail}` : content;
}

// --- Types ---

export interface ContextMemory {
  id: string;
  content: string;
  detail: string | null;
  domain: string;
  confidence: number;
  permanence: string;
  entity_type: string | null;
  entity_name: string | null;
  connections: {
    content: string;
    relationship: string;
  }[];
}

export interface ContextSummary {
  id: string;
  content: string;
  confidence: number;
  domain: string;
  permanence: string;
}

export interface ContextReference {
  id: string;
  snippet: string;
}

export interface EntityProfileSummary {
  entityName: string;
  entityType: string;
  summary: string;
}

export interface Saturation {
  budgetBound: boolean;
  budgetUsedPct: number;
}

export interface ScoreDistribution {
  hasCliff: boolean;
  cliffAt: number | null;
  shape: "flat" | "cliff" | "decaying";
  normalizedCurve: number[];
}

export interface Coverage {
  domains: string[];
  entityTypes: string[];
  entityNames: string[];
}

export interface SuggestedFollowUp {
  kind: "drill" | "broaden" | "briefing";
  target: string;
  reason: string;
}

export interface ContextMeta {
  totalMatches: number;
  tokenBudget: number;
  tokensUsed: number;
  retrievalId?: string;
  saturation: Saturation;
  scoreDistribution: ScoreDistribution;
  coverage: Coverage;
  suggestedFollowUps: SuggestedFollowUp[];
  /** True when the cross-encoder reranker produced the final ordering;
   *  false when it was disabled, had no candidates, or threw.
   *  Undefined when the reranker path was not evaluated. */
  rerankerEngaged?: boolean;
  /** Error message if the reranker threw (truncated). Callers/dashboards can
   *  use this to detect silent fallback to RRF ordering. */
  rerankerError?: string;
}

export interface HierarchicalResult {
  primary: {
    memories: ContextMemory[];
    tokenCount: number;
  };
  secondary: {
    summaries: ContextSummary[];
    tokenCount: number;
  };
  references: {
    items: ContextReference[];
    tokenCount: number;
  };
  entityProfiles?: {
    profiles: EntityProfileSummary[];
    tokenCount: number;
  };
  returnedMemoryIds: string[];
  meta: ContextMeta & { format: "hierarchical" };
}

export interface NarrativeResult {
  text: string;
  returnedMemoryIds: string[];
  meta: ContextMeta & { format: "narrative" };
}

export type ContextPackedResult = HierarchicalResult | NarrativeResult;

// --- Sanitization (prompt-injection defense for suggestedFollowUps.target) ---

const FOLLOW_UP_TARGET_MAX_LEN = 80;
const FOLLOW_UP_TARGET_ALLOWED = /[^A-Za-z0-9 .,&'\-]/g;

export function sanitizeFollowUpTarget(raw: string): string {
  const stripped = raw.replace(FOLLOW_UP_TARGET_ALLOWED, " ").replace(/\s+/g, " ").trim();
  return stripped.length > FOLLOW_UP_TARGET_MAX_LEN
    ? stripped.slice(0, FOLLOW_UP_TARGET_MAX_LEN)
    : stripped;
}

// --- Score distribution (pinned cliff detection) ---

function mean(xs: number[]): number {
  if (xs.length === 0) return 0;
  let sum = 0;
  for (const x of xs) sum += x;
  return sum / xs.length;
}

export function computeScoreDistribution(rawScores: number[]): ScoreDistribution {
  if (rawScores.length === 0) {
    return { hasCliff: false, cliffAt: null, shape: "flat", normalizedCurve: [] };
  }
  const top = rawScores.slice(0, Math.min(20, rawScores.length));
  const maxScore = Math.max(...top);
  const normalizedCurve = maxScore > 0 ? top.map((s) => s / maxScore) : top.map(() => 0);

  if (normalizedCurve.length < 2) {
    return { hasCliff: false, cliffAt: null, shape: "flat", normalizedCurve };
  }

  const headSize = Math.min(3, normalizedCurve.length);
  const tailSize = Math.min(3, normalizedCurve.length);
  const head = mean(normalizedCurve.slice(0, headSize));
  const tail = mean(normalizedCurve.slice(-tailSize));
  const hasCliff = head > 0 && tail / head < 0.4;

  let cliffAt: number | null = null;
  if (hasCliff) {
    const firstScore = normalizedCurve[0];
    for (let i = 0; i < normalizedCurve.length; i++) {
      if (firstScore > 0 && normalizedCurve[i] / firstScore < 0.4) {
        cliffAt = i;
        break;
      }
    }
  }

  const shape: "flat" | "cliff" | "decaying" = hasCliff
    ? "cliff"
    : head > 0 && tail / head > 0.8
      ? "flat"
      : "decaying";

  return { hasCliff, cliffAt, shape, normalizedCurve };
}

// --- Coverage + follow-ups ---

function computeCoverage(results: ExpandedResult[]): Coverage {
  const domains = new Set<string>();
  const entityTypes = new Set<string>();
  const entityNames = new Set<string>();
  for (const r of results) {
    const d = r.memory.domain as string | null;
    if (d) domains.add(d);
    const et = r.memory.entity_type as string | null;
    if (et) entityTypes.add(et);
    const en = r.memory.entity_name as string | null;
    if (en) entityNames.add(en);
  }
  return {
    domains: Array.from(domains),
    entityTypes: Array.from(entityTypes),
    entityNames: Array.from(entityNames),
  };
}

function computeSuggestedFollowUps(
  primaryResults: ExpandedResult[],
  saturation: Saturation,
  scoreDistribution: ScoreDistribution,
  tokenBudget: number,
  hadDomainFilter: boolean,
): SuggestedFollowUp[] {
  const followUps: SuggestedFollowUp[] = [];

  // Count entity name occurrences in primary
  const entityCounts = new Map<string, number>();
  for (const r of primaryResults) {
    const name = r.memory.entity_name as string | null;
    if (name) entityCounts.set(name, (entityCounts.get(name) ?? 0) + 1);
  }
  for (const [name, count] of entityCounts.entries()) {
    if (count >= 2) {
      followUps.push({
        kind: "briefing",
        target: sanitizeFollowUpTarget(name),
        reason: `entity mentioned ${count}× in primary results`,
      });
    }
  }

  // Broaden if budget-bound and no cliff visible
  if (saturation.budgetBound && scoreDistribution.shape !== "cliff") {
    followUps.push({
      kind: "broaden",
      target: sanitizeFollowUpTarget(`increase token_budget to ${tokenBudget * 2}`),
      reason: "budget exhausted without a relevance cliff — more useful results likely exist",
    });
  }

  // Drill if primary dominated by one domain and no domain filter was set
  if (!hadDomainFilter && primaryResults.length >= 3) {
    const domainCounts = new Map<string, number>();
    for (const r of primaryResults) {
      const d = r.memory.domain as string | null;
      if (d) domainCounts.set(d, (domainCounts.get(d) ?? 0) + 1);
    }
    const total = primaryResults.length;
    for (const [domain, count] of domainCounts.entries()) {
      if (count / total >= 0.7 && domainCounts.size > 1) {
        // Suggest drilling into a different domain that appears but is under-represented
        for (const [otherDomain, otherCount] of domainCounts.entries()) {
          if (otherDomain !== domain && otherCount > 0) {
            followUps.push({
              kind: "drill",
              target: sanitizeFollowUpTarget(otherDomain),
              reason: `primary is ${Math.round((count / total) * 100)}% ${domain}; ${otherDomain} may be under-sampled`,
            });
            break;
          }
        }
        break;
      }
    }
  }

  return followUps;
}

// --- Permanence scoring ---

function permanenceMultiplier(mem: Record<string, unknown>): number {
  const perm = effectivePermanence({
    permanence: mem.permanence as string | null,
    confirmed_count: mem.confirmed_count as number | undefined,
    confidence: mem.confidence as number | undefined,
    used_count: mem.used_count as number | undefined,
    entity_type: mem.entity_type as string | null,
    content: mem.content as string | undefined,
    detail: mem.detail as string | null,
  });

  switch (perm) {
    case "canonical": return 1.2;
    case "active": return 1.0;
    case "ephemeral": {
      const expiresAt = mem.expires_at as string | null;
      if (expiresAt && expiresAt < new Date().toISOString()) return 0.8;
      return 1.0;
    }
    case "archived": return 0.5;
    default: return 1.0;
  }
}

// --- Context packing ---

function buildContextMemory(result: ExpandedResult): ContextMemory {
  const mem = result.memory;
  return {
    id: mem.id as string,
    content: mem.content as string,
    detail: (mem.detail as string) || null,
    domain: mem.domain as string,
    confidence: mem.confidence as number,
    permanence: effectivePermanence({
      permanence: mem.permanence as string | null,
      confirmed_count: mem.confirmed_count as number | undefined,
      confidence: mem.confidence as number | undefined,
      used_count: mem.used_count as number | undefined,
      entity_type: mem.entity_type as string | null,
      content: mem.content as string | undefined,
      detail: mem.detail as string | null,
    }),
    entity_type: (mem.entity_type as string) || null,
    entity_name: (mem.entity_name as string) || null,
    connections: result.connected.slice(0, 3).map((c) => ({
      content: c.memory.content as string,
      relationship: c.relationship,
    })),
  };
}

function buildContextSummary(result: ExpandedResult): ContextSummary {
  const mem = result.memory;
  return {
    id: mem.id as string,
    content: mem.content as string,
    confidence: mem.confidence as number,
    domain: mem.domain as string,
    permanence: effectivePermanence({
      permanence: mem.permanence as string | null,
      confirmed_count: mem.confirmed_count as number | undefined,
      confidence: mem.confidence as number | undefined,
      used_count: mem.used_count as number | undefined,
      entity_type: mem.entity_type as string | null,
      content: mem.content as string | undefined,
      detail: mem.detail as string | null,
    }),
  };
}

function buildContextReference(result: ExpandedResult): ContextReference {
  const mem = result.memory;
  const content = mem.content as string;
  return {
    id: mem.id as string,
    snippet: content.length > 60 ? content.slice(0, 57) + "..." : content,
  };
}

function memoryTokenCount(cm: ContextMemory): number {
  let text = cm.content;
  if (cm.detail) text += " " + cm.detail;
  if (cm.entity_name) text += " " + cm.entity_name;
  for (const c of cm.connections) {
    text += " " + c.content;
  }
  return estimateTokens(text) + 20; // overhead for structure
}

function summaryTokenCount(cs: ContextSummary): number {
  return estimateTokens(cs.content) + 10;
}

function referenceTokenCount(cr: ContextReference): number {
  return estimateTokens(cr.snippet) + 5;
}

interface PackHierarchicalOutput {
  result: Omit<HierarchicalResult, "meta"> & { meta: Omit<ContextMeta, "saturation" | "scoreDistribution" | "coverage" | "suggestedFollowUps"> & { format: "hierarchical" } };
  primaryResults: ExpandedResult[];
  budgetBound: boolean;
}

function packHierarchicalRaw(
  results: ExpandedResult[],
  tokenBudget: number,
  entityProfiles?: EntityProfileSummary[],
): PackHierarchicalOutput {
  // Budget allocation: primary 50%, profiles 15%, secondary 25%, references 10%
  const hasProfiles = entityProfiles && entityProfiles.length > 0;
  const primaryBudget = Math.floor(tokenBudget * 0.50);
  const profileBudget = hasProfiles ? Math.floor(tokenBudget * 0.15) : 0;
  const secondaryBudget = Math.floor(tokenBudget * (hasProfiles ? 0.25 : 0.30));
  const referencesBudget = Math.floor(tokenBudget * (hasProfiles ? 0.10 : 0.20));

  const primary: ContextMemory[] = [];
  const primaryResults: ExpandedResult[] = [];
  let primaryTokens = 0;
  let idx = 0;
  let budgetBound = false;

  // Fill primary (full detail + connections)
  while (idx < results.length) {
    const cm = buildContextMemory(results[idx]);
    const tokens = memoryTokenCount(cm);
    if (primaryTokens + tokens > primaryBudget && primary.length > 0) {
      budgetBound = true;
      break;
    }
    primary.push(cm);
    primaryResults.push(results[idx]);
    primaryTokens += tokens;
    idx++;
  }

  // Fill secondary (content only)
  const secondary: ContextSummary[] = [];
  let secondaryTokens = 0;
  while (idx < results.length) {
    const cs = buildContextSummary(results[idx]);
    const tokens = summaryTokenCount(cs);
    if (secondaryTokens + tokens > secondaryBudget && secondary.length > 0) {
      budgetBound = true;
      break;
    }
    secondary.push(cs);
    secondaryTokens += tokens;
    idx++;
  }

  // Fill references (snippets)
  const references: ContextReference[] = [];
  let referenceTokens = 0;
  while (idx < results.length) {
    const cr = buildContextReference(results[idx]);
    const tokens = referenceTokenCount(cr);
    if (referenceTokens + tokens > referencesBudget && references.length > 0) {
      budgetBound = true;
      break;
    }
    references.push(cr);
    referenceTokens += tokens;
    idx++;
  }

  // Include entity profiles if available
  let profilesSection: HierarchicalResult["entityProfiles"];
  let profileTokens = 0;
  if (hasProfiles) {
    const includedProfiles: EntityProfileSummary[] = [];
    for (const profile of entityProfiles) {
      const tokens = estimateTokens(profile.summary) + 15;
      if (profileTokens + tokens > profileBudget && includedProfiles.length > 0) {
        budgetBound = true;
        break;
      }
      includedProfiles.push(profile);
      profileTokens += tokens;
    }
    if (includedProfiles.length > 0) {
      profilesSection = { profiles: includedProfiles, tokenCount: profileTokens };
    }
  }

  if (idx < results.length) budgetBound = true;

  const returnedMemoryIds: string[] = [];
  for (const cm of primary) returnedMemoryIds.push(cm.id);
  for (const cs of secondary) returnedMemoryIds.push(cs.id);
  for (const cr of references) returnedMemoryIds.push(cr.id);

  return {
    result: {
      primary: { memories: primary, tokenCount: primaryTokens },
      secondary: { summaries: secondary, tokenCount: secondaryTokens },
      references: { items: references, tokenCount: referenceTokens },
      ...(profilesSection ? { entityProfiles: profilesSection } : {}),
      returnedMemoryIds,
      meta: {
        totalMatches: results.length,
        tokenBudget,
        tokensUsed: primaryTokens + secondaryTokens + referenceTokens + profileTokens,
        format: "hierarchical",
      },
    },
    primaryResults,
    budgetBound,
  };
}

interface PackNarrativeOutput {
  result: Omit<NarrativeResult, "meta"> & { meta: Omit<ContextMeta, "saturation" | "scoreDistribution" | "coverage" | "suggestedFollowUps"> & { format: "narrative" } };
  primaryResults: ExpandedResult[];
  budgetBound: boolean;
}

function packNarrativeRaw(
  results: ExpandedResult[],
  tokenBudget: number,
): PackNarrativeOutput {
  const lines: string[] = [];
  const returnedMemoryIds: string[] = [];
  const primaryResults: ExpandedResult[] = [];
  let tokensUsed = 0;
  let budgetBound = false;
  const headerTokens = estimateTokens("You know the following about this topic:");
  tokensUsed += headerTokens;
  lines.push("You know the following about this topic:");

  // First few: full detail
  let idx = 0;
  const fullDetailBudget = Math.floor(tokenBudget * 0.6);
  while (idx < results.length && tokensUsed < fullDetailBudget) {
    const mem = results[idx].memory;
    let line = `- ${mem.content as string}`;
    if (mem.detail) line += ` (${mem.detail as string})`;
    const conf = mem.confidence as number;
    line += ` [${(conf * 100).toFixed(0)}% confidence]`;
    const lineTokens = estimateTokens(line);
    if (tokensUsed + lineTokens > fullDetailBudget && idx > 0) {
      budgetBound = true;
      break;
    }
    lines.push(line);
    returnedMemoryIds.push(mem.id as string);
    primaryResults.push(results[idx]);
    tokensUsed += lineTokens;
    idx++;
  }

  // Next: one-line summaries
  const summaryBudget = Math.floor(tokenBudget * 0.85);
  while (idx < results.length && tokensUsed < summaryBudget) {
    const mem = results[idx].memory;
    const content = mem.content as string;
    const line = `- ${content.length > 80 ? content.slice(0, 77) + "..." : content}`;
    const lineTokens = estimateTokens(line);
    if (tokensUsed + lineTokens > summaryBudget && idx > 0) {
      budgetBound = true;
      break;
    }
    lines.push(line);
    returnedMemoryIds.push(mem.id as string);
    tokensUsed += lineTokens;
    idx++;
  }

  // Remaining count
  const remaining = results.length - idx;
  if (remaining > 0) {
    budgetBound = true;
    const footer = `Also relevant: ${remaining} additional ${remaining === 1 ? "memory" : "memories"} available via memory_search.`;
    lines.push(footer);
    tokensUsed += estimateTokens(footer);
  }

  return {
    result: {
      text: lines.join("\n"),
      returnedMemoryIds,
      meta: {
        totalMatches: results.length,
        tokenBudget,
        tokensUsed,
        format: "narrative",
      },
    },
    primaryResults,
    budgetBound,
  };
}

// --- Main entry point ---

export async function contextSearch(
  client: Client,
  query: string,
  options: {
    userId?: string | null;
    tokenBudget?: number;
    format?: "hierarchical" | "narrative";
    domain?: string;
    entityType?: string;
    entityName?: string;
    minConfidence?: number;
    includeArchived?: boolean;
  } = {},
): Promise<ContextPackedResult> {
  const tokenBudget = options.tokenBudget ?? 6000;
  const format = options.format ?? "hierarchical";

  // Reranker enablement — environment-aware default with explicit overrides:
  //   • LODIS_RERANKER_DISABLED=1 → always off  (evaluated first — safer)
  //   • LODIS_RERANKER_ENABLED=1  → always on
  //   • LODIS_RERANKER_URL set    → on (implies HTTP provider — no cold-start)
  //   • otherwise: ON for long-lived Node (default), OFF on Vercel
  //
  // Rationale: the in-process BGE-reranker incurs ~13-15s cold-start per
  // Lambda invocation. That's unacceptable UX on a serverless function.
  // Local-first users (`npx lodis`, long-lived Node) keep the reranker on
  // by default. Hosted/Vercel users point LODIS_RERANKER_URL at a warm
  // service (see HttpReranker + modal/rerank_app.py) and auto-enable.
  // DISABLED wins over ENABLED to avoid silent override of a stale
  // kill-switch — always the safest interpretation of conflicting env.
  const rerankerEnabled = (() => {
    if (process.env.LODIS_RERANKER_DISABLED === "1") return false;
    if (process.env.LODIS_RERANKER_ENABLED === "1") return true;
    if (process.env.LODIS_RERANKER_URL) return true; // HTTP provider implies enabled
    return process.env.VERCEL !== "1"; // default off on Vercel, on elsewhere
  })();

  // Stage 1: hybrid retrieval.
  // When reranker is enabled, fetch a wider candidate set (limit=200) and skip
  // graph expansion — the reranker orders relevance so we don't need the RRF
  // scores to guide expansion. When disabled, fall back to the legacy single-
  // stage path (limit=50 + expand). LODIS_RERANKER_DISABLED=1 opts out.
  const stage1Limit = rerankerEnabled ? 200 : 50;
  const { results } = await hybridSearch(client, query, {
    userId: options.userId,
    domain: options.domain,
    entityType: options.entityType,
    entityName: options.entityName,
    minConfidence: options.minConfidence,
    limit: stage1Limit,
    expand: !rerankerEnabled,
    maxDepth: 2,
    similarityThreshold: 0.4,
  });

  // Stage 2: cross-encoder rerank (optional).
  // BGE-reranker scores each (query, memory) pair directly; we re-order the
  // candidate set and keep the top rerankTopK. Replaces r.score with the
  // reranker logit so downstream score-weighted steps use the cross-encoder
  // signal. Failures here (model unavailable, etc.) fall back to the RRF
  // ordering — retrieval must not break if reranker infrastructure is absent.
  // We track `rerankerEngaged` and `rerankerError` in ContextMeta so callers
  // / dashboards can detect silent fallback — the bare catch in the v0 of
  // this code made Stage-2 regressions undetectable from the response.
  const rerankTopK = 40;
  let reranked: ExpandedResult[];
  let rerankerEngaged: boolean | undefined;
  let rerankerError: string | undefined;
  if (!rerankerEnabled) {
    rerankerEngaged = false;
    reranked = results;
  } else if (results.length === 0) {
    rerankerEngaged = false;
    reranked = results;
  } else {
    try {
      const candidates = results.map((r) => ({
        id: r.memory.id as string,
        text: memoryRerankText(r),
      }));
      const rerankResults = await rerank(query, candidates, { topK: rerankTopK });
      const byId = new Map(results.map((r) => [r.memory.id as string, r]));
      reranked = rerankResults.flatMap((rr) => {
        const orig = byId.get(rr.id);
        if (!orig) return [];
        return [{ ...orig, score: rr.score }];
      });
      rerankerEngaged = true;
    } catch (err) {
      const msg = String((err as Error)?.message ?? err);
      rerankerError = msg.length > 200 ? msg.slice(0, 200) : msg;
      rerankerEngaged = false;
      // Stderr so the failure surfaces in MCP launch logs — matches the
      // pattern embeddings.ts / vec.ts use for graceful-degradation notes.
      process.stderr.write(`[lodis] reranker threw, falling back to RRF ordering: ${rerankerError}\n`);
      reranked = results;
    }
  }

  // Apply permanence-aware scoring
  const scored = reranked.map((r) => ({
    ...r,
    score: r.score * permanenceMultiplier(r.memory),
  }));

  // Filter archived unless explicitly included
  const filtered = options.includeArchived
    ? scored
    : scored.filter((r) => (r.memory.permanence as string | null) !== "archived");

  // Re-sort by adjusted score
  filtered.sort((a, b) => b.score - a.score);

  const rawScores = filtered.map((r) => r.score);
  const scoreDistribution = computeScoreDistribution(rawScores);

  if (format === "narrative") {
    const { result, primaryResults, budgetBound } = packNarrativeRaw(filtered, tokenBudget);
    const saturation: Saturation = {
      budgetBound,
      budgetUsedPct: tokenBudget > 0 ? Math.min(1, result.meta.tokensUsed / tokenBudget) : 0,
    };
    const coverage = computeCoverage(primaryResults);
    const suggestedFollowUps = computeSuggestedFollowUps(
      primaryResults,
      saturation,
      scoreDistribution,
      tokenBudget,
      Boolean(options.domain),
    );
    return {
      ...result,
      meta: {
        ...result.meta,
        saturation,
        scoreDistribution,
        coverage,
        suggestedFollowUps,
        rerankerEngaged,
        ...(rerankerError ? { rerankerError } : {}),
      },
    };
  }

  // Fetch entity profiles for unique entity names in results
  const entityNames = new Set<string>();
  for (const r of filtered) {
    const name = r.memory.entity_name as string | null;
    if (name) entityNames.add(name);
  }

  const profiles: EntityProfileSummary[] = [];
  for (const name of entityNames) {
    try {
      const profile = await getProfile(client, name, undefined, options.userId);
      if (profile) {
        profiles.push({
          entityName: profile.entityName,
          entityType: profile.entityType,
          summary: profile.summary,
        });
      }
    } catch {
      // Non-fatal — profile lookup failure shouldn't block search
    }
  }

  const { result, primaryResults, budgetBound } = packHierarchicalRaw(filtered, tokenBudget, profiles);
  const saturation: Saturation = {
    budgetBound,
    budgetUsedPct: tokenBudget > 0 ? Math.min(1, result.meta.tokensUsed / tokenBudget) : 0,
  };
  const coverage = computeCoverage(primaryResults);
  const suggestedFollowUps = computeSuggestedFollowUps(
    primaryResults,
    saturation,
    scoreDistribution,
    tokenBudget,
    Boolean(options.domain),
  );

  return {
    ...result,
    meta: {
      ...result.meta,
      saturation,
      scoreDistribution,
      coverage,
      suggestedFollowUps,
      rerankerEngaged,
      ...(rerankerError ? { rerankerError } : {}),
    },
  };
}

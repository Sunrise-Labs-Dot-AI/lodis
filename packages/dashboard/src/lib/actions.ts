"use server";

import {
  deleteMemoryById,
  confirmMemoryById,
  flagMemoryById,
  correctMemoryById,
  splitMemoryById,
  clearAllMemories as clearAll,
  getMemoryById,
  getMemories,
  pinMemoryById,
  archiveMemoryById,
  restoreMemoryById,
} from "./db";
import {
  scanForSuggestions,
  expandMergeSuggestion,
  expandSplitSuggestion,
  expandContradictionSuggestion,
  suggestionKey,
  type CleanupSuggestion,
  type ScanResult,
} from "./cleanup";
import { getUserId } from "@/lib/auth";
import { revalidatePath } from "next/cache";
import { resolveLLMProvider } from "@engrams/core/llm-config";
import { parseLLMJson } from "@engrams/core/llm-utils";
import { validateCorrection, validateSplit } from "@engrams/core/llm-validation";
import type { LLMProvider } from "@engrams/core/llm";

export async function deleteMemoryAction(id: string) {
  const userId = await getUserId();
  await deleteMemoryById(id, userId);
  revalidatePath("/");
  revalidatePath(`/memory/${id}`);
}

export async function confirmMemoryAction(id: string) {
  const userId = await getUserId();
  const result = await confirmMemoryById(id, userId);
  revalidatePath("/");
  revalidatePath(`/memory/${id}`);
  return result;
}

export async function flagMemoryAction(id: string) {
  const userId = await getUserId();
  const result = await flagMemoryById(id, userId);
  revalidatePath("/");
  revalidatePath(`/memory/${id}`);
  return result;
}

export async function correctMemoryAction(id: string, feedback: string): Promise<{ newConfidence: number; content: string; detail: string | null } | { error: string } | null> {
  const userId = await getUserId();
  const memory = await getMemoryById(id, userId);
  if (!memory) return null;

  const provider = resolveLLMProvider("analysis");
  if (!provider) {
    return { error: "No LLM provider configured. Semantic correction requires an LLM. Set ANTHROPIC_API_KEY, OPENAI_API_KEY, or configure in Settings." };
  }

  const prompt = `You are updating a stored memory based on user feedback. Return ONLY valid JSON with "content" and "detail" fields.

Current memory:
- Content: ${JSON.stringify(memory.content)}
- Detail: ${JSON.stringify(memory.detail)}

User's correction: ${JSON.stringify(feedback)}

Apply the user's correction to produce updated content and detail. The "content" field is a short summary (one sentence). The "detail" field is optional additional context. If the correction only applies to one field, keep the other unchanged. If detail should be empty, set it to null.

Respond with ONLY a JSON object: {"content": "...", "detail": "..." or null}`;

  try {
    const text = await provider.complete(prompt, { maxTokens: 512, json: true });
    const parsed = parseLLMJson<{ content: string; detail: string | null }>(text);
    const newContent = typeof parsed.content === "string" ? parsed.content : memory.content;
    const newDetail = parsed.detail === null ? null : (typeof parsed.detail === "string" ? parsed.detail : memory.detail);

    const validation = validateCorrection(memory.content, newContent, feedback);
    if (!validation.valid) {
      return { error: `LLM correction failed validation: ${validation.error ?? "unknown reason"}. Please try rephrasing your correction.` };
    }

    const result = await correctMemoryById(id, newContent, newDetail, userId);
    revalidatePath("/");
    revalidatePath(`/memory/${id}`);
    if (!result) return null;
    return { ...result, content: newContent, detail: newDetail ?? null };
  } catch (e) {
    return { error: `Correction failed: ${e instanceof Error ? e.message : String(e)}` };
  }
}

export type SplitPart = { content: string; detail: string | null };

export async function proposeSplitAction(
  id: string,
  guidance?: string,
): Promise<{ parts: SplitPart[] } | { error: string }> {
  const userId = await getUserId();
  const memory = await getMemoryById(id, userId);
  if (!memory) return { error: "Memory not found" };

  const provider = resolveLLMProvider("analysis");
  if (!provider) {
    return { error: "No LLM provider configured. Set ANTHROPIC_API_KEY, OPENAI_API_KEY, or configure in Settings." };
  }

  const prompt = `You are managing a memory system that stores facts about a user. This memory contains multiple distinct topics that should be stored separately so they can be independently searched, confirmed, corrected, or removed.

Current memory:
- Content: ${JSON.stringify(memory.content)}
- Detail: ${JSON.stringify(memory.detail)}
${guidance ? `\nUser's guidance on how to split: ${JSON.stringify(guidance)}` : ""}

Split this into the minimum number of independent memories. Each memory should:
- Have a clear, specific "content" field (the core fact, one sentence)
- Have an optional "detail" field for supporting context that aids retrieval
- Be independently useful — searchable on its own without the other parts

Return ONLY a JSON array: [{"content": "...", "detail": "..." or null}, ...]`;

  try {
    const text = await provider.complete(prompt, { maxTokens: 1024, json: true });
    const parts = parseLLMJson<SplitPart[]>(text);

    const validation = validateSplit(memory.content, parts);
    if (!validation.valid) {
      return { error: validation.error || "Split analysis failed" };
    }

    return { parts };
  } catch (e) {
    return { error: "Failed to analyze memory for splitting" };
  }
}

export async function confirmSplitAction(
  id: string,
  parts: SplitPart[],
): Promise<{ newIds: string[] } | { error: string } | null> {
  const userId = await getUserId();
  if (parts.length < 2) return { error: "Need at least 2 parts to split" };
  const result = await splitMemoryById(id, parts, userId);
  if (!result) return { error: "Memory not found" };
  revalidatePath("/");
  return result;
}

export async function clearAllMemoriesAction() {
  const userId = await getUserId();
  await clearAll(userId);
  revalidatePath("/");
}

// --- Cleanup actions ---

/** Scan with cache + dismissal filtering. Auto-invalidates when memories change. */
export async function scanCleanupAction(forceRefresh?: boolean): Promise<
  ScanResult | { error: string }
> {
  const userId = await getUserId();
  try {
    const { getLastModified, getCachedScanResult, setCachedScanResult, getDismissedKeys } = await import("./db");

    const currentLastModified = await getLastModified(userId);
    let scanResult: ScanResult;

    if (!forceRefresh) {
      const cached = await getCachedScanResult(userId);
      if (cached && cached.lastModifiedAt === currentLastModified) {
        scanResult = cached.result;
      } else {
        scanResult = await scanForSuggestions(userId);
        if (currentLastModified) {
          await setCachedScanResult(scanResult, currentLastModified, userId);
        }
      }
    } else {
      scanResult = await scanForSuggestions(userId);
      if (currentLastModified) {
        await setCachedScanResult(scanResult, currentLastModified, userId);
      }
    }

    // Filter out dismissed suggestions
    const dismissedKeys = await getDismissedKeys(userId);
    if (dismissedKeys.size > 0) {
      scanResult = {
        ...scanResult,
        actionable: scanResult.actionable.filter(s => !dismissedKeys.has(suggestionKey(s))),
      };
    }

    return scanResult;
  } catch (e) {
    console.error("[engrams] Cleanup scan failed:", e);
    return { error: "Cleanup scan failed" };
  }
}

/** Persist a suggestion dismissal so it doesn't reappear on re-scan. */
export async function dismissSuggestionAction(
  suggestionType: string,
  memoryIds: string[],
  action: "dismissed" | "resolved" = "dismissed",
  resolutionNote?: string,
): Promise<{ ok: true } | { error: string }> {
  const userId = await getUserId();
  try {
    const { dismissSuggestion } = await import("./db");
    const key = `${suggestionType}:${[...memoryIds].sort().join(",")}`;
    await dismissSuggestion(key, suggestionType, action, resolutionNote, userId);
    return { ok: true };
  } catch (e) {
    console.error("[engrams] Dismiss suggestion failed:", e);
    return { error: "Failed to dismiss suggestion" };
  }
}

/** Expand: on-demand LLM call for a single suggestion. Requires LLM provider. */
export async function expandSuggestionAction(
  suggestion: CleanupSuggestion,
): Promise<{ suggestion: CleanupSuggestion } | { error: string }> {
  const provider = resolveLLMProvider("analysis");
  if (!provider) {
    return {
      error: "No LLM provider configured. Set ANTHROPIC_API_KEY, OPENAI_API_KEY, or configure in Settings.",
    };
  }

  try {
    let expanded: CleanupSuggestion;
    switch (suggestion.type) {
      case "merge":
        expanded = await expandMergeSuggestion(suggestion, provider);
        break;
      case "split":
        expanded = await expandSplitSuggestion(suggestion, provider);
        break;
      case "contradiction":
        expanded = await expandContradictionSuggestion(suggestion, provider);
        break;
      default:
        expanded = { ...suggestion, expanded: true };
    }
    return { suggestion: expanded };
  } catch (e) {
    console.error("[engrams] Expand suggestion failed:", e);
    return { error: "Failed to analyze this suggestion" };
  }
}

export async function applyMergeSuggestionAction(
  keepId: string,
  deleteIds: string[],
): Promise<{ error?: string }> {
  const userId = await getUserId();
  for (const id of deleteIds) {
    if (id !== keepId) {
      await deleteMemoryById(id, userId);
    }
  }
  revalidatePath("/");
  revalidatePath("/cleanup");
  return {};
}

export async function applySplitSuggestionAction(
  id: string,
  parts: SplitPart[],
): Promise<{ newIds: string[]; error?: string } | { error: string }> {
  const userId = await getUserId();
  if (parts.length < 2) return { error: "Need at least 2 parts to split" };
  const result = await splitMemoryById(id, parts, userId);
  if (!result) return { error: "Memory not found" };
  revalidatePath("/");
  revalidatePath("/cleanup");
  return result;
}

export async function scrubMemoryAction(
  id: string,
): Promise<{ scrubbed: boolean; memory?: { content: string; detail: string | null }; error?: string }> {
  const userId = await getUserId();
  const memory = await getMemoryById(id, userId);
  if (!memory) return { scrubbed: false, error: "Memory not found" };

  const { redactSensitiveData } = await import("@engrams/core/pii");
  const { redacted: redactedContent } = redactSensitiveData(memory.content);
  const redactedDetail = memory.detail
    ? redactSensitiveData(memory.detail).redacted
    : null;

  const { scrubMemoryById } = await import("./db");
  const success = await scrubMemoryById(id, redactedContent, redactedDetail, redactSensitiveData, userId);
  if (!success) return { scrubbed: false, error: "Memory not found" };

  revalidatePath("/");
  revalidatePath(`/memory/${id}`);
  revalidatePath("/cleanup");
  return { scrubbed: true, memory: { content: redactedContent, detail: redactedDetail } };
}

export async function pinMemoryAction(id: string) {
  const userId = await getUserId();
  await pinMemoryById(id, userId);
  revalidatePath("/");
  revalidatePath(`/memory/${id}`);
}

export async function archiveMemoryAction(id: string) {
  const userId = await getUserId();
  await archiveMemoryById(id, userId);
  revalidatePath("/");
  revalidatePath("/archive");
  revalidatePath(`/memory/${id}`);
}

export async function restoreMemoryAction(id: string) {
  const userId = await getUserId();
  await restoreMemoryById(id, userId);
  revalidatePath("/");
  revalidatePath("/archive");
  revalidatePath(`/memory/${id}`);
}

export async function bulkRestoreAction(ids: string[]) {
  const userId = await getUserId();
  const { bulkRestoreMemories } = await import("./db");
  const restored = await bulkRestoreMemories(ids, userId);
  revalidatePath("/");
  revalidatePath("/archive");
  return { restored };
}

// --- Resolve with message ---

export interface ResolveAction {
  action: "keep_both" | "keep" | "delete" | "correct" | "merge";
  memoryId?: string;
  newContent?: string;
  newDetail?: string | null;
  reason: string;
}

export interface ResolveResult {
  actions: ResolveAction[];
  summary: string;
  error?: string;
}

export async function resolveWithMessageAction(
  memoryIds: string[],
  message: string,
): Promise<ResolveResult | { error: string }> {
  const userId = await getUserId();
  const memories = await Promise.all(memoryIds.map(id => getMemoryById(id, userId)));
  const validMemories = memories.filter(Boolean) as NonNullable<typeof memories[0]>[];

  if (validMemories.length === 0) return { error: "No memories found" };

  const provider = resolveLLMProvider("analysis");
  if (!provider) {
    return { error: "No LLM provider configured. Set ANTHROPIC_API_KEY, OPENAI_API_KEY, or configure in Settings." };
  }

  const memoryDescriptions = validMemories.map(m =>
    `- ID: ${m.id}\n  Content: ${JSON.stringify(m.content)}\n  Detail: ${JSON.stringify(m.detail)}\n  Domain: ${m.domain}\n  Confidence: ${m.confidence}`,
  ).join("\n\n");

  const prompt = `You are managing a memory system. The user wants to resolve an issue with these memories.

Memories:
${memoryDescriptions}

User's message: ${JSON.stringify(message)}

Based on the user's message, decide what actions to take. Available actions:
- "keep_both": Both memories are valid, no changes needed (use when user says both are correct/not contradictory)
- "keep": Keep only this memory, delete others. Requires "memoryId"
- "delete": Delete this memory. Requires "memoryId"
- "correct": Update a memory's content. Requires "memoryId", "newContent", and optionally "newDetail"
- "merge": Combine memories into one. Requires "memoryId" (the one to keep), "newContent", and optionally "newDetail"

Return ONLY a JSON object:
{
  "actions": [{"action": "...", "memoryId": "...", "newContent": "...", "newDetail": "..." or null, "reason": "..."}],
  "summary": "One sentence describing what was done"
}`;

  try {
    const text = await provider.complete(prompt, { maxTokens: 1024, json: true });
    const result = parseLLMJson<ResolveResult>(text);

    if (!result.actions || !Array.isArray(result.actions) || result.actions.length === 0) {
      return { error: "LLM returned no actions. Try rephrasing your message." };
    }

    // Apply each action
    for (const action of result.actions) {
      switch (action.action) {
        case "keep_both":
          // No-op — both are fine
          break;
        case "keep": {
          const deleteIds = memoryIds.filter(id => id !== action.memoryId);
          for (const id of deleteIds) {
            await deleteMemoryById(id, userId);
          }
          break;
        }
        case "delete":
          if (action.memoryId) {
            await deleteMemoryById(action.memoryId, userId);
          }
          break;
        case "correct":
          if (action.memoryId && action.newContent) {
            await correctMemoryById(action.memoryId, action.newContent, action.newDetail ?? null, userId);
          }
          break;
        case "merge": {
          if (action.memoryId && action.newContent) {
            await correctMemoryById(action.memoryId, action.newContent, action.newDetail ?? null, userId);
            const deleteIds = memoryIds.filter(id => id !== action.memoryId);
            for (const id of deleteIds) {
              await deleteMemoryById(id, userId);
            }
          }
          break;
        }
      }
    }

    revalidatePath("/");
    revalidatePath("/cleanup");
    for (const id of memoryIds) {
      revalidatePath(`/memory/${id}`);
    }

    return { actions: result.actions, summary: result.summary };
  } catch (e) {
    return { error: `Resolution failed: ${e instanceof Error ? e.message : String(e)}` };
  }
}

export { type CleanupSuggestion } from "./cleanup";

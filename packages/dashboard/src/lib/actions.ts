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

export async function correctMemoryAction(id: string, feedback: string): Promise<{ newConfidence: number; content: string; detail: string | null } | null> {
  const userId = await getUserId();
  const memory = await getMemoryById(id, userId);
  if (!memory) return null;

  const provider = resolveLLMProvider("analysis");
  if (!provider) {
    const result = await correctMemoryById(id, feedback, undefined, userId);
    revalidatePath("/");
    revalidatePath(`/memory/${id}`);
    if (!result) return null;
    const updated = await getMemoryById(id, userId);
    return { ...result, content: updated?.content ?? feedback, detail: updated?.detail ?? null };
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
      const result = await correctMemoryById(id, feedback, undefined, userId);
      revalidatePath("/");
      revalidatePath(`/memory/${id}`);
      if (!result) return null;
      const updated = await getMemoryById(id, userId);
      return { ...result, content: updated?.content ?? feedback, detail: updated?.detail ?? null };
    }

    const result = await correctMemoryById(id, newContent, newDetail, userId);
    revalidatePath("/");
    revalidatePath(`/memory/${id}`);
    if (!result) return null;
    return { ...result, content: newContent, detail: newDetail ?? null };
  } catch {
    const result = await correctMemoryById(id, feedback, undefined, userId);
    revalidatePath("/");
    revalidatePath(`/memory/${id}`);
    if (!result) return null;
    const updated = await getMemoryById(id, userId);
    return { ...result, content: updated?.content ?? feedback, detail: updated?.detail ?? null };
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

/** Scan: algorithmic only, zero API cost. Returns health score + prioritized suggestions. */
export async function scanCleanupAction(): Promise<
  ScanResult | { error: string }
> {
  const userId = await getUserId();
  try {
    return await scanForSuggestions(userId);
  } catch (e) {
    console.error("[engrams] Cleanup scan failed:", e);
    return { error: "Cleanup scan failed" };
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

export { type CleanupSuggestion } from "./cleanup";

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
  suggestionKey,
  type CleanupSuggestion,
  type ScanResult,
} from "./cleanup";
import { getUserId } from "@/lib/auth";
import { revalidatePath } from "next/cache";

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

export async function correctMemoryAction(id: string, newContent: string, newDetail?: string | null): Promise<{ newConfidence: number; content: string; detail: string | null } | { error: string } | null> {
  const userId = await getUserId();
  const memory = await getMemoryById(id, userId);
  if (!memory) return null;

  const result = await correctMemoryById(id, newContent, newDetail ?? memory.detail, userId);
  revalidatePath("/");
  revalidatePath(`/memory/${id}`);
  if (!result) return null;
  return { ...result, content: newContent, detail: newDetail ?? memory.detail };
}

export type SplitPart = { content: string; detail: string | null };

export async function proposeSplitAction(
  id: string,
): Promise<{ parts: SplitPart[] } | { error: string }> {
  const userId = await getUserId();
  const memory = await getMemoryById(id, userId);
  if (!memory) return { error: "Memory not found" };

  // Algorithmic sentence splitting — no LLM needed
  const fullText = memory.content + (memory.detail ? " " + memory.detail : "");
  const sentences = fullText.split(/(?<=[.!?])\s+/).filter(s => s.length > 10);

  if (sentences.length < 2) {
    return { error: "Memory doesn't contain enough distinct sentences to split." };
  }

  const parts: SplitPart[] = sentences.map(s => ({ content: s.trim(), detail: null }));
  return { parts };
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

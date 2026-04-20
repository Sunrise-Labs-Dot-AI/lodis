"use server";

import {
  deleteMemoryById,
  confirmMemoryById,
  flagMemoryById,
  correctMemoryById,
  splitMemoryById,
  clearAllMemories as clearAll,
  getMemoryById,
  pinMemoryById,
  archiveMemoryById,
  restoreMemoryById,
} from "./db";
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

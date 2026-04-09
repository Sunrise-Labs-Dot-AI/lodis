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
} from "./db";
import {
  scanForSuggestions,
  expandMergeSuggestion,
  expandSplitSuggestion,
  expandContradictionSuggestion,
  type CleanupSuggestion,
} from "./cleanup";
import { revalidatePath } from "next/cache";
import Anthropic from "@anthropic-ai/sdk";
import { readFileSync } from "fs";
import { resolve } from "path";

function getApiKey(): string | undefined {
  if (process.env.ANTHROPIC_API_KEY) return process.env.ANTHROPIC_API_KEY;
  // Next.js may not load .env.local from the right dir — try manual fallback
  const candidates = [
    resolve(process.cwd(), ".env.local"),
    resolve(process.cwd(), "packages/dashboard/.env.local"),
  ];
  for (const envPath of candidates) {
    try {
      const content = readFileSync(envPath, "utf8");
      const match = content.match(/^ANTHROPIC_API_KEY=(.+)$/m);
      if (match) return match[1].trim();
    } catch {}
  }
  return undefined;
}

export async function deleteMemoryAction(id: string) {
  deleteMemoryById(id);
  revalidatePath("/");
  revalidatePath(`/memory/${id}`);
}

export async function confirmMemoryAction(id: string) {
  const result = confirmMemoryById(id);
  revalidatePath("/");
  revalidatePath(`/memory/${id}`);
  return result;
}

export async function flagMemoryAction(id: string) {
  const result = flagMemoryById(id);
  revalidatePath("/");
  revalidatePath(`/memory/${id}`);
  return result;
}

export async function correctMemoryAction(id: string, feedback: string) {
  const memory = getMemoryById(id);
  if (!memory) return null;

  const apiKey = getApiKey();
  if (!apiKey) {
    const result = correctMemoryById(id, feedback);
    revalidatePath("/");
    revalidatePath(`/memory/${id}`);
    return result;
  }

  const client = new Anthropic({ apiKey });
  const response = await client.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 512,
    messages: [
      {
        role: "user",
        content: `You are updating a stored memory based on user feedback. Return ONLY valid JSON with "content" and "detail" fields.

Current memory:
- Content: ${JSON.stringify(memory.content)}
- Detail: ${JSON.stringify(memory.detail)}

User's correction: ${JSON.stringify(feedback)}

Apply the user's correction to produce updated content and detail. The "content" field is a short summary (one sentence). The "detail" field is optional additional context. If the correction only applies to one field, keep the other unchanged. If detail should be empty, set it to null.

Respond with ONLY a JSON object: {"content": "...", "detail": "..." or null}`,
      },
    ],
  });

  const text = response.content[0].type === "text" ? response.content[0].text : "";
  try {
    const parsed = JSON.parse(text);
    const newContent = typeof parsed.content === "string" ? parsed.content : memory.content;
    const newDetail = parsed.detail === null ? null : (typeof parsed.detail === "string" ? parsed.detail : memory.detail);
    const result = correctMemoryById(id, newContent, newDetail);
    revalidatePath("/");
    revalidatePath(`/memory/${id}`);
    return result;
  } catch {
    const result = correctMemoryById(id, feedback);
    revalidatePath("/");
    revalidatePath(`/memory/${id}`);
    return result;
  }
}

export type SplitPart = { content: string; detail: string | null };

export async function proposeSplitAction(
  id: string,
  guidance?: string,
): Promise<{ parts: SplitPart[] } | { error: string }> {
  const memory = getMemoryById(id);
  if (!memory) return { error: "Memory not found" };

  const apiKey = getApiKey();
  if (!apiKey) {
    return { error: "ANTHROPIC_API_KEY is required. Add it to packages/dashboard/.env.local" };
  }

  const client = new Anthropic({ apiKey });
  const response = await client.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 1024,
    messages: [
      {
        role: "user",
        content: `You are managing a memory system that stores facts about a user. This memory contains multiple distinct topics that should be stored separately so they can be independently searched, confirmed, corrected, or removed.

Current memory:
- Content: ${JSON.stringify(memory.content)}
- Detail: ${JSON.stringify(memory.detail)}
${guidance ? `\nUser's guidance on how to split: ${JSON.stringify(guidance)}` : ""}

Split this into the minimum number of independent memories. Each memory should:
- Have a clear, specific "content" field (the core fact, one sentence)
- Have an optional "detail" field for supporting context that aids retrieval
- Be independently useful — searchable on its own without the other parts

Return ONLY a JSON array: [{"content": "...", "detail": "..." or null}, ...]`,
      },
    ],
  });

  const text = response.content[0].type === "text" ? response.content[0].text : "";
  try {
    // Strip markdown code fences if present
    const cleaned = text.replace(/^```(?:json)?\s*\n?/i, "").replace(/\n?```\s*$/i, "").trim();
    const parts = JSON.parse(cleaned) as SplitPart[];
    if (!Array.isArray(parts) || parts.length < 2) {
      return { error: "This memory doesn't appear to need splitting" };
    }
    return { parts };
  } catch (e) {
    console.error("[engrams] Split parse error. Raw LLM response:", JSON.stringify(text));
    return { error: "Failed to analyze memory for splitting" };
  }
}

export async function confirmSplitAction(
  id: string,
  parts: SplitPart[],
): Promise<{ newIds: string[] } | { error: string } | null> {
  if (parts.length < 2) return { error: "Need at least 2 parts to split" };
  const result = splitMemoryById(id, parts);
  if (!result) return { error: "Memory not found" };
  revalidatePath("/");
  return result;
}

export async function clearAllMemoriesAction() {
  clearAll();
  revalidatePath("/");
}

// --- Cleanup actions ---

/** Scan: algorithmic only, zero API cost. Returns suggestions instantly. */
export async function scanCleanupAction(): Promise<
  { suggestions: CleanupSuggestion[] } | { error: string }
> {
  try {
    const suggestions = scanForSuggestions();
    return { suggestions };
  } catch (e) {
    console.error("[engrams] Cleanup scan failed:", e);
    return { error: "Cleanup scan failed" };
  }
}

/** Expand: on-demand LLM call for a single suggestion. Requires API key. */
export async function expandSuggestionAction(
  suggestion: CleanupSuggestion,
): Promise<{ suggestion: CleanupSuggestion } | { error: string }> {
  const apiKey = getApiKey();
  if (!apiKey) {
    return {
      error: "API key required. Add ANTHROPIC_API_KEY to packages/dashboard/.env.local",
    };
  }

  try {
    let expanded: CleanupSuggestion;
    switch (suggestion.type) {
      case "merge":
        expanded = await expandMergeSuggestion(suggestion, apiKey);
        break;
      case "split":
        expanded = await expandSplitSuggestion(suggestion, apiKey);
        break;
      case "contradiction":
        expanded = await expandContradictionSuggestion(suggestion, apiKey);
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
  for (const id of deleteIds) {
    if (id !== keepId) {
      deleteMemoryById(id);
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
  if (parts.length < 2) return { error: "Need at least 2 parts to split" };
  const result = splitMemoryById(id, parts);
  if (!result) return { error: "Memory not found" };
  revalidatePath("/");
  revalidatePath("/cleanup");
  return result;
}

export { type CleanupSuggestion } from "./cleanup";

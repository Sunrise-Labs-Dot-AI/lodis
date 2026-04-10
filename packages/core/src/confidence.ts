import type { Client } from "@libsql/client";
import type { SourceType } from "./types.js";

export const DECAY_RATE = 0.01; // per 30 days (used memories)
export const UNUSED_DECAY_RATE = 0.05; // per 30 days (never-used memories)
export const MIN_CONFIDENCE = 0.10;
export const DECAY_INTERVAL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

export async function applyConfidenceDecay(client: Client, userId?: string | null): Promise<number> {
  const now = new Date();

  const result = await client.execute({
    sql: `SELECT id, confidence, used_count, confirmed_count, last_used_at, confirmed_at, learned_at
          FROM memories
          WHERE deleted_at IS NULL AND confidence > ?${userId ? ' AND user_id = ?' : ''}`,
    args: userId ? [MIN_CONFIDENCE, userId] : [MIN_CONFIDENCE],
  });

  const candidates = result.rows as unknown as {
    id: string;
    confidence: number;
    used_count: number;
    confirmed_count: number;
    last_used_at: string | null;
    confirmed_at: string | null;
    learned_at: string | null;
  }[];

  let decayed = 0;

  for (const mem of candidates) {
    const lastActivity = mem.last_used_at || mem.confirmed_at || mem.learned_at;
    if (!lastActivity) continue;

    const elapsed = now.getTime() - new Date(lastActivity).getTime();
    const periods = Math.floor(elapsed / DECAY_INTERVAL_MS);

    if (periods <= 0) continue;

    // Never-used, never-confirmed memories decay 5x faster
    const neverEngaged = mem.used_count === 0 && mem.confirmed_count === 0;
    const rate = neverEngaged ? UNUSED_DECAY_RATE : DECAY_RATE;

    const newConfidence = Math.max(mem.confidence - (rate * periods), MIN_CONFIDENCE);
    if (newConfidence < mem.confidence) {
      await client.execute({
        sql: `UPDATE memories SET confidence = ? WHERE id = ?${userId ? ' AND user_id = ?' : ''}`,
        args: userId ? [newConfidence, mem.id, userId] : [newConfidence, mem.id],
      });
      decayed++;
    }
  }

  return decayed;
}

const INITIAL_CONFIDENCE: Record<SourceType, number> = {
  stated: 0.9,
  observed: 0.75,
  inferred: 0.65,
  "cross-agent": 0.7,
};

export function getInitialConfidence(sourceType: SourceType): number {
  return INITIAL_CONFIDENCE[sourceType] ?? 0.7;
}

export function applyConfirm(_current: number): number {
  return 0.99;
}

export function applyCorrect(): number {
  return 0.5;
}

export function applyMistake(current: number): number {
  return Math.max(current - 0.15, 0.1);
}

export function applyUsed(current: number): number {
  return Math.min(current + 0.02, 0.99);
}

// Temporal language patterns that indicate time-sensitive content
const TEMPORAL_PATTERNS = [
  /\bnext\s+(monday|tuesday|wednesday|thursday|friday|saturday|sunday|week|month)\b/i,
  /\bthis\s+(week|month|quarter|sprint)\b/i,
  /\bcurrently\s/i,
  /\bright\s+now\b/i,
  /\bat\s+the\s+moment\b/i,
  /\btoday\b/i,
  /\btomorrow\b/i,
  /\byesterday\b/i,
];

/**
 * Degrade confidence on memories with temporal language that are older than 14 days.
 * This runs alongside normal decay to prevent stale temporal references from
 * polluting search results.
 */
export async function applyTemporalDecay(client: Client, userId?: string | null): Promise<number> {
  const fourteenDaysAgo = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString();

  const result = await client.execute({
    sql: `SELECT id, content, detail, confidence, learned_at
          FROM memories
          WHERE deleted_at IS NULL
          AND confidence > 0.5
          AND learned_at < ?${userId ? ' AND user_id = ?' : ''}`,
    args: userId ? [fourteenDaysAgo, userId] : [fourteenDaysAgo],
  });

  const candidates = result.rows as unknown as {
    id: string;
    content: string;
    detail: string | null;
    confidence: number;
    learned_at: string;
  }[];

  let degraded = 0;

  for (const mem of candidates) {
    const text = mem.content + (mem.detail ? " " + mem.detail : "");
    const hasTemporal = TEMPORAL_PATTERNS.some((p) => p.test(text));
    if (!hasTemporal) continue;

    // Degrade to 0.5 — still findable but won't dominate results
    const newConfidence = Math.min(mem.confidence, 0.5);
    if (newConfidence < mem.confidence) {
      await client.execute({
        sql: `UPDATE memories SET confidence = ? WHERE id = ?${userId ? ' AND user_id = ?' : ''}`,
        args: userId ? [newConfidence, mem.id, userId] : [newConfidence, mem.id],
      });
      degraded++;
    }
  }

  return degraded;
}

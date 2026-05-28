import type { Client } from "@libsql/client";
import type { SourceType, Permanence } from "./types.js";

export const DECAY_RATE = 0.01; // per 30 days (used memories)
export const UNUSED_DECAY_RATE = 0.05; // per 30 days (never-used memories)
export const MIN_CONFIDENCE = 0.10;
export const DECAY_INTERVAL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

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

const PERMANENT_ENTITY_TYPES = ["preference", "skill", "fact", "lesson"];

export function effectivePermanence(mem: {
  permanence?: string | null;
  confirmed_count?: number;
  confidence?: number;
  used_count?: number;
  entity_type?: string | null;
  content?: string;
  detail?: string | null;
}): Permanence {
  if (mem.permanence) return mem.permanence as Permanence;

  // Canonical signals: confirmed 2+ times, high confidence
  if ((mem.confirmed_count ?? 0) >= 2 && (mem.confidence ?? 0) >= 0.9) return "canonical";

  // Ephemeral signals: temporal language + no engagement
  const text = (mem.content ?? "") + (mem.detail ? " " + mem.detail : "");
  const hasTemporal = TEMPORAL_PATTERNS.some((p) => p.test(text));
  if (hasTemporal && (mem.used_count ?? 0) === 0 && (mem.confirmed_count ?? 0) === 0) return "ephemeral";

  // Inherently permanent entity types with good confidence
  if (PERMANENT_ENTITY_TYPES.includes(mem.entity_type ?? "") && (mem.confidence ?? 0) >= 0.7) return "canonical";

  return "active";
}

export async function applyConfidenceDecay(client: Client, userId?: string | null): Promise<number> {
  const now = new Date();

  const result = await client.execute({
    sql: `SELECT id, confidence, used_count, confirmed_count, corrected_count, last_used_at, confirmed_at, learned_at,
                 permanence, entity_type, content, detail
          FROM memories
          WHERE deleted_at IS NULL AND valid_to IS NULL AND confidence > ?${userId ? ' AND user_id = ?' : ''}`,
    args: userId ? [MIN_CONFIDENCE, userId] : [MIN_CONFIDENCE],
  });

  const candidates = result.rows as unknown as {
    id: string;
    confidence: number;
    used_count: number;
    confirmed_count: number;
    corrected_count: number;
    last_used_at: string | null;
    confirmed_at: string | null;
    learned_at: string | null;
    permanence: string | null;
    entity_type: string | null;
    content: string;
    detail: string | null;
  }[];

  let decayed = 0;

  for (const mem of candidates) {
    const perm = effectivePermanence(mem);

    // Canonical memories are decay-immune
    if (perm === "canonical") continue;

    // Archived memories are frozen
    if (perm === "archived") continue;

    const lastActivity = mem.last_used_at || mem.confirmed_at || mem.learned_at;
    if (!lastActivity) continue;

    const elapsed = now.getTime() - new Date(lastActivity).getTime();
    const periods = Math.floor(elapsed / DECAY_INTERVAL_MS);

    if (periods <= 0) continue;

    // Never-used, never-confirmed, never-corrected memories decay 5x faster
    const neverEngaged = mem.used_count === 0 && mem.confirmed_count === 0 && (mem.corrected_count ?? 0) === 0;
    let rate = neverEngaged ? UNUSED_DECAY_RATE : DECAY_RATE;

    // Ephemeral memories decay 2x faster
    if (perm === "ephemeral") rate *= 2;

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

/**
 * Sweep expired ephemeral memories — soft-delete any with expires_at in the past.
 * Runs alongside confidence decay.
 */
export async function sweepExpiredMemories(client: Client, userId?: string | null): Promise<number> {
  const now = new Date().toISOString();

  const result = await client.execute({
    sql: `UPDATE memories SET deleted_at = ?
          WHERE deleted_at IS NULL
          AND expires_at IS NOT NULL
          AND expires_at < ?${userId ? ' AND user_id = ?' : ''}`,
    args: userId ? [now, now, userId] : [now, now],
  });

  return result.rowsAffected;
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

export function applyCorrect(current: number): number {
  return Math.max(current, 0.9);
}

export function applyMistake(current: number): number {
  return Math.max(current - 0.15, 0.1);
}

export function applyUsed(current: number): number {
  return Math.min(current + 0.02, 0.99);
}

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
          AND valid_to IS NULL
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

/**
 * Parse a TTL string (e.g., "1h", "24h", "7d", "30d") into an ISO 8601 expiration timestamp.
 */
export function parseTTL(ttl: string): string {
  const match = ttl.match(/^(\d+)(h|d)$/);
  if (!match) throw new Error(`Invalid TTL format: "${ttl}". Use e.g. "1h", "24h", "7d", "30d".`);

  const value = parseInt(match[1], 10);
  const unit = match[2];
  const ms = unit === "h" ? value * 60 * 60 * 1000 : value * 24 * 60 * 60 * 1000;

  return new Date(Date.now() + ms).toISOString();
}

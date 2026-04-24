/**
 * Auto-pin rules for snippet writes. Pure functions — no DB access here.
 * The caller (memory_write_snippet) applies the returned PinAction via
 * UPDATE + memory_events audit log. See plan D2, D7.
 */

export type PinAction =
  | { permanence: "active"; ttl: string; reason: string }   // ttl is a parseTTL-compatible spec (e.g. "180d")
  | { permanence: "canonical"; ttl: null; reason: string }; // canonical always nulls expires_at

export interface SnippetForRules {
  snippet_type: string;
  life_domain: string;
  linked_goal_id?: string | null;
  meta?: Record<string, unknown> | null;
}

/**
 * Evaluates auto-pin rules in order; first match wins (per plan D2).
 *
 * Rule 1: goal-linked ship → active + 180d TTL.
 * Rule 2: meta.milestone === true → canonical (no TTL).
 *
 * Precedence: goal-linked ship wins over milestone when both apply.
 * Returns null when neither rule fires (keeps default ephemeral/60d).
 */
export function evaluateAutoPin(s: SnippetForRules): PinAction | null {
  if (s.snippet_type === "shipped" && s.linked_goal_id) {
    return { permanence: "active", ttl: "180d", reason: "goal-linked ship" };
  }
  if (s.meta && s.meta.milestone === true) {
    return { permanence: "canonical", ttl: null, reason: "explicit milestone flag" };
  }
  return null;
}

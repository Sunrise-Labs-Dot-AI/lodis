import type { PermissionRow } from "./db";

/**
 * Derived state shown to the user. Always derived from the set of
 * `agent_permissions` rows by `deriveAgentMode`; never persisted as a
 * column. UI copy mapping (see `scopeLabel` below):
 *   open               → "Open"
 *   isolated           → "Isolated"
 *   isolated_allowlist → "Allowlist · N"
 *   open_blocklist     → "Blocked · N"
 *   mixed              → "Custom rules"  (the literal "mixed" never
 *                                          appears in any UI string —
 *                                          `mixed` is the code term and
 *                                          "Custom rules" is the user
 *                                          term; this mapping is
 *                                          intentional, see plan
 *                                          §Mode enum truth table)
 */
export type AgentModeKind =
  | "open"
  | "isolated"
  | "isolated_allowlist"
  | "open_blocklist"
  | "mixed";

export interface AgentModeState {
  kind: AgentModeKind;
  /** Non-wildcard rules that allow a domain (canRead=1, canWrite=1). */
  allowlist: string[];
  /** Non-wildcard rules that block a domain (canRead=0, canWrite=0). */
  blocklist: string[];
  /** All rules verbatim for the advanced editor / debugging. */
  rules: PermissionRow[];
}

/**
 * Derive the user-facing mode from a set of agent_permissions rows.
 * Matches the truth table in the Agent Permissions redesign plan:
 *
 *   No rows                                                  → Open
 *   (*, 0, 0) only                                           → Isolated
 *   (*, 0, 0) + N non-wildcard rows where canRead=canWrite=1 → Isolated + allowlist
 *   ≥1 row where canRead=canWrite=0, no wildcard             → Open + blocklist
 *   Any partial-R/W row (e.g. (d, 1, 0))                     → Mixed
 *
 * "Mixed" is a fallback that preserves any row shape the simplified UI can't
 * express, so prior configurations aren't corrupted by Slice 1 upgrades.
 */
export function deriveAgentMode(rules: PermissionRow[]): AgentModeState {
  const base: Omit<AgentModeState, "kind"> = {
    allowlist: [],
    blocklist: [],
    rules,
  };

  if (rules.length === 0) {
    return { kind: "open", ...base };
  }

  // Any row with canRead != canWrite → Mixed.
  if (rules.some(r => !!r.can_read !== !!r.can_write)) {
    return { kind: "mixed", ...base };
  }

  const wildcard = rules.find(r => r.domain === "*");
  const nonWildcard = rules.filter(r => r.domain !== "*");

  if (wildcard) {
    // Wildcard must be deny-deny to mean "isolated". Any other wildcard
    // shape is non-expressible in the simple UI → Mixed.
    if (wildcard.can_read !== 0 || wildcard.can_write !== 0) {
      return { kind: "mixed", ...base };
    }
    const allowRows = nonWildcard.filter(r => r.can_read === 1 && r.can_write === 1);
    const blockRows = nonWildcard.filter(r => r.can_read === 0 && r.can_write === 0);
    // Under a wildcard deny, explicit block rows are redundant/confusing.
    // Treat as Mixed rather than silently dropping them.
    if (blockRows.length > 0) {
      return { kind: "mixed", ...base };
    }
    if (allowRows.length === 0) {
      return { kind: "isolated", ...base };
    }
    return {
      kind: "isolated_allowlist",
      allowlist: allowRows.map(r => r.domain),
      blocklist: [],
      rules,
    };
  }

  // No wildcard.
  const blockRows = nonWildcard.filter(r => r.can_read === 0 && r.can_write === 0);
  const allowRows = nonWildcard.filter(r => r.can_read === 1 && r.can_write === 1);

  if (blockRows.length > 0) {
    return {
      kind: "open_blocklist",
      allowlist: allowRows.map(r => r.domain),
      blocklist: blockRows.map(r => r.domain),
      rules,
    };
  }

  // Only redundant allow rows and no wildcard — effectively Open.
  return { kind: "open", ...base };
}

export interface ScopeLabel {
  glyph: string;
  text: string;
  /** Short token for aria-label / WCAG redundancy — never rely on color alone. */
  token: "open" | "isolated" | "allowlist" | "blocklist" | "mixed";
  detail?: string;
}

export function scopeLabel(mode: AgentModeState): ScopeLabel {
  switch (mode.kind) {
    case "open":
      return { glyph: "◎", text: "Open", token: "open", detail: "No rules" };
    case "isolated":
      return { glyph: "⊘", text: "Isolated", token: "isolated", detail: "Blocks everything" };
    case "isolated_allowlist":
      return {
        glyph: "⊘✓",
        text: `Allowlist · ${mode.allowlist.length}`,
        token: "allowlist",
        detail: `${mode.allowlist.length} allowed domain${mode.allowlist.length === 1 ? "" : "s"}`,
      };
    case "open_blocklist":
      return {
        glyph: "✕",
        text: `Blocked · ${mode.blocklist.length}`,
        token: "blocklist",
        detail: `${mode.blocklist.length} blocked domain${mode.blocklist.length === 1 ? "" : "s"}`,
      };
    case "mixed":
      return { glyph: "≋", text: "Custom rules", token: "mixed", detail: "Advanced configuration" };
  }
}

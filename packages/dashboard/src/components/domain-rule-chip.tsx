"use client";

import { useState, useTransition } from "react";
import clsx from "clsx";
import { X } from "lucide-react";
import { removeRule } from "@/app/agents/actions";

export type RuleKind = "allow" | "block";

interface DomainRuleChipProps {
  agentId: string;
  domain: string;
  kind: RuleKind;
}

/**
 * A chip representing one non-wildcard rule row. The whole chip is a button
 * that removes the rule on click (the "X" icon is decorative — hit target is
 * the full chip). A <button> is used rather than role=button for native
 * activation semantics.
 *
 * Errors from `removeRule` (validation, ownership, DB) are surfaced via
 * a small inline message rendered next to the chip + a console error so
 * a regression in the action layer is never silent.
 */
export function DomainRuleChip({ agentId, domain, kind }: DomainRuleChipProps) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const style =
    kind === "allow"
      ? "bg-[var(--accent-soft)] text-[var(--accent-strong)] border-[var(--border-strong)] hover:border-[var(--accent)]"
      : "bg-[rgba(251,191,36,0.08)] text-[var(--warning)] border-[rgba(251,191,36,0.2)] hover:border-[rgba(251,191,36,0.4)]";

  const glyph = kind === "allow" ? "✓" : "✕";
  const tokenLabel = kind === "allow" ? "Allow" : "Block";

  return (
    <span className="inline-flex flex-col items-start gap-1">
      <button
        type="button"
        aria-label={`Remove ${tokenLabel} rule for ${domain}`}
        disabled={isPending}
        onClick={() =>
          startTransition(async () => {
            setError(null);
            try {
              await removeRule(agentId, domain);
            } catch (e) {
              const message = e instanceof Error ? e.message : "Could not remove rule";
              setError(message);
              // eslint-disable-next-line no-console
              console.error("[lodis] removeRule failed:", e);
            }
          })
        }
        className={clsx(
          "group inline-flex items-center gap-1.5 px-2 py-1 text-xs font-medium rounded-full border transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-wait",
          style,
        )}
      >
        <span aria-hidden="true" className="font-mono leading-none">
          {glyph}
        </span>
        <span className="font-mono">{domain}</span>
        <X
          size={12}
          aria-hidden="true"
          className="opacity-60 group-hover:opacity-100 transition-opacity"
        />
      </button>
      {error && (
        <span role="alert" className="text-[10px] text-[var(--danger)]">
          {error}
        </span>
      )}
    </span>
  );
}

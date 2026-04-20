"use client";

import { useEffect, useState, useTransition } from "react";
import clsx from "clsx";
import { setAgentMode, type AgentMode } from "@/app/agents/actions";

interface AgentModeToggleProps {
  agentId: string;
  /** The toggle only controls the Open/Isolated binary — the underlying mode
   *  may be a derived "isolated + allowlist" or "open + blocklist" and the UI
   *  tracks that separately. The `current` prop is the raw binary state. */
  current: AgentMode;
  /** When true (Mixed mode), both options are visually secondary and the
   *  caller should explain to the user via nearby copy. */
  ambiguous?: boolean;
}

const modes: { value: AgentMode; label: string; glyph: string; description: string }[] = [
  {
    value: "open",
    label: "Open",
    glyph: "◎",
    description: "Agent can read and write everything unless a rule blocks it.",
  },
  {
    value: "isolated",
    label: "Isolated",
    glyph: "⊘",
    description: "Agent is blocked from everything unless a rule allows it.",
  },
];

export function AgentModeToggle({ agentId, current, ambiguous }: AgentModeToggleProps) {
  const [value, setValue] = useState<AgentMode>(current);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  // Keep local optimistic state in sync when the server re-renders with a new
  // derived mode (e.g. after applyPreset flips the agent from Open to
  // Isolated+allowlist). Without this, the toggle stays visually stuck on its
  // original value after a non-toggle action changes the underlying rules.
  useEffect(() => {
    setValue(current);
  }, [current]);

  function onChange(next: AgentMode) {
    if (next === value || isPending) return;
    setError(null);
    setValue(next);
    startTransition(async () => {
      try {
        await setAgentMode(agentId, next);
      } catch (e) {
        setValue(current);
        setError(e instanceof Error ? e.message : "Could not update mode");
      }
    });
  }

  return (
    <div className="flex flex-col gap-2">
      <div
        role="radiogroup"
        aria-label="Agent access mode"
        className={clsx(
          "inline-flex items-center p-0.5 gap-0.5 rounded-lg border border-[var(--border)] bg-[var(--bg-soft)]",
          isPending && "opacity-70",
        )}
      >
        {modes.map(m => {
          const active = m.value === value && !ambiguous;
          return (
            <button
              key={m.value}
              type="button"
              role="radio"
              aria-checked={active}
              disabled={isPending}
              onClick={() => onChange(m.value)}
              className={clsx(
                "inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium transition-colors cursor-pointer disabled:cursor-wait",
                active
                  ? "bg-[var(--accent-soft)] text-[var(--accent-strong)] border border-[var(--border-strong)]"
                  : "text-[var(--text-muted)] hover:text-[var(--text)] hover:bg-[rgba(125,211,252,0.05)] border border-transparent",
              )}
            >
              <span aria-hidden="true" className="font-mono leading-none">
                {m.glyph}
              </span>
              {m.label}
            </button>
          );
        })}
      </div>
      <p className="text-[11px] text-[var(--text-dim)]">
        {ambiguous
          ? "This agent has custom rules. Switching now will simplify them — use Advanced for finer control."
          : modes.find(m => m.value === value)?.description}
      </p>
      {error && (
        <p role="alert" className="text-[11px] text-[var(--danger)]">
          {error}
        </p>
      )}
    </div>
  );
}

"use client";

import { useState, useTransition } from "react";
import { updateTier } from "@/app/settings/llm-actions";

const TIERS = [
  {
    value: "local",
    label: "Local",
    description: "All data stays on your machine. No cloud sync.",
    color: "var(--color-text-muted)",
  },
  {
    value: "cloud",
    label: "Cloud",
    description: "Cloud sync via Turso. Bring your own LLM key.",
    color: "var(--color-accent-text)",
  },
  {
    value: "cloud+",
    label: "Cloud+",
    description: "Cloud sync + managed LLM. No API key needed.",
    color: "var(--color-success)",
  },
] as const;

export function TierSelector({
  currentTier,
  userId,
}: {
  currentTier: string;
  userId: string | null;
}) {
  const [selected, setSelected] = useState(currentTier);
  const [isPending, startTransition] = useTransition();

  function handleSelect(tier: string) {
    if (!userId || tier === selected) return;
    setSelected(tier);
    startTransition(async () => {
      await updateTier(userId, tier as "local" | "cloud" | "cloud+");
    });
  }

  return (
    <div className="space-y-2">
      {TIERS.map((tier) => (
        <button
          key={tier.value}
          onClick={() => handleSelect(tier.value)}
          disabled={isPending || !userId}
          className={`w-full flex items-center justify-between rounded-lg border px-3 py-2.5 text-left text-sm transition-colors ${
            selected === tier.value
              ? "border-[var(--color-accent-text)] bg-[rgba(125,211,252,0.05)]"
              : "border-[var(--color-border)] hover:border-[var(--color-border-hover)]"
          } ${isPending || !userId ? "opacity-50 cursor-not-allowed" : "cursor-pointer"}`}
        >
          <div>
            <span
              className="font-medium"
              style={{ color: tier.color }}
            >
              {tier.label}
            </span>
            <p className="text-xs text-[var(--color-text-muted)] mt-0.5">
              {tier.description}
            </p>
          </div>
          {selected === tier.value && (
            <span
              className="text-xs"
              style={{ color: tier.color }}
            >
              Active
            </span>
          )}
        </button>
      ))}
      {!userId && (
        <p className="text-xs text-[var(--color-text-dim)]">
          Sign in to change your plan.
        </p>
      )}
    </div>
  );
}

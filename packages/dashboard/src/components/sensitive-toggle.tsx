"use client";

import { useState, useTransition } from "react";
import { Lock, LockOpen } from "lucide-react";
import clsx from "clsx";
import { markDomainSensitive } from "@/app/agents/actions";

interface SensitiveToggleProps {
  domain: string;
  initialSensitive: boolean;
}

export function SensitiveToggle({ domain, initialSensitive }: SensitiveToggleProps) {
  const [sensitive, setSensitive] = useState(initialSensitive);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function toggle() {
    setError(null);
    const next = !sensitive;
    setSensitive(next);
    startTransition(async () => {
      try {
        await markDomainSensitive(domain, next);
      } catch (e) {
        setSensitive(!next);
        setError(e instanceof Error ? e.message : "Could not update");
      }
    });
  }

  return (
    <div className="flex flex-col gap-2">
      <button
        type="button"
        onClick={toggle}
        disabled={isPending}
        aria-pressed={sensitive}
        className={clsx(
          "inline-flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium border cursor-pointer transition-colors disabled:opacity-60",
          sensitive
            ? "bg-[var(--violet-soft)] text-[var(--violet)] border-[var(--violet)]"
            : "bg-[var(--bg-soft)] text-[var(--text-muted)] border-[var(--border)] hover:border-[var(--border-strong)]",
        )}
      >
        {sensitive ? <Lock size={14} aria-hidden="true" /> : <LockOpen size={14} aria-hidden="true" />}
        {sensitive ? "Marked sensitive" : "Mark sensitive"}
      </button>
      <p className="text-[11px] text-[var(--text-dim)] max-w-sm">
        {sensitive
          ? "Allowing an agent to read this domain now requires confirmation, and new agents writing here are blocked by default."
          : "Marking sensitive warns before granting agents access and defaults new agents to blocked for this domain."}
      </p>
      {error && (
        <p role="alert" className="text-[11px] text-[var(--danger)]">
          {error}
        </p>
      )}
    </div>
  );
}

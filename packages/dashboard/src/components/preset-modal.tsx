"use client";

import { useMemo, useState, useTransition } from "react";
import clsx from "clsx";
import { Lock } from "lucide-react";
import { Modal } from "@/components/ui/modal";
import { Button } from "@/components/ui/button";
import { applyPreset, type Preset } from "@/app/agents/actions";

interface PresetModalProps {
  open: boolean;
  onClose: () => void;
  agentId: string;
  agentName: string;
  /** Preset chosen by the user via the card they clicked. */
  preset: Preset;
  /** All domains that currently exist in memories. */
  availableDomains: string[];
  /** Domains the user has marked sensitive (rendered with a warning). */
  sensitiveDomains: string[];
  /** The rules that will be wiped when the preset applies. Used for the diff. */
  existingRuleDomains: string[];
}

const presetCopy: Record<Preset, { title: string; description: string; defaultDomains?: string[] }> = {
  work: {
    title: "Work",
    description:
      "Pick the domains this agent should see while you're working. Everything else will be hidden.",
  },
  personal: {
    title: "Personal",
    description:
      "Pick the domains this agent should see for personal context. Everything else will be hidden.",
  },
  lockdown: {
    title: "Lockdown",
    description:
      "This agent will be blocked from every domain. Use for agents you don't fully trust yet.",
  },
};

export function PresetModal({
  open,
  onClose,
  agentId,
  agentName,
  preset,
  availableDomains,
  sensitiveDomains,
  existingRuleDomains,
}: PresetModalProps) {
  const copy = presetCopy[preset];
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [filter, setFilter] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const sensitiveSet = useMemo(() => new Set(sensitiveDomains), [sensitiveDomains]);

  const filteredDomains = useMemo(() => {
    const q = filter.trim().toLowerCase();
    return availableDomains
      .filter(d => (q ? d.toLowerCase().includes(q) : true))
      .slice(0, 100);
  }, [availableDomains, filter]);

  function toggle(d: string) {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(d)) next.delete(d);
      else next.add(d);
      return next;
    });
  }

  const sensitiveSelected = preset !== "lockdown"
    ? Array.from(selected).filter(d => sensitiveSet.has(d))
    : [];

  function submit() {
    setError(null);
    const allowlist = preset === "lockdown" ? [] : Array.from(selected);
    // Passing `sensitiveSelected` acts as the user's confirmation for
    // each sensitive domain — the server action requires this to match
    // the intersection of (allowlist, sensitive_domains); see
    // actions.ts:applyPreset. The inline warning block above the
    // submit button is what the user is acknowledging by clicking.
    startTransition(async () => {
      try {
        await applyPreset(agentId, preset, allowlist, sensitiveSelected);
        onClose();
        setSelected(new Set());
      } catch (e) {
        setError(e instanceof Error ? e.message : "Could not apply preset");
      }
    });
  }

  return (
    <Modal open={open} onClose={onClose} title={`Apply "${copy.title}" to ${agentName}`} size="lg">
      <p className="text-sm text-[var(--text-muted)] mb-4">{copy.description}</p>

      {preset !== "lockdown" && (
        <>
          <div className="mb-3">
            <input
              type="text"
              value={filter}
              onChange={e => setFilter(e.target.value)}
              placeholder="Filter domains…"
              className="w-full px-3 py-2 text-sm rounded-md bg-[var(--bg)] border border-[var(--border)] focus:border-[var(--accent)] outline-none"
            />
          </div>

          <div className="border border-[var(--border-subtle)] rounded-md max-h-64 overflow-y-auto p-1">
            {filteredDomains.length === 0 ? (
              <p className="text-xs text-[var(--text-dim)] p-3">No domains match.</p>
            ) : (
              <ul className="space-y-0.5">
                {filteredDomains.map(d => {
                  const isChecked = selected.has(d);
                  const isSensitive = sensitiveSet.has(d);
                  return (
                    <li key={d}>
                      <label
                        className={clsx(
                          "flex items-center gap-2 px-2 py-1.5 rounded cursor-pointer text-sm",
                          "hover:bg-[rgba(125,211,252,0.05)]",
                          isChecked && "bg-[var(--accent-soft)]",
                        )}
                      >
                        <input
                          type="checkbox"
                          checked={isChecked}
                          onChange={() => toggle(d)}
                          className="accent-[var(--accent-solid)]"
                        />
                        <span className="font-mono flex-1 truncate">{d}</span>
                        {isSensitive && (
                          <span
                            className="inline-flex items-center gap-1 px-1.5 py-0.5 text-[10px] font-medium rounded-full bg-[var(--violet-soft)] text-[var(--violet)]"
                            aria-label="Sensitive domain"
                          >
                            <Lock size={10} aria-hidden="true" />
                            Sensitive
                          </span>
                        )}
                      </label>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>

          <div className="mt-3 text-xs text-[var(--text-dim)]">
            {selected.size === 0
              ? "No domains selected. Applying will isolate this agent from everything."
              : `${selected.size} selected`}
          </div>

          {sensitiveSelected.length > 0 && (
            <div className="mt-3 p-3 rounded-md bg-[var(--violet-soft)] border border-[var(--violet)] text-xs">
              <p className="text-[var(--violet)] font-medium mb-1">
                You&rsquo;re allowing access to {sensitiveSelected.length} sensitive domain{sensitiveSelected.length === 1 ? "" : "s"}
              </p>
              <p className="text-[var(--text-muted)] font-mono">
                {sensitiveSelected.join(", ")}
              </p>
            </div>
          )}
        </>
      )}

      {preset === "lockdown" && (
        <div className="mb-4 p-3 rounded-md bg-[rgba(251,191,36,0.08)] border border-[rgba(251,191,36,0.2)] text-xs">
          <p className="text-[var(--warning)] font-medium mb-1">This agent will see nothing.</p>
          <p className="text-[var(--text-muted)]">
            You can re-open access anytime by switching the agent back to Open or adding explicit allow rules.
          </p>
        </div>
      )}

      {existingRuleDomains.length > 0 && (
        <p className="mt-3 text-[11px] text-[var(--text-dim)]">
          This replaces {existingRuleDomains.length} existing rule{existingRuleDomains.length === 1 ? "" : "s"}: {existingRuleDomains.slice(0, 4).join(", ")}{existingRuleDomains.length > 4 ? `, +${existingRuleDomains.length - 4} more` : ""}.
        </p>
      )}

      {error && (
        <p role="alert" className="mt-3 text-xs text-[var(--danger)]">
          {error}
        </p>
      )}

      <div className="flex items-center justify-end gap-2 mt-5 pt-4 border-t border-[var(--border-subtle)]">
        <Button variant="ghost" onClick={onClose} disabled={isPending}>
          Cancel
        </Button>
        <Button onClick={submit} disabled={isPending}>
          {isPending ? "Applying…" : `Apply ${copy.title}`}
        </Button>
      </div>
    </Modal>
  );
}

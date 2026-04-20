"use client";

import { useState, useTransition, useMemo, useRef, useEffect } from "react";
import clsx from "clsx";
import { Plus, Lock } from "lucide-react";
import { allowDomain, blockDomain } from "@/app/agents/actions";
import { Modal } from "@/components/ui/modal";
import { Button } from "@/components/ui/button";
import type { RuleKind } from "./domain-rule-chip";

interface AddDomainChipButtonProps {
  agentId: string;
  agentName: string;
  kind: RuleKind;
  /** Known domains that exist in memory; used to suggest choices. */
  availableDomains: string[];
  /** Domains already ruled-on for this agent (to exclude from the picker). */
  excludedDomains: string[];
  /** Domains the user has marked sensitive — a confirm modal is required
   *  before granting an agent allow-access to any of these. */
  sensitiveDomains: string[];
}

export function AddDomainChipButton({
  agentId,
  agentName,
  kind,
  availableDomains,
  excludedDomains,
  sensitiveDomains,
}: AddDomainChipButtonProps) {
  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pendingSensitive, setPendingSensitive] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const rootRef = useRef<HTMLDivElement>(null);

  const sensitiveSet = useMemo(() => new Set(sensitiveDomains), [sensitiveDomains]);

  const options = useMemo(() => {
    const excluded = new Set(excludedDomains);
    const q = filter.trim().toLowerCase();
    return availableDomains
      .filter(d => !excluded.has(d))
      .filter(d => (q ? d.toLowerCase().includes(q) : true))
      .slice(0, 20);
  }, [availableDomains, excludedDomains, filter]);

  // Click-outside to dismiss.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    window.addEventListener("mousedown", onDown);
    return () => window.removeEventListener("mousedown", onDown);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  function submit(domain: string, confirmed = false) {
    if (!domain) return;
    setError(null);
    // Intercept: if user is granting allow-access to a sensitive domain and
    // hasn't confirmed yet, surface the confirm modal instead of calling the
    // action (which would throw anyway — this just saves a round-trip and
    // explains to the user *why* before they act).
    if (kind === "allow" && sensitiveSet.has(domain) && !confirmed) {
      setPendingSensitive(domain);
      return;
    }
    startTransition(async () => {
      try {
        if (kind === "allow") {
          await allowDomain(agentId, domain, confirmed);
        } else {
          await blockDomain(agentId, domain);
        }
        setFilter("");
        setOpen(false);
        setPendingSensitive(null);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Could not add rule");
      }
    });
  }

  const label = kind === "allow" ? "Allow a domain" : "Block a domain";

  return (
    <div ref={rootRef} className="relative inline-block">
      <button
        type="button"
        onClick={() => setOpen(v => !v)}
        className={clsx(
          "inline-flex items-center gap-1 px-2 py-1 text-xs font-medium rounded-full border border-dashed cursor-pointer transition-colors",
          "border-[var(--border-strong)] text-[var(--text-muted)] hover:text-[var(--accent-strong)] hover:border-[var(--accent)] hover:bg-[var(--accent-soft)]",
        )}
      >
        <Plus size={12} aria-hidden="true" />
        {label}
      </button>

      {open && (
        <div
          role="dialog"
          aria-label={label}
          className="absolute left-0 top-full mt-1 z-20 w-64 rounded-lg border border-[var(--border)] bg-[var(--bg-soft)] shadow-xl p-2 space-y-2"
        >
          <input
            type="text"
            autoFocus
            value={filter}
            onChange={e => setFilter(e.target.value)}
            onKeyDown={e => {
              if (e.key === "Enter") submit(filter.trim());
            }}
            placeholder="Domain name…"
            className="w-full px-2 py-1.5 text-xs rounded-md bg-[var(--bg)] border border-[var(--border)] focus:border-[var(--accent)] outline-none font-mono"
          />
          {options.length > 0 && (
            <ul role="listbox" className="max-h-48 overflow-y-auto space-y-0.5">
              {options.map(d => (
                <li key={d}>
                  <button
                    type="button"
                    role="option"
                    aria-selected="false"
                    onClick={() => submit(d)}
                    disabled={isPending}
                    className="w-full text-left px-2 py-1 text-xs font-mono rounded hover:bg-[var(--accent-soft)] hover:text-[var(--accent-strong)] transition-colors cursor-pointer disabled:opacity-50"
                  >
                    {d}
                  </button>
                </li>
              ))}
            </ul>
          )}
          {filter.trim() && !options.includes(filter.trim()) && (
            <button
              type="button"
              onClick={() => submit(filter.trim())}
              disabled={isPending}
              className="w-full text-left px-2 py-1 text-xs rounded bg-[var(--accent-soft)] text-[var(--accent-strong)] hover:bg-[rgba(125,211,252,0.18)] transition-colors cursor-pointer disabled:opacity-50"
            >
              <span className="opacity-70">Use </span>
              <span className="font-mono">{filter.trim()}</span>
            </button>
          )}
          {error && (
            <p role="alert" className="text-[11px] text-[var(--danger)]">
              {error}
            </p>
          )}
        </div>
      )}

      <Modal
        open={pendingSensitive !== null}
        onClose={() => setPendingSensitive(null)}
        title="Grant access to a sensitive domain?"
        size="sm"
      >
        <div className="space-y-3">
          <div className="flex items-start gap-2 p-3 rounded-md bg-[var(--violet-soft)] border border-[var(--violet)]">
            <Lock size={14} aria-hidden="true" className="text-[var(--violet)] mt-0.5 shrink-0" />
            <div className="text-xs">
              <p className="text-[var(--violet)] font-medium">
                You marked <span className="font-mono">{pendingSensitive}</span> as sensitive.
              </p>
              <p className="text-[var(--text-muted)] mt-1">
                Allowing <span className="font-medium">{agentName}</span> to read and write this
                domain gives it the same access you'd give any other agent. Continue only if
                that's intentional.
              </p>
            </div>
          </div>
          <div className="flex items-center justify-end gap-2 pt-2">
            <Button variant="ghost" onClick={() => setPendingSensitive(null)}>
              Cancel
            </Button>
            <Button
              onClick={() => {
                if (pendingSensitive) submit(pendingSensitive, true);
              }}
              disabled={isPending}
            >
              {isPending ? "Granting…" : "Grant access"}
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}

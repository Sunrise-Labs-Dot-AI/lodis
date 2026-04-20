"use client";

import { useState, useTransition } from "react";
import { RotateCcw } from "lucide-react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import { resetAgentRules } from "@/app/agents/actions";

interface ResetRulesButtonProps {
  agentId: string;
  agentName: string;
  ruleCount: number;
}

export function ResetRulesButton({ agentId, agentName, ruleCount }: ResetRulesButtonProps) {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const router = useRouter();

  function confirm() {
    setError(null);
    startTransition(async () => {
      try {
        await resetAgentRules(agentId);
        setOpen(false);
        // router.refresh() before push so the destination render reads
        // the post-delete state. Without it, on a hosted/replica
        // deployment the user can land back on the detail page and
        // see the old "Custom rules" listing for a beat before Next's
        // RSC cache catches up to the revalidate.
        router.refresh();
        router.push(`/agents/${encodeURIComponent(agentId)}`);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Could not reset rules");
      }
    });
  }

  return (
    <>
      <Button
        variant="secondary"
        size="sm"
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-2"
      >
        <RotateCcw size={12} aria-hidden="true" />
        Reset to Open
      </Button>
      <Modal open={open} onClose={() => setOpen(false)} title="Reset all rules?" size="sm">
        <div className="space-y-3">
          <p className="text-sm text-[var(--text-muted)]">
            This removes all {ruleCount} rule{ruleCount === 1 ? "" : "s"} for{" "}
            <span className="font-medium text-[var(--text)]">{agentName}</span> and returns it to
            the Open state — no restrictions on which domains it can read or write.
          </p>
          {error && (
            <p role="alert" className="text-xs text-[var(--danger)]">
              {error}
            </p>
          )}
          <div className="flex items-center justify-end gap-2 pt-2">
            <Button variant="ghost" onClick={() => setOpen(false)} disabled={isPending}>
              Cancel
            </Button>
            <Button variant="danger" onClick={confirm} disabled={isPending}>
              {isPending ? "Resetting…" : "Reset rules"}
            </Button>
          </div>
        </div>
      </Modal>
    </>
  );
}

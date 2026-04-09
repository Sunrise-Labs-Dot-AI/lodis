"use client";

import { useTransition } from "react";
import { X } from "lucide-react";
import { removePermission } from "@/app/agents/actions";

interface RemoveRuleButtonProps {
  agentId: string;
  domain: string;
}

export function RemoveRuleButton({ agentId, domain }: RemoveRuleButtonProps) {
  const [isPending, startTransition] = useTransition();

  return (
    <button
      disabled={isPending}
      onClick={() => {
        startTransition(() => removePermission(agentId, domain));
      }}
      title="Remove rule"
      className="p-0.5 rounded text-[var(--color-text-muted)] hover:text-[var(--color-danger)] hover:bg-[var(--color-danger-bg)] transition-colors cursor-pointer disabled:opacity-50"
    >
      <X size={10} />
    </button>
  );
}

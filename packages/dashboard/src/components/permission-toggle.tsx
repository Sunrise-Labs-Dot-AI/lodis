"use client";

import { useTransition } from "react";
import clsx from "clsx";
import { togglePermission } from "@/app/agents/actions";

interface PermissionToggleProps {
  agentId: string;
  domain: string;
  field: "read" | "write";
  enabled: boolean;
}

export function PermissionToggle({
  agentId,
  domain,
  field,
  enabled,
}: PermissionToggleProps) {
  const [isPending, startTransition] = useTransition();

  return (
    <button
      disabled={isPending}
      onClick={() => {
        startTransition(() => togglePermission(agentId, domain, field, enabled));
      }}
      className={clsx(
        "px-1.5 py-0.5 rounded text-[10px] font-medium transition-colors cursor-pointer",
        isPending && "opacity-50",
        enabled
          ? "bg-[var(--color-success-bg)] text-[var(--color-success)]"
          : "bg-[var(--color-danger-bg)] text-[var(--color-danger)]",
      )}
    >
      {field === "read" ? "R" : "W"}
    </button>
  );
}

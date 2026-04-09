"use client";

import { useState, useTransition } from "react";
import { Plus } from "lucide-react";
import { upsertPermission } from "@/app/agents/actions";

interface AddRuleFormProps {
  agents: { agent_id: string; agent_name: string }[];
  domains: string[];
}

export function AddRuleForm({ agents, domains }: AddRuleFormProps) {
  const [isPending, startTransition] = useTransition();
  const [agentId, setAgentId] = useState("");
  const [domain, setDomain] = useState("");
  const [canRead, setCanRead] = useState(true);
  const [canWrite, setCanWrite] = useState(true);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!agentId || !domain) return;

    startTransition(async () => {
      await upsertPermission(agentId, domain, canRead, canWrite);
      setDomain("");
      setCanRead(true);
      setCanWrite(true);
    });
  }

  return (
    <form onSubmit={handleSubmit} className="flex items-center gap-2 flex-wrap">
      <select
        value={agentId}
        onChange={(e) => setAgentId(e.target.value)}
        className="px-2 py-1.5 text-xs bg-[var(--color-bg-soft)] border border-[var(--color-border)] rounded-md text-[var(--color-text-secondary)] focus:outline-none focus:ring-1 focus:ring-[var(--color-accent-solid)]"
      >
        <option value="">Select agent</option>
        {agents.map((a) => (
          <option key={a.agent_id} value={a.agent_id}>
            {a.agent_name}
          </option>
        ))}
      </select>

      <input
        type="text"
        value={domain}
        onChange={(e) => setDomain(e.target.value)}
        placeholder="Domain (or * for all)"
        list="domain-options"
        className="px-2 py-1.5 text-xs bg-[var(--color-bg-soft)] border border-[var(--color-border)] rounded-md text-[var(--color-text)] placeholder:text-[var(--color-text-muted)] focus:outline-none focus:ring-1 focus:ring-[var(--color-accent-solid)] w-40"
      />
      <datalist id="domain-options">
        <option value="*" />
        {domains.map((d) => (
          <option key={d} value={d} />
        ))}
      </datalist>

      <label className="flex items-center gap-1 text-xs text-[var(--color-text-secondary)]">
        <input
          type="checkbox"
          checked={canRead}
          onChange={(e) => setCanRead(e.target.checked)}
          className="rounded"
        />
        Read
      </label>

      <label className="flex items-center gap-1 text-xs text-[var(--color-text-secondary)]">
        <input
          type="checkbox"
          checked={canWrite}
          onChange={(e) => setCanWrite(e.target.checked)}
          className="rounded"
        />
        Write
      </label>

      <button
        type="submit"
        disabled={isPending || !agentId || !domain}
        className="flex items-center gap-1 px-2 py-1.5 text-xs bg-gradient-to-r from-[rgba(125,211,252,0.15)] to-[rgba(167,139,250,0.15)] border border-[var(--color-border-hover)] text-[var(--color-accent-text)] rounded-md hover:from-[rgba(125,211,252,0.25)] hover:to-[rgba(167,139,250,0.25)] transition-all disabled:opacity-50 cursor-pointer"
      >
        <Plus size={12} />
        Add rule
      </button>
    </form>
  );
}

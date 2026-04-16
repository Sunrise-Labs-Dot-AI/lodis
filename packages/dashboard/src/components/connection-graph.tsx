import Link from "next/link";
import { StatusBadge } from "@/components/ui/status-badge";
import type { ConnectionRow } from "@/lib/db";

interface ConnectionGraphProps {
  outgoing: (ConnectionRow & { content: string })[];
  incoming: (ConnectionRow & { content: string })[];
}

export function ConnectionGraph({ outgoing, incoming }: ConnectionGraphProps) {
  if (outgoing.length === 0 && incoming.length === 0) {
    return (
      <p className="text-sm text-[var(--text-dim)]">
        No connections yet.
      </p>
    );
  }

  return (
    <div className="space-y-3">
      {outgoing.map((c) => (
        <div key={`o-${c.target_memory_id}`} className="flex items-center gap-2">
          <span className="text-xs text-[var(--text-dim)]">&#8594;</span>
          <StatusBadge variant="accent">{c.relationship}</StatusBadge>
          <Link
            href={`/memory/${c.target_memory_id}`}
            className="text-sm text-[var(--accent-strong)] hover:underline truncate"
          >
            {c.content}
          </Link>
        </div>
      ))}
      {incoming.map((c) => (
        <div key={`i-${c.source_memory_id}`} className="flex items-center gap-2">
          <span className="text-xs text-[var(--text-dim)]">&#8592;</span>
          <StatusBadge variant="neutral">{c.relationship}</StatusBadge>
          <Link
            href={`/memory/${c.source_memory_id}`}
            className="text-sm text-[var(--accent-strong)] hover:underline truncate"
          >
            {c.content}
          </Link>
        </div>
      ))}
    </div>
  );
}

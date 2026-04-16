import { MemoryCard } from "./memory-card";
import type { MemoryRow } from "@/lib/db";

interface MemoryListProps {
  memories: MemoryRow[];
  groupByDomain?: boolean;
}

export function MemoryList({ memories, groupByDomain = true }: MemoryListProps) {
  if (memories.length === 0) {
    return (
      <div className="text-center py-16">
        <p className="text-[var(--text-dim)] text-sm">
          No memories yet. Start chatting with an AI tool that has Lodis
          connected.
        </p>
      </div>
    );
  }

  if (!groupByDomain) {
    return (
      <div className="space-y-2">
        {memories.map((m) => (
          <MemoryCard key={m.id} memory={m} />
        ))}
      </div>
    );
  }

  const grouped = new Map<string, MemoryRow[]>();
  for (const m of memories) {
    const list = grouped.get(m.domain) ?? [];
    list.push(m);
    grouped.set(m.domain, list);
  }

  return (
    <div className="space-y-6">
      {Array.from(grouped.entries()).map(([domain, domainMemories]) => (
        <div key={domain}>
          <h2 className="flex items-baseline gap-2 pb-2 mb-3 border-b border-[var(--border-subtle)] text-sm font-semibold text-[var(--text)] capitalize">
            {domain}
            <span className="text-xs font-normal text-[var(--text-dim)]">
              &middot; {domainMemories.length}{" "}
              {domainMemories.length === 1 ? "memory" : "memories"}
            </span>
          </h2>
          <div className="space-y-2">
            {domainMemories.map((m) => (
              <MemoryCard key={m.id} memory={m} />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

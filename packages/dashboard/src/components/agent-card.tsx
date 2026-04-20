import Link from "next/link";
import { Card } from "@/components/ui/card";
import { ScopeChip } from "@/components/scope-chip";
import { scopeLabel, type AgentModeState } from "@/lib/agent-mode";

interface AgentCardProps {
  agentId: string;
  agentName: string;
  memoryCount: number;
  lastSeen: string | null;
  mode: AgentModeState;
}

function avatarInitials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return "?";
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return (words[0][0] + words[1][0]).toUpperCase();
}

function relativeTime(ts: string | null): string {
  if (!ts) return "never";
  const t = new Date(ts).getTime();
  if (Number.isNaN(t)) return "never";
  const seconds = Math.round((Date.now() - t) / 1000);
  if (seconds < 60) return "just now";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 30) return `${days}d ago`;
  const months = Math.round(days / 30);
  if (months < 12) return `${months}mo ago`;
  return `${Math.round(months / 12)}y ago`;
}

export function AgentCard({
  agentId,
  agentName,
  memoryCount,
  lastSeen,
  mode,
}: AgentCardProps) {
  const label = scopeLabel(mode);
  return (
    <Card className="p-4 flex flex-col gap-3">
      <div className="flex items-start gap-3">
        <Link
          href={`/agents/${encodeURIComponent(agentId)}`}
          className="flex items-center gap-3 min-w-0 flex-1 group rounded-md outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--bg)]"
        >
          <span
            aria-hidden="true"
            className="shrink-0 w-10 h-10 rounded-full bg-[var(--accent-soft)] border border-[var(--border)] text-[var(--accent-strong)] flex items-center justify-center text-sm font-semibold font-mono"
          >
            {avatarInitials(agentName)}
          </span>
          <span className="min-w-0">
            <span className="block text-sm font-medium truncate group-hover:text-[var(--accent-strong)] transition-colors">
              {agentName}
            </span>
            <span className="block text-[11px] text-[var(--text-dim)] font-mono truncate">
              {agentId}
            </span>
          </span>
        </Link>
        <ScopeChip label={label} />
      </div>

      <dl className="flex items-center justify-between text-[11px] text-[var(--text-dim)] border-t border-[var(--border-subtle)] pt-3">
        <div>
          <dt className="sr-only">Memories</dt>
          <dd>
            <span className="text-[var(--text-muted)] font-medium">
              {memoryCount.toLocaleString()}
            </span>{" "}
            {memoryCount === 1 ? "memory" : "memories"}
          </dd>
        </div>
        <div>
          <dt className="sr-only">Last active</dt>
          <dd>Last seen {relativeTime(lastSeen)}</dd>
        </div>
      </dl>
    </Card>
  );
}

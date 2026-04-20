import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronLeft } from "lucide-react";
import {
  getAgentActivity,
  getAgentPermissions,
} from "@/lib/db";
import { getUserId } from "@/lib/auth";
import { Card } from "@/components/ui/card";
import { ScopeChip } from "@/components/scope-chip";
import { ResetRulesButton } from "@/components/reset-rules-button";
import { deriveAgentMode, scopeLabel } from "@/lib/agent-mode";

export const dynamic = "force-dynamic";

interface PageProps {
  params: Promise<{ agentId: string }>;
}

export default async function AgentAdvancedPage({ params }: PageProps) {
  const { agentId: rawAgentId } = await params;
  const agentId = decodeURIComponent(rawAgentId);
  const userId = await getUserId();

  const [activity, permissions] = await Promise.all([
    getAgentActivity(userId),
    getAgentPermissions(userId),
  ]);

  // Same fallback as the basic detail page: surface agents that have
  // rules but no surviving memories (e.g. auto-block wrote a rule
  // then the only memory was deleted, or an admin migration seeded
  // rules). Without this, "Open advanced view" 404s for any
  // rule-only agent.
  const fromActivity = activity.find(a => a.agentId === agentId);
  const ruleHit = permissions.find(p => p.agent_id === agentId);
  const agent = fromActivity ?? (ruleHit
    ? { agentId, agentName: agentId, count: 0, lastSeen: null }
    : null);
  if (!agent) notFound();

  const rules = permissions.filter(p => p.agent_id === agentId);
  const mode = deriveAgentMode(rules);
  const label = scopeLabel(mode);

  return (
    <div className="space-y-6 max-w-3xl">
      <nav aria-label="Breadcrumb" className="text-xs text-[var(--text-dim)]">
        <Link
          href={`/agents/${encodeURIComponent(agent.agentId)}`}
          className="inline-flex items-center gap-1 hover:text-[var(--accent-strong)] transition-colors"
        >
          <ChevronLeft size={14} aria-hidden="true" />
          Back to {agent.agentName}
        </Link>
      </nav>

      <header className="flex items-start justify-between gap-4 flex-wrap">
        <div className="min-w-0">
          <h1 className="text-xl font-semibold">Advanced rules</h1>
          <p className="text-xs text-[var(--text-dim)] mt-1">
            Raw <code className="font-mono">agent_permissions</code> rows for{" "}
            <span className="text-[var(--text-muted)]">{agent.agentName}</span>. Read-only —
            edit via the main agent page, or reset to start fresh.
          </p>
        </div>
        <ScopeChip label={label} size="md" />
      </header>

      <Card className="p-0 overflow-hidden">
        <table className="w-full text-xs font-mono">
          <thead>
            <tr className="border-b border-[var(--border)] bg-[var(--bg-soft)]">
              <th className="text-left px-4 py-2 font-medium text-[var(--text-muted)]">Domain</th>
              <th className="text-center px-4 py-2 font-medium text-[var(--text-muted)]">Read</th>
              <th className="text-center px-4 py-2 font-medium text-[var(--text-muted)]">Write</th>
            </tr>
          </thead>
          <tbody>
            {rules.length === 0 ? (
              <tr>
                <td
                  colSpan={3}
                  className="text-center px-4 py-6 text-[var(--text-dim)] font-sans"
                >
                  No rules. Agent has unrestricted access to every domain.
                </td>
              </tr>
            ) : (
              rules.map(r => (
                <tr
                  key={r.domain}
                  className="border-b border-[var(--border-subtle)] last:border-b-0"
                >
                  <td className="px-4 py-2">
                    {r.domain === "*" ? (
                      <span className="text-[var(--text-muted)]">* (wildcard)</span>
                    ) : (
                      r.domain
                    )}
                  </td>
                  <td
                    className={
                      "text-center px-4 py-2 " +
                      (r.can_read ? "text-[var(--success)]" : "text-[var(--danger)]")
                    }
                  >
                    {r.can_read ? "1" : "0"}
                  </td>
                  <td
                    className={
                      "text-center px-4 py-2 " +
                      (r.can_write ? "text-[var(--success)]" : "text-[var(--danger)]")
                    }
                  >
                    {r.can_write ? "1" : "0"}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </Card>

      <Card className="p-4 space-y-3">
        <h2 className="text-sm font-medium">Escape hatch</h2>
        <p className="text-xs text-[var(--text-muted)] max-w-lg">
          If the rules here don&rsquo;t map to Open/Isolated in the main UI (e.g. partial R/W
          rows), resetting will delete all {rules.length} row{rules.length === 1 ? "" : "s"} and
          return the agent to the implicit Open state. You can then configure access from
          scratch with a preset or a few chip rules.
        </p>
        <ResetRulesButton
          agentId={agent.agentId}
          agentName={agent.agentName}
          ruleCount={rules.length}
        />
      </Card>
    </div>
  );
}

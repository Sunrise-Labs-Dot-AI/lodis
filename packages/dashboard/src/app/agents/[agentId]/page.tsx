import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronLeft, ChevronRight, Lock, ShieldAlert } from "lucide-react";
import {
  getAgentActivity,
  getAgentPermissions,
  getAgentDomainDistribution,
  getAgentRecentMemories,
  getDomains,
  getSensitiveDomains,
} from "@/lib/db";
import { getUserId } from "@/lib/auth";
import { Card } from "@/components/ui/card";
import { ScopeChip } from "@/components/scope-chip";
import { AgentModeToggle } from "@/components/agent-mode-toggle";
import { DomainRuleChip } from "@/components/domain-rule-chip";
import { AddDomainChipButton } from "@/components/add-domain-chip-button";
import { PresetLauncher } from "@/components/preset-launcher";
import { deriveAgentMode, scopeLabel } from "@/lib/agent-mode";

export const dynamic = "force-dynamic";

interface PageProps {
  params: Promise<{ agentId: string }>;
}

function formatDate(ts: string | null): string {
  if (!ts) return "never";
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return "never";
  return d.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default async function AgentDetailPage({ params }: PageProps) {
  const { agentId: rawAgentId } = await params;
  const agentId = decodeURIComponent(rawAgentId);
  const userId = await getUserId();

  const [activity, permissions, distribution, recentMemories, domains, sensitiveDomains] =
    await Promise.all([
      getAgentActivity(userId),
      getAgentPermissions(userId),
      getAgentDomainDistribution(userId, agentId, 50),
      getAgentRecentMemories(userId, agentId, 10),
      getDomains(userId),
      getSensitiveDomains(userId),
    ]);

  // Resolve the agent from two sources: (1) activity (memories the
  // agent has authored for this user) and (2) permissions (rules this
  // user has defined for this agent_id).
  //
  // The fallback covers three legitimate paths:
  //   a. The MCP sensitive-domain auto-block wrote a (0, 0) rule for
  //      an agent whose only memory was later deleted — ownership
  //      still passes via the rule row.
  //   b. A hosted-mode admin tool / migration seeded rules before any
  //      memory existed (rare, but possible).
  //   c. A rule was created via an MCP tool call (e.g. a Lodis
  //      internal helper) before the user browsed the dashboard.
  //
  // Pre-write UI configuration is NOT a supported path from this page
  // — `assertAgentOwnership` rejects mutating actions on an unknown
  // agent_id. The fallback is strictly a render-time recovery so a
  // user whose memory history was pruned can still see and reset
  // their rules.
  const fromActivity = activity.find(a => a.agentId === agentId);
  const ruleHit = permissions.find(p => p.agent_id === agentId);
  const agent = fromActivity ?? (ruleHit
    ? { agentId, agentName: agentId, count: 0, lastSeen: null }
    : null);
  if (!agent) notFound();

  const rules = permissions.filter(p => p.agent_id === agentId);
  const mode = deriveAgentMode(rules);
  const label = scopeLabel(mode);
  const isIsolatedFamily = mode.kind === "isolated" || mode.kind === "isolated_allowlist";
  const currentMode = isIsolatedFamily ? "isolated" : "open";
  const ambiguous = mode.kind === "mixed";

  const ruleDomains = new Set(rules.map(r => r.domain));
  const availableDomains = domains.map(d => d.domain).filter(d => d && d !== "*");

  return (
    <div className="space-y-6 max-w-3xl">
      <nav aria-label="Breadcrumb" className="text-xs text-[var(--text-dim)]">
        <Link
          href="/agents"
          className="inline-flex items-center gap-1 hover:text-[var(--accent-strong)] transition-colors"
        >
          <ChevronLeft size={14} aria-hidden="true" />
          All agents
        </Link>
      </nav>

      <header className="flex items-start justify-between gap-4 flex-wrap">
        <div className="min-w-0">
          <h1 className="text-xl font-semibold">{agent.agentName}</h1>
          <p className="text-xs text-[var(--text-dim)] font-mono mt-1 break-all">
            {agent.agentId}
          </p>
          <p className="text-xs text-[var(--text-dim)] mt-2">
            {agent.count.toLocaleString()} memories · last seen {formatDate(agent.lastSeen)}
          </p>
        </div>
        <ScopeChip label={label} size="md" />
      </header>

      <section aria-label="Access mode" className="space-y-3">
        <h2 className="text-sm font-medium text-[var(--text-muted)]">Access</h2>
        <Card className="p-4 space-y-4">
          <AgentModeToggle
            agentId={agent.agentId}
            current={currentMode}
            ambiguous={ambiguous}
          />
          <div className="pt-3 border-t border-[var(--border-subtle)] space-y-2">
            <p className="text-xs text-[var(--text-muted)]">Apply a preset</p>
            <PresetLauncher
              agentId={agent.agentId}
              agentName={agent.agentName}
              availableDomains={availableDomains}
              sensitiveDomains={sensitiveDomains}
              existingRuleDomains={rules.map(r => r.domain)}
            />
          </div>
        </Card>
      </section>

      {isIsolatedFamily && (
        <section aria-label="Allowed domains" className="space-y-3">
          <div className="flex items-baseline justify-between">
            <h2 className="text-sm font-medium text-[var(--text-muted)]">
              Allowed domains
            </h2>
            <span className="text-[11px] text-[var(--text-dim)]">
              {mode.allowlist.length} of {domains.length}
            </span>
          </div>
          <Card className="p-4 space-y-3">
            <div className="flex flex-wrap gap-2">
              {mode.allowlist.length === 0 && (
                <p className="text-xs text-[var(--text-dim)]">
                  No domains allowed. This agent currently sees nothing.
                </p>
              )}
              {mode.allowlist.map(d => (
                <DomainRuleChip
                  key={d}
                  agentId={agent.agentId}
                  domain={d}
                  kind="allow"
                />
              ))}
              <AddDomainChipButton
                agentId={agent.agentId}
                agentName={agent.agentName}
                kind="allow"
                availableDomains={availableDomains}
                excludedDomains={Array.from(ruleDomains)}
                sensitiveDomains={sensitiveDomains}
              />
            </div>
          </Card>
        </section>
      )}

      {mode.kind === "open_blocklist" && (
        <section aria-label="Blocked domains" className="space-y-3">
          <div className="flex items-baseline justify-between">
            <h2 className="text-sm font-medium text-[var(--text-muted)]">
              Blocked domains
            </h2>
            <span className="text-[11px] text-[var(--text-dim)]">
              {mode.blocklist.length}
            </span>
          </div>
          <Card className="p-4 space-y-3">
            <div className="flex flex-wrap gap-2">
              {mode.blocklist.map(d => (
                <DomainRuleChip
                  key={d}
                  agentId={agent.agentId}
                  domain={d}
                  kind="block"
                />
              ))}
              <AddDomainChipButton
                agentId={agent.agentId}
                agentName={agent.agentName}
                kind="block"
                availableDomains={availableDomains}
                excludedDomains={Array.from(ruleDomains)}
                sensitiveDomains={sensitiveDomains}
              />
            </div>
          </Card>
        </section>
      )}

      {mode.kind === "open" && (
        <section aria-label="Blocked domains" className="space-y-3">
          <h2 className="text-sm font-medium text-[var(--text-muted)]">
            Blocked domains
          </h2>
          <Card className="p-4">
            <div className="flex flex-wrap gap-2 items-center">
              <p className="text-xs text-[var(--text-dim)]">
                None. Add one to block a specific domain.
              </p>
              <AddDomainChipButton
                agentId={agent.agentId}
                agentName={agent.agentName}
                kind="block"
                availableDomains={availableDomains}
                excludedDomains={Array.from(ruleDomains)}
                sensitiveDomains={sensitiveDomains}
              />
            </div>
          </Card>
        </section>
      )}

      {mode.kind === "mixed" && (
        <section aria-label="Custom rules" className="space-y-3">
          <h2 className="text-sm font-medium text-[var(--text-muted)]">
            Custom rules
          </h2>
          <Card className="p-4 space-y-3">
            <p className="text-xs text-[var(--text-muted)]">
              This agent has rules that don&rsquo;t map to Open or Isolated. Applying a preset
              above will replace them; use the advanced view to inspect them first.
            </p>
            <div className="text-xs font-mono space-y-1">
              {rules.map(r => (
                <div key={r.domain} className="flex items-center gap-3">
                  <span className="text-[var(--text-muted)] truncate">{r.domain === "*" ? "* (wildcard)" : r.domain}</span>
                  <span className={r.can_read ? "text-[var(--success)]" : "text-[var(--danger)]"}>
                    R:{r.can_read}
                  </span>
                  <span className={r.can_write ? "text-[var(--success)]" : "text-[var(--danger)]"}>
                    W:{r.can_write}
                  </span>
                </div>
              ))}
            </div>
            <Link
              href={`/agents/${encodeURIComponent(agent.agentId)}/advanced`}
              className="inline-flex items-center gap-1 text-xs text-[var(--accent)] hover:text-[var(--accent-strong)] transition-colors"
            >
              Open advanced view
              <ChevronRight size={12} aria-hidden="true" />
            </Link>
          </Card>
        </section>
      )}

      <div className="flex items-center justify-end">
        <Link
          href={`/agents/${encodeURIComponent(agent.agentId)}/advanced`}
          className="inline-flex items-center gap-1 text-[11px] text-[var(--text-dim)] hover:text-[var(--accent-strong)] transition-colors"
        >
          Advanced rules
          <ChevronRight size={11} aria-hidden="true" />
        </Link>
      </div>

      <section aria-label="Activity" className="space-y-3">
        <h2 className="text-sm font-medium text-[var(--text-muted)]">Activity</h2>
        <div className="grid gap-3 md:grid-cols-2">
          <Card className="p-4">
            <h3 className="text-xs font-medium text-[var(--text-muted)] mb-3">
              Top domains
            </h3>
            {distribution.length === 0 ? (
              <p className="text-xs text-[var(--text-dim)]">No memories yet.</p>
            ) : (
              <ul className="space-y-1.5">
                {distribution.slice(0, 8).map(d => {
                  const isSensitive = sensitiveDomains.includes(d.domain);
                  return (
                    <li
                      key={d.domain}
                      className="flex items-center justify-between gap-2 text-xs"
                    >
                      <Link
                        href={`/agents/domains/${encodeURIComponent(d.domain)}`}
                        className="font-mono truncate inline-flex items-center gap-1.5 hover:text-[var(--accent-strong)] transition-colors"
                      >
                        {isSensitive && (
                          <Lock
                            size={10}
                            aria-label="Sensitive"
                            className="text-[var(--violet)] shrink-0"
                          />
                        )}
                        {d.domain}
                      </Link>
                      <span className="text-[var(--text-dim)] tabular-nums">
                        {d.count.toLocaleString()}
                      </span>
                    </li>
                  );
                })}
              </ul>
            )}
          </Card>
          <Card className="p-4">
            <h3 className="text-xs font-medium text-[var(--text-muted)] mb-3">
              Recent memories
            </h3>
            {recentMemories.length === 0 ? (
              <p className="text-xs text-[var(--text-dim)]">No memories yet.</p>
            ) : (
              <ul className="space-y-1.5">
                {recentMemories.map(m => (
                  <li key={m.id} className="text-xs">
                    <Link
                      href={`/memory/${m.id}`}
                      className="inline-flex items-start gap-1.5 truncate text-[var(--text-muted)] hover:text-[var(--accent-strong)] transition-colors"
                    >
                      {m.hasPii && (
                        <ShieldAlert
                          size={12}
                          aria-label="Contains PII"
                          className="text-[var(--warning)] shrink-0 mt-0.5"
                        />
                      )}
                      <span className="truncate">{m.title || "(untitled)"}</span>
                    </Link>
                    <span className="text-[10px] text-[var(--text-dim)] font-mono block">
                      {m.domain}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      </section>
    </div>
  );
}

import Link from "next/link";
import { ChevronLeft, Lock } from "lucide-react";
import {
  getDomains,
  getAgentsWithDomainRule,
  isDomainSensitive,
} from "@/lib/db";
import { getUserId } from "@/lib/auth";
import { Card } from "@/components/ui/card";
import { SensitiveToggle } from "@/components/sensitive-toggle";

export const dynamic = "force-dynamic";

interface PageProps {
  params: Promise<{ domain: string }>;
}

export default async function DomainPage({ params }: PageProps) {
  const { domain: rawDomain } = await params;
  const domain = decodeURIComponent(rawDomain);
  const userId = await getUserId();

  const [domains, sensitive, agents] = await Promise.all([
    getDomains(userId),
    isDomainSensitive(userId, domain),
    getAgentsWithDomainRule(userId, domain),
  ]);

  const memoryCount = domains.find(d => d.domain === domain)?.count ?? 0;

  const allowed = agents.filter(a => !a.isWildcard && a.canRead === 1);
  const blocked = agents.filter(a => !a.isWildcard && a.canRead === 0);
  const isolatedImplicit = agents.filter(a => a.isWildcard && a.canRead === 0);

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

      <header className="space-y-2">
        <div className="flex items-center gap-2">
          <h1 className="text-xl font-semibold font-mono">{domain}</h1>
          {sensitive && (
            <span
              className="inline-flex items-center gap-1 px-2 py-0.5 text-[11px] rounded-full bg-[var(--violet-soft)] text-[var(--violet)]"
              aria-label="Domain marked sensitive"
            >
              <Lock size={11} aria-hidden="true" />
              Sensitive
            </span>
          )}
        </div>
        <p className="text-xs text-[var(--text-dim)]">
          {memoryCount.toLocaleString()} {memoryCount === 1 ? "memory" : "memories"} in this domain.
        </p>
      </header>

      <section aria-label="Sensitive setting" className="space-y-3">
        <h2 className="text-sm font-medium text-[var(--text-muted)]">Sensitivity</h2>
        <Card className="p-4">
          <SensitiveToggle domain={domain} initialSensitive={sensitive} />
        </Card>
      </section>

      <section aria-label="Agent access" className="space-y-3">
        <h2 className="text-sm font-medium text-[var(--text-muted)]">Agent access</h2>

        <div className="grid gap-3 md:grid-cols-3">
          <Card className="p-4">
            <h3 className="text-xs font-medium text-[var(--text-muted)] mb-2">
              <span aria-hidden="true" className="font-mono mr-1">✓</span>
              Allowed ({allowed.length})
            </h3>
            {allowed.length === 0 ? (
              <p className="text-[11px] text-[var(--text-dim)]">No agents with an allow rule.</p>
            ) : (
              <ul className="space-y-1">
                {allowed.map(a => (
                  <li key={a.agentId}>
                    <Link
                      href={`/agents/${encodeURIComponent(a.agentId)}`}
                      className="block text-xs hover:text-[var(--accent-strong)] transition-colors truncate"
                    >
                      {a.agentName}
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card className="p-4">
            <h3 className="text-xs font-medium text-[var(--text-muted)] mb-2">
              <span aria-hidden="true" className="font-mono mr-1">✕</span>
              Blocked ({blocked.length})
            </h3>
            {blocked.length === 0 ? (
              <p className="text-[11px] text-[var(--text-dim)]">No agents with a block rule.</p>
            ) : (
              <ul className="space-y-1">
                {blocked.map(a => (
                  <li key={a.agentId}>
                    <Link
                      href={`/agents/${encodeURIComponent(a.agentId)}`}
                      className="block text-xs hover:text-[var(--accent-strong)] transition-colors truncate"
                    >
                      {a.agentName}
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card className="p-4">
            <h3 className="text-xs font-medium text-[var(--text-muted)] mb-2">
              <span aria-hidden="true" className="font-mono mr-1">⊘</span>
              Isolated ({isolatedImplicit.length})
            </h3>
            {isolatedImplicit.length === 0 ? (
              <p className="text-[11px] text-[var(--text-dim)]">No agents are isolated.</p>
            ) : (
              <ul className="space-y-1">
                {isolatedImplicit.map(a => (
                  <li key={a.agentId}>
                    <Link
                      href={`/agents/${encodeURIComponent(a.agentId)}`}
                      className="block text-xs hover:text-[var(--accent-strong)] transition-colors truncate"
                    >
                      {a.agentName}
                    </Link>
                  </li>
                ))}
              </ul>
            )}
            <p className="text-[10px] text-[var(--text-dim)] mt-2">
              Implicitly blocked by a wildcard deny with no allow rule for this domain.
            </p>
          </Card>
        </div>
      </section>
    </div>
  );
}

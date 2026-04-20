import {
  getAgentActivity,
  getAgentPermissions,
  getSensitiveDomains,
  getDomains,
  type PermissionRow,
} from "@/lib/db";
import { getUserId } from "@/lib/auth";
import { AgentCard } from "@/components/agent-card";
import { SensitiveDomainsPanel } from "@/components/sensitive-domains-panel";
import { EmptyState } from "@/components/ui/empty-state";
import { Shield } from "lucide-react";
import { deriveAgentMode } from "@/lib/agent-mode";

export const dynamic = "force-dynamic";

export default async function AgentsPage() {
  const userId = await getUserId();
  const [activity, permissions, sensitiveDomains, allDomains] = await Promise.all([
    getAgentActivity(userId),
    getAgentPermissions(userId),
    getSensitiveDomains(userId),
    getDomains(userId),
  ]);

  const rulesByAgent = new Map<string, PermissionRow[]>();
  for (const p of permissions) {
    if (!rulesByAgent.has(p.agent_id)) rulesByAgent.set(p.agent_id, []);
    rulesByAgent.get(p.agent_id)!.push(p);
  }

  if (activity.length === 0) {
    return (
      <EmptyState
        icon={<Shield size={28} aria-hidden="true" />}
        title="No agents yet"
        description="Connect an AI tool to Lodis and its agent will appear here. Each agent's memory access can be isolated, blocked, or left open."
      />
    );
  }

  return (
    <div className="space-y-6">
      <header className="flex items-baseline justify-between gap-4">
        <div>
          <h1 className="text-lg font-semibold">Agents</h1>
          <p className="text-xs text-[var(--text-dim)] mt-1">
            {activity.length} connected · click an agent to review what it can see and write.
          </p>
        </div>
      </header>

      <div className="grid gap-5 lg:grid-cols-[1fr_280px]">
        <ul
          role="list"
          className="grid gap-3 grid-cols-1 sm:grid-cols-2"
        >
          {activity.map(a => {
            const rules = rulesByAgent.get(a.agentId) ?? [];
            const mode = deriveAgentMode(rules);
            return (
              <li key={`${a.agentId}|${a.agentName}`}>
                <AgentCard
                  agentId={a.agentId}
                  agentName={a.agentName}
                  memoryCount={a.count}
                  lastSeen={a.lastSeen}
                  mode={mode}
                />
              </li>
            );
          })}
        </ul>
        <aside aria-label="Sensitive domains" className="lg:sticky lg:top-4 lg:self-start">
          <SensitiveDomainsPanel
            sensitiveDomains={sensitiveDomains}
            allDomains={allDomains}
          />
        </aside>
      </div>
    </div>
  );
}

import { getAgentPermissions, getAgents, getDomains } from "@/lib/db";
import { getUserId } from "@/lib/auth";
import { Card } from "@/components/ui/card";
import { PermissionToggle } from "@/components/permission-toggle";
import { AddRuleForm } from "@/components/add-rule-form";
import { RemoveRuleButton } from "@/components/remove-rule-button";

export const dynamic = "force-dynamic";

export default async function AgentsPage() {
  const userId = await getUserId();
  const agents = await getAgents(userId);
  const permissions = await getAgentPermissions(userId);
  const domains = await getDomains(userId);

  // Build permission map: agentId -> domain -> { canRead, canWrite }
  const permMap = new Map<string, Map<string, { canRead: boolean; canWrite: boolean }>>();
  for (const p of permissions) {
    if (!permMap.has(p.agent_id)) permMap.set(p.agent_id, new Map());
    permMap.get(p.agent_id)!.set(p.domain, {
      canRead: !!p.can_read,
      canWrite: !!p.can_write,
    });
  }

  // Collect all domains that have explicit rules (including * wildcard)
  const ruleDomains = new Set<string>();
  for (const p of permissions) {
    ruleDomains.add(p.domain);
  }
  // Also include memory domains
  for (const d of domains) {
    ruleDomains.add(d.domain);
  }
  const allDomains = Array.from(ruleDomains).sort((a, b) => {
    if (a === "*") return -1;
    if (b === "*") return 1;
    return a.localeCompare(b);
  });

  if (agents.length === 0) {
    return (
      <div className="text-center py-16">
        <p className="text-[var(--color-text-muted)] text-sm">
          No agents have connected yet. Connect an AI tool with Engrams to see
          agents here.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <h1 className="text-lg font-semibold">Agent Permissions</h1>
      <p className="text-xs text-[var(--color-text-muted)]">
        Click R/W badges to toggle. Agents without explicit rules have full access.
      </p>

      <Card className="overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[var(--color-border)]">
                <th className="text-left p-3 font-medium text-[var(--color-text-secondary)]">
                  Agent
                </th>
                {allDomains.map((d) => (
                  <th
                    key={d}
                    className="text-center p-3 font-medium text-[var(--color-text-secondary)]"
                  >
                    {d === "*" ? "All (*)" : d}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {agents.map((agent) => (
                <tr
                  key={agent.agent_id}
                  className="border-b border-[var(--color-border-light)]"
                >
                  <td className="p-3">
                    <div>
                      <p className="font-medium">{agent.agent_name}</p>
                      <p className="text-xs text-[var(--color-text-muted)] font-mono truncate max-w-48">
                        {agent.agent_id}
                      </p>
                    </div>
                  </td>
                  {allDomains.map((d) => {
                    const perm = permMap.get(agent.agent_id)?.get(d);
                    return (
                      <td key={d} className="text-center p-3">
                        {perm ? (
                          <div className="flex items-center justify-center gap-1">
                            <PermissionToggle
                              agentId={agent.agent_id}
                              domain={d}
                              field="read"
                              enabled={perm.canRead}
                            />
                            <PermissionToggle
                              agentId={agent.agent_id}
                              domain={d}
                              field="write"
                              enabled={perm.canWrite}
                            />
                            <RemoveRuleButton
                              agentId={agent.agent_id}
                              domain={d}
                            />
                          </div>
                        ) : (
                          <span className="text-[var(--color-text-muted)]">
                            —
                          </span>
                        )}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <Card className="p-4">
        <h2 className="text-sm font-medium mb-3">Add Permission Rule</h2>
        <AddRuleForm
          agents={agents.map((a) => ({
            agent_id: a.agent_id,
            agent_name: a.agent_name,
          }))}
          domains={domains.map((d) => d.domain)}
        />
      </Card>
    </div>
  );
}

import Link from "next/link";
import { Lock } from "lucide-react";
import { Card } from "@/components/ui/card";

interface SensitiveDomainsPanelProps {
  sensitiveDomains: string[];
  allDomains: { domain: string; count: number }[];
}

/**
 * Right-rail panel listing the domains the user has marked sensitive.
 * Violet is deliberately reserved for this marker — it's the one place in the
 * UI that uses the secondary accent color.
 */
export function SensitiveDomainsPanel({
  sensitiveDomains,
  allDomains,
}: SensitiveDomainsPanelProps) {
  const countByDomain = new Map(allDomains.map(d => [d.domain, d.count]));

  return (
    <Card className="p-4 space-y-3">
      <header className="flex items-center gap-2">
        <Lock size={14} aria-hidden="true" className="text-[var(--violet)]" />
        <h2 className="text-sm font-medium">Sensitive domains</h2>
      </header>

      {sensitiveDomains.length === 0 ? (
        <p className="text-xs text-[var(--text-dim)]">
          Mark a domain sensitive to require confirmation every time an agent is granted access.
        </p>
      ) : (
        <ul className="space-y-1.5">
          {sensitiveDomains.map(d => (
            <li key={d}>
              <Link
                href={`/agents/domains/${encodeURIComponent(d)}`}
                className="flex items-center justify-between gap-2 px-2 py-1 rounded-md hover:bg-[var(--violet-soft)] transition-colors"
              >
                <span className="font-mono text-xs truncate">{d}</span>
                <span className="text-[10px] text-[var(--text-dim)] tabular-nums">
                  {(countByDomain.get(d) ?? 0).toLocaleString()}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}

      <p className="pt-2 border-t border-[var(--border-subtle)] text-[10px] text-[var(--text-dim)]">
        Agents writing to a sensitive domain for the first time are blocked by default until you allow them.
      </p>
    </Card>
  );
}

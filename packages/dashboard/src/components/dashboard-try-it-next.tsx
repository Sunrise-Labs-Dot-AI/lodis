"use client";

import { useCallback, useState } from "react";
import type { TryItNext } from "@lodis/core/tutorial";

export function DashboardTryItNextPanel({ items }: { items: TryItNext[] }) {
  if (items.length === 0) return null;
  return (
    <aside
      className="mt-5 rounded-lg border border-[var(--border)] bg-[rgba(167,139,250,0.03)] p-4"
      aria-label="Examples to narrate"
    >
      <p className="text-[0.68rem] uppercase tracking-[0.18em] text-[var(--text-dim)] mb-3">
        Examples — narrate and ask before running
      </p>
      <ul className="flex flex-col gap-3">
        {items.map((item, i) => (
          <TryItNextItem key={i} item={item} />
        ))}
      </ul>
    </aside>
  );
}

function TryItNextItem({ item }: { item: TryItNext }) {
  const [copied, setCopied] = useState(false);
  // navigator.clipboard requires HTTPS or localhost — dashboard runs on
  // localhost:3838. Do not test on a LAN IP; clipboard silently fails there.
  const handleCopy = useCallback(() => {
    if (!item.exampleInvocation) return;
    navigator.clipboard.writeText(item.exampleInvocation).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }, [item.exampleInvocation]);

  return (
    <li>
      <p className="text-sm text-[var(--text)] mb-1.5">
        {item.naturalLanguage}{" "}
        <span className="text-[var(--text-dim)] text-xs">
          uses{" "}
          <code className="font-mono text-[var(--accent)]">
            {item.toolName}
          </code>
        </span>
      </p>
      {item.exampleInvocation && (
        <div className="relative">
          <pre className="font-mono text-[15px] leading-relaxed bg-[var(--bg-soft)] border border-[var(--border)] rounded-md px-3 py-2 overflow-x-auto">
            <code>{item.exampleInvocation}</code>
          </pre>
          <button
            type="button"
            onClick={handleCopy}
            className="absolute top-1.5 right-1.5 text-[0.7rem] uppercase tracking-wider text-[var(--text-dim)] hover:text-[var(--text)] bg-[var(--bg-soft)] border border-[var(--border)] rounded px-2 py-0.5"
            aria-label={copied ? "Copied" : "Copy invocation"}
          >
            {copied ? "Copied" : "Copy"}
          </button>
        </div>
      )}
    </li>
  );
}

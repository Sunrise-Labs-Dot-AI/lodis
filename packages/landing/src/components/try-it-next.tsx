"use client";

import { useCallback, useState } from "react";
import type { TryItNext } from "@lodis/core/tutorial";

export function TryItNextPanel({ items }: { items: TryItNext[] }) {
  if (items.length === 0) return null;
  return (
    <aside className="try-it-next-panel" aria-label="Examples to narrate">
      <p className="try-it-next-heading">
        Examples — narrate and ask before running
      </p>
      <ul>
        {items.map((item, i) => (
          <TryItNextItem key={i} item={item} />
        ))}
      </ul>
    </aside>
  );
}

function TryItNextItem({ item }: { item: TryItNext }) {
  const [copied, setCopied] = useState(false);
  // navigator.clipboard requires HTTPS or localhost — lodis.ai is HTTPS, dashboard
  // is localhost:3838. Do not test on a LAN IP; clipboard silently fails there.
  const handleCopy = useCallback(() => {
    if (!item.exampleInvocation) return;
    navigator.clipboard.writeText(item.exampleInvocation).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }, [item.exampleInvocation]);

  return (
    <li className="try-it-next-item">
      <p className="try-it-next-text">
        {item.naturalLanguage}{" "}
        <span className="try-it-next-tool">uses <code>{item.toolName}</code></span>
      </p>
      {item.exampleInvocation && (
        <div className="try-it-next-code">
          <pre>
            <code>{item.exampleInvocation}</code>
          </pre>
          <button
            type="button"
            onClick={handleCopy}
            className="try-it-next-copy"
            aria-label={copied ? "Copied" : "Copy invocation"}
          >
            {copied ? "Copied" : "Copy"}
          </button>
        </div>
      )}
    </li>
  );
}

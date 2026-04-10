"use client";

import { useState } from "react";
import { Copy, Check, Plug } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

export function ConnectClaude({ baseUrl }: { baseUrl: string }) {
  const mcpUrl = `${baseUrl}/api/mcp`;
  const [copied, setCopied] = useState(false);

  async function handleCopy() {
    await navigator.clipboard.writeText(mcpUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <Card className="p-4">
      <div className="flex items-center gap-2 mb-1">
        <Plug size={16} className="text-[var(--color-accent)]" />
        <h3 className="text-sm font-semibold">Connect to Claude</h3>
      </div>
      <p className="text-xs text-[var(--color-text-muted)] mb-3">
        Add Engrams as a remote MCP server in Claude.ai, Claude Desktop, or Claude Code.
      </p>

      <div className="space-y-3">
        <div>
          <label className="text-xs text-[var(--color-text-muted)] block mb-1">MCP Server URL</label>
          <div className="flex items-center gap-2">
            <code className="flex-1 text-xs bg-[var(--color-bg-secondary)] px-3 py-2 rounded-lg border border-[var(--color-border)] font-mono truncate">
              {mcpUrl}
            </code>
            <Button variant="secondary" size="sm" onClick={handleCopy}>
              {copied ? <Check size={14} /> : <Copy size={14} />}
            </Button>
          </div>
        </div>

        <div className="text-xs text-[var(--color-text-muted)] space-y-2">
          <p className="font-medium text-[var(--color-text-secondary)]">Setup instructions:</p>
          <ol className="list-decimal list-inside space-y-1">
            <li>
              In <strong>Claude.ai</strong>: Settings → Integrations → Add custom connector → paste the URL above
            </li>
            <li>
              In <strong>Claude Desktop</strong>: Customize → Connectors → Add → paste the URL
            </li>
            <li>
              In <strong>Claude Code</strong>:{" "}
              <code className="bg-[var(--color-bg-secondary)] px-1 rounded text-[10px]">
                claude mcp add engrams --transport http {mcpUrl}
              </code>
            </li>
          </ol>
          <p>You&apos;ll be asked to sign in and authorize access to your memories.</p>
        </div>
      </div>
    </Card>
  );
}

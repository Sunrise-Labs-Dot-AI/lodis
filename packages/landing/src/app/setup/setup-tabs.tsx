"use client";

import { useState } from "react";
import clsx from "clsx";
import { CodeBlock } from "@/components/code-block";

const stdioConfig = `{
  "mcpServers": {
    "lodis": {
      "command": "npx",
      "args": ["-y", "@sunriselabs/lodis"]
    }
  }
}`;

const codexTomlConfig = `[mcp_servers.lodis]
command = "npx"
args = ["-y", "@sunriselabs/lodis"]`;

const clients = [
  {
    name: "Codex",
    path: "~/.codex/config.toml",
    config: codexTomlConfig,
    note: "Codex shares this config between the CLI and IDE extension. Use /mcp in the TUI or codex mcp list to confirm Lodis is active.",
    command: "codex mcp add lodis -- npx -y @sunriselabs/lodis",
    isCodex: true,
  },
  {
    name: "Claude Code",
    path: "~/.claude.json",
    config: stdioConfig,
    note: "Or add to your project's .mcp.json for per-project config.",
  },
  {
    name: "Claude Desktop",
    path: "~/Library/Application Support/Claude/claude_desktop_config.json",
    pathWindows: "%APPDATA%\\Claude\\claude_desktop_config.json",
    config: stdioConfig,
    note: "Restart Claude Desktop after saving the config file.",
  },
  {
    name: "Cursor",
    path: ".cursor/mcp.json",
    config: stdioConfig,
    note: "Add to your project root. Cursor picks it up automatically.",
  },
  {
    name: "Windsurf",
    path: "~/.windsurf/mcp.json",
    config: stdioConfig,
    note: null,
  },
  {
    name: "Cline",
    path: "VS Code Settings → Cline → MCP Servers",
    config: stdioConfig,
    note: "Or add to .vscode/cline_mcp_settings.json in your project.",
  },
];

export function SetupTabs() {
  const [active, setActive] = useState(0);
  const client = clients[active];

  return (
    <div>
      {/* Tabs */}
      <div className="flex flex-wrap gap-2 mb-6">
        {clients.map((c, i) => (
          <button
            key={c.name}
            onClick={() => setActive(i)}
            className={clsx(
              "px-4 py-2 text-sm rounded-lg font-medium transition-all duration-300",
              i === active
                ? "bg-[rgba(125,211,252,0.1)] text-glow-soft border border-border-hover"
                : "text-text-muted hover:text-text border border-transparent hover:border-border"
            )}
          >
            {c.name}
          </button>
        ))}
      </div>

      {/* Content */}
      {client.isCodex ? (
        <div className="space-y-5">
          <div>
            <p className="text-text-muted text-sm mb-3">
              Fastest path: let Codex write the MCP entry for you.
            </p>
            <CodeBlock>{client.command!}</CodeBlock>
          </div>

          <div>
            <p className="text-text-dim text-sm font-mono mb-3">
              {client.path}
            </p>
            <CodeBlock>{client.config!}</CodeBlock>
          </div>

          {client.note && (
            <p className="text-text-dim text-sm">{client.note}</p>
          )}
        </div>
      ) : (
        <div>
          {/* Config path */}
          <p className="text-text-dim text-sm font-mono mb-3">
            {client.path}
          </p>
          {client.pathWindows && (
            <p className="text-text-dim text-xs font-mono mb-3">
              Windows: {client.pathWindows}
            </p>
          )}

          {/* Code block */}
          <CodeBlock>{client.config!}</CodeBlock>

          {client.note && (
            <p className="text-text-dim text-sm mt-3">{client.note}</p>
          )}
        </div>
      )}
    </div>
  );
}

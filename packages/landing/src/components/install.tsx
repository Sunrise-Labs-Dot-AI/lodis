"use client";

import { useState } from "react";
import clsx from "clsx";

const clients = [
  {
    name: "Claude Code",
    path: "~/.claude.json",
  },
  {
    name: "Claude Desktop",
    path: "~/Library/Application Support/Claude/claude_desktop_config.json",
  },
  {
    name: "Cursor",
    path: ".cursor/mcp.json",
  },
  {
    name: "Windsurf",
    path: "~/.windsurf/mcp.json",
  },
];

const config = `{
  "mcpServers": {
    "engrams": {
      "command": "npx",
      "args": ["-y", "engrams"]
    }
  }
}`;

export function Install() {
  const [active, setActive] = useState(0);

  return (
    <section id="install" className="py-24 px-6">
      <div className="max-w-3xl mx-auto">
        <h2 className="text-3xl sm:text-4xl font-bold text-center mb-16 tracking-tight">
          Get started in{" "}
          <span className="text-glow">30 seconds.</span>
        </h2>

        {/* Tabs */}
        <div className="flex flex-wrap gap-2 mb-6 justify-center">
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

        {/* Config path */}
        <p className="text-text-dim text-sm text-center font-mono mb-3">
          {clients[active].path}
        </p>

        {/* Code block */}
        <pre className="code-block">
          <code>{config}</code>
        </pre>

        <p className="text-text-dim text-sm text-center mt-4">
          Same config for every client. Just change the file path.
        </p>
      </div>
    </section>
  );
}

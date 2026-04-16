import { CodeBlock } from "./code-block";

const clients = [
  { name: "Claude Code", path: "~/.claude.json" },
  {
    name: "Claude Desktop",
    path: "~/Library/Application Support/Claude/claude_desktop_config.json",
  },
  { name: "Cursor", path: "~/.cursor/mcp.json" },
  { name: "Windsurf", path: "~/.codeium/windsurf/mcp_config.json" },
];

const config = `{
  "mcpServers": {
    "lodis": {
      "command": "npx",
      "args": ["-y", "lodis"]
    }
  }
}`;

export function Install() {
  return (
    <section id="install" className="py-24 px-6">
      <div className="max-w-3xl mx-auto">
        <h2 className="text-3xl sm:text-4xl font-bold text-center mb-16 tracking-tight">
          Get started in{" "}
          <span className="text-glow">30 seconds.</span>
        </h2>

        <p className="text-text-muted text-center mb-3 text-sm">
          Same config for every MCP client. Paste it into the file below for the
          client you use.
        </p>

        <CodeBlock>{config}</CodeBlock>

        <dl className="mt-6 grid grid-cols-1 sm:grid-cols-[max-content_1fr] gap-x-6 gap-y-2 text-sm max-w-xl mx-auto">
          {clients.map((c) => (
            <div key={c.name} className="contents">
              <dt className="text-text-muted">{c.name}</dt>
              <dd className="font-mono text-text-dim break-all">{c.path}</dd>
            </div>
          ))}
        </dl>
      </div>
    </section>
  );
}

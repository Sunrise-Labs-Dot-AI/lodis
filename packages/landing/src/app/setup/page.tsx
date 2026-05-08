import type { Metadata } from "next";
import Link from "next/link";
import { Header } from "@/components/header";
import { Footer } from "@/components/footer";
import { CodeBlock } from "@/components/code-block";
import { SetupTabs } from "./setup-tabs";

export const metadata: Metadata = {
  title: "Setup Guide | Lodis",
  description:
    "Get Lodis running in your AI tools. Setup guides for Claude Code, Cursor, Windsurf, Claude Desktop, and more.",
};

const systemPrompt = `Use Lodis MCP tools for all persistent memory. At the start of
conversations, call memory_search with relevant terms to retrieve
context. When the user states a preference, corrects an assumption,
shares personal context, or provides information useful across future
conversations, save it with memory_write.`;

const claudeCodePrompt = `## Memory — CRITICAL OVERRIDE

**DO NOT use the built-in file-based auto-memory system.** Never create,
read, or write to \`MEMORY.md\` or any files in the
\`~/.claude/projects/.../memory/\` directory. That system is fully
replaced by Lodis.

**USE Lodis MCP tools for ALL persistent memory.** Lodis is the
single source of truth.

### At conversation start
- Call \`memory_search\` with terms relevant to the user's request to
  retrieve prior context

### When to write
- \`memory_write\` — user states a preference, corrects an assumption,
  shares personal context, or says anything useful for future conversations
- \`memory_confirm\` — user validates a recalled fact
- \`memory_correct\` — user corrects a stored memory
- \`memory_flag_mistake\` — a memory turns out to be wrong

### When to search
- \`memory_search\` — before answering questions where prior context
  would help
- \`memory_context\` — token-budget-aware retrieval for building responses
- \`memory_briefing\` — entity summaries (people, projects, etc.)

### Rules
- Never duplicate memories to both Lodis and the built-in file system
- Treat Lodis memories as the persistent record — they survive across
  all MCP-connected tools (Claude Code, Cursor, Windsurf, Claude Desktop)
- When the user says "remember this," save immediately via \`memory_write\``;

const promptLocations = [
  {
    client: "Claude Code",
    location: "~/.claude/CLAUDE.md",
    detail:
      "Add to your global ~/.claude/CLAUDE.md (or project CLAUDE.md). Claude Code has a built-in auto-memory system that competes with Lodis — the snippet above explicitly disables it.",
    useClaudeCodePrompt: true,
  },
  {
    client: "Claude Desktop",
    location: "System prompt in Settings",
    detail:
      'Open Settings → General → System Prompt. Paste the snippet above. Claude Desktop will include it in every conversation.',
  },
  {
    client: "Cursor",
    location: ".cursorrules or Rules settings",
    detail:
      "Add to your project's .cursorrules file, or go to Settings → Rules → User Rules to set it globally.",
  },
  {
    client: "Windsurf",
    location: "System prompt in Settings",
    detail:
      "Open Settings → AI → System Prompt. Paste the snippet above.",
  },
];

const importSources = [
  {
    label: "Claude Code auto-memory",
    prompt: '"Import my Claude memories into Lodis"',
  },
  {
    label: "ChatGPT memory export",
    prompt: '"Import this ChatGPT memory export into Lodis"',
  },
  {
    label: "Cursor rules",
    prompt: '"Import my .cursorrules as Lodis preferences"',
  },
  {
    label: "Git config",
    prompt: '"Import my gitconfig into Lodis"',
  },
];

export default function SetupGuide() {
  return (
    <>
      <Header />
      <main className="min-h-screen pt-24 pb-16 px-6">
        <div className="max-w-3xl mx-auto">
          <Link
            href="/"
            className="text-text-muted hover:text-text transition-colors text-sm"
          >
            &larr; Back to home
          </Link>

          <h1 className="text-4xl sm:text-5xl font-bold mt-8 mb-4 tracking-tight">
            Setup{" "}
            <span className="bg-gradient-to-r from-glow to-violet bg-clip-text text-transparent">
              Guide
            </span>
          </h1>
          <p className="text-text-muted text-lg mb-12 leading-relaxed">
            Get Lodis running in your AI tools in under a minute.
          </p>

          {/* Table of contents */}
          <nav className="glass p-6 mb-16">
            <p className="text-xs font-semibold uppercase tracking-widest text-text-dim mb-4">
              On this page
            </p>
            <ol className="space-y-2 text-sm">
              <li>
                <a href="#mcp-setup" className="text-text-muted hover:text-glow transition-colors">
                  1. MCP Client Setup
                </a>
              </li>
              <li>
                <a href="#system-prompt" className="text-text-muted hover:text-glow transition-colors">
                  2. System Prompt Configuration
                </a>
              </li>
              <li>
                <a href="#first-run" className="text-text-muted hover:text-glow transition-colors">
                  3. First Run — Seeding Your Memory
                </a>
              </li>
              <li>
                <a href="#cloud-setup" className="text-text-muted hover:text-glow transition-colors">
                  4. Cloud Setup
                </a>
              </li>
              <li>
                <a href="#local-http" className="text-text-muted hover:text-glow transition-colors">
                  5. Local HTTP Mode
                </a>
              </li>
            </ol>
          </nav>

          {/* Section 1: MCP Client Setup */}
          <section id="mcp-setup" className="mb-20 scroll-mt-24">
            <h2 className="text-2xl font-bold mb-2">1. MCP Client Setup</h2>
            <p className="text-text-muted mb-8">
              Add the Lodis MCP server to your client&rsquo;s config file. Same JSON for every client — just change the file path.
            </p>
            <SetupTabs />
          </section>

          {/* Section 2: System Prompt */}
          <section id="system-prompt" className="mb-20 scroll-mt-24">
            <h2 className="text-2xl font-bold mb-2">
              2. System Prompt Configuration
            </h2>
            <p className="text-text-muted mb-6">
              Tell your AI to use Lodis by default. Add this snippet to your system prompt or instructions file:
            </p>

            <CodeBlock className="mb-8">{systemPrompt}</CodeBlock>

            <h3 className="text-lg font-semibold mb-4 text-text-muted">
              Where to put it
            </h3>
            <div className="space-y-4">
              {promptLocations.map((p) => (
                <div key={p.client} className="glass p-5">
                  <div className="flex items-baseline gap-2 mb-1">
                    <span className="font-semibold text-sm">{p.client}</span>
                    <span className="text-xs font-mono text-text-dim">
                      {p.location}
                    </span>
                  </div>
                  <p className="text-sm text-text-muted">{p.detail}</p>
                  {"useClaudeCodePrompt" in p && (
                    <div className="mt-4">
                      <p className="text-xs font-semibold uppercase tracking-widest text-text-dim mb-2">
                        Claude Code requires a stronger override
                      </p>
                      <CodeBlock className="text-xs">{claudeCodePrompt}</CodeBlock>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </section>

          {/* Section 3: First Run */}
          <section id="first-run" className="mb-20 scroll-mt-24">
            <h2 className="text-2xl font-bold mb-2">
              3. First Run — Seeding Your Memory
            </h2>
            <p className="text-text-muted mb-6">
              Once Lodis is connected, tell your AI assistant:
            </p>

            <div className="glass p-6 mb-8">
              <p className="text-lg font-medium text-center">
                &ldquo;Help me set up Lodis&rdquo;
              </p>
            </div>

            <p className="text-text-muted mb-4">
              Your assistant will call{" "}
              <code className="font-mono text-sm text-glow">memory_onboard</code>{" "}
              and:
            </p>

            <ol className="space-y-3 mb-8">
              <li className="flex items-start gap-3">
                <span className="font-mono text-sm text-glow bg-glow/10 rounded-full w-7 h-7 flex items-center justify-center shrink-0">
                  1
                </span>
                <div>
                  <span className="font-medium">Scan</span>
                  <span className="text-text-muted">
                    {" "}your connected tools (calendar, email, GitHub) to extract people, projects, and context
                  </span>
                </div>
              </li>
              <li className="flex items-start gap-3">
                <span className="font-mono text-sm text-glow bg-glow/10 rounded-full w-7 h-7 flex items-center justify-center shrink-0">
                  2
                </span>
                <div>
                  <span className="font-medium">Interview</span>
                  <span className="text-text-muted">
                    {" "}you with targeted questions based on what it found
                  </span>
                </div>
              </li>
              <li className="flex items-start gap-3">
                <span className="font-mono text-sm text-glow bg-glow/10 rounded-full w-7 h-7 flex items-center justify-center shrink-0">
                  3
                </span>
                <div>
                  <span className="font-medium">Seed</span>
                  <span className="text-text-muted">
                    {" "}30-50 memories with entity types and connections
                  </span>
                </div>
              </li>
            </ol>

            <h3 className="text-lg font-semibold mb-4 text-text-muted">
              Importing existing memories
            </h3>
            <p className="text-text-muted mb-4">
              If you already have memories in other tools, your AI can import them:
            </p>
            <div className="space-y-3">
              {importSources.map((s) => (
                <div key={s.label} className="glass p-4 flex items-center justify-between gap-4">
                  <span className="text-sm text-text-muted">{s.label}</span>
                  <code className="text-xs font-mono text-text-dim shrink-0">
                    {s.prompt}
                  </code>
                </div>
              ))}
            </div>

            <p className="text-text-muted text-sm mt-6">
              Review your memories at{" "}
              <code className="font-mono text-glow">localhost:3838</code>.
              Confirm what&rsquo;s right, correct what&rsquo;s wrong.
            </p>
          </section>

          {/* Section 4: Cloud Setup */}
          <section id="cloud-setup" className="mb-20 scroll-mt-24">
            <h2 className="text-2xl font-bold mb-2">4. Cloud Setup</h2>
            <p className="text-text-muted mb-6">
              Cloud mode syncs your memories across devices via Turso. All data encrypted at rest with AES-256-GCM.
            </p>

            <div className="glass p-5 mb-6 border border-border-hover">
              <p className="text-sm text-text-muted">
                <span className="font-semibold text-glow">Cloud access is invite-only during beta.</span>{" "}
                Email{" "}
                <a href="mailto:james@sunriselabs.ai" className="text-glow hover:underline">
                  james@sunriselabs.ai
                </a>{" "}
                to request an invitation. Once you have one, follow the steps below.
              </p>
            </div>

            <ol className="space-y-4 mb-8">
              <li className="glass p-5">
                <div className="flex items-baseline gap-2 mb-1">
                  <span className="font-mono text-sm text-glow bg-glow/10 rounded-full w-7 h-7 flex items-center justify-center shrink-0">
                    1
                  </span>
                  <span className="font-semibold text-sm">Activate your invite</span>
                </div>
                <p className="text-sm text-text-muted ml-10">
                  Use your invite link to create an account at{" "}
                  <a
                    href="https://app.lodis.ai/sign-up"
                    className="text-glow hover:underline"
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    app.lodis.ai
                  </a>
                </p>
              </li>
              <li className="glass p-5">
                <div className="flex items-baseline gap-2 mb-1">
                  <span className="font-mono text-sm text-glow bg-glow/10 rounded-full w-7 h-7 flex items-center justify-center shrink-0">
                    2
                  </span>
                  <span className="font-semibold text-sm">Create an API token</span>
                </div>
                <p className="text-sm text-text-muted ml-10">
                  Go to Settings → API Tokens → Generate Token. Copy it — you&rsquo;ll need it for MCP client config.
                </p>
              </li>
              <li className="glass p-5">
                <div className="flex items-baseline gap-2 mb-1">
                  <span className="font-mono text-sm text-glow bg-glow/10 rounded-full w-7 h-7 flex items-center justify-center shrink-0">
                    3
                  </span>
                  <span className="font-semibold text-sm">Configure your MCP client</span>
                </div>
                <p className="text-sm text-text-muted ml-10 mb-3">
                  Use the HTTP transport with your API token:
                </p>
                <div className="ml-10">
                  <CodeBlock className="text-xs">{`{
  "mcpServers": {
    "lodis": {
      "type": "streamable-http",
      "url": "https://app.lodis.ai/api/mcp",
      "headers": {
        "Authorization": "Bearer YOUR_API_TOKEN"
      }
    }
  }
}`}</CodeBlock>
                </div>
              </li>
            </ol>

            <div className="glass p-5">
              <h3 className="text-sm font-semibold mb-2">
                Claude.ai — OAuth (zero config)
              </h3>
              <p className="text-sm text-text-muted">
                Claude.ai users can skip API tokens entirely. Connect via OAuth 2.1: go to your Claude.ai settings, add Lodis as an MCP server, and authorize through{" "}
                <a
                  href="https://app.lodis.ai"
                  className="text-glow hover:underline"
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  app.lodis.ai
                </a>
                . No config files needed.
              </p>
            </div>

            <p className="text-text-dim text-sm mt-6">
              Already running locally? Use{" "}
              <code className="font-mono text-text-muted">memory_migrate</code>{" "}
              to move your existing memories to cloud.
            </p>
          </section>

          {/* Section 5: Local HTTP Mode */}
          <section id="local-http" className="mb-12 scroll-mt-24">
            <h2 className="text-2xl font-bold mb-2">
              5. Local HTTP Mode
            </h2>
            <p className="text-text-muted mb-6">
              Want to connect remote clients to a self-hosted Lodis instance? Run the HTTP server with Bearer token authentication:
            </p>

            <div className="glass p-5 mb-6">
              <h3 className="text-sm font-semibold mb-2">Start the HTTP server</h3>
              <CodeBlock className="text-xs">{"lodis --serve"}</CodeBlock>
              <p className="text-sm text-text-muted mt-3">
                Starts an HTTP MCP server on port 3939 with Bearer token authentication.
              </p>
            </div>

            <ol className="space-y-4">
              <li className="glass p-5">
                <div className="flex items-baseline gap-2 mb-1">
                  <span className="font-mono text-sm text-glow bg-glow/10 rounded-full w-7 h-7 flex items-center justify-center shrink-0">
                    1
                  </span>
                  <span className="font-semibold text-sm">Create an API token</span>
                </div>
                <p className="text-sm text-text-muted ml-10">
                  Open the dashboard at{" "}
                  <code className="font-mono text-glow">localhost:3838</code>{" "}
                  → Settings → API Tokens → Generate Token.
                </p>
              </li>
              <li className="glass p-5">
                <div className="flex items-baseline gap-2 mb-1">
                  <span className="font-mono text-sm text-glow bg-glow/10 rounded-full w-7 h-7 flex items-center justify-center shrink-0">
                    2
                  </span>
                  <span className="font-semibold text-sm">Configure your remote client</span>
                </div>
                <div className="ml-10 mt-3">
                  <CodeBlock className="text-xs">{`{
  "mcpServers": {
    "lodis": {
      "type": "streamable-http",
      "url": "http://localhost:3939/mcp",
      "headers": {
        "Authorization": "Bearer YOUR_API_TOKEN"
      }
    }
  }
}`}</CodeBlock>
                </div>
              </li>
            </ol>

            <p className="text-text-dim text-sm mt-6">
              This gives you the same remote access as cloud mode, but running entirely on your own machine.
            </p>
          </section>
        </div>
      </main>
      <Footer />
    </>
  );
}

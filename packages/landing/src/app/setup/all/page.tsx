import type { Metadata } from "next";
import Link from "next/link";
import { Header } from "@/components/header";
import { Footer } from "@/components/footer";
import { CodeBlock } from "@/components/code-block";
import { SetupTabs } from "../setup-tabs";

export const metadata: Metadata = {
  title: "Complete Setup Reference | Lodis",
  description:
    "All Lodis setup options in one place: local MCP, Codex, and memory instructions.",
};

const systemPrompt = `Use Lodis MCP tools for all persistent memory. At the start of
conversations, call memory_search with relevant terms to retrieve
context. When the user states a preference, corrects an assumption,
shares personal context, or provides information useful across future
conversations, save it with memory_write.`;

const codexPrompt = `## Memory — Lodis

Use Lodis MCP tools for persistent memory. Lodis is the source of truth
for preferences, corrections, personal context, project context, and any
fact the user asks you to remember.

### At conversation start
- Call \`memory_search\` with terms relevant to the user's request to
  retrieve prior context.

### When to write
- \`memory_write\` — user states a preference, corrects an assumption,
  shares personal context, or says anything useful for future conversations.
- \`memory_confirm\` — user validates a recalled fact.
- \`memory_correct\` — user corrects a stored memory.
- \`memory_flag_mistake\` — a memory turns out to be wrong.

### Rules
- Do not duplicate long-term memories into another memory system when
  Lodis is available.
- Treat Lodis memories as the persistent record across Codex, Claude Code,
  Cursor, Windsurf, and other MCP-connected tools.
- When the user says "remember this," save immediately via \`memory_write\`.`;

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
  ["Codex", "~/.codex/AGENTS.md or project AGENTS.md"],
  ["Claude Code", "~/.claude/CLAUDE.md or project CLAUDE.md"],
  ["Claude Desktop", "System prompt in Settings"],
  ["Cursor", ".cursorrules or Rules settings"],
  ["Windsurf", "System prompt in Settings"],
];

const importPrompts = [
  ["Start fresh", '"Help me set up Lodis"'],
  ["Claude memories", '"Import my Claude memories into Lodis"'],
  ["ChatGPT memory export", '"Import this ChatGPT memory export into Lodis"'],
  ["Cursor rules", '"Import my .cursorrules as Lodis preferences"'],
  ["Git config", '"Import my gitconfig into Lodis"'],
];

export default function CompleteSetupReference() {
  return (
    <>
      <Header />
      <main id="main" className="min-h-screen pt-24 pb-16 px-6">
        <div className="max-w-3xl mx-auto">
          <Link
            href="/setup"
            className="text-text-muted hover:text-text transition-colors text-sm"
          >
            &larr; Back to setup planner
          </Link>

          <h1 className="text-4xl sm:text-5xl font-bold mt-8 mb-4 tracking-tight">
            Everything Setup
          </h1>
          <p className="text-text-muted text-lg mb-12 leading-relaxed">
            Every current Lodis setup path in one place, no quiz required.
          </p>

          <nav className="rounded-lg border border-border bg-black/20 p-5 mb-16">
            <p className="text-xs font-semibold uppercase tracking-widest text-text-dim mb-4">
              On this page
            </p>
            <ol className="space-y-2 text-sm">
              <li>
                <a href="#local-mcp" className="text-text-muted hover:text-glow transition-colors">
                  Local MCP clients
                </a>
              </li>
              <li>
                <a href="#agent-instructions" className="text-text-muted hover:text-glow transition-colors">
                  Agent instructions
                </a>
              </li>
              <li>
                <a href="#first-run" className="text-text-muted hover:text-glow transition-colors">
                  First run
                </a>
              </li>
            </ol>
          </nav>

          <section id="local-mcp" className="mb-20 scroll-mt-24">
            <h2 className="text-2xl font-bold mb-2">Local MCP Clients</h2>
            <p className="text-text-muted mb-8">
              Use this when Lodis should run locally through your AI tool. Codex
              uses TOML; most other MCP clients use JSON.
            </p>
            <SetupTabs />
          </section>

          <section id="agent-instructions" className="mb-20 scroll-mt-24">
            <h2 className="text-2xl font-bold mb-2">Agent Instructions</h2>
            <p className="text-text-muted mb-6">
              Add the Lodis memory policy to the instruction surface your client reads.
              Use the general snippet for most clients; Claude Code needs the stronger
              override shown below.
            </p>
            <CodeBlock className="mb-8">{systemPrompt}</CodeBlock>

            <div className="space-y-4">
              {promptLocations.map(([client, location]) => (
                <div key={client} className="rounded-lg border border-border bg-black/20 p-5">
                  <div className="flex flex-wrap items-baseline gap-2">
                    <span className="font-semibold text-sm">{client}</span>
                    <span className="text-xs font-mono text-text-dim">{location}</span>
                  </div>
                  {client === "Codex" && (
                    <div className="mt-4">
                      <p className="text-xs font-semibold uppercase tracking-widest text-text-dim mb-2">
                        Codex AGENTS.md snippet
                      </p>
                      <CodeBlock className="text-xs">{codexPrompt}</CodeBlock>
                    </div>
                  )}
                  {client === "Claude Code" && (
                    <div className="mt-4">
                      <p className="mb-3 rounded-md border border-border-hover bg-glow/10 px-3 py-2 text-sm text-text">
                        Claude Code requires a stronger override because it can also read
                        its own file-based memory system.
                      </p>
                      <p className="text-xs font-semibold uppercase tracking-widest text-text-dim mb-2">
                        Claude Code CLAUDE.md snippet
                      </p>
                      <CodeBlock className="text-xs">{claudeCodePrompt}</CodeBlock>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </section>

          <section id="first-run" className="mb-20 scroll-mt-24">
            <h2 className="text-2xl font-bold mb-2">First Run</h2>
            <p className="text-text-muted mb-6">
              Once Lodis is connected, use the prompt that matches your starting point.
            </p>
            <div className="space-y-3">
              {importPrompts.map(([label, prompt]) => (
                <div key={label} className="rounded-lg border border-border bg-black/20 p-4 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                  <span className="text-sm text-text-muted">{label}</span>
                  <code className="text-xs font-mono text-text-dim">{prompt}</code>
                </div>
              ))}
            </div>
          </section>

        </div>
      </main>
      <Footer />
    </>
  );
}

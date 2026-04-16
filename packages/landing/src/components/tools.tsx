import { Reveal } from "./reveal";

type Tool = {
  name: string;
  desc: string;
  example?: string;
  featured?: boolean;
};

const toolGroups: { label: string; tools: Tool[] }[] = [
  {
    label: "Core",
    tools: [
      {
        name: "memory_write",
        desc: "Create a memory with dedup detection and permanence tiers",
        example: `memory_write({ content: "Sarah prefers morning meetings", domain: "work" })`,
        featured: true,
      },
      {
        name: "memory_search",
        desc: "Hybrid semantic + keyword search with filters",
        example: `memory_search({ query: "design decisions", minConfidence: 0.8 })`,
        featured: true,
      },
      { name: "memory_context", desc: "Token-budget-aware context retrieval" },
      { name: "memory_update", desc: "Modify content, detail, or metadata" },
      { name: "memory_remove", desc: "Soft-delete with reason tracking" },
    ],
  },
  {
    label: "Trust",
    tools: [
      { name: "memory_confirm", desc: "Mark a memory as verified and boost its confidence" },
      {
        name: "memory_correct",
        desc: "LLM-powered semantic diff correction",
        example: `memory_correct({ id, correction: "It's Thursdays, not Tuesdays" })`,
        featured: true,
      },
      { name: "memory_flag_mistake", desc: "Degrade confidence on bad information" },
      { name: "memory_pin", desc: "Pin as canonical — decay-immune, high confidence" },
    ],
  },
  {
    label: "Graph",
    tools: [
      {
        name: "memory_connect",
        desc: "Create typed relationship between memories",
        example: `memory_connect({ from, to, relationship: "works_at" })`,
        featured: true,
      },
      { name: "memory_get_connections", desc: "Traverse the knowledge graph" },
      { name: "memory_split", desc: "Break compound memories into atomic units" },
    ],
  },
  {
    label: "Discovery",
    tools: [
      { name: "memory_list", desc: "Browse by domain, confidence, or recency" },
      { name: "memory_list_domains", desc: "List all domains with memory counts" },
      { name: "memory_list_entities", desc: "Show extracted entities by type" },
      { name: "memory_classify", desc: "Auto-classify a memory's entity type via LLM" },
      { name: "memory_briefing", desc: "LLM-generated entity profile summaries" },
    ],
  },
  {
    label: "Safety",
    tools: [
      { name: "memory_scrub", desc: "Detect and redact PII from memory content" },
      { name: "memory_set_permissions", desc: "Per-agent read/write access by domain" },
      { name: "memory_archive", desc: "Archive for reference — deprioritize and freeze" },
    ],
  },
  {
    label: "Onboarding",
    tools: [
      {
        name: "memory_onboard",
        desc: "Guided onboarding: scan tools, interview, seed",
        example: `memory_onboard({ scan: ["claude", "cursor", "gitconfig"] })`,
        featured: true,
      },
      { name: "memory_import", desc: "Import from Claude, ChatGPT, Cursor, gitconfig" },
      { name: "memory_interview", desc: "Agent-driven cleanup and gap-fill" },
    ],
  },
  {
    label: "Data",
    tools: [
      {
        name: "memory_export",
        desc: "Export memories as portable JSON",
        example: `memory_export({ format: "json" }) → lodis-backup.json`,
        featured: true,
      },
      { name: "memory_index", desc: "Index external docs for unified search" },
      { name: "memory_index_status", desc: "Check staleness of indexed documents" },
      { name: "memory_migrate", desc: "Migrate local memories to cloud (Pro)" },
    ],
  },
];

const featured: Tool[] = toolGroups.flatMap((g) => g.tools.filter((t) => t.featured));

export function Tools() {
  return (
    <section className="py-24 px-6">
      <div className="max-w-6xl mx-auto">
        <Reveal>
          <h2 className="text-3xl sm:text-4xl font-bold text-center mb-4 tracking-tight">
            27 MCP tools.{" "}
            <span className="text-glow">One install.</span>
          </h2>
          <p className="text-text-muted text-center mb-16 text-lg">
            Everything your agent needs to remember, learn, and forget.
          </p>
        </Reveal>

        {/* Featured hero set */}
        <Reveal>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 mb-10">
            {featured.map((tool) => (
              <div key={tool.name} className="glass px-5 py-4 flex flex-col">
                <p className="font-mono text-sm text-glow mb-2">{tool.name}</p>
                <p className="text-sm text-text-muted leading-relaxed mb-3">
                  {tool.desc}
                </p>
                {tool.example && (
                  <pre className="mt-auto text-[11px] font-mono text-text-dim bg-black/30 border border-border rounded-md px-2.5 py-2 overflow-x-auto leading-snug">
                    {tool.example}
                  </pre>
                )}
              </div>
            ))}
          </div>
        </Reveal>

        {/* Full catalog — expanded on demand */}
        <Reveal>
          <details className="group">
            <summary className="cursor-pointer list-none inline-flex items-center gap-2 text-sm text-text-muted hover:text-text transition-colors">
              <span className="group-open:hidden">See all 27 tools</span>
              <span className="hidden group-open:inline">Hide full catalog</span>
              <svg
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                className="transition-transform group-open:rotate-180"
                aria-hidden="true"
              >
                <polyline points="6 9 12 15 18 9" />
              </svg>
            </summary>
            <div className="mt-6 space-y-8">
              {toolGroups.map((group) => (
                <div key={group.label}>
                  <h3 className="text-xs font-semibold uppercase tracking-widest text-text-dim mb-3">
                    {group.label}
                  </h3>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-2">
                    {group.tools.map((tool) => (
                      <div
                        key={tool.name}
                        className="flex items-baseline gap-3 py-1 border-b border-border/40"
                      >
                        <code className="font-mono text-sm text-glow whitespace-nowrap">
                          {tool.name}
                        </code>
                        <span className="text-xs text-text-muted leading-snug">
                          {tool.desc}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </details>
        </Reveal>
      </div>
    </section>
  );
}

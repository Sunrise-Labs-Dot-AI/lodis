import { Reveal } from "./reveal";

const toolGroups = [
  {
    label: "Core",
    tools: [
      { name: "memory_search", desc: "Full-text search with domain and confidence filters" },
      { name: "memory_write", desc: "Create a memory with content, domain, and source" },
      { name: "memory_update", desc: "Modify content, detail, or domain" },
      { name: "memory_remove", desc: "Soft-delete with reason tracking" },
    ],
  },
  {
    label: "Trust",
    tools: [
      { name: "memory_confirm", desc: "Mark a memory as verified and boost its confidence" },
      { name: "memory_correct", desc: "Replace content and reset confidence" },
      { name: "memory_flag_mistake", desc: "Degrade confidence on bad information" },
    ],
  },
  {
    label: "Graph",
    tools: [
      { name: "memory_connect", desc: "Create typed relationship between memories" },
      { name: "memory_get_connections", desc: "Traverse the knowledge graph" },
      { name: "memory_split", desc: "Break compound memories into atomic units" },
    ],
  },
  {
    label: "Discovery",
    tools: [
      { name: "memory_list", desc: "Browse by domain, confidence, or recency" },
      { name: "memory_list_domains", desc: "List all domains with memory counts" },
      { name: "memory_list_entities", desc: "Show extracted entity types" },
      { name: "memory_classify", desc: "Auto-classify a memory's entity type" },
    ],
  },
  {
    label: "Safety",
    tools: [
      { name: "memory_scrub", desc: "Detect and redact PII from memory content" },
      { name: "memory_set_permissions", desc: "Per-agent read/write access by domain" },
    ],
  },
];

export function Tools() {
  return (
    <section className="py-24 px-6">
      <div className="max-w-6xl mx-auto">
        <Reveal>
          <h2 className="text-3xl sm:text-4xl font-bold text-center mb-4 tracking-tight">
            16 MCP tools.{" "}
            <span className="text-glow">One install.</span>
          </h2>
          <p className="text-text-muted text-center mb-16 text-lg">
            Everything your agent needs to remember, learn, and forget.
          </p>
        </Reveal>

        <div className="space-y-10">
          {toolGroups.map((group) => (
            <Reveal key={group.label}>
              <h3 className="text-sm font-semibold uppercase tracking-widest text-text-dim mb-4">
                {group.label}
              </h3>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                {group.tools.map((tool) => (
                  <div key={tool.name} className="glass px-4 py-3">
                    <p className="font-mono text-sm text-glow mb-1">{tool.name}</p>
                    <p className="text-xs text-text-muted leading-relaxed">{tool.desc}</p>
                  </div>
                ))}
              </div>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}

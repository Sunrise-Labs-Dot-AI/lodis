import { Reveal } from "./reveal";

const features = [
  {
    title: "Search & Retrieve",
    description:
      "Hybrid search finds the right memory even when the wording differs. Context-packed retrieval delivers token-budget-aware results. Filter by domain, confidence, entity type, or just ask.",
    visual: (
      <div className="glass p-2 overflow-hidden rounded-xl">
        <img
          src="/screenshots/dashboard-search.png"
          alt="Search results showing memories with confidence scores and entity types"
          width={1280}
          height={800}
          className="rounded-lg w-full h-auto"
          loading="lazy"
        />
      </div>
    ),
  },
  {
    title: "Correct & Control",
    description:
      "Confirm what's right. Correct what's wrong. Split compound memories. Flag mistakes. Your AI learns from your feedback.",
    visual: (
      <div className="glass p-6">
        <div className="rounded-lg bg-surface/50 p-4 space-y-4">
          <p className="text-sm text-text">
            &quot;Prefers TypeScript with strict mode enabled&quot;
          </p>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-1.5">
              <span className="inline-block w-2 h-2 rounded-full bg-emerald" />
              <span className="text-xs text-emerald font-mono">0.92</span>
            </div>
            <div className="flex gap-2">
              {["Confirm", "Correct", "Split"].map((a) => (
                <span key={a} className="px-2.5 py-1 text-xs rounded-md border border-border text-text-muted hover:border-border-hover transition-colors">
                  {a}
                </span>
              ))}
            </div>
          </div>
        </div>
      </div>
    ),
  },
  {
    title: "Connect & Understand",
    description:
      "Memories form a knowledge graph across 13 entity types. People, projects, and preferences are automatically linked. Entity profiles generate summaries on demand. Contradictions detected.",
    visual: (
      <div className="glass p-2 overflow-hidden rounded-xl">
        <img
          src="/screenshots/dashboard-graph.png"
          alt="Knowledge graph showing interconnected entities and relationships"
          width={1280}
          height={800}
          className="rounded-lg w-full h-auto"
          loading="lazy"
        />
      </div>
    ),
  },
];

export function Solution() {
  return (
    <section className="py-24 px-6">
      <div className="max-w-6xl mx-auto">
        <Reveal>
          <h2 className="text-3xl sm:text-4xl font-bold text-center mb-16 tracking-tight">
            Engrams makes AI memory{" "}
            <span className="text-glow">yours.</span>
          </h2>
        </Reveal>

        <div className="space-y-20">
          {features.map((f, i) => (
            <Reveal key={f.title}>
              <div className={`flex flex-col ${i % 2 === 0 ? "md:flex-row" : "md:flex-row-reverse"} gap-10 items-center`}>
                <div className="flex-1 space-y-4">
                  <h3 className="text-2xl font-semibold">{f.title}</h3>
                  <p className="text-text-muted leading-relaxed text-lg">{f.description}</p>
                </div>
                <div className="flex-1 w-full">{f.visual}</div>
              </div>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}

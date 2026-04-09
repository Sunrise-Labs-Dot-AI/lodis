import { Reveal } from "./reveal";

const features = [
  {
    title: "Search & Retrieve",
    description:
      "Full-text search finds the right memory even when the wording differs. Filter by domain, confidence, entity type, or just ask.",
    visual: (
      <div className="glass p-6 space-y-3">
        <div className="flex items-center gap-2 text-text-dim text-sm font-mono">
          <span className="text-glow">&#8250;</span> memory_search &quot;deployment preferences&quot;
        </div>
        <div className="space-y-2">
          {[
            { content: "Prefers blue-green deployments over rolling updates", conf: 0.92 },
            { content: "Uses GitHub Actions for CI/CD, not Jenkins", conf: 0.87 },
            { content: "Always runs smoke tests after deploy", conf: 0.78 },
          ].map((r) => (
            <div key={r.content} className="flex items-center justify-between gap-4 px-3 py-2 rounded-lg bg-surface/50">
              <span className="text-sm text-text">{r.content}</span>
              <span className="text-xs font-mono text-glow shrink-0">{r.conf.toFixed(2)}</span>
            </div>
          ))}
        </div>
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
      "Memories form a knowledge graph. People, projects, and preferences are automatically linked. Entity types extracted. Contradictions detected.",
    visual: (
      <div className="glass p-6 flex items-center justify-center">
        <svg viewBox="0 0 300 200" className="w-full max-w-xs" fill="none">
          {/* Edges */}
          <line x1="150" y1="40" x2="60" y2="120" stroke="var(--color-glow)" strokeWidth="1" strokeOpacity="0.3" />
          <line x1="150" y1="40" x2="240" y2="100" stroke="var(--color-violet)" strokeWidth="1" strokeOpacity="0.3" />
          <line x1="60" y1="120" x2="150" y2="170" stroke="var(--color-glow)" strokeWidth="1" strokeOpacity="0.3" />
          <line x1="240" y1="100" x2="150" y2="170" stroke="var(--color-violet)" strokeWidth="1" strokeOpacity="0.3" />
          {/* Nodes */}
          <circle cx="150" cy="40" r="20" fill="rgba(125,211,252,0.15)" stroke="var(--color-glow)" strokeWidth="1" />
          <text x="150" y="44" textAnchor="middle" fill="var(--color-glow)" fontSize="10" fontFamily="var(--font-mono)">person</text>
          <circle cx="60" cy="120" r="20" fill="rgba(167,139,250,0.12)" stroke="var(--color-violet)" strokeWidth="1" />
          <text x="60" y="124" textAnchor="middle" fill="var(--color-violet)" fontSize="10" fontFamily="var(--font-mono)">project</text>
          <circle cx="240" cy="100" r="20" fill="rgba(52,211,153,0.12)" stroke="var(--color-emerald)" strokeWidth="1" />
          <text x="240" y="104" textAnchor="middle" fill="var(--color-emerald)" fontSize="10" fontFamily="var(--font-mono)">pref</text>
          <circle cx="150" cy="170" r="20" fill="rgba(251,191,36,0.12)" stroke="var(--color-amber)" strokeWidth="1" />
          <text x="150" y="174" textAnchor="middle" fill="var(--color-amber)" fontSize="10" fontFamily="var(--font-mono)">goal</text>
        </svg>
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

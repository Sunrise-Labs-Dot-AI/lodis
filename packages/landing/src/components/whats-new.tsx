import { Reveal } from "./reveal";

const updates = [
  {
    icon: (
      <svg viewBox="0 0 24 24" className="w-6 h-6" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
        <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6l4 2m5-2a9 9 0 11-18 0 9 9 0 0118 0z" />
      </svg>
    ),
    title: "Temporal supersession.",
    text: "Facts carry validity windows. Corrections preserve history without an LLM call.",
  },
  {
    icon: (
      <svg viewBox="0 0 24 24" className="w-6 h-6" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
        <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-4.35-4.35m1.1-5.15a6.25 6.25 0 11-12.5 0 6.25 6.25 0 0112.5 0z" />
        <path strokeLinecap="round" strokeLinejoin="round" d="M8.75 11.5l1.75 1.75 3.25-4" />
      </svg>
    ),
    title: "Default-clean search.",
    text: "Progress snippets and rows in archived domains stay out of default memory_search / memory_context results unless explicitly requested. memory_archive_domain('noisy') segregates a noisy domain in one call.",
  },
  {
    icon: (
      <svg viewBox="0 0 24 24" className="w-6 h-6" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
        <path strokeLinecap="round" strokeLinejoin="round" d="M6 8a2 2 0 100-4 2 2 0 000 4zm12 0a2 2 0 100-4 2 2 0 000 4zM6 20a2 2 0 100-4 2 2 0 000 4zm12 0a2 2 0 100-4 2 2 0 000 4zM8 6h8M8 18h8M6 8v8m12-8v8" />
      </svg>
    ),
    title: "Snippet -> durable graph.",
    text: "memory_write_snippet takes connections[] so progress events link to the people, organizations, and projects they are about. Zero LLM on the write path.",
  },
];

export function WhatsNew() {
  return (
    <section className="py-24 px-6">
      <div className="max-w-5xl mx-auto">
        <Reveal>
          <p className="text-xs font-semibold uppercase tracking-widest text-glow/70 text-center mb-4">
            Phase 3 + Phase 4
          </p>
          <h2 className="text-3xl sm:text-4xl font-bold text-center mb-6 tracking-tight">
            What changed in{" "}
            <span className="text-glow">the local-first release.</span>
          </h2>
          <p className="text-text-muted text-center mb-14 text-lg max-w-3xl mx-auto">
            The new retrieval model keeps the write path deterministic, keeps noisy progress data out of normal search, and preserves factual history.
          </p>
        </Reveal>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {updates.map(({ icon, title, text }) => (
            <Reveal key={title}>
              <div className="glass p-6 h-full">
                <div className="text-glow mb-5">{icon}</div>
                <h3 className="text-lg font-semibold mb-3">{title}</h3>
                <p className="text-sm text-text-muted leading-relaxed">{text}</p>
              </div>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}

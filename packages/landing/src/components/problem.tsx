import { Reveal } from "./reveal";

const rows = [
  {
    before: "Your AI builds up knowledge about you over time. You can\u2019t see what it stored.",
    after: "Browse, search, and edit every memory in a real dashboard.",
  },
  {
    before: "Teach something in one tool, start over in the next. Context trapped in walled gardens.",
    after: "One memory layer shared across all your AI tools.",
  },
  {
    before: "Corrections don\u2019t stick. You can\u2019t trace where it learned something or how sure it was.",
    after: "Confirm, correct, or flag \u2014 with confidence scores and full provenance.",
  },
];

export function Problem() {
  return (
    <section className="py-24 px-6">
      <div className="max-w-5xl mx-auto">
        <Reveal>
          <h2 className="text-3xl sm:text-4xl font-bold text-center mb-16 tracking-tight">
            AI memory today is{" "}
            <span className="text-[var(--warning)]">broken.</span>
          </h2>
        </Reveal>

        {/* Column headers */}
        <div className="hidden md:grid md:grid-cols-2 gap-8 mb-6 px-1">
          <p className="text-xs font-semibold uppercase tracking-widest text-[var(--warning)]/70">
            Today
          </p>
          <p className="text-xs font-semibold uppercase tracking-widest text-glow/70">
            With Lodis
          </p>
        </div>

        <div className="space-y-4">
          {rows.map((row, i) => (
            <Reveal key={i}>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 md:gap-8">
                {/* Before */}
                <div className="border-l-2 border-[var(--warning)]/30 pl-5 py-4">
                  <p className="md:hidden text-xs font-semibold uppercase tracking-widest text-[var(--warning)]/70 mb-2">
                    Today
                  </p>
                  <p className="text-text-muted leading-relaxed">{row.before}</p>
                </div>
                {/* After */}
                <div className="glass border-l-2 border-glow/30 pl-5 pr-5 py-4">
                  <p className="md:hidden text-xs font-semibold uppercase tracking-widest text-glow/70 mb-2">
                    With Lodis
                  </p>
                  <p className="text-text leading-relaxed">{row.after}</p>
                </div>
              </div>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}

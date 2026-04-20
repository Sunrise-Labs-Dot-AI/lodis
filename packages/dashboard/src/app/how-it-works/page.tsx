import type { Metadata } from "next";
import { listChapters } from "@lodis/core/tutorial";
import { DashboardChapterNav } from "@/components/dashboard-chapter-nav";
import { DashboardTryItNextPanel } from "@/components/dashboard-try-it-next";

export const metadata: Metadata = {
  title: "How Lodis works",
  description: "Learn how Lodis gives your AI agents a shared memory.",
};

export default function HowItWorksPage() {
  const chapters = listChapters();

  return (
    <div className="py-4">
      <section className="mb-12">
        <p className="text-[0.68rem] uppercase tracking-[0.18em] text-[var(--text-dim)] mb-3">
          How Lodis works
        </p>
        <h1 className="text-3xl md:text-4xl font-semibold leading-tight text-[var(--text)] mb-4 max-w-2xl">
          Lodis gives your AI agents a memory that&apos;s yours, not the
          tool&apos;s.
        </h1>
        <p className="text-sm text-[var(--text-dim)] flex flex-wrap items-center gap-x-3 gap-y-1">
          <span>27 MCP tools</span>
          <span aria-hidden="true">·</span>
          <span>105 tests passing</span>
          <span aria-hidden="true">·</span>
          <span>MIT open source</span>
        </p>
        <p className="mt-4 text-sm text-[var(--text-muted)]">
          Or in Claude:{" "}
          <code className="font-mono text-[var(--accent)]">
            memory_tutorial()
          </code>{" "}
          — this same content, chapter by chapter.
        </p>
      </section>

      <div className="grid grid-cols-1 md:grid-cols-[200px_minmax(0,1fr)] gap-10">
        <aside className="hidden md:block">
          <DashboardChapterNav
            chapters={chapters.map((c) => ({ id: c.id, title: c.title }))}
          />
        </aside>

        <div className="flex flex-col gap-16 min-w-0">
          {chapters.map((chapter) => (
            <section
              key={chapter.id}
              id={chapter.id}
              className="scroll-mt-24"
            >
              <header className="mb-5 pb-4 border-b border-[var(--border)]">
                <p className="text-[0.68rem] uppercase tracking-[0.18em] text-[var(--accent)] mb-2">
                  {chapter.id}
                </p>
                <h2 className="text-2xl font-semibold text-[var(--text)] mb-2">
                  {chapter.title}
                </h2>
                <p className="text-base text-[var(--text-muted)]">
                  {chapter.oneLiner}
                </p>
              </header>

              {chapter.sections.map((section, i) => (
                <div key={i} className="mb-6">
                  <h3 className="text-base font-semibold text-[var(--text)] mb-2">
                    {section.heading}
                  </h3>
                  <p className="text-[0.95rem] leading-relaxed text-[var(--text-muted)] mb-3">
                    {section.body}
                  </p>
                  {section.codeExample && (
                    <pre className="font-mono text-[15px] leading-relaxed bg-[var(--bg-soft)] border border-[var(--border)] rounded-md px-4 py-3 overflow-x-auto">
                      <code>{section.codeExample}</code>
                    </pre>
                  )}
                </div>
              ))}

              {chapter.tools.length > 0 && (
                <div className="mt-6">
                  <h3 className="text-[0.68rem] uppercase tracking-[0.18em] text-[var(--text-dim)] mb-2">
                    Tools in this chapter
                  </h3>
                  <ul className="flex flex-col gap-1.5">
                    {chapter.tools.map((tool) => (
                      <li key={tool.name} className="text-sm">
                        <code className="font-mono text-[var(--accent)]">
                          {tool.name}
                        </code>
                        <span className="text-[var(--text-muted)]">
                          {" "}
                          — {tool.blurb}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              <DashboardTryItNextPanel items={chapter.tryItNext} />
            </section>
          ))}

          <section className="mt-8 p-6 rounded-xl border border-[var(--border)] bg-[var(--surface)]">
            <h2 className="text-xl font-semibold text-[var(--text)] mb-2">
              Call <code className="font-mono text-[var(--accent)]">memory_tutorial</code> in Claude
            </h2>
            <p className="text-sm text-[var(--text-muted)]">
              Every chapter here is also available as an MCP tool response.
              Open Claude Code, say &ldquo;teach me how Lodis works,&rdquo;
              and walk through chapter by chapter.
            </p>
          </section>
        </div>
      </div>
    </div>
  );
}

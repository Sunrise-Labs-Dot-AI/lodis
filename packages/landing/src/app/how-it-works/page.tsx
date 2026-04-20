import type { Metadata } from "next";
import { listChapters } from "@lodis/core/tutorial";
import { Header } from "@/components/header";
import { Footer } from "@/components/footer";
import { ChapterNav } from "@/components/chapter-nav";
import { TryItNextPanel } from "@/components/try-it-next";

export const metadata: Metadata = {
  title: "How Lodis works",
  description:
    "Lodis gives your AI agents a memory that's yours, not the tool's. 27 MCP tools, 105 tests, MIT open source.",
};

export default function HowItWorksPage() {
  const chapters = listChapters();

  return (
    <>
      <Header />
      <main id="main" className="how-it-works">
        <section className="how-hero">
          <div className="orb orb-1" aria-hidden="true" />
          <div className="how-hero-inner">
            <div className="how-hero-copy">
              <p className="how-hero-eyebrow">How Lodis works</p>
              <h1 className="how-hero-title">
                Lodis gives your AI agents a memory that&apos;s yours, not the tool&apos;s.
              </h1>
              <p className="how-hero-proof">
                <span>27 MCP tools</span>
                <span aria-hidden="true" className="how-hero-dot">·</span>
                <span>105 tests passing</span>
                <span aria-hidden="true" className="how-hero-dot">·</span>
                <span>MIT open source</span>
              </p>
              <div className="how-hero-ctas">
                <a href="/setup" className="btn-glow">
                  Set up Lodis in Claude
                </a>
                <a
                  href="https://app.lodis.ai"
                  className="btn-ghost"
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  Open the dashboard
                </a>
              </div>
              <p className="how-hero-tutorial">
                Or in Claude:{" "}
                <code>memory_tutorial()</code> — this same content, chapter by chapter.
              </p>
            </div>
            <div className="how-hero-diagram" aria-hidden="true">
              <HeroDiagram />
            </div>
          </div>
        </section>

        <div className="how-layout">
          <aside className="how-nav-rail">
            <ChapterNav
              chapters={chapters.map((c) => ({ id: c.id, title: c.title }))}
            />
          </aside>

          <div className="how-chapters">
            {chapters.map((chapter) => (
              <section
                key={chapter.id}
                id={chapter.id}
                className="how-chapter"
              >
                <header className="how-chapter-header">
                  <p className="how-chapter-id">{chapter.id}</p>
                  <h2 className="how-chapter-title">{chapter.title}</h2>
                  <p className="how-chapter-oneliner">{chapter.oneLiner}</p>
                </header>

                {chapter.sections.map((section, i) => (
                  <div key={i} className="how-section">
                    <h3 className="how-section-heading">{section.heading}</h3>
                    <p className="how-section-body">{section.body}</p>
                    {section.codeExample && (
                      <pre className="how-code">
                        <code>{section.codeExample}</code>
                      </pre>
                    )}
                  </div>
                ))}

                {chapter.tools.length > 0 && (
                  <div className="how-tools">
                    <h3 className="how-tools-heading">Tools in this chapter</h3>
                    <ul>
                      {chapter.tools.map((tool) => (
                        <li key={tool.name}>
                          <code className="how-tool-name">{tool.name}</code>
                          <span className="how-tool-blurb"> — {tool.blurb}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                <TryItNextPanel items={chapter.tryItNext} />
              </section>
            ))}

            <section className="how-footer-cta">
              <h2>Call <code>memory_tutorial</code> in Claude</h2>
              <p>
                Every chapter on this page is also available as an MCP tool
                response. Open Claude Code, say &ldquo;teach me how Lodis
                works,&rdquo; and walk through the same content chapter by chapter.
              </p>
              <a href="/setup" className="btn-glow">
                Set up Lodis
              </a>
            </section>
          </div>
        </div>
      </main>
      <Footer />
    </>
  );
}

function HeroDiagram() {
  return (
    <svg
      viewBox="0 0 320 240"
      className="hero-diagram-svg"
      role="img"
      aria-label="Lodis architecture: many agents, one memory layer"
    >
      <defs>
        <linearGradient id="hd-line" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="var(--accent)" stopOpacity="0.5" />
          <stop offset="100%" stopColor="var(--violet)" stopOpacity="0.5" />
        </linearGradient>
      </defs>

      {/* Agents */}
      {AGENT_NODES.map((n) => (
        <g key={n.label}>
          <line
            x1={n.x}
            y1={n.y}
            x2={160}
            y2={140}
            stroke="url(#hd-line)"
            strokeWidth="1"
            strokeDasharray="3 3"
          />
          <circle cx={n.x} cy={n.y} r="20" fill="var(--bg-soft)" stroke="var(--border-strong)" />
          <text
            x={n.x}
            y={n.y + 4}
            textAnchor="middle"
            fill="var(--text-muted)"
            fontSize="10"
            fontFamily="var(--font-mono)"
          >
            {n.label}
          </text>
        </g>
      ))}

      {/* Lodis core */}
      <rect
        x={110}
        y={115}
        width={100}
        height={50}
        rx="8"
        fill="var(--bg-raised)"
        stroke="var(--accent)"
      />
      <text
        x={160}
        y={138}
        textAnchor="middle"
        fill="var(--accent-strong)"
        fontSize="13"
        fontFamily="var(--font-mono)"
        fontWeight="600"
      >
        lodis
      </text>
      <text
        x={160}
        y={154}
        textAnchor="middle"
        fill="var(--text-dim)"
        fontSize="9"
        fontFamily="var(--font-mono)"
      >
        one memory
      </text>

      {/* Storage */}
      <g>
        <line x1={160} y1={165} x2={160} y2={200} stroke="var(--border-strong)" strokeWidth="1" />
        <rect x={115} y={200} width={90} height={26} rx="4" fill="var(--bg-soft)" stroke="var(--border)" />
        <text
          x={160}
          y={217}
          textAnchor="middle"
          fill="var(--text-muted)"
          fontSize="10"
          fontFamily="var(--font-mono)"
        >
          ~/.lodis/lodis.db
        </text>
      </g>
    </svg>
  );
}

const AGENT_NODES = [
  { x: 40, y: 40, label: "Claude" },
  { x: 160, y: 30, label: "Cursor" },
  { x: 280, y: 40, label: "Windsurf" },
  { x: 40, y: 150, label: "Cline" },
  { x: 280, y: 150, label: "Desktop" },
];

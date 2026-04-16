import { MemoryThreads } from "./memory-threads";
import { CodeBlock } from "./code-block";

const installConfig = `{
  "mcpServers": {
    "lodis": {
      "command": "npx",
      "args": ["-y", "lodis"]
    }
  }
}`;

export function Hero() {
  return (
    <section className="relative min-h-[720px] md:min-h-[780px] flex items-center justify-center overflow-hidden pt-24">
      {/* Floating orbs */}
      <div className="orb orb-1" />
      <div className="orb orb-2" />
      <div className="orb orb-3" />

      {/* Memory thread SVG */}
      <MemoryThreads />

      <div className="relative z-10 max-w-4xl mx-auto px-6 text-center">
        <h1 className="text-5xl sm:text-6xl lg:text-7xl font-bold tracking-tight text-text leading-[1.1] mb-6">
          Your AI&rsquo;s memory,{" "}
          <span className="bg-gradient-to-r from-glow to-violet bg-clip-text text-transparent">
            made visible.
          </span>
        </h1>

        <p className="text-lg sm:text-xl text-text-muted max-w-2xl mx-auto mb-10 leading-relaxed">
          A universal memory layer for AI agents. Searchable, correctable, portable.
          Install once, remember everywhere.
        </p>

        <div className="flex items-center justify-center gap-4 mb-12">
          <a href="/setup" className="btn-glow text-base">
            Get Started
          </a>
          <a
            href="https://github.com/Sunrise-Labs-Dot-AI/lodis"
            target="_blank"
            rel="noopener noreferrer"
            className="btn-ghost text-base"
          >
            View on GitHub
          </a>
        </div>

        <div className="max-w-lg mx-auto">
          <CodeBlock className="text-left text-sm">{installConfig}</CodeBlock>
          <p className="text-text-dim text-sm mt-3">
            Add to Claude Code, Cursor, Windsurf, or any MCP client. That&rsquo;s it.
          </p>
        </div>

        {/* Dashboard screenshot */}
        <div className="mt-16 max-w-5xl mx-auto perspective-container">
          <div className="screenshot-frame">
            <img
              src="/screenshots/dashboard-hero.png"
              alt="Lodis dashboard showing memory browser with search, domain filters, and confidence scores"
              width={1440}
              height={900}
              className="rounded-lg w-full h-auto"
            />
          </div>
        </div>
      </div>
    </section>
  );
}

import { Reveal } from "./reveal";

const localFeatures = [
  "SQLite on your machine - zero infrastructure",
  "Stdio MCP transport - works with any local MCP client",
  "No accounts or API keys required",
  "In-process reranker - no external inference service",
  "Dashboard at localhost:3838",
];

const selfHostedFeatures = [
  "Run lodis --serve when stdio is not enough",
  "HTTP transport for clients that cannot launch local processes",
  "API-token protection for your own server",
  "Same local database and dashboard",
  "You own the network boundary",
];

export function Deployment() {
  return (
    <section className="py-24 px-6">
      <div className="max-w-6xl mx-auto">
        <Reveal>
          <h2 className="text-3xl sm:text-4xl font-bold text-center mb-4 tracking-tight">
            Run it locally.{" "}
            <span className="text-glow">Keep it portable.</span>
          </h2>
          <p className="text-text-muted text-center mb-16 text-lg">
            Start with stdio MCP. Use local HTTP only when a client cannot launch Lodis as a process.
          </p>
        </Reveal>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 max-w-5xl mx-auto">
          {/* Local card */}
          <Reveal>
            <div className="glass p-8 h-full flex flex-col">
              <div className="flex items-center gap-3 mb-2">
                <svg viewBox="0 0 24 24" className="w-6 h-6 text-glow" fill="none" stroke="currentColor" strokeWidth="1.5">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 17.25v1.007a3 3 0 01-.879 2.122L7.5 21h9l-.621-.621A3 3 0 0115 18.257V17.25m6-12V15a2.25 2.25 0 01-2.25 2.25H5.25A2.25 2.25 0 013 15V5.25A2.25 2.25 0 015.25 3h13.5A2.25 2.25 0 0121 5.25z" />
                </svg>
                <h3 className="text-xl font-semibold">Local</h3>
              </div>
              <p className="text-text-dim text-sm mb-6">Recommended &middot; Open source &middot; MIT License</p>

              <ul className="space-y-3 mb-8 flex-1">
                {localFeatures.map((f) => (
                  <li key={f} className="flex items-start gap-2.5">
                    <svg viewBox="0 0 20 20" className="w-5 h-5 text-emerald shrink-0 mt-0.5" fill="currentColor">
                      <path fillRule="evenodd" d="M16.704 4.153a.75.75 0 01.143 1.052l-8 10.5a.75.75 0 01-1.127.075l-4.5-4.5a.75.75 0 011.06-1.06l3.894 3.893 7.48-9.817a.75.75 0 011.05-.143z" clipRule="evenodd" />
                    </svg>
                    <span className="text-sm text-text-muted">{f}</span>
                  </li>
                ))}
              </ul>

              <p className="text-text-dim text-xs mb-5 italic">
                Your data never leaves your machine.
              </p>

              <a href="#install" className="btn-ghost text-sm text-center w-full block">
                Install local
              </a>
            </div>
          </Reveal>

          {/* Self-hosted card */}
          <Reveal>
            <div className="relative glass p-8 h-full flex flex-col border-glow/20">
              <span className="absolute top-4 right-4 px-2.5 py-1 text-[11px] font-medium rounded-full bg-[rgba(125,211,252,0.12)] text-glow-soft border border-border-hover">
                Advanced
              </span>
              <div className="flex items-center gap-3 mb-2">
                <svg viewBox="0 0 24 24" className="w-6 h-6 text-violet" fill="none" stroke="currentColor" strokeWidth="1.5">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 6.75h7.5m-7.5 3h7.5m-9 3.75h10.5A2.25 2.25 0 0019.5 11.25v-6A2.25 2.25 0 0017.25 3H6.75A2.25 2.25 0 004.5 5.25v6a2.25 2.25 0 002.25 2.25zM7.5 16.5h9" />
                </svg>
                <h3 className="text-xl font-semibold">Local HTTP</h3>
              </div>
              <p className="text-text-dim text-sm mb-6">Self-hosted &middot; Token protected &middot; Still local-first</p>

              <ul className="space-y-3 mb-8 flex-1">
                {selfHostedFeatures.map((f) => (
                  <li key={f} className="flex items-start gap-2.5">
                    <svg viewBox="0 0 20 20" className="w-5 h-5 text-violet shrink-0 mt-0.5" fill="currentColor">
                      <path fillRule="evenodd" d="M16.704 4.153a.75.75 0 01.143 1.052l-8 10.5a.75.75 0 01-1.127.075l-4.5-4.5a.75.75 0 011.06-1.06l3.894 3.893 7.48-9.817a.75.75 0 011.05-.143z" clipRule="evenodd" />
                    </svg>
                    <span className="text-sm text-text-muted">{f}</span>
                  </li>
                ))}
              </ul>

              <p className="text-text-dim text-xs mb-5 italic">
                Use only after stdio is working.
              </p>

              <a
                href="/setup/all#local-http"
                className="btn-ghost text-sm text-center w-full block"
              >
                View HTTP setup
              </a>
            </div>
          </Reveal>
        </div>

        <Reveal>
          <p className="text-text-dim text-sm text-center mt-10">
            Your data stays in{" "}
            <code className="font-mono text-text-muted">~/.lodis/lodis.db</code>{" "}
            and exports as portable JSON.
          </p>
        </Reveal>
      </div>
    </section>
  );
}

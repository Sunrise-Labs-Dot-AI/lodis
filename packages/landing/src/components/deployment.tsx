import { Reveal } from "./reveal";

const localFeatures = [
  "SQLite on your machine — zero infrastructure",
  "Stdio or HTTP transport — works with any MCP client",
  "No accounts, no cloud, no API keys required",
  "API tokens for remote client access",
  "Dashboard at localhost:3838",
];

const cloudFeatures = [
  "Turso cloud database — sync across devices",
  "OAuth 2.1 — connect Claude.ai with one click",
  "API tokens for remote MCP clients",
  "Managed hosting — nothing to run",
  "Dashboard at app.lodis.ai",
];

export function Deployment() {
  return (
    <section className="py-24 px-6">
      <div className="max-w-6xl mx-auto">
        <Reveal>
          <h2 className="text-3xl sm:text-4xl font-bold text-center mb-4 tracking-tight">
            Run it{" "}
            <span className="text-glow">your way.</span>
          </h2>
          <p className="text-text-muted text-center mb-16 text-lg">
            Start local with full privacy. Move to cloud when you need sync.
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
              <p className="text-text-dim text-sm mb-6">Free &middot; Open source &middot; MIT License</p>

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
                Get Started
              </a>
            </div>
          </Reveal>

          {/* Cloud card */}
          <Reveal>
            <div className="relative glass p-8 h-full flex flex-col border-glow/20">
              <span className="absolute top-4 right-4 px-2.5 py-1 text-[11px] font-medium rounded-full bg-[rgba(125,211,252,0.12)] text-glow-soft border border-border-hover">
                Free during beta
              </span>
              <div className="flex items-center gap-3 mb-2">
                <svg viewBox="0 0 24 24" className="w-6 h-6 text-violet" fill="none" stroke="currentColor" strokeWidth="1.5">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 15a4.5 4.5 0 004.5 4.5H18a3.75 3.75 0 001.332-7.257 3 3 0 00-3.758-3.848 5.25 5.25 0 00-10.233 2.33A4.502 4.502 0 002.25 15z" />
                </svg>
                <h3 className="text-xl font-semibold">Cloud</h3>
              </div>
              <p className="text-text-dim text-sm mb-6">Managed &middot; Multi-device &middot; AES-256-GCM encrypted</p>

              <ul className="space-y-3 mb-8 flex-1">
                {cloudFeatures.map((f) => (
                  <li key={f} className="flex items-start gap-2.5">
                    <svg viewBox="0 0 20 20" className="w-5 h-5 text-violet shrink-0 mt-0.5" fill="currentColor">
                      <path fillRule="evenodd" d="M16.704 4.153a.75.75 0 01.143 1.052l-8 10.5a.75.75 0 01-1.127.075l-4.5-4.5a.75.75 0 011.06-1.06l3.894 3.893 7.48-9.817a.75.75 0 011.05-.143z" clipRule="evenodd" />
                    </svg>
                    <span className="text-sm text-text-muted">{f}</span>
                  </li>
                ))}
              </ul>

              <p className="text-text-dim text-xs mb-5 italic">
                Same memory, everywhere you work.
              </p>

              <a
                href="https://app.lodis.ai/sign-up"
                className="btn-glow text-sm text-center w-full block"
              >
                Sign Up
              </a>
            </div>
          </Reveal>
        </div>

        <Reveal>
          <p className="text-text-dim text-sm text-center mt-10">
            Start local, migrate anytime.{" "}
            <code className="font-mono text-text-muted">memory_migrate</code>{" "}
            moves your memories to cloud in one command.
          </p>
        </Reveal>
      </div>
    </section>
  );
}

import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Terms of Service | Lodis",
  description: "Terms of Service for the Lodis open-source local memory layer.",
};

export default function TermsOfService() {
  return (
    <main className="min-h-screen py-16 px-6">
      <div className="max-w-3xl mx-auto">
        <Link
          href="/"
          className="text-text-muted hover:text-text transition-colors text-sm"
        >
          &larr; Back to home
        </Link>

        <h1 className="text-4xl font-bold mt-8 mb-2 text-glow">
          Terms of Service
        </h1>
        <p className="text-text-dim text-sm mb-12">Last updated: May 2026</p>

        <div className="space-y-10 text-text-muted leading-relaxed">
          <section>
            <h2 className="text-xl font-semibold text-text mb-3">
              1. Open-Source Software
            </h2>
            <p>
              Lodis is an open-source, local-first memory layer for AI agents.
              The MCP server, dashboard, and core libraries are licensed under
              the{" "}
              <a
                href="https://github.com/Sunrise-Labs-Dot-AI/lodis/blob/main/LICENSE"
                target="_blank"
                rel="noopener noreferrer"
                className="text-glow hover:underline"
              >
                MIT License
              </a>
              . Your use, modification, and distribution of the software are
              governed by that license.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-text mb-3">
              2. Local Data
            </h2>
            <p>
              The recommended Lodis install runs on your machine and stores data
              in <code className="font-mono text-text">~/.lodis/lodis.db</code>.
              You are responsible for your local files, backups, device access,
              and any AI client configuration you choose to connect.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-text mb-3">
              3. Acceptable Use
            </h2>
            <p>You agree not to use Lodis to:</p>
            <ul className="list-disc list-inside mt-3 space-y-2 ml-2">
              <li>Store content that is illegal, harmful, or violates others&apos; rights.</li>
              <li>Bypass access controls in tools, files, or services you connect.</li>
              <li>Attack, disrupt, or abuse infrastructure you do not own.</li>
            </ul>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-text mb-3">
              4. External Services
            </h2>
            <p>
              If you configure Lodis or your AI client to call external services,
              APIs, or model providers, you are responsible for those credentials,
              costs, provider terms, and access decisions.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-text mb-3">
              5. Disclaimers
            </h2>
            <p>
              Lodis is provided &quot;as is&quot; without warranties of any kind.
              AI-generated memories, classifications, connections, and summaries
              may be incomplete or incorrect. You should verify important
              information independently.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-text mb-3">
              6. Limitation of Liability
            </h2>
            <p>
              To the maximum extent permitted by law, Sunrise Labs is not liable
              for indirect, incidental, special, consequential, or punitive
              damages, or for loss of data, profits, goodwill, or use arising
              from Lodis.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-text mb-3">
              7. Changes
            </h2>
            <p>
              We may update these terms as Lodis evolves. Material changes will
              be reflected on this page.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-text mb-3">
              8. Contact
            </h2>
            <p>
              Questions? Email{" "}
              <a href="mailto:hello@sunriselabs.ai" className="text-glow hover:underline">
                hello@sunriselabs.ai
              </a>
              .
            </p>
          </section>
        </div>
      </div>
    </main>
  );
}

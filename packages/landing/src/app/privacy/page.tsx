import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Privacy Policy | Lodis",
  description: "Privacy Policy for the Lodis open-source local memory layer.",
};

export default function PrivacyPolicy() {
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
          Privacy Policy
        </h1>
        <p className="text-text-dim text-sm mb-12">Last updated: May 2026</p>

        <div className="space-y-10 text-text-muted leading-relaxed">
          <section>
            <p>
              Lodis is built by Sunrise Labs. The public product path is
              local-first: your AI memory lives on your machine, in your files,
              under your control.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-text mb-3">
              1. What We Collect
            </h2>
            <p>
              The local Lodis install does not send us your memories,
              embeddings, configuration, or credentials. We do not run product
              analytics, telemetry, or phone-home collection from the local MCP
              server or dashboard.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-text mb-3">
              2. Where Your Data Lives
            </h2>
            <p>
              Local Lodis stores memory data in{" "}
              <code className="font-mono text-text">~/.lodis/lodis.db</code>{" "}
              and cached embedding models under{" "}
              <code className="font-mono text-text">~/.lodis/models/</code>.
              Your device permissions, backups, and connected AI clients govern
              who can access that data.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-text mb-3">
              3. Model Calls and External Tools
            </h2>
            <p>
              Lodis core read/write paths are LLM-free. If your AI client,
              scripts, or configured tools call external model providers or
              services, those calls are controlled by that client or tool, not
              by Lodis itself.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-text mb-3">
              4. Exports and Deletion
            </h2>
            <p>
              You can export Lodis data as portable JSON and delete local data
              by removing the files under{" "}
              <code className="font-mono text-text">~/.lodis/</code>. Lodis also
              supports soft deletes inside the database so removed memories are
              excluded from normal search and retrieval.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-text mb-3">
              5. Security Notes
            </h2>
            <p>
              Local-first does not mean risk-free. Anyone with access to your
              machine or AI client configuration may be able to read or modify
              your Lodis data. Use normal device security, filesystem
              permissions, backups, and credential hygiene.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-text mb-3">
              6. Changes
            </h2>
            <p>
              We may update this policy as Lodis evolves. Material changes will
              be reflected on this page.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-text mb-3">
              7. Contact
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

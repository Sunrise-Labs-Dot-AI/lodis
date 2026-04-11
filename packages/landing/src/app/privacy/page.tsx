import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Privacy Policy | Engrams",
  description: "Privacy Policy for the Engrams AI memory platform.",
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
        <p className="text-text-dim text-sm mb-12">Last updated: April 2026</p>

        <div className="space-y-10 text-text-muted leading-relaxed">
          <section>
            <p>
              Engrams is built by Sunrise Labs (&quot;we&quot;, &quot;us&quot;,
              &quot;our&quot;). We believe you should understand exactly what
              happens with your data, so this policy is written to be read, not
              just agreed to.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-text mb-3">
              1. Information We Collect
            </h2>
            <p>
              What we collect depends entirely on which tier you use:
            </p>

            <h3 className="text-lg font-medium text-text mt-5 mb-2">
              Local Tier
            </h3>
            <p>
              <span className="text-text font-medium">
                We collect nothing.
              </span>{" "}
              The Local tier runs entirely on your machine. Your memories,
              embeddings, configuration, and credentials never leave your
              computer. There is no telemetry, no analytics, and no phone-home
              behavior. The only network calls the software makes are to your own
              LLM provider, if you configure one.
            </p>

            <h3 className="text-lg font-medium text-text mt-5 mb-2">
              Cloud and Cloud+ Tiers
            </h3>
            <p>When you create an account, we collect:</p>
            <ul className="list-disc list-inside mt-3 space-y-2 ml-2">
              <li>
                <span className="text-text">Account information</span> &mdash;
                Email address and authentication data, provided through Clerk
                (our authentication provider).
              </li>
              <li>
                <span className="text-text">Memory content</span> &mdash;
                The memories your AI agents store, including content, details,
                entity classifications, structured data, and metadata (timestamps,
                confidence scores, agent identifiers).
              </li>
              <li>
                <span className="text-text">Embedding vectors</span> &mdash;
                384-dimensional float vectors generated from your memory content,
                used for semantic search.
              </li>
              <li>
                <span className="text-text">Relationship graph</span> &mdash;
                Connections between your memories (e.g., &quot;works_at&quot;,
                &quot;part_of&quot;).
              </li>
              <li>
                <span className="text-text">Event history</span> &mdash;
                An audit trail of actions taken on your memories (creation,
                updates, confirmations, corrections).
              </li>
              <li>
                <span className="text-text">BYOK API keys</span> (Cloud tier)
                &mdash; Your LLM provider API keys, if you provide them.
              </li>
            </ul>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-text mb-3">
              2. How We Use Your Information
            </h2>
            <ul className="list-disc list-inside mt-3 space-y-2 ml-2">
              <li>
                To provide the Service: storing, searching, and managing your AI
                agent memories.
              </li>
              <li>
                To authenticate you and secure your account.
              </li>
              <li>
                To process LLM requests on your behalf (Cloud+ tier, or BYOK
                calls on Cloud tier).
              </li>
              <li>
                To send you service-related communications (account security,
                terms updates).
              </li>
            </ul>
            <p className="mt-3">
              We do not sell your data. We do not use your memory content to
              train models. We do not serve ads.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-text mb-3">
              3. Data Storage and Encryption
            </h2>
            <p>
              We want to be transparent about our security model, including its
              limitations.
            </p>

            <h3 className="text-lg font-medium text-text mt-5 mb-2">
              Encryption at Rest
            </h3>
            <p>
              Your memory content is encrypted at rest using AES-256-GCM with
              keys derived via scrypt. This means your data is encrypted when
              stored on disk in our database (hosted on Turso, a cloud SQLite
              platform).
            </p>

            <h3 className="text-lg font-medium text-text mt-5 mb-2">
              Important: This Is Not Zero-Knowledge
            </h3>
            <p>
              During request processing, your memory content is decrypted in
              server memory so we can perform operations like search, entity
              extraction, and deduplication. This means our server has access to
              your plaintext data while processing your requests. We do not log
              or persist decrypted content outside of the request lifecycle, but
              you should understand that this is a trust-based model, not a
              zero-knowledge architecture.
            </p>
            <p className="mt-3">
              If you require zero-knowledge encryption, the Local tier keeps all
              data on your own machine under your full control.
            </p>

            <h3 className="text-lg font-medium text-text mt-5 mb-2">
              Embedding Vectors
            </h3>
            <p>
              Embedding vectors (384-dimensional float arrays) are stored
              unencrypted in the database. This is necessary for vector
              similarity search to function. Embeddings are mathematical
              representations of your content &mdash; while they do not contain
              readable text, they could theoretically be used to infer
              information about the source content.
            </p>

            <h3 className="text-lg font-medium text-text mt-5 mb-2">
              BYOK API Keys
            </h3>
            <p>
              If you provide your own LLM API keys (Cloud tier), they are encrypted
              at rest in our database using a server-managed encryption key. They
              are decrypted in server memory only when making LLM API calls on
              your behalf. We do not log your API keys.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-text mb-3">
              4. Third-Party Services
            </h2>
            <p>
              The Cloud tiers rely on the following third-party services:
            </p>
            <ul className="list-disc list-inside mt-3 space-y-2 ml-2">
              <li>
                <span className="text-text">Clerk</span> &mdash; Authentication
                and user management. Clerk receives your email address and
                authentication credentials. See{" "}
                <a
                  href="https://clerk.com/privacy"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-glow hover:underline"
                >
                  Clerk&apos;s Privacy Policy
                </a>
                .
              </li>
              <li>
                <span className="text-text">Turso</span> &mdash; Cloud database
                hosting. Your encrypted memory data is stored on Turso
                infrastructure. See{" "}
                <a
                  href="https://turso.tech/privacy-policy"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-glow hover:underline"
                >
                  Turso&apos;s Privacy Policy
                </a>
                .
              </li>
              <li>
                <span className="text-text">
                  Anthropic / OpenAI
                </span>{" "}
                (Cloud+ tier only) &mdash; Your memory content is sent to these
                LLM providers for entity extraction, classification, and
                analysis. This means your plaintext memory content is processed
                by their systems, subject to their respective privacy policies
                and data handling practices.
              </li>
              <li>
                <span className="text-text">Vercel</span> &mdash; Hosting for
                the web dashboard and landing page.
              </li>
            </ul>
            <p className="mt-3">
              On the Local tier, none of these services are involved unless you
              explicitly configure an LLM provider yourself.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-text mb-3">
              5. Data Retention and Deletion
            </h2>
            <p>
              Memories are retained until you delete them. Engrams uses soft
              deletes (marking memories as deleted rather than immediately
              removing them), but soft-deleted data is excluded from all search
              results and API responses. Permanently purging soft-deleted data
              occurs during routine maintenance.
            </p>
            <p className="mt-3">
              When you delete your account, all associated data &mdash;
              memories, connections, events, API keys, and account information
              &mdash; is permanently deleted from our systems. This action is
              irreversible.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-text mb-3">
              6. Your Rights
            </h2>
            <p>You have the right to:</p>
            <ul className="list-disc list-inside mt-3 space-y-2 ml-2">
              <li>
                <span className="text-text">Export your data</span> &mdash;
                Download all your memories as JSON at any time through the
                dashboard settings.
              </li>
              <li>
                <span className="text-text">Delete your data</span> &mdash;
                Delete individual memories, or delete your entire account and all
                associated data.
              </li>
              <li>
                <span className="text-text">Revoke access tokens</span> &mdash;
                Revoke any Personal Access Token (PAT) at any time to disconnect
                MCP clients.
              </li>
              <li>
                <span className="text-text">Revoke API keys</span> &mdash;
                Remove your BYOK API keys from our system at any time.
              </li>
              <li>
                <span className="text-text">Access your data</span> &mdash;
                View all memories, connections, events, and metadata through the
                dashboard.
              </li>
            </ul>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-text mb-3">
              7. Children&apos;s Privacy
            </h2>
            <p>
              Engrams is not intended for use by anyone under the age of 13. We
              do not knowingly collect personal information from children under
              13. If you believe a child under 13 has provided us with personal
              information, please contact us and we will delete it.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-text mb-3">
              8. Changes to This Policy
            </h2>
            <p>
              We may update this Privacy Policy from time to time. We will notify
              Cloud tier users of material changes via email. The &quot;Last
              updated&quot; date at the top of this page indicates when the
              policy was last revised.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-text mb-3">
              9. Contact
            </h2>
            <p>
              If you have questions about this Privacy Policy or how your data is
              handled, contact us at{" "}
              <a
                href="mailto:privacy@getengrams.com"
                className="text-glow hover:underline"
              >
                privacy@getengrams.com
              </a>
              .
            </p>
          </section>
        </div>
      </div>
    </main>
  );
}

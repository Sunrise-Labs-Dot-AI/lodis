import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Terms of Service | Engrams",
  description: "Terms of Service for the Engrams AI memory platform.",
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
        <p className="text-text-dim text-sm mb-12">Last updated: April 2026</p>

        <div className="space-y-10 text-text-muted leading-relaxed">
          <section>
            <h2 className="text-xl font-semibold text-text mb-3">
              1. Acceptance of Terms
            </h2>
            <p>
              By accessing or using the Engrams platform (&quot;Service&quot;),
              operated by Sunrise Labs (&quot;we&quot;, &quot;us&quot;,
              &quot;our&quot;), you agree to be bound by these Terms of Service.
              If you do not agree, do not use the Service.
            </p>
            <p className="mt-3">
              These terms apply to both the open-source software and the hosted
              service. The open-source MCP server and dashboard are available
              under the MIT License, but your use of our hosted infrastructure
              is governed by these terms.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-text mb-3">
              2. Description of Service
            </h2>
            <p>
              Engrams is a universal memory layer for AI agents. It provides
              persistent, searchable memory that works across MCP-compatible
              tools. We offer multiple tiers:
            </p>
            <ul className="list-disc list-inside mt-3 space-y-2 ml-2">
              <li>
                <span className="text-text font-medium">Local</span> &mdash; A
                local-only MCP server and dashboard. All data stays on your
                machine. No cloud services are involved unless you configure your
                own LLM provider (BYOK).
              </li>
              <li>
                <span className="text-text font-medium">Cloud</span> &mdash; A
                cloud-hosted MCP server and dashboard. Your memories are stored
                in our cloud database, encrypted at rest. You supply your own LLM
                API keys (BYOK).
              </li>
              <li>
                <span className="text-text font-medium">Cloud+</span> &mdash;
                Same as Cloud, with LLM processing included. Your memory content
                is sent to third-party LLM providers (Anthropic, OpenAI) for
                entity extraction and analysis.
              </li>
            </ul>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-text mb-3">
              3. User Accounts and API Tokens
            </h2>
            <p>
              Cloud and Cloud+ tiers require an account, authenticated through
              Clerk (our third-party authentication provider). You are
              responsible for maintaining the security of your account
              credentials.
            </p>
            <p className="mt-3">
              MCP client connections are authenticated using Personal Access
              Tokens (PATs). You are responsible for keeping your tokens secure.
              Treat them like passwords. If you believe a token has been
              compromised, revoke it immediately through the dashboard.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-text mb-3">
              4. Acceptable Use
            </h2>
            <p>You agree not to:</p>
            <ul className="list-disc list-inside mt-3 space-y-2 ml-2">
              <li>
                Use the Service to store content that is illegal, harmful, or
                violates the rights of others.
              </li>
              <li>
                Attempt to gain unauthorized access to other users&apos; data or
                our infrastructure.
              </li>
              <li>
                Reverse-engineer, attack, or attempt to disrupt the hosted
                service.
              </li>
              <li>
                Use the Service to circumvent the usage policies of third-party
                LLM providers.
              </li>
              <li>
                Resell or redistribute access to the hosted service without our
                written permission.
              </li>
            </ul>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-text mb-3">
              5. Intellectual Property
            </h2>
            <p>
              The Engrams open-source software (MCP server, dashboard, and core
              libraries) is licensed under the{" "}
              <a
                href="https://github.com/Sunrise-Labs-Dot-AI/engrams/blob/main/LICENSE"
                target="_blank"
                rel="noopener noreferrer"
                className="text-glow hover:underline"
              >
                MIT License
              </a>
              . You are free to use, modify, and distribute it under those
              terms.
            </p>
            <p className="mt-3">
              The hosted service (infrastructure, deployment, and managed
              operations) is a separate commercial offering. The MIT license
              applies to the source code, not to our hosted infrastructure or
              service availability.
            </p>
            <p className="mt-3">
              You retain full ownership of all content you store in Engrams. We
              do not claim any rights over your memories, data, or intellectual
              property.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-text mb-3">
              6. Data and Privacy
            </h2>
            <p>
              Your privacy matters to us. Please review our{" "}
              <Link href="/privacy" className="text-glow hover:underline">
                Privacy Policy
              </Link>{" "}
              for detailed information about how we collect, use, and protect
              your data across each tier.
            </p>
            <p className="mt-3">
              In summary: the Local tier collects no data and makes no cloud
              calls. The Cloud tiers store your data encrypted at rest in our cloud
              infrastructure. You can export or delete your data at any time.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-text mb-3">
              7. BYOK API Keys
            </h2>
            <p>
              If you provide your own API keys (&quot;Bring Your Own Key&quot;)
              for LLM providers, you are responsible for:
            </p>
            <ul className="list-disc list-inside mt-3 space-y-2 ml-2">
              <li>
                Ensuring your usage complies with the LLM provider&apos;s terms
                of service.
              </li>
              <li>
                Any costs incurred through those API keys when used by the
                Service.
              </li>
              <li>
                Revoking keys if you suspect unauthorized use.
              </li>
            </ul>
            <p className="mt-3">
              On the Cloud tier, your API keys are encrypted at rest in our
              database and only decrypted in server memory when making LLM calls
              on your behalf. See our Privacy Policy for details.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-text mb-3">
              8. Disclaimers
            </h2>
            <p>
              The Service is provided &quot;as is&quot; and &quot;as
              available&quot; without warranties of any kind, either express or
              implied, including but not limited to implied warranties of
              merchantability, fitness for a particular purpose, and
              non-infringement.
            </p>
            <p className="mt-3">
              We do not warrant that the Service will be uninterrupted, secure,
              or error-free. AI-generated entity extraction, memory
              classification, and other automated features may produce inaccurate
              results. You should verify important information independently.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-text mb-3">
              9. Limitation of Liability
            </h2>
            <p>
              To the maximum extent permitted by law, Sunrise Labs shall not be
              liable for any indirect, incidental, special, consequential, or
              punitive damages, or any loss of profits or revenues, whether
              incurred directly or indirectly, or any loss of data, use,
              goodwill, or other intangible losses resulting from:
            </p>
            <ul className="list-disc list-inside mt-3 space-y-2 ml-2">
              <li>Your use of or inability to use the Service.</li>
              <li>
                Any unauthorized access to or alteration of your data.
              </li>
              <li>
                Any third-party conduct on the Service, including LLM provider
                actions.
              </li>
              <li>Any other matter relating to the Service.</li>
            </ul>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-text mb-3">
              10. Termination
            </h2>
            <p>
              You may stop using the Service at any time. For Cloud tier accounts,
              you can delete your account and all associated data through the
              dashboard settings.
            </p>
            <p className="mt-3">
              We may suspend or terminate your access if you violate these terms,
              with notice where practicable. Upon termination, you may export
              your data before your account and its contents are permanently
              deleted.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-text mb-3">
              11. Changes to Terms
            </h2>
            <p>
              We may update these Terms of Service from time to time. We will
              notify Cloud tier users of material changes via email. Continued use
              of the Service after changes take effect constitutes acceptance of
              the revised terms.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-text mb-3">
              12. Contact
            </h2>
            <p>
              If you have questions about these Terms of Service, contact us at{" "}
              <a
                href="mailto:support@getengrams.com"
                className="text-glow hover:underline"
              >
                support@getengrams.com
              </a>
              .
            </p>
          </section>
        </div>
      </div>
    </main>
  );
}

import { resolve } from "path";
import { homedir } from "os";
import { getDbStats } from "@/lib/db";
import { getUserId } from "@/lib/auth";
import { formatBytes } from "@/lib/utils";
import { Card } from "@/components/ui/card";
import { SettingsActions } from "./actions";
import { getLLMStatus } from "./llm-actions";
import { LLMProviderForm } from "@/components/llm-provider-form";
import { ApiTokens } from "@/components/api-tokens";
import { ConnectClaude } from "@/components/connect-claude";
import { TierSelector } from "@/components/tier-selector";
import { listApiTokens } from "./token-actions";

export const dynamic = "force-dynamic";

const isHosted = !!process.env.TURSO_DATABASE_URL;

export default async function SettingsPage() {
  const userId = await getUserId();
  const stats = await getDbStats(userId);
  const dbPath = isHosted
    ? "(hosted — Turso)"
    : resolve(homedir(), ".engrams", "engrams.db");
  const llmStatus = await getLLMStatus(userId);

  return (
    <div className="space-y-6">
      <h1 className="text-lg font-semibold">Settings</h1>

      {/* Connect to Claude (hosted only) */}
      {isHosted && <ConnectClaude baseUrl={process.env.NEXT_PUBLIC_APP_URL || "https://app.getengrams.com"} />}

      {/* Plan selector */}
      <Card className="p-4">
        <h3 className="text-sm font-semibold mb-3">Plan</h3>
        <TierSelector currentTier={llmStatus.tier || "local"} userId={userId} />
      </Card>

      <Card className="p-4">
        <h3 className="text-sm font-semibold mb-3">Database</h3>
        <div className="space-y-2 text-sm">
          <div className="flex justify-between">
            <span className="text-[var(--color-text-muted)]">
              {isHosted ? "Database" : "File path"}
            </span>
            <span className="font-mono text-xs">{dbPath}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-[var(--color-text-muted)]">Size</span>
            <span>{isHosted ? "—" : formatBytes(stats.dbSizeBytes)}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-[var(--color-text-muted)]">
              Total memories
            </span>
            <span>{stats.totalMemories}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-[var(--color-text-muted)]">Domains</span>
            <span>{stats.totalDomains}</span>
          </div>
        </div>
      </Card>

      <Card className="p-4">
        <h3 className="text-sm font-semibold mb-1">LLM Provider</h3>
        {llmStatus.managed ? (
          <div className="space-y-2">
            <p className="text-xs text-[var(--color-text-muted)]">
              LLM calls are included with your Cloud+ plan. Powered by Anthropic.
            </p>
            <div className="flex items-center gap-2">
              <span className="inline-flex items-center rounded-full bg-[rgba(52,211,153,0.1)] border border-[rgba(52,211,153,0.2)] px-2 py-0.5 text-xs text-[var(--color-success)]">
                Active
              </span>
              <span className="text-xs text-[var(--color-text-muted)]">
                Extraction: Haiku 4.5 / Analysis: Sonnet 4.5
              </span>
            </div>
          </div>
        ) : (
          <>
            <p className="text-xs text-[var(--color-text-muted)] mb-3">
              Powers entity extraction, memory correction, and splitting. Bring your own API key.
            </p>
            <LLMProviderForm initialStatus={llmStatus} userId={userId} />
          </>
        )}
      </Card>

      {/* API Tokens (hosted only) */}
      {isHosted && userId && (
        <Card className="p-4">
          <ApiTokensSection userId={userId} />
        </Card>
      )}

      <SettingsActions />
    </div>
  );
}

async function ApiTokensSection({ userId }: { userId: string }) {
  const tokens = await listApiTokens(userId);
  return <ApiTokens userId={userId} tokens={tokens} />;
}


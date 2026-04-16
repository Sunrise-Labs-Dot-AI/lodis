import { resolve } from "path";
import { homedir } from "os";
import { getDbStats } from "@/lib/db";
import { getUserId } from "@/lib/auth";
import { formatBytes } from "@/lib/utils";
import { Card } from "@/components/ui/card";
import { SettingsActions } from "./actions";
import { ApiTokens } from "@/components/api-tokens";
import { ConnectClaude } from "@/components/connect-claude";
import { listApiTokens } from "./token-actions";

export const dynamic = "force-dynamic";

const isHosted = !!process.env.TURSO_DATABASE_URL;

export default async function SettingsPage() {
  const userId = await getUserId();
  const stats = await getDbStats(userId);
  const dbPath = isHosted
    ? "(hosted — Turso)"
    : resolve(homedir(), ".lodis", "lodis.db");

  return (
    <div className="space-y-6">
      <h1 className="text-lg font-semibold">Settings</h1>

      {/* Connect to Claude (hosted only) */}
      {isHosted && <ConnectClaude baseUrl={process.env.NEXT_PUBLIC_APP_URL || "https://app.lodis.ai"} />}

      <Card className="p-4">
        <h3 className="text-sm font-semibold mb-3">Database</h3>
        <div className="space-y-2 text-sm">
          <div className="flex justify-between">
            <span className="text-[var(--text-dim)]">
              {isHosted ? "Database" : "File path"}
            </span>
            <span className="font-mono text-xs">{dbPath}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-[var(--text-dim)]">Size</span>
            <span>{isHosted ? "—" : formatBytes(stats.dbSizeBytes)}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-[var(--text-dim)]">
              Total memories
            </span>
            <span>{stats.totalMemories}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-[var(--text-dim)]">Domains</span>
            <span>{stats.totalDomains}</span>
          </div>
        </div>
      </Card>

      {/* API Tokens */}
      <Card className="p-4">
        <ApiTokensSection userId={isHosted ? userId! : "local"} isHosted={isHosted} baseUrl={process.env.NEXT_PUBLIC_APP_URL || "https://app.lodis.ai"} />
      </Card>

      <SettingsActions />
    </div>
  );
}

async function ApiTokensSection({ userId, isHosted, baseUrl }: { userId: string; isHosted: boolean; baseUrl: string }) {
  const tokens = await listApiTokens(userId);
  return <ApiTokens userId={userId} tokens={tokens} isHosted={isHosted} baseUrl={baseUrl} />;
}

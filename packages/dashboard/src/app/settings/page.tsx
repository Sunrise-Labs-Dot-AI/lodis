import { resolve } from "path";
import { homedir } from "os";
import { getDbStats } from "@/lib/db";
import { formatBytes } from "@/lib/utils";
import { Card } from "@/components/ui/card";
import { SettingsActions } from "./actions";
import { SyncSettings } from "./sync-settings";
import { getSyncStatus } from "./sync-actions";
import { getLLMStatus } from "./llm-actions";
import { LLMProviderForm } from "@/components/llm-provider-form";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const stats = await getDbStats();
  const dbPath = process.env.TURSO_DATABASE_URL
    ? "(hosted — Turso)"
    : resolve(homedir(), ".engrams", "engrams.db");
  const syncStatus = await getSyncStatus();
  const llmStatus = await getLLMStatus();

  return (
    <div className="space-y-6">
      <h1 className="text-lg font-semibold">Settings</h1>

      <Card className="p-4">
        <h3 className="text-sm font-semibold mb-3">Database</h3>
        <div className="space-y-2 text-sm">
          <div className="flex justify-between">
            <span className="text-[var(--color-text-muted)]">File path</span>
            <span className="font-mono text-xs">{dbPath}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-[var(--color-text-muted)]">Size</span>
            <span>{formatBytes(stats.dbSizeBytes)}</span>
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
        <p className="text-xs text-[var(--color-text-muted)] mb-3">
          Powers entity extraction, memory correction, and splitting. Bring your own API key.
        </p>
        <LLMProviderForm initialStatus={llmStatus} />
      </Card>

      <SyncSettings syncStatus={syncStatus} />

      <SettingsActions />
    </div>
  );
}

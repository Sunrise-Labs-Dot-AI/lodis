"use client";

import { useState } from "react";
import { Cloud, Key, Lock, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { setupPassphrase, saveTursoConfig, triggerSync } from "./sync-actions";

interface SyncStatus {
  hasPassphrase: boolean;
  hasTursoConfig: boolean;
  deviceId: string | null;
}

export function SyncSettings({ syncStatus }: { syncStatus: SyncStatus }) {
  const [passphrase, setPassphrase] = useState("");
  const [tursoUrl, setTursoUrl] = useState("");
  const [tursoToken, setTursoToken] = useState("");
  const [syncPassphrase, setSyncPassphrase] = useState("");
  const [loading, setLoading] = useState<string | null>(null);
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);
  const [status, setStatus] = useState(syncStatus);

  async function handleSetPassphrase() {
    if (!passphrase) return;
    setLoading("passphrase");
    setMessage(null);
    const result = await setupPassphrase(passphrase);
    if (result.success) {
      setMessage({ type: "success", text: "Passphrase set successfully" });
      setStatus((s) => ({ ...s, hasPassphrase: true }));
      setPassphrase("");
    } else {
      setMessage({ type: "error", text: result.error ?? "Failed" });
    }
    setLoading(null);
  }

  async function handleSaveTurso() {
    if (!tursoUrl || !tursoToken) return;
    setLoading("turso");
    setMessage(null);
    const result = await saveTursoConfig(tursoUrl, tursoToken);
    if (result.success) {
      setMessage({ type: "success", text: "Turso connection verified and saved" });
      setStatus((s) => ({ ...s, hasTursoConfig: true }));
      setTursoUrl("");
      setTursoToken("");
    } else {
      setMessage({ type: "error", text: result.error ?? "Failed" });
    }
    setLoading(null);
  }

  async function handleSync() {
    if (!syncPassphrase) return;
    setLoading("sync");
    setMessage(null);
    const result = await triggerSync(syncPassphrase);
    if (result.success) {
      setMessage({ type: "success", text: `Synced: ${result.pushed} pushed, ${result.pulled} pulled` });
      setSyncPassphrase("");
    } else {
      setMessage({ type: "error", text: result.error ?? "Sync failed" });
    }
    setLoading(null);
  }

  return (
    <>
      {message && (
        <div className={`text-sm px-3 py-2 rounded ${message.type === "success" ? "bg-[var(--color-success-bg)] text-[var(--color-success)]" : "bg-[var(--color-danger-bg)] text-[var(--color-danger)]"}`}>
          {message.text}
        </div>
      )}

      <Card className="p-4">
        <h3 className="text-sm font-semibold mb-1 flex items-center gap-2">
          <Lock size={14} />
          Encryption
        </h3>
        <p className="text-xs text-[var(--color-text-muted)] mb-3">
          Your passphrase encrypts memories before cloud sync. If you lose it, your cloud data cannot be recovered.
        </p>
        {status.hasPassphrase ? (
          <div className="flex items-center gap-2 text-sm">
            <Key size={14} className="text-[var(--color-success)]" />
            <span className="text-[var(--color-success)]">Passphrase configured</span>
          </div>
        ) : (
          <div className="space-y-2">
            <input
              type="password"
              value={passphrase}
              onChange={(e) => setPassphrase(e.target.value)}
              placeholder="Enter encryption passphrase"
              className="w-full px-3 py-1.5 text-sm bg-[var(--color-bg-soft)] border border-[var(--color-border)] rounded-md"
            />
            <Button
              variant="primary"
              size="sm"
              onClick={handleSetPassphrase}
              disabled={!passphrase || loading === "passphrase"}
            >
              {loading === "passphrase" ? "Setting..." : "Set Passphrase"}
            </Button>
          </div>
        )}
      </Card>

      <Card className="p-4">
        <h3 className="text-sm font-semibold mb-1 flex items-center gap-2">
          <Cloud size={14} />
          Cloud Sync
        </h3>
        <p className="text-xs text-[var(--color-text-muted)] mb-3">
          Connect to Turso for cross-device sync. Your memories are encrypted before leaving this device.
        </p>

        {status.hasTursoConfig ? (
          <div className="space-y-3">
            <div className="flex items-center gap-2 text-sm">
              <Cloud size={14} className="text-[var(--color-success)]" />
              <span className="text-[var(--color-success)]">Turso connected</span>
            </div>
            <div className="space-y-2">
              <input
                type="password"
                value={syncPassphrase}
                onChange={(e) => setSyncPassphrase(e.target.value)}
                placeholder="Enter passphrase to sync"
                className="w-full px-3 py-1.5 text-sm bg-[var(--color-bg-soft)] border border-[var(--color-border)] rounded-md"
              />
              <Button
                variant="primary"
                size="sm"
                onClick={handleSync}
                disabled={!syncPassphrase || loading === "sync"}
              >
                <RefreshCw size={14} className="mr-1" />
                {loading === "sync" ? "Syncing..." : "Sync Now"}
              </Button>
            </div>
          </div>
        ) : (
          <div className="space-y-2">
            <input
              type="text"
              value={tursoUrl}
              onChange={(e) => setTursoUrl(e.target.value)}
              placeholder="Turso database URL (libsql://...)"
              className="w-full px-3 py-1.5 text-sm bg-[var(--color-bg-soft)] border border-[var(--color-border)] rounded-md font-mono"
            />
            <input
              type="password"
              value={tursoToken}
              onChange={(e) => setTursoToken(e.target.value)}
              placeholder="Turso auth token"
              className="w-full px-3 py-1.5 text-sm bg-[var(--color-bg-soft)] border border-[var(--color-border)] rounded-md"
            />
            <Button
              variant="primary"
              size="sm"
              onClick={handleSaveTurso}
              disabled={!tursoUrl || !tursoToken || loading === "turso"}
            >
              {loading === "turso" ? "Testing..." : "Save & Test Connection"}
            </Button>
          </div>
        )}

        {status.deviceId && (
          <p className="text-xs text-[var(--color-text-muted)] mt-3">
            Device ID: <span className="font-mono">{status.deviceId}</span>
          </p>
        )}
      </Card>
    </>
  );
}

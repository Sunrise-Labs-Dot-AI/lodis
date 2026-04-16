"use client";

import { useState, useRef } from "react";
import { useRouter } from "next/navigation";
import { Download, Upload, Moon, Sun, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Modal } from "@/components/ui/modal";
import { clearAllMemoriesAction } from "@/lib/actions";

export function SettingsActions() {
  const router = useRouter();
  const [dark, setDark] = useState(false);
  const [clearModalOpen, setClearModalOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [importStatus, setImportStatus] = useState<{ type: "success" | "error"; message: string } | null>(null);
  const [importing, setImporting] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  function toggleDark() {
    const next = !dark;
    setDark(next);
    document.documentElement.classList.toggle("dark", next);
  }

  async function handleExport() {
    const res = await fetch("/api/export");
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `lodis-export-${new Date().toISOString().split("T")[0]}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  async function handleImport(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setImporting(true);
    setImportStatus(null);
    try {
      const text = await file.text();
      const data = JSON.parse(text);
      const res = await fetch("/api/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      const result = await res.json();
      if (!res.ok) {
        setImportStatus({ type: "error", message: result.error || "Import failed" });
      } else {
        setImportStatus({
          type: "success",
          message: `Imported ${result.imported} memories, ${result.connections} connections. ${result.skipped} skipped (already exist).`,
        });
        router.refresh();
      }
    } catch (err) {
      setImportStatus({ type: "error", message: err instanceof Error ? err.message : "Failed to read file" });
    } finally {
      setImporting(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  async function handleClear() {
    setLoading(true);
    try {
      await clearAllMemoriesAction();
      setClearModalOpen(false);
      router.refresh();
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      <Card className="p-4">
        <h3 className="text-sm font-semibold mb-3">Appearance</h3>
        <Button variant="secondary" size="sm" onClick={toggleDark}>
          {dark ? <Sun size={14} className="mr-1" /> : <Moon size={14} className="mr-1" />}
          {dark ? "Light Mode" : "Dark Mode"}
        </Button>
      </Card>

      <Card className="p-4">
        <h3 className="text-sm font-semibold mb-3">Export & Import</h3>
        <p className="text-xs text-[var(--text-dim)] mb-3">
          Export your memories as JSON, or import from another Lodis instance.
        </p>
        <div className="flex gap-2">
          <Button variant="secondary" size="sm" onClick={handleExport}>
            <Download size={14} className="mr-1" />
            Export
          </Button>
          <Button
            variant="secondary"
            size="sm"
            disabled={importing}
            onClick={() => fileInputRef.current?.click()}
          >
            <Upload size={14} className="mr-1" />
            {importing ? "Importing..." : "Import"}
          </Button>
          <input
            ref={fileInputRef}
            type="file"
            accept=".json"
            className="hidden"
            onChange={handleImport}
          />
        </div>
        {importStatus && (
          <p className={`text-xs mt-2 ${importStatus.type === "success" ? "text-[var(--success)]" : "text-[var(--danger)]"}`}>
            {importStatus.message}
          </p>
        )}
      </Card>

      <Card className="p-4 border-[var(--danger)]">
        <h3 className="text-sm font-semibold text-[var(--danger)] mb-3">
          Danger Zone
        </h3>
        <p className="text-xs text-[var(--text-dim)] mb-3">
          Permanently delete all memories. This cannot be undone.
        </p>
        <Button
          variant="danger"
          size="sm"
          onClick={() => setClearModalOpen(true)}
        >
          <Trash2 size={14} className="mr-1" />
          Clear All Memories
        </Button>
      </Card>

      <Modal
        open={clearModalOpen}
        onClose={() => setClearModalOpen(false)}
        title="Clear All Memories"
      >
        <p className="text-sm text-[var(--text-muted)]">
          This will permanently delete all memories. This action cannot be
          undone. Are you absolutely sure?
        </p>
        <div className="flex justify-end gap-2 mt-4">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setClearModalOpen(false)}
          >
            Cancel
          </Button>
          <Button variant="danger" size="sm" disabled={loading} onClick={handleClear}>
            Yes, Delete Everything
          </Button>
        </div>
      </Modal>
    </>
  );
}

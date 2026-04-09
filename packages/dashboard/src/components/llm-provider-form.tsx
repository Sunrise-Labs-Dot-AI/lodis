"use client";

import { useState } from "react";
import { saveLLMConfig } from "@/app/settings/llm-actions";

const DEFAULT_MODELS: Record<string, { extraction: string; analysis: string }> = {
  anthropic: { extraction: "claude-haiku-4-5-20251001", analysis: "claude-sonnet-4-5-20250514" },
  openai: { extraction: "gpt-4o-mini", analysis: "gpt-4o" },
  ollama: { extraction: "llama3.2", analysis: "llama3.2" },
};

interface Props {
  initialStatus: {
    configured: boolean;
    provider?: string;
    extractionModel?: string;
    analysisModel?: string;
  };
}

export function LLMProviderForm({ initialStatus }: Props) {
  const [provider, setProvider] = useState(initialStatus.provider || "anthropic");
  const [apiKey, setApiKey] = useState("");
  const [baseUrl, setBaseUrl] = useState(provider === "ollama" ? "http://localhost:11434/v1" : "");
  const [extractionModel, setExtractionModel] = useState(initialStatus.extractionModel || "");
  const [analysisModel, setAnalysisModel] = useState(initialStatus.analysisModel || "");
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState<{ type: "success" | "error"; message: string } | null>(
    initialStatus.configured ? { type: "success", message: `Connected (${initialStatus.provider})` } : null,
  );

  const defaults = DEFAULT_MODELS[provider] || DEFAULT_MODELS.anthropic;

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setStatus(null);
    const result = await saveLLMConfig(provider, apiKey, baseUrl, extractionModel, analysisModel);
    if (result.success) {
      setStatus({ type: "success", message: `Connected (${provider})` });
    } else {
      setStatus({ type: "error", message: result.error || "Failed" });
    }
    setSaving(false);
  }

  return (
    <form onSubmit={handleSave} className="space-y-3">
      <div>
        <label className="block text-xs font-medium mb-1">Provider</label>
        <select
          value={provider}
          onChange={(e) => {
            setProvider(e.target.value);
            if (e.target.value === "ollama") setBaseUrl("http://localhost:11434/v1");
            else setBaseUrl("");
          }}
          className="w-full rounded border border-[var(--color-border)] bg-[var(--color-bg)] px-2 py-1.5 text-sm"
        >
          <option value="anthropic">Anthropic</option>
          <option value="openai">OpenAI</option>
          <option value="ollama">Ollama (local)</option>
        </select>
      </div>

      {provider !== "ollama" && (
        <div>
          <label className="block text-xs font-medium mb-1">API Key</label>
          <input
            type="password"
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            placeholder={provider === "anthropic" ? "sk-ant-..." : "sk-..."}
            className="w-full rounded border border-[var(--color-border)] bg-[var(--color-bg)] px-2 py-1.5 text-sm"
          />
          <p className="text-[10px] text-[var(--color-text-muted)] mt-0.5">
            Stored locally in ~/.engrams/config.json
          </p>
        </div>
      )}

      {(provider === "openai" || provider === "ollama") && (
        <div>
          <label className="block text-xs font-medium mb-1">Base URL</label>
          <input
            type="text"
            value={baseUrl}
            onChange={(e) => setBaseUrl(e.target.value)}
            placeholder={provider === "ollama" ? "http://localhost:11434/v1" : "https://api.openai.com/v1"}
            className="w-full rounded border border-[var(--color-border)] bg-[var(--color-bg)] px-2 py-1.5 text-sm"
          />
        </div>
      )}

      <div className="border-t border-[var(--color-border)] pt-3">
        <p className="text-xs font-medium mb-2">Model Configuration</p>

        <div className="space-y-2">
          <div>
            <label className="block text-[10px] text-[var(--color-text-muted)] mb-0.5">Extraction model (high-volume)</label>
            <input
              type="text"
              value={extractionModel}
              onChange={(e) => setExtractionModel(e.target.value)}
              placeholder={defaults.extraction}
              className="w-full rounded border border-[var(--color-border)] bg-[var(--color-bg)] px-2 py-1.5 text-sm"
            />
            <p className="text-[10px] text-[var(--color-text-muted)] mt-0.5">
              Entity classification on every write. A fast, cheap model is fine.
            </p>
          </div>

          <div>
            <label className="block text-[10px] text-[var(--color-text-muted)] mb-0.5">Analysis model (user-initiated)</label>
            <input
              type="text"
              value={analysisModel}
              onChange={(e) => setAnalysisModel(e.target.value)}
              placeholder={defaults.analysis}
              className="w-full rounded border border-[var(--color-border)] bg-[var(--color-bg)] px-2 py-1.5 text-sm"
            />
            <p className="text-[10px] text-[var(--color-text-muted)] mt-0.5">
              Correction, splitting, and cleanup. Use a capable model for best results.
            </p>
          </div>
        </div>
      </div>

      <button
        type="submit"
        disabled={saving}
        className="w-full rounded bg-[var(--color-accent)] px-3 py-1.5 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50"
      >
        {saving ? "Testing..." : "Save & Test Connection"}
      </button>

      {status && (
        <p className={`text-xs ${status.type === "success" ? "text-green-600" : "text-red-500"}`}>
          {status.message}
        </p>
      )}
    </form>
  );
}

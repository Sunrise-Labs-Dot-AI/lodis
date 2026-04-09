"use client";

import clsx from "clsx";
import { useRouter, useSearchParams } from "next/navigation";
import { useTransition } from "react";
import { ArrowUpDown, Filter } from "lucide-react";

interface MemoryFiltersProps {
  sourceTypes: string[];
  entityTypes: string[];
}

const SORT_OPTIONS = [
  { value: "confidence", label: "Confidence" },
  { value: "recency", label: "Newest" },
  { value: "learned", label: "Oldest" },
  { value: "used", label: "Most Used" },
] as const;

const CONFIDENCE_PRESETS = [
  { value: "", label: "Any" },
  { value: "0.8-1", label: "High (80%+)" },
  { value: "0.5-0.8", label: "Medium (50-80%)" },
  { value: "0-0.5", label: "Low (<50%)" },
] as const;

export function MemoryFilters({ sourceTypes, entityTypes }: MemoryFiltersProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [, startTransition] = useTransition();

  const activeSort = searchParams.get("sort") ?? "confidence";
  const activeSource = searchParams.get("source") ?? "";
  const activeEntity = searchParams.get("entity") ?? "";
  const activeMinConf = searchParams.get("minConf") ?? "";
  const activeMaxConf = searchParams.get("maxConf") ?? "";
  const activeUnused = searchParams.get("unused") === "1";

  const activeConfPreset = activeMinConf && activeMaxConf
    ? `${activeMinConf}-${activeMaxConf}`
    : activeMinConf
    ? `${activeMinConf}-1`
    : "";

  function updateParam(key: string, value: string | null) {
    startTransition(() => {
      const params = new URLSearchParams(searchParams.toString());
      if (value) {
        params.set(key, value);
      } else {
        params.delete(key);
      }
      router.push(`/?${params.toString()}`);
    });
  }

  function setConfidencePreset(preset: string) {
    startTransition(() => {
      const params = new URLSearchParams(searchParams.toString());
      if (!preset) {
        params.delete("minConf");
        params.delete("maxConf");
      } else {
        const [min, max] = preset.split("-");
        params.set("minConf", min);
        params.set("maxConf", max);
      }
      router.push(`/?${params.toString()}`);
    });
  }

  function toggleUnused() {
    updateParam("unused", activeUnused ? null : "1");
  }

  const hasActiveFilters = activeSource || activeEntity || activeMinConf || activeUnused;

  return (
    <div className="flex items-center gap-3 flex-wrap text-xs">
      {/* Sort */}
      <div className="flex items-center gap-1.5">
        <ArrowUpDown size={12} className="text-[var(--color-text-muted)]" />
        {SORT_OPTIONS.map(({ value, label }) => (
          <button
            key={value}
            onClick={() => updateParam("sort", value === "confidence" ? null : value)}
            className={clsx(
              "px-2 py-1 rounded-md transition-colors cursor-pointer",
              activeSort === value
                ? "bg-[var(--color-accent-soft)] text-[var(--color-accent-text)] font-medium"
                : "text-[var(--color-text-muted)] hover:text-[var(--color-text)] hover:bg-[var(--color-bg-soft)]",
            )}
          >
            {label}
          </button>
        ))}
      </div>

      <span className="text-[var(--color-border)]">|</span>

      {/* Confidence presets */}
      <div className="flex items-center gap-1.5">
        {CONFIDENCE_PRESETS.map(({ value, label }) => (
          <button
            key={value || "any"}
            onClick={() => setConfidencePreset(value)}
            className={clsx(
              "px-2 py-1 rounded-md transition-colors cursor-pointer",
              activeConfPreset === value
                ? "bg-[var(--color-accent-soft)] text-[var(--color-accent-text)] font-medium"
                : "text-[var(--color-text-muted)] hover:text-[var(--color-text)] hover:bg-[var(--color-bg-soft)]",
            )}
          >
            {label}
          </button>
        ))}
      </div>

      <span className="text-[var(--color-border)]">|</span>

      {/* Source type */}
      {sourceTypes.length > 1 && (
        <select
          value={activeSource}
          onChange={(e) => updateParam("source", e.target.value || null)}
          className="px-2 py-1 text-xs bg-[var(--color-bg-soft)] border border-[var(--color-border)] rounded-md text-[var(--color-text-secondary)] cursor-pointer focus:outline-none focus:ring-1 focus:ring-[var(--color-accent-solid)]"
        >
          <option value="">All sources</option>
          {sourceTypes.map((st) => (
            <option key={st} value={st}>
              {st}
            </option>
          ))}
        </select>
      )}

      {/* Entity type */}
      {entityTypes.length > 0 && (
        <select
          value={activeEntity}
          onChange={(e) => updateParam("entity", e.target.value || null)}
          className="px-2 py-1 text-xs bg-[var(--color-bg-soft)] border border-[var(--color-border)] rounded-md text-[var(--color-text-secondary)] cursor-pointer focus:outline-none focus:ring-1 focus:ring-[var(--color-accent-solid)]"
        >
          <option value="">All types</option>
          {entityTypes.map((et) => (
            <option key={et} value={et}>
              {et}
            </option>
          ))}
        </select>
      )}

      {/* Unused toggle */}
      <button
        onClick={toggleUnused}
        className={clsx(
          "px-2 py-1 rounded-md transition-colors cursor-pointer",
          activeUnused
            ? "bg-[var(--color-warning-bg)] text-[var(--color-warning)] font-medium"
            : "text-[var(--color-text-muted)] hover:text-[var(--color-text)] hover:bg-[var(--color-bg-soft)]",
        )}
      >
        Unused
      </button>

      {/* Clear filters */}
      {hasActiveFilters && (
        <>
          <span className="text-[var(--color-border)]">|</span>
          <button
            onClick={() => {
              startTransition(() => {
                const params = new URLSearchParams(searchParams.toString());
                params.delete("source");
                params.delete("entity");
                params.delete("minConf");
                params.delete("maxConf");
                params.delete("unused");
                router.push(`/?${params.toString()}`);
              });
            }}
            className="px-2 py-1 text-[var(--color-danger)] hover:bg-[var(--color-danger-bg)] rounded-md transition-colors cursor-pointer"
          >
            Clear filters
          </button>
        </>
      )}
    </div>
  );
}

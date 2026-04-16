"use client";

import clsx from "clsx";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { ChevronDown, SlidersHorizontal } from "lucide-react";

interface MemoryFiltersProps {
  sourceTypes: string[];
  entityTypes: string[];
}

const SORT_OPTIONS = [
  { value: "confidence", label: "Confidence (highest first)" },
  { value: "recency", label: "Newest" },
  { value: "learned", label: "Oldest" },
  { value: "used", label: "Most used" },
] as const;

const CONFIDENCE_PRESETS = [
  { value: "", label: "Any" },
  { value: "0.8-1", label: "High (80%+)" },
  { value: "0.5-0.8", label: "Medium (50–80%)" },
  { value: "0-0.5", label: "Low (<50%)" },
] as const;

const PERMANENCE_OPTIONS = [
  { value: "", label: "All tiers" },
  { value: "canonical", label: "Canonical" },
  { value: "active", label: "Active" },
  { value: "ephemeral", label: "Ephemeral" },
  { value: "archived", label: "Archived" },
] as const;

export function MemoryFilters({ sourceTypes, entityTypes }: MemoryFiltersProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [, startTransition] = useTransition();
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  const activeSort = searchParams.get("sort") ?? "confidence";
  const activeSource = searchParams.get("source") ?? "";
  const activeEntity = searchParams.get("entity") ?? "";
  const activeMinConf = searchParams.get("minConf") ?? "";
  const activeMaxConf = searchParams.get("maxConf") ?? "";
  const activePermanence = searchParams.get("permanence") ?? "";
  const activeUnused = searchParams.get("unused") === "1";
  const activeReview = searchParams.get("review") === "1";

  const activeConfPreset = activeMinConf && activeMaxConf
    ? `${activeMinConf}-${activeMaxConf}`
    : activeMinConf
    ? `${activeMinConf}-1`
    : "";

  const sortLabel =
    SORT_OPTIONS.find((o) => o.value === activeSort)?.label ?? "Confidence";
  const confLabel = CONFIDENCE_PRESETS.find((o) => o.value === activeConfPreset)
    ?.label;

  const summaryChips: string[] = [];
  if (activeSort !== "confidence") summaryChips.push(sortLabel);
  if (confLabel && confLabel !== "Any") summaryChips.push(confLabel);
  if (activeSource) summaryChips.push(activeSource);
  if (activeEntity) summaryChips.push(activeEntity);
  if (activePermanence) summaryChips.push(activePermanence);
  if (activeUnused) summaryChips.push("Unused");
  if (activeReview) summaryChips.push("Needs review");

  const hasActiveFilters = summaryChips.length > 0;

  function updateParam(key: string, value: string | null) {
    startTransition(() => {
      const params = new URLSearchParams(searchParams.toString());
      if (value) {
        params.set(key, value);
      } else {
        params.delete(key);
      }
      router.replace(`/?${params.toString()}`);
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
      router.replace(`/?${params.toString()}`);
    });
  }

  function clearFilters() {
    startTransition(() => {
      const params = new URLSearchParams(searchParams.toString());
      params.delete("source");
      params.delete("entity");
      params.delete("minConf");
      params.delete("maxConf");
      params.delete("permanence");
      params.delete("unused");
      params.delete("review");
      params.delete("sort");
      router.replace(`/?${params.toString()}`);
    });
  }

  const selectClass =
    "w-full px-2.5 py-1.5 text-xs bg-[var(--bg-soft)] border border-[var(--border)] rounded-md text-[var(--text-muted)] cursor-pointer focus:outline-none focus:ring-1 focus:ring-[var(--accent-solid)]";

  const toggleClass = (active: boolean) =>
    clsx(
      "px-2.5 py-1 rounded-md transition-colors cursor-pointer text-xs border",
      active
        ? "bg-[var(--accent-soft)] text-[var(--accent-strong)] border-[var(--accent-solid)] font-medium"
        : "text-[var(--text-dim)] border-[var(--border)] hover:text-[var(--text)] hover:bg-[var(--bg-soft)]",
    );

  return (
    <div className="text-xs">
      <button
        type="button"
        aria-expanded={open}
        aria-controls="memory-filters-panel"
        onClick={() => setOpen((v) => !v)}
        className={clsx(
          "inline-flex items-center gap-2 px-2.5 py-1.5 rounded-md border transition-colors cursor-pointer max-w-full",
          open || hasActiveFilters
            ? "border-[var(--accent-solid)] text-[var(--text)]"
            : "border-[var(--border)] text-[var(--text-dim)] hover:text-[var(--text)]",
        )}
      >
        <SlidersHorizontal size={12} />
        <span className="font-medium">Filters</span>
        {hasActiveFilters ? (
          <span className="flex items-center gap-1 min-w-0 overflow-hidden">
            <span className="text-[var(--text-dim)]">·</span>
            <span className="truncate text-[var(--accent-strong)]">
              {summaryChips.slice(0, 3).join(" · ")}
              {summaryChips.length > 3 ? ` +${summaryChips.length - 3}` : ""}
            </span>
          </span>
        ) : (
          <span className="text-[var(--text-dim)]">·</span>
        )}
        <ChevronDown
          size={12}
          className={clsx(
            "transition-transform",
            open && "rotate-180",
          )}
        />
      </button>

      {open && (
        <div
          id="memory-filters-panel"
          className="relative mt-2 p-4 rounded-lg border border-[var(--border)] bg-[var(--surface)]"
        >
          {hasActiveFilters && (
            <button
              type="button"
              onClick={clearFilters}
              className="absolute top-3 right-3 px-2 py-1 text-xs text-[var(--danger)] hover:bg-[var(--danger-bg)] rounded-md transition-colors cursor-pointer"
            >
              Clear filters
            </button>
          )}

          <div className="grid gap-4 sm:grid-cols-2">
            {/* Sort */}
            <div>
              <div className="mb-1.5 text-[11px] uppercase tracking-wide text-[var(--text-dim)]">
                Sort
              </div>
              <div className="flex flex-wrap gap-1.5">
                {SORT_OPTIONS.map(({ value, label }) => (
                  <button
                    key={value}
                    type="button"
                    onClick={() =>
                      updateParam(
                        "sort",
                        value === "confidence" ? null : value,
                      )
                    }
                    className={toggleClass(activeSort === value)}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>

            {/* Confidence range */}
            <div>
              <div className="mb-1.5 text-[11px] uppercase tracking-wide text-[var(--text-dim)]">
                Confidence range
              </div>
              <div className="flex flex-wrap gap-1.5">
                {CONFIDENCE_PRESETS.map(({ value, label }) => (
                  <button
                    key={value || "any"}
                    type="button"
                    onClick={() => setConfidencePreset(value)}
                    className={toggleClass(activeConfPreset === value)}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>

            {/* Source */}
            {sourceTypes.length > 1 && (
              <div>
                <label
                  htmlFor="filter-source"
                  className="mb-1.5 block text-[11px] uppercase tracking-wide text-[var(--text-dim)]"
                >
                  Source
                </label>
                <select
                  id="filter-source"
                  value={activeSource}
                  onChange={(e) => updateParam("source", e.target.value || null)}
                  className={selectClass}
                >
                  <option value="">All sources</option>
                  {sourceTypes.map((st) => (
                    <option key={st} value={st}>
                      {st}
                    </option>
                  ))}
                </select>
              </div>
            )}

            {/* Entity type */}
            {entityTypes.length > 0 && (
              <div>
                <label
                  htmlFor="filter-entity"
                  className="mb-1.5 block text-[11px] uppercase tracking-wide text-[var(--text-dim)]"
                >
                  Entity type
                </label>
                <select
                  id="filter-entity"
                  value={activeEntity}
                  onChange={(e) => updateParam("entity", e.target.value || null)}
                  className={selectClass}
                >
                  <option value="">All types</option>
                  {entityTypes.map((et) => (
                    <option key={et} value={et}>
                      {et}
                    </option>
                  ))}
                </select>
              </div>
            )}

            {/* Tier */}
            <div>
              <label
                htmlFor="filter-permanence"
                className="mb-1.5 block text-[11px] uppercase tracking-wide text-[var(--text-dim)]"
              >
                Tier
              </label>
              <select
                id="filter-permanence"
                value={activePermanence}
                onChange={(e) => updateParam("permanence", e.target.value || null)}
                className={selectClass}
              >
                {PERMANENCE_OPTIONS.map(({ value, label }) => (
                  <option key={value || "any"} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </div>

            {/* Quick filters */}
            <div>
              <div className="mb-1.5 text-[11px] uppercase tracking-wide text-[var(--text-dim)]">
                Quick filters
              </div>
              <div className="flex flex-wrap gap-1.5">
                <button
                  type="button"
                  onClick={() => updateParam("unused", activeUnused ? null : "1")}
                  className={clsx(
                    "px-2.5 py-1 rounded-md text-xs border transition-colors cursor-pointer",
                    activeUnused
                      ? "bg-[var(--warning-bg)] text-[var(--warning)] border-[var(--warning)] font-medium"
                      : "text-[var(--text-dim)] border-[var(--border)] hover:text-[var(--text)] hover:bg-[var(--bg-soft)]",
                  )}
                >
                  Unused
                </button>
                <button
                  type="button"
                  onClick={() => updateParam("review", activeReview ? null : "1")}
                  className={toggleClass(activeReview)}
                >
                  Needs review
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

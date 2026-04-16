"use client";

import { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import clsx from "clsx";
import { Archive, RotateCcw, Search, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { StatusBadge } from "@/components/ui/status-badge";
import { ConfidenceBar } from "@/components/confidence-bar";
import { restoreMemoryAction, bulkRestoreAction } from "@/lib/actions";
import { formatDate } from "@/lib/utils";
import type { MemoryRow } from "@/lib/db";

const SORT_OPTIONS = [
  { value: "archived", label: "Recently Archived" },
  { value: "confidence", label: "Confidence" },
  { value: "learned", label: "Oldest" },
] as const;

export function ArchiveClient({ memories }: { memories: MemoryRow[] }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState(searchParams.get("q") ?? "");

  const activeSort = searchParams.get("sort") ?? "archived";

  function updateParam(key: string, value: string | null) {
    const params = new URLSearchParams(searchParams.toString());
    if (value) {
      params.set(key, value);
    } else {
      params.delete(key);
    }
    router.push(`/archive?${params.toString()}`);
  }

  function handleSearch(e: React.FormEvent) {
    e.preventDefault();
    updateParam("q", search.trim() || null);
  }

  function toggleSelect(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function selectAll() {
    if (selected.size === memories.length) {
      setSelected(new Set());
    } else {
      setSelected(new Set(memories.map((m) => m.id)));
    }
  }

  async function handleRestore(id: string) {
    setLoading(true);
    try {
      await restoreMemoryAction(id);
      router.refresh();
    } finally {
      setLoading(false);
    }
  }

  async function handleBulkRestore() {
    if (selected.size === 0) return;
    setLoading(true);
    try {
      await bulkRestoreAction([...selected]);
      setSelected(new Set());
      router.refresh();
    } finally {
      setLoading(false);
    }
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-[var(--text)] flex items-center gap-2">
            <Archive size={24} />
            Archive
          </h1>
          <p className="text-sm mt-1 text-[var(--text-muted)]">
            {memories.length} archived {memories.length === 1 ? "memory" : "memories"}
          </p>
        </div>
        {selected.size > 0 && (
          <Button onClick={handleBulkRestore} disabled={loading}>
            {loading ? (
              <>
                <Loader2 size={14} className="animate-spin mr-1.5" />
                Restoring...
              </>
            ) : (
              <>
                <RotateCcw size={14} className="mr-1.5" />
                Restore {selected.size} {selected.size === 1 ? "memory" : "memories"}
              </>
            )}
          </Button>
        )}
      </div>

      {/* Search + Sort */}
      <div className="flex items-center gap-3 flex-wrap mb-4">
        <form onSubmit={handleSearch} className="flex-1 min-w-[200px] max-w-sm">
          <div className="relative">
            <Search
              size={14}
              className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-dim)]"
            />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search archive..."
              className="w-full pl-9 pr-3 py-2 text-sm bg-[var(--bg-soft)] border border-[var(--border)] rounded-lg placeholder:text-[var(--text-dim)] focus:outline-none focus:ring-2 focus:ring-[var(--accent-solid)]"
            />
          </div>
        </form>

        <div className="flex items-center gap-1.5 text-xs">
          {SORT_OPTIONS.map(({ value, label }) => (
            <button
              key={value}
              onClick={() => updateParam("sort", value === "archived" ? null : value)}
              className={clsx(
                "px-2 py-1 rounded-md transition-colors cursor-pointer",
                activeSort === value
                  ? "bg-[var(--accent-soft)] text-[var(--accent-strong)] font-medium"
                  : "text-[var(--text-dim)] hover:text-[var(--text)] hover:bg-[var(--bg-soft)]",
              )}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {memories.length === 0 ? (
        <Card className="p-8 text-center">
          <Archive
            size={40}
            className="mx-auto mb-3 text-[var(--text-dim)]"
          />
          <p className="text-lg font-medium text-[var(--text)]">
            {searchParams.get("q") ? "No matching archived memories" : "Archive is empty"}
          </p>
          <p className="text-sm mt-1 text-[var(--text-dim)]">
            {searchParams.get("q")
              ? "Try a different search term."
              : "Archived memories will appear here. Use the Archive button on any memory to move it here."}
          </p>
        </Card>
      ) : (
        <>
          {/* Select all */}
          <div className="flex items-center gap-2 mb-3">
            <button
              onClick={selectAll}
              className="text-xs text-[var(--text-dim)] hover:text-[var(--text)] cursor-pointer"
            >
              {selected.size === memories.length ? "Deselect all" : "Select all"}
            </button>
          </div>

          <div className="flex flex-col gap-3">
            {memories.map((memory) => (
              <Card
                key={memory.id}
                className={clsx(
                  "p-4 transition-colors",
                  selected.has(memory.id) && "ring-1 ring-[var(--accent)]",
                )}
              >
                <div className="flex items-start gap-3">
                  <input
                    type="checkbox"
                    checked={selected.has(memory.id)}
                    onChange={() => toggleSelect(memory.id)}
                    className="mt-1 accent-[var(--accent)]"
                  />
                  <div className="flex-1 min-w-0">
                    <Link
                      href={`/memory/${memory.id}`}
                      className="text-sm font-medium text-[var(--text)] hover:text-[var(--accent-strong)] line-clamp-2"
                    >
                      {memory.content}
                    </Link>
                    {memory.detail && (
                      <p className="text-xs text-[var(--text-muted)] mt-1 line-clamp-1">
                        {memory.detail}
                      </p>
                    )}
                    <div className="flex items-center gap-2 mt-2 flex-wrap">
                      <StatusBadge variant="accent">{memory.domain}</StatusBadge>
                      {memory.entity_type && (
                        <StatusBadge variant="neutral">{memory.entity_type}</StatusBadge>
                      )}
                      <span className="text-xs text-[var(--text-dim)]">
                        Archived {memory.archived_at ? formatDate(memory.archived_at) : ""}
                      </span>
                    </div>
                    <div className="max-w-[200px] mt-2">
                      <ConfidenceBar confidence={memory.confidence} />
                    </div>
                  </div>
                  <Button
                    variant="secondary"
                    size="sm"
                    disabled={loading}
                    onClick={() => handleRestore(memory.id)}
                  >
                    <RotateCcw size={13} className="mr-1" />
                    Restore
                  </Button>
                </div>
              </Card>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

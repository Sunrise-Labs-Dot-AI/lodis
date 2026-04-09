"use client";

import { useState } from "react";
import { Button } from "../../components/ui/button";
import { Card } from "../../components/ui/card";
import { StatusBadge } from "../../components/ui/status-badge";
import {
  scanCleanupAction,
  expandSuggestionAction,
  applyMergeSuggestionAction,
  applySplitSuggestionAction,
  deleteMemoryAction,
  confirmMemoryAction,
} from "../../lib/actions";
import type { CleanupSuggestion } from "../../lib/cleanup";
import { Search, CheckCircle, Loader2, ChevronDown } from "lucide-react";

const TYPE_LABELS: Record<CleanupSuggestion["type"], string> = {
  merge: "Duplicate",
  split: "Needs Split",
  contradiction: "Possible Conflict",
  stale: "Stale",
  update: "May Be Outdated",
};

const TYPE_BADGE_VARIANT: Record<
  CleanupSuggestion["type"],
  "accent" | "warning" | "danger" | "neutral" | "success"
> = {
  merge: "accent",
  split: "warning",
  contradiction: "danger",
  stale: "neutral",
  update: "success",
};

export function CleanupClient() {
  const [suggestions, setSuggestions] = useState<CleanupSuggestion[]>([]);
  const [scanning, setScanning] = useState(false);
  const [hasScanned, setHasScanned] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expandingIndex, setExpandingIndex] = useState<number | null>(null);
  const [applyingIndex, setApplyingIndex] = useState<number | null>(null);

  async function handleScan() {
    setScanning(true);
    setError(null);
    try {
      const result = await scanCleanupAction();
      if ("error" in result) {
        setError(result.error);
      } else {
        setSuggestions(result.suggestions);
      }
      setHasScanned(true);
    } catch {
      setError("Scan failed unexpectedly");
    } finally {
      setScanning(false);
    }
  }

  function dismiss(index: number) {
    setSuggestions((prev) => prev.filter((_, i) => i !== index));
  }

  function updateSuggestion(index: number, updated: CleanupSuggestion) {
    setSuggestions((prev) => prev.map((s, i) => (i === index ? updated : s)));
  }

  async function handleExpand(index: number) {
    const suggestion = suggestions[index];
    if (suggestion.expanded) return;
    setExpandingIndex(index);
    try {
      const result = await expandSuggestionAction(suggestion);
      if ("error" in result) {
        setError(result.error);
      } else {
        updateSuggestion(index, result.suggestion);
      }
    } catch {
      setError("Failed to expand suggestion");
    } finally {
      setExpandingIndex(null);
    }
  }

  async function applyMerge(suggestion: CleanupSuggestion, index: number) {
    if (!suggestion.keepId) return;
    setApplyingIndex(index);
    try {
      const deleteIds = suggestion.memoryIds.filter(
        (id) => id !== suggestion.keepId,
      );
      await applyMergeSuggestionAction(suggestion.keepId, deleteIds);
      dismiss(index);
    } finally {
      setApplyingIndex(null);
    }
  }

  async function applySplit(suggestion: CleanupSuggestion, index: number) {
    if (!suggestion.parts || suggestion.parts.length < 2) return;
    setApplyingIndex(index);
    try {
      await applySplitSuggestionAction(suggestion.memoryIds[0], suggestion.parts);
      dismiss(index);
    } finally {
      setApplyingIndex(null);
    }
  }

  async function applyStaleConfirm(suggestion: CleanupSuggestion, index: number) {
    setApplyingIndex(index);
    try {
      await confirmMemoryAction(suggestion.memoryIds[0]);
      dismiss(index);
    } finally {
      setApplyingIndex(null);
    }
  }

  async function applyDelete(suggestion: CleanupSuggestion, index: number) {
    setApplyingIndex(index);
    try {
      await deleteMemoryAction(suggestion.memoryIds[0]);
      dismiss(index);
    } finally {
      setApplyingIndex(null);
    }
  }

  async function applyContradictionKeep(
    suggestion: CleanupSuggestion,
    keepId: string,
    index: number,
  ) {
    setApplyingIndex(index);
    try {
      const deleteIds = suggestion.memoryIds.filter((id) => id !== keepId);
      for (const id of deleteIds) {
        await deleteMemoryAction(id);
      }
      dismiss(index);
    } finally {
      setApplyingIndex(null);
    }
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1
            className="text-2xl font-bold"
            style={{ color: "var(--color-text)" }}
          >
            Cleanup
          </h1>
          <p
            className="text-sm mt-1"
            style={{ color: "var(--color-text-secondary)" }}
          >
            Scan for duplicates, conflicts, and stale entries
          </p>
        </div>
        <div className="flex items-center gap-3">
          {hasScanned && suggestions.length > 0 && (
            <span
              className="text-sm font-medium"
              style={{ color: "var(--color-text-muted)" }}
            >
              {suggestions.length} suggestion{suggestions.length !== 1 && "s"}
            </span>
          )}
          <Button onClick={handleScan} disabled={scanning}>
            {scanning ? (
              <>
                <Loader2 size={16} className="animate-spin mr-1.5" />
                Scanning...
              </>
            ) : (
              <>
                <Search size={16} className="mr-1.5" />
                Scan
              </>
            )}
          </Button>
        </div>
      </div>

      {error && (
        <Card className="p-4 mb-4 border-[var(--color-danger)]">
          <p style={{ color: "var(--color-danger)" }}>{error}</p>
        </Card>
      )}

      {hasScanned && !scanning && suggestions.length === 0 && !error && (
        <Card className="p-8 text-center">
          <CheckCircle
            size={40}
            className="mx-auto mb-3"
            style={{ color: "var(--color-success)" }}
          />
          <p
            className="text-lg font-medium"
            style={{ color: "var(--color-text)" }}
          >
            No suggestions
          </p>
          <p
            className="text-sm mt-1"
            style={{ color: "var(--color-text-muted)" }}
          >
            Your memory store looks clean!
          </p>
        </Card>
      )}

      <div className="flex flex-col gap-4">
        {suggestions.map((suggestion, index) => (
          <SuggestionCard
            key={`${suggestion.type}-${suggestion.memoryIds.join("-")}-${index}`}
            suggestion={suggestion}
            index={index}
            expanding={expandingIndex === index}
            applying={applyingIndex === index}
            onDismiss={() => dismiss(index)}
            onExpand={() => handleExpand(index)}
            onApplyMerge={() => applyMerge(suggestion, index)}
            onApplySplit={() => applySplit(suggestion, index)}
            onStaleConfirm={() => applyStaleConfirm(suggestion, index)}
            onDelete={() => applyDelete(suggestion, index)}
            onContradictionKeep={(keepId: string) =>
              applyContradictionKeep(suggestion, keepId, index)
            }
          />
        ))}
      </div>
    </div>
  );
}

function SuggestionCard({
  suggestion,
  index,
  expanding,
  applying,
  onDismiss,
  onExpand,
  onApplyMerge,
  onApplySplit,
  onStaleConfirm,
  onDelete,
  onContradictionKeep,
}: {
  suggestion: CleanupSuggestion;
  index: number;
  expanding: boolean;
  applying: boolean;
  onDismiss: () => void;
  onExpand: () => void;
  onApplyMerge: () => void;
  onApplySplit: () => void;
  onStaleConfirm: () => void;
  onDelete: () => void;
  onContradictionKeep: (keepId: string) => void;
}) {
  const needsExpand = !suggestion.expanded;

  return (
    <Card className="p-4">
      <div className="flex items-start justify-between mb-3">
        <div className="flex items-center gap-2 flex-wrap">
          <StatusBadge variant={TYPE_BADGE_VARIANT[suggestion.type]}>
            {TYPE_LABELS[suggestion.type]}
          </StatusBadge>
          <span
            className="text-sm"
            style={{ color: "var(--color-text-secondary)" }}
          >
            {suggestion.description}
          </span>
        </div>
        <Button
          variant="ghost"
          size="sm"
          onClick={onDismiss}
          disabled={applying}
        >
          Dismiss
        </Button>
      </div>

      {/* Show memory previews */}
      {suggestion.memories && suggestion.memories.length > 0 && (
        <div className="flex flex-col gap-1.5 mb-3">
          {suggestion.memories.map((m) => (
            <div
              key={m.id}
              className="text-sm px-3 py-2 rounded"
              style={{
                background: "var(--color-bg-soft)",
                color: "var(--color-text)",
              }}
            >
              <span className="line-clamp-2">{m.content}</span>
              <span
                className="text-xs font-mono ml-2"
                style={{ color: "var(--color-text-muted)" }}
              >
                {m.id.slice(0, 8)}
              </span>
            </div>
          ))}
        </div>
      )}

      {/* Expand button for suggestions that need LLM */}
      {needsExpand && (
        <Button
          size="sm"
          variant="secondary"
          onClick={onExpand}
          disabled={expanding}
        >
          {expanding ? (
            <>
              <Loader2 size={14} className="animate-spin mr-1.5" />
              Analyzing...
            </>
          ) : (
            <>
              <ChevronDown size={14} className="mr-1.5" />
              Expand
            </>
          )}
        </Button>
      )}

      {/* Expanded action UIs */}
      {suggestion.expanded && suggestion.type === "merge" && (
        <MergeDetail
          suggestion={suggestion}
          applying={applying}
          onApply={onApplyMerge}
        />
      )}
      {suggestion.expanded && suggestion.type === "split" && suggestion.parts && (
        <SplitDetail
          suggestion={suggestion}
          applying={applying}
          onApply={onApplySplit}
        />
      )}
      {suggestion.expanded && suggestion.type === "contradiction" && suggestion.conflicts && (
        <ContradictionDetail
          suggestion={suggestion}
          applying={applying}
          onKeep={onContradictionKeep}
        />
      )}
      {suggestion.expanded && suggestion.type === "stale" && (
        <StaleDetail
          applying={applying}
          onConfirm={onStaleConfirm}
          onDelete={onDelete}
        />
      )}
      {suggestion.expanded && suggestion.type === "update" && (
        <UpdateDetail applying={applying} onDelete={onDelete} />
      )}
    </Card>
  );
}

function MergeDetail({
  suggestion,
  applying,
  onApply,
}: {
  suggestion: CleanupSuggestion;
  applying: boolean;
  onApply: () => void;
}) {
  return (
    <div className="mt-2">
      <div className="flex flex-wrap gap-2 mb-3">
        {suggestion.memories?.map((m) => (
          <div
            key={m.id}
            className="text-xs px-2 py-1 rounded border"
            style={{
              background:
                m.id === suggestion.keepId
                  ? "var(--color-success-bg)"
                  : "var(--color-bg-soft)",
              borderColor:
                m.id === suggestion.keepId
                  ? "var(--color-success)"
                  : "var(--color-border)",
              color:
                m.id === suggestion.keepId
                  ? "var(--color-success)"
                  : "var(--color-text-secondary)",
            }}
          >
            {m.id.slice(0, 12)}...
            {m.id === suggestion.keepId && " (keep)"}
          </div>
        ))}
      </div>
      <Button size="sm" onClick={onApply} disabled={applying}>
        {applying ? "Merging..." : "Merge"}
      </Button>
    </div>
  );
}

function SplitDetail({
  suggestion,
  applying,
  onApply,
}: {
  suggestion: CleanupSuggestion;
  applying: boolean;
  onApply: () => void;
}) {
  return (
    <div className="mt-2">
      <div className="flex flex-col gap-2 mb-3">
        {suggestion.parts?.map((part, i) => (
          <div
            key={i}
            className="text-sm p-2 rounded border"
            style={{
              background: "var(--color-bg-soft)",
              borderColor: "var(--color-border)",
              color: "var(--color-text)",
            }}
          >
            <span className="font-medium">Part {i + 1}:</span> {part.content}
            {part.detail && (
              <p
                className="text-xs mt-0.5"
                style={{ color: "var(--color-text-muted)" }}
              >
                {part.detail}
              </p>
            )}
          </div>
        ))}
      </div>
      <Button size="sm" onClick={onApply} disabled={applying}>
        {applying ? "Splitting..." : "Split"}
      </Button>
    </div>
  );
}

function ContradictionDetail({
  suggestion,
  applying,
  onKeep,
}: {
  suggestion: CleanupSuggestion;
  applying: boolean;
  onKeep: (keepId: string) => void;
}) {
  return (
    <div className="mt-2">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {suggestion.conflicts?.map((conflict) => (
          <div
            key={conflict.id}
            className="p-3 rounded border"
            style={{
              background: "var(--color-bg-soft)",
              borderColor: "var(--color-border)",
            }}
          >
            <p className="text-sm mb-2" style={{ color: "var(--color-text)" }}>
              {conflict.statement}
            </p>
            <div className="flex items-center justify-between">
              <span
                className="text-xs font-mono"
                style={{ color: "var(--color-text-muted)" }}
              >
                {conflict.id.slice(0, 12)}...
              </span>
              <Button
                size="sm"
                variant="secondary"
                onClick={() => onKeep(conflict.id)}
                disabled={applying}
              >
                Keep this
              </Button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function StaleDetail({
  applying,
  onConfirm,
  onDelete,
}: {
  applying: boolean;
  onConfirm: () => void;
  onDelete: () => void;
}) {
  return (
    <div className="flex items-center gap-2 mt-2">
      <Button size="sm" variant="secondary" onClick={onConfirm} disabled={applying}>
        {applying ? "..." : "Confirm"}
      </Button>
      <Button size="sm" variant="danger" onClick={onDelete} disabled={applying}>
        {applying ? "..." : "Delete"}
      </Button>
    </div>
  );
}

function UpdateDetail({
  applying,
  onDelete,
}: {
  applying: boolean;
  onDelete: () => void;
}) {
  return (
    <div className="flex items-center gap-2 mt-2">
      <Button size="sm" variant="danger" onClick={onDelete} disabled={applying}>
        {applying ? "..." : "Delete"}
      </Button>
    </div>
  );
}

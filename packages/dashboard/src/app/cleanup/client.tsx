"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { Button } from "../../components/ui/button";
import { Card } from "../../components/ui/card";
import { StatusBadge } from "../../components/ui/status-badge";
import {
  scanCleanupAction,
  dismissSuggestionAction,
  expandSuggestionAction,
  applyMergeSuggestionAction,
  applySplitSuggestionAction,
  deleteMemoryAction,
  confirmMemoryAction,
  flagMemoryAction,
  correctMemoryAction,
  scrubMemoryAction,
  pinMemoryAction,
  archiveMemoryAction,
  resolveWithMessageAction,
} from "../../lib/actions";
import type { CleanupSuggestion, HealthScore } from "../../lib/cleanup";
import {
  Search,
  CheckCircle,
  Loader2,
  ChevronDown,
  Shield,
  Zap,
  Pencil,
  AlertTriangle,
  Trash2,
  ShieldAlert,
  ExternalLink,
  Star,
  Archive,
  Clock,
  MessageSquare,
  Send,
} from "lucide-react";
import { confidenceColor, formatConfidence } from "../../lib/utils";

// --- Constants ---

const TYPE_LABELS: Record<CleanupSuggestion["type"], string> = {
  pii: "Sensitive Data",
  merge: "Duplicate",
  split: "Needs Split",
  contradiction: "Possible Conflict",
  stale: "Stale",
  update: "May Be Outdated",
  promote: "Promote to Canonical",
  expired: "Expired",
  stale_project: "Stale Project",
};

const TYPE_BADGE_VARIANT: Record<
  CleanupSuggestion["type"],
  "accent" | "warning" | "danger" | "neutral" | "success"
> = {
  pii: "danger",
  merge: "accent",
  split: "warning",
  contradiction: "danger",
  stale: "neutral",
  update: "success",
  promote: "success",
  expired: "warning",
  stale_project: "neutral",
};

// --- Health Score ---

function healthColor(score: number): string {
  if (score >= 80) return "var(--color-success)";
  if (score >= 60) return "var(--color-accent)";
  if (score >= 40) return "var(--color-warning)";
  return "var(--color-danger)";
}

function healthLabel(score: number): string {
  if (score >= 90) return "Great";
  if (score >= 70) return "Good";
  if (score >= 50) return "Fair";
  if (score >= 30) return "Poor";
  return "Critical";
}

function HealthFactorRow({
  factor,
  compact,
}: {
  factor: { name: string; score: number; detail: string };
  compact?: boolean;
}) {
  const color = healthColor(factor.score);
  const barWidth = factor.score === 0 ? 3 : factor.score;

  return (
    <div>
      <div className="flex items-center justify-between mb-0.5">
        <div className="flex items-center gap-1.5">
          <span
            className="text-xs font-medium"
            style={{
              color: factor.score < 80 ? color : "var(--color-text-secondary)",
            }}
          >
            {factor.name}
          </span>
          {!compact && factor.score < 40 && (
            <span
              className="text-[10px] px-1.5 py-0.5 rounded-full font-medium"
              style={{
                background: "var(--color-danger-bg)",
                color: "var(--color-danger)",
              }}
            >
              {factor.score === 0 ? "Critical" : "Low"}
            </span>
          )}
        </div>
        <span className="text-xs" style={{ color: "var(--color-text-muted)" }}>
          {factor.detail}
        </span>
      </div>
      <div
        className={`${compact ? "h-1" : "h-1.5"} rounded-full overflow-hidden`}
        style={{ background: "var(--color-bg-soft)" }}
      >
        <div
          className="h-full rounded-full transition-all duration-500"
          style={{ width: `${barWidth}%`, background: color }}
        />
      </div>
    </div>
  );
}

function HealthScoreCard({ health }: { health: HealthScore }) {
  const sortedFactors = [...health.factors].sort((a, b) => a.score - b.score);
  const problemFactors = sortedFactors.filter((f) => f.score < 80);
  const goodFactors = sortedFactors.filter((f) => f.score >= 80);

  return (
    <Card className="p-6 mb-6">
      <div className="flex items-start gap-6">
        <div className="flex-shrink-0 flex flex-col items-center">
          <div
            className="w-20 h-20 rounded-full flex items-center justify-center border-4"
            style={{ borderColor: healthColor(health.overall) }}
          >
            <span
              className="text-2xl font-bold"
              style={{ color: healthColor(health.overall) }}
            >
              {health.overall}
            </span>
          </div>
          <span
            className="text-xs font-medium mt-1.5"
            style={{ color: healthColor(health.overall) }}
          >
            {healthLabel(health.overall)}
          </span>
          <span
            className="text-xs mt-0.5"
            style={{ color: "var(--color-text-muted)" }}
          >
            {health.totalMemories} memories
          </span>
        </div>

        <div className="flex-1 min-w-0">
          {problemFactors.length > 0 && (
            <div className="mb-3">
              <h3
                className="text-xs font-medium mb-2"
                style={{ color: "var(--color-text-muted)" }}
              >
                Needs attention
              </h3>
              <div className="flex flex-col gap-2.5">
                {problemFactors.map((f) => (
                  <HealthFactorRow key={f.name} factor={f} />
                ))}
              </div>
            </div>
          )}

          {goodFactors.length > 0 && (
            <div>
              {problemFactors.length > 0 && (
                <h3
                  className="text-xs font-medium mb-2 mt-3"
                  style={{ color: "var(--color-text-muted)" }}
                >
                  Looking good
                </h3>
              )}
              <div className="flex flex-col gap-2">
                {goodFactors.map((f) => (
                  <HealthFactorRow key={f.name} factor={f} compact />
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      {(health.autoHandled.temporalDegraded > 0 ||
        health.autoHandled.staleDegrading > 0) && (
        <div
          className="mt-4 pt-4 flex items-start gap-2 text-xs"
          style={{
            borderTop: "1px solid var(--color-border)",
            color: "var(--color-text-muted)",
          }}
        >
          <Zap
            size={14}
            className="flex-shrink-0 mt-0.5"
            style={{ color: "var(--color-accent)" }}
          />
          <span>{health.autoHandled.description}</span>
        </div>
      )}
    </Card>
  );
}

// --- Memory Mini Card ---

type SuggestionMemory = NonNullable<CleanupSuggestion["memories"]>[number];

function MemoryMiniCard({
  memory,
  highlight,
  label,
}: {
  memory: SuggestionMemory;
  highlight?: boolean;
  label?: string;
}) {
  const confColor = confidenceColor(memory.confidence);
  return (
    <div
      className="text-sm px-3 py-2.5 rounded border"
      style={{
        background: highlight
          ? "var(--color-success-bg)"
          : "var(--color-bg-soft)",
        borderColor: highlight
          ? "var(--color-success)"
          : "var(--color-border)",
      }}
    >
      <div className="flex items-start justify-between gap-2">
        <span className="line-clamp-2" style={{ color: "var(--color-text)" }}>
          {memory.content}
        </span>
        <Link
          href={`/memory/${memory.id}`}
          className="flex-shrink-0 mt-0.5 hover:opacity-80"
          style={{ color: "var(--color-text-muted)" }}
        >
          <ExternalLink size={12} />
        </Link>
      </div>
      <div className="flex items-center gap-2 mt-1.5 flex-wrap">
        {label && (
          <span
            className="text-[10px] font-medium px-1.5 py-0.5 rounded"
            style={{
              background: "var(--color-success-bg)",
              color: "var(--color-success)",
            }}
          >
            {label}
          </span>
        )}
        <StatusBadge variant="accent">{memory.domain}</StatusBadge>
        {memory.entity_type && (
          <StatusBadge variant="neutral">{memory.entity_type}</StatusBadge>
        )}
        <span
          className="text-[10px] font-medium tabular-nums"
          style={{ color: confColor }}
        >
          {formatConfidence(memory.confidence)}
        </span>
        <span
          className="text-[10px] font-mono"
          style={{ color: "var(--color-text-muted)" }}
        >
          {memory.id.slice(0, 8)}
        </span>
      </div>
    </div>
  );
}

// --- Inline Correction ---

function InlineCorrection({
  memoryId,
  onSubmit,
  onCancel,
  loading,
}: {
  memoryId: string;
  onSubmit: (memoryId: string, feedback: string) => void;
  onCancel: () => void;
  loading: boolean;
}) {
  const [text, setText] = useState("");
  return (
    <div
      className="mt-2 p-3 rounded border"
      style={{
        background: "var(--color-bg-soft)",
        borderColor: "var(--color-border)",
      }}
    >
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="Describe what's wrong or what should change..."
        rows={2}
        className="w-full p-2 text-sm bg-[var(--color-card)] border border-[var(--color-border)] rounded placeholder:text-[var(--color-text-muted)] focus:outline-none focus:ring-2 focus:ring-[var(--color-accent-solid)] resize-none"
      />
      <div className="flex justify-end gap-2 mt-2">
        <Button variant="ghost" size="sm" onClick={onCancel} disabled={loading}>
          Cancel
        </Button>
        <Button
          size="sm"
          disabled={!text.trim() || loading}
          onClick={() => onSubmit(memoryId, text.trim())}
        >
          {loading ? "Applying..." : "Apply Correction"}
        </Button>
      </div>
    </div>
  );
}

// --- Memory Action Bar ---

function MemoryActionBar({
  memoryId,
  showConfirm,
  showCorrect,
  showFlag,
  showDelete,
  showScrub,
  loading,
  correctingId,
  onConfirm,
  onCorrectToggle,
  onFlag,
  onDelete,
  onScrub,
}: {
  memoryId: string;
  showConfirm?: boolean;
  showCorrect?: boolean;
  showFlag?: boolean;
  showDelete?: boolean;
  showScrub?: boolean;
  loading: boolean;
  correctingId: string | null;
  onConfirm?: (id: string) => void;
  onCorrectToggle?: (id: string | null) => void;
  onFlag?: (id: string) => void;
  onDelete?: (id: string) => void;
  onScrub?: (id: string) => void;
}) {
  const isCorrectingThis = correctingId === memoryId;
  return (
    <div className="flex items-center gap-1 mt-1.5">
      {showConfirm && onConfirm && (
        <Button
          variant="ghost"
          size="sm"
          disabled={loading}
          onClick={() => onConfirm(memoryId)}
        >
          <CheckCircle size={13} className="mr-1" />
          Confirm
        </Button>
      )}
      {showCorrect && onCorrectToggle && (
        <Button
          variant="ghost"
          size="sm"
          disabled={loading}
          onClick={() =>
            onCorrectToggle(isCorrectingThis ? null : memoryId)
          }
        >
          <Pencil size={13} className="mr-1" />
          {isCorrectingThis ? "Cancel" : "Correct"}
        </Button>
      )}
      {showFlag && onFlag && (
        <Button
          variant="ghost"
          size="sm"
          disabled={loading}
          onClick={() => onFlag(memoryId)}
        >
          <AlertTriangle size={13} className="mr-1" />
          Flag
        </Button>
      )}
      {showScrub && onScrub && (
        <Button
          variant="ghost"
          size="sm"
          disabled={loading}
          onClick={() => onScrub(memoryId)}
        >
          <ShieldAlert size={13} className="mr-1" />
          Redact
        </Button>
      )}
      {showDelete && onDelete && (
        <Button
          variant="ghost"
          size="sm"
          disabled={loading}
          onClick={() => onDelete(memoryId)}
          className="text-[var(--color-danger)] hover:text-[var(--color-danger)]"
        >
          <Trash2 size={13} className="mr-1" />
          Delete
        </Button>
      )}
    </div>
  );
}

// --- Resolved State ---

function ResolvedCard({
  action,
  memory,
  onDismiss,
}: {
  action: string;
  memory?: { content: string; detail: string | null };
  onDismiss: () => void;
}) {
  useEffect(() => {
    const timer = setTimeout(onDismiss, 3000);
    return () => clearTimeout(timer);
  }, [onDismiss]);

  return (
    <Card className="p-4">
      <div className="flex items-start gap-3">
        <CheckCircle
          size={18}
          className="flex-shrink-0 mt-0.5"
          style={{ color: "var(--color-success)" }}
        />
        <div className="flex-1 min-w-0">
          <p
            className="text-sm font-medium"
            style={{ color: "var(--color-success)" }}
          >
            {action}
          </p>
          {memory && (
            <div
              className="mt-2 text-sm p-2.5 rounded"
              style={{
                background: "var(--color-bg-soft)",
                color: "var(--color-text)",
              }}
            >
              <p className="line-clamp-3">{memory.content}</p>
              {memory.detail && (
                <p
                  className="text-xs mt-1"
                  style={{ color: "var(--color-text-muted)" }}
                >
                  {memory.detail}
                </p>
              )}
            </div>
          )}
        </div>
        <Button variant="ghost" size="sm" onClick={onDismiss}>
          Dismiss
        </Button>
      </div>
    </Card>
  );
}

// --- Main Component ---

interface ResolvedState {
  action: string;
  memory?: { content: string; detail: string | null };
}

export function CleanupClient() {
  const [actionable, setActionable] = useState<CleanupSuggestion[]>([]);
  const [health, setHealth] = useState<HealthScore | null>(null);
  const [scanning, setScanning] = useState(false);
  const [hasScanned, setHasScanned] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expandingIndex, setExpandingIndex] = useState<number | null>(null);
  const [applyingIndex, setApplyingIndex] = useState<number | null>(null);
  const [correctingId, setCorrectingId] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [resolved, setResolved] = useState<Map<number, ResolvedState>>(
    new Map(),
  );

  useEffect(() => {
    handleScan(false);
  }, []);

  async function handleScan(forceRefresh = false) {
    setScanning(true);
    setError(null);
    try {
      const result = await scanCleanupAction(forceRefresh);
      if ("error" in result) {
        setError(result.error);
      } else {
        setHealth(result.health);
        setActionable(result.actionable);
        setResolved(new Map());
      }
      setHasScanned(true);
    } catch {
      setError("Scan failed unexpectedly");
    } finally {
      setScanning(false);
    }
  }

  const dismiss = useCallback((index: number) => {
    const suggestion = actionable[index];
    if (suggestion) {
      dismissSuggestionAction(suggestion.type, suggestion.memoryIds, "dismissed");
    }
    setActionable((prev) => prev.filter((_, i) => i !== index));
    setResolved((prev) => {
      const next = new Map(prev);
      next.delete(index);
      return next;
    });
  }, [actionable]);

  function resolve(index: number, action: string, memory?: { content: string; detail: string | null }) {
    const suggestion = actionable[index];
    if (suggestion) {
      dismissSuggestionAction(suggestion.type, suggestion.memoryIds, "resolved", action);
    }
    setResolved((prev) => new Map(prev).set(index, { action, memory }));
  }

  function updateSuggestion(index: number, updated: CleanupSuggestion) {
    setActionable((prev) => prev.map((s, i) => (i === index ? updated : s)));
  }

  async function handleExpand(index: number) {
    const suggestion = actionable[index];
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

  // --- Memory-level actions ---

  async function handleMemoryConfirm(memoryId: string, index: number) {
    setActionLoading(memoryId);
    try {
      const result = await confirmMemoryAction(memoryId);
      if (result) {
        resolve(index, "Confirmed — confidence set to 99%");
      }
    } catch {
      setError("Failed to confirm memory");
    } finally {
      setActionLoading(null);
    }
  }

  async function handleMemoryFlag(memoryId: string, index: number) {
    setActionLoading(memoryId);
    try {
      const result = await flagMemoryAction(memoryId);
      if (result) {
        resolve(index, `Flagged — confidence reduced to ${formatConfidence(result.newConfidence)}`);
      }
    } catch {
      setError("Failed to flag memory");
    } finally {
      setActionLoading(null);
    }
  }

  async function handleMemoryCorrect(
    memoryId: string,
    feedback: string,
    index: number,
  ) {
    setActionLoading(memoryId);
    try {
      const result = await correctMemoryAction(memoryId, feedback);
      if (result && "error" in result) {
        setError(result.error);
      } else if (result) {
        setCorrectingId(null);
        resolve(index, "Corrected", {
          content: result.content,
          detail: result.detail,
        });
      }
    } catch {
      setError("Failed to correct memory");
    } finally {
      setActionLoading(null);
    }
  }

  async function handleMemoryDelete(memoryId: string, index: number) {
    setActionLoading(memoryId);
    try {
      await deleteMemoryAction(memoryId);
      resolve(index, "Deleted");
    } catch {
      setError("Failed to delete memory");
    } finally {
      setActionLoading(null);
    }
  }

  async function handleMemoryPin(memoryId: string, index: number) {
    setActionLoading(memoryId);
    try {
      await pinMemoryAction(memoryId);
      resolve(index, "Pinned as canonical — decay-immune permanent knowledge");
    } catch {
      setError("Failed to pin memory");
    } finally {
      setActionLoading(null);
    }
  }

  async function handleMemoryArchive(memoryId: string, index: number) {
    setActionLoading(memoryId);
    try {
      await archiveMemoryAction(memoryId);
      resolve(index, "Archived — preserved but deprioritized in search");
    } catch {
      setError("Failed to archive memory");
    } finally {
      setActionLoading(null);
    }
  }

  async function handleMemoryScrub(memoryId: string, index: number) {
    setActionLoading(memoryId);
    try {
      const result = await scrubMemoryAction(memoryId);
      if (result.error) {
        setError(result.error);
      } else {
        resolve(index, "Redacted — sensitive data scrubbed from memory and event history", result.memory);
      }
    } catch {
      setError("Failed to redact memory");
    } finally {
      setActionLoading(null);
    }
  }

  // --- Suggestion-level actions ---

  async function applyMerge(suggestion: CleanupSuggestion, index: number) {
    if (!suggestion.keepId) return;
    setApplyingIndex(index);
    try {
      const deleteIds = suggestion.memoryIds.filter(
        (id) => id !== suggestion.keepId,
      );
      await applyMergeSuggestionAction(suggestion.keepId, deleteIds);
      resolve(index, `Merged — kept best version, removed ${deleteIds.length} duplicate${deleteIds.length > 1 ? "s" : ""}`);
    } finally {
      setApplyingIndex(null);
    }
  }

  async function applySplit(suggestion: CleanupSuggestion, index: number) {
    if (!suggestion.parts || suggestion.parts.length < 2) return;
    setApplyingIndex(index);
    try {
      await applySplitSuggestionAction(
        suggestion.memoryIds[0],
        suggestion.parts,
      );
      resolve(index, `Split into ${suggestion.parts.length} separate memories`);
    } finally {
      setApplyingIndex(null);
    }
  }

  async function handleResolveWithMessage(
    suggestion: CleanupSuggestion,
    message: string,
    index: number,
  ) {
    setApplyingIndex(index);
    setError(null);
    try {
      const result = await resolveWithMessageAction(suggestion.memoryIds, message);
      if ("error" in result && !("actions" in result)) {
        setError(result.error);
      } else {
        resolve(index, result.summary);
      }
    } catch {
      setError("Failed to resolve suggestion");
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
      resolve(index, "Resolved — kept selected version, removed conflicting memory");
    } finally {
      setApplyingIndex(null);
    }
  }

  const visibleActionable = actionable.filter((_, i) => !resolved.has(i));
  const resolvedEntries = [...resolved.entries()];

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1
            className="text-2xl font-bold"
            style={{ color: "var(--color-text)" }}
          >
            Memory Health
          </h1>
          <p
            className="text-sm mt-1"
            style={{ color: "var(--color-text-secondary)" }}
          >
            Monitor quality and resolve issues that need your input
          </p>
        </div>
        <Button onClick={() => handleScan(true)} disabled={scanning}>
          {scanning ? (
            <>
              <Loader2 size={16} className="animate-spin mr-1.5" />
              Scanning...
            </>
          ) : (
            <>
              <Search size={16} className="mr-1.5" />
              Re-scan
            </>
          )}
        </Button>
      </div>

      {error && (
        <Card className="p-4 mb-4 border-[var(--color-danger)]">
          <p style={{ color: "var(--color-danger)" }}>{error}</p>
        </Card>
      )}

      {health && <HealthScoreCard health={health} />}

      {/* Resolved items */}
      {resolvedEntries.length > 0 && (
        <div className="flex flex-col gap-3 mb-4">
          {resolvedEntries.map(([index, state]) => (
            <ResolvedCard
              key={`resolved-${index}`}
              action={state.action}
              memory={state.memory}
              onDismiss={() => dismiss(index)}
            />
          ))}
        </div>
      )}

      {/* All clear */}
      {hasScanned &&
        !scanning &&
        health &&
        visibleActionable.length === 0 &&
        resolvedEntries.length === 0 &&
        !error && (
          <Card className="p-8 text-center">
            <Shield
              size={40}
              className="mx-auto mb-3"
              style={{ color: "var(--color-success)" }}
            />
            <p
              className="text-lg font-medium"
              style={{ color: "var(--color-text)" }}
            >
              Nothing needs your attention
            </p>
            <p
              className="text-sm mt-1"
              style={{ color: "var(--color-text-muted)" }}
            >
              The system is handling routine maintenance automatically.
            </p>
          </Card>
        )}

      {/* Actionable items */}
      {visibleActionable.length > 0 && (
        <div className="mb-4">
          <h2
            className="text-sm font-medium mb-3"
            style={{ color: "var(--color-text-secondary)" }}
          >
            Needs your input ({visibleActionable.length})
          </h2>
          <div className="flex flex-col gap-4">
            {actionable.map((suggestion, index) => {
              if (resolved.has(index)) return null;
              return (
                <SuggestionCard
                  key={`${suggestion.type}-${suggestion.memoryIds.join("-")}-${index}`}
                  suggestion={suggestion}
                  index={index}
                  expanding={expandingIndex === index}
                  applying={applyingIndex === index}
                  actionLoading={actionLoading}
                  correctingId={correctingId}
                  onDismiss={() => dismiss(index)}
                  onExpand={() => handleExpand(index)}
                  onApplyMerge={() => applyMerge(suggestion, index)}
                  onApplySplit={() => applySplit(suggestion, index)}
                  onContradictionKeep={(keepId: string) =>
                    applyContradictionKeep(suggestion, keepId, index)
                  }
                  onMemoryConfirm={(id) => handleMemoryConfirm(id, index)}
                  onMemoryFlag={(id) => handleMemoryFlag(id, index)}
                  onMemoryCorrect={(id, fb) =>
                    handleMemoryCorrect(id, fb, index)
                  }
                  onMemoryDelete={(id) => handleMemoryDelete(id, index)}
                  onMemoryScrub={(id) => handleMemoryScrub(id, index)}
                  onMemoryPin={(id) => handleMemoryPin(id, index)}
                  onMemoryArchive={(id) => handleMemoryArchive(id, index)}
                  onCorrectToggle={setCorrectingId}
                  onResolve={(message: string) =>
                    handleResolveWithMessage(suggestion, message, index)
                  }
                />
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

// --- Suggestion Card ---

function SuggestionCard({
  suggestion,
  index,
  expanding,
  applying,
  actionLoading,
  correctingId,
  onDismiss,
  onExpand,
  onApplyMerge,
  onApplySplit,
  onContradictionKeep,
  onMemoryConfirm,
  onMemoryFlag,
  onMemoryCorrect,
  onMemoryDelete,
  onMemoryScrub,
  onMemoryPin,
  onMemoryArchive,
  onCorrectToggle,
  onResolve,
}: {
  suggestion: CleanupSuggestion;
  index: number;
  expanding: boolean;
  applying: boolean;
  actionLoading: string | null;
  correctingId: string | null;
  onDismiss: () => void;
  onExpand: () => void;
  onApplyMerge: () => void;
  onApplySplit: () => void;
  onContradictionKeep: (keepId: string) => void;
  onMemoryConfirm: (id: string) => void;
  onMemoryFlag: (id: string) => void;
  onMemoryCorrect: (id: string, feedback: string) => void;
  onMemoryDelete: (id: string) => void;
  onMemoryScrub: (id: string) => void;
  onMemoryPin: (id: string) => void;
  onMemoryArchive: (id: string) => void;
  onCorrectToggle: (id: string | null) => void;
  onResolve: (message: string) => void;
}) {
  const needsExpand = !suggestion.expanded;
  const isLoading = applying || actionLoading !== null;
  const [showResolve, setShowResolve] = useState(false);
  const [resolveText, setResolveText] = useState("");

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
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setShowResolve(!showResolve)}
            disabled={isLoading}
          >
            <MessageSquare size={14} className="mr-1" />
            Resolve
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={onDismiss}
            disabled={isLoading}
          >
            Dismiss
          </Button>
        </div>
      </div>

      {showResolve && (
        <div
          className="mb-3 p-3 rounded border"
          style={{ background: "var(--color-bg-soft)", borderColor: "var(--color-border)" }}
        >
          <textarea
            value={resolveText}
            onChange={(e) => setResolveText(e.target.value)}
            placeholder="Describe how to resolve this (e.g. 'both are true', 'delete the first one', 'merge them')..."
            rows={2}
            className="w-full p-2 text-sm bg-[var(--color-card)] border border-[var(--color-border)] rounded placeholder:text-[var(--color-text-muted)] focus:outline-none focus:ring-2 focus:ring-[var(--color-accent-solid)] resize-none"
          />
          <div className="flex justify-end gap-2 mt-2">
            <Button variant="ghost" size="sm" onClick={() => { setShowResolve(false); setResolveText(""); }} disabled={isLoading}>
              Cancel
            </Button>
            <Button
              size="sm"
              disabled={!resolveText.trim() || isLoading}
              onClick={() => { onResolve(resolveText.trim()); setShowResolve(false); setResolveText(""); }}
            >
              {isLoading ? (
                <><Loader2 size={14} className="animate-spin mr-1" />Resolving...</>
              ) : (
                <><Send size={14} className="mr-1" />Resolve</>
              )}
            </Button>
          </div>
        </div>
      )}

      {/* Memory previews (only when not expanded — detail components show their own) */}
      {!suggestion.expanded &&
        suggestion.memories &&
        suggestion.memories.length > 0 && (
          <div className="flex flex-col gap-1.5 mb-3">
            {suggestion.memories.map((m) => (
              <MemoryMiniCard key={m.id} memory={m} />
            ))}
          </div>
        )}

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

      {suggestion.expanded && suggestion.type === "merge" && (
        <MergeDetail
          suggestion={suggestion}
          applying={isLoading}
          correctingId={correctingId}
          onApply={onApplyMerge}
          onConfirm={onMemoryConfirm}
          onCorrectToggle={onCorrectToggle}
          onCorrect={onMemoryCorrect}
          onFlag={onMemoryFlag}
        />
      )}
      {suggestion.expanded &&
        suggestion.type === "split" &&
        suggestion.parts && (
          <SplitDetail
            suggestion={suggestion}
            applying={isLoading}
            onApply={onApplySplit}
            onFlag={onMemoryFlag}
          />
        )}
      {suggestion.expanded &&
        suggestion.type === "contradiction" &&
        suggestion.conflicts && (
          <ContradictionDetail
            suggestion={suggestion}
            applying={isLoading}
            correctingId={correctingId}
            onKeep={onContradictionKeep}
            onConfirm={onMemoryConfirm}
            onCorrectToggle={onCorrectToggle}
            onCorrect={onMemoryCorrect}
            onFlag={onMemoryFlag}
          />
        )}
      {suggestion.expanded && suggestion.type === "pii" && (
        <PiiDetail
          suggestion={suggestion}
          applying={isLoading}
          correctingId={correctingId}
          onScrub={onMemoryScrub}
          onDelete={onMemoryDelete}
          onCorrectToggle={onCorrectToggle}
          onCorrect={onMemoryCorrect}
        />
      )}
      {suggestion.expanded && suggestion.type === "stale" && (
        <StaleDetail
          suggestion={suggestion}
          applying={isLoading}
          correctingId={correctingId}
          onConfirm={onMemoryConfirm}
          onCorrectToggle={onCorrectToggle}
          onCorrect={onMemoryCorrect}
          onFlag={onMemoryFlag}
          onDelete={onMemoryDelete}
        />
      )}
      {suggestion.expanded && suggestion.type === "promote" && (
        <PromoteDetail
          suggestion={suggestion}
          applying={isLoading}
          onPin={onMemoryPin}
          onDelete={onMemoryDelete}
        />
      )}
      {suggestion.expanded && suggestion.type === "expired" && (
        <ExpiredDetail
          suggestion={suggestion}
          applying={isLoading}
          onDelete={onMemoryDelete}
          onConfirm={onMemoryConfirm}
        />
      )}
      {suggestion.expanded && suggestion.type === "stale_project" && (
        <StaleProjectDetail
          suggestion={suggestion}
          applying={isLoading}
          onArchive={onMemoryArchive}
          onDelete={onMemoryDelete}
          onConfirm={onMemoryConfirm}
        />
      )}
    </Card>
  );
}

// --- Detail Components ---

function MergeDetail({
  suggestion,
  applying,
  correctingId,
  onApply,
  onConfirm,
  onCorrectToggle,
  onCorrect,
  onFlag,
}: {
  suggestion: CleanupSuggestion;
  applying: boolean;
  correctingId: string | null;
  onApply: () => void;
  onConfirm: (id: string) => void;
  onCorrectToggle: (id: string | null) => void;
  onCorrect: (id: string, feedback: string) => void;
  onFlag: (id: string) => void;
}) {
  return (
    <div className="mt-2">
      <div className="flex flex-col gap-2 mb-3">
        {suggestion.memories?.map((m) => (
          <div key={m.id}>
            <MemoryMiniCard
              memory={m}
              highlight={m.id === suggestion.keepId}
              label={m.id === suggestion.keepId ? "Keep" : undefined}
            />
            {m.id === suggestion.keepId && (
              <MemoryActionBar
                memoryId={m.id}
                showConfirm
                showCorrect
                showFlag
                loading={applying}
                correctingId={correctingId}
                onConfirm={onConfirm}
                onCorrectToggle={onCorrectToggle}
                onFlag={onFlag}
              />
            )}
            {correctingId === m.id && (
              <InlineCorrection
                memoryId={m.id}
                onSubmit={onCorrect}
                onCancel={() => onCorrectToggle(null)}
                loading={applying}
              />
            )}
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
  onFlag,
}: {
  suggestion: CleanupSuggestion;
  applying: boolean;
  onApply: () => void;
  onFlag: (id: string) => void;
}) {
  const originalMemory = suggestion.memories?.[0];
  return (
    <div className="mt-2">
      {originalMemory && (
        <div className="mb-3">
          <MemoryMiniCard memory={originalMemory} />
          <MemoryActionBar
            memoryId={originalMemory.id}
            showFlag
            loading={applying}
            correctingId={null}
            onFlag={onFlag}
          />
        </div>
      )}
      <p
        className="text-xs font-medium mb-2"
        style={{ color: "var(--color-text-muted)" }}
      >
        Proposed split:
      </p>
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
  correctingId,
  onKeep,
  onConfirm,
  onCorrectToggle,
  onCorrect,
  onFlag,
}: {
  suggestion: CleanupSuggestion;
  applying: boolean;
  correctingId: string | null;
  onKeep: (keepId: string) => void;
  onConfirm: (id: string) => void;
  onCorrectToggle: (id: string | null) => void;
  onCorrect: (id: string, feedback: string) => void;
  onFlag: (id: string) => void;
}) {
  // Map conflicts to the full memory data
  const memoryMap = new Map(
    suggestion.memories?.map((m) => [m.id, m]) ?? [],
  );

  return (
    <div className="mt-2">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {suggestion.conflicts?.map((conflict) => {
          const mem = memoryMap.get(conflict.id);
          return (
            <div key={conflict.id}>
              <div
                className="p-3 rounded border"
                style={{
                  background: "var(--color-bg-soft)",
                  borderColor: "var(--color-border)",
                }}
              >
                <p
                  className="text-sm mb-2"
                  style={{ color: "var(--color-text)" }}
                >
                  {conflict.statement}
                </p>
                {mem && (
                  <div className="flex items-center gap-2 mb-2 flex-wrap">
                    <StatusBadge variant="accent">{mem.domain}</StatusBadge>
                    {mem.entity_type && (
                      <StatusBadge variant="neutral">
                        {mem.entity_type}
                      </StatusBadge>
                    )}
                    <span
                      className="text-[10px] font-medium tabular-nums"
                      style={{ color: confidenceColor(mem.confidence) }}
                    >
                      {formatConfidence(mem.confidence)}
                    </span>
                    <Link
                      href={`/memory/${conflict.id}`}
                      className="hover:opacity-80"
                      style={{ color: "var(--color-text-muted)" }}
                    >
                      <ExternalLink size={11} />
                    </Link>
                  </div>
                )}
                <div className="flex items-center gap-1">
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() => onKeep(conflict.id)}
                    disabled={applying}
                  >
                    Keep this
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => onConfirm(conflict.id)}
                    disabled={applying}
                  >
                    <CheckCircle size={13} className="mr-1" />
                    Confirm
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() =>
                      onCorrectToggle(
                        correctingId === conflict.id ? null : conflict.id,
                      )
                    }
                    disabled={applying}
                  >
                    <Pencil size={13} className="mr-1" />
                    Correct
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => onFlag(conflict.id)}
                    disabled={applying}
                  >
                    <AlertTriangle size={13} className="mr-1" />
                    Flag
                  </Button>
                </div>
              </div>
              {correctingId === conflict.id && (
                <InlineCorrection
                  memoryId={conflict.id}
                  onSubmit={onCorrect}
                  onCancel={() => onCorrectToggle(null)}
                  loading={applying}
                />
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function PiiDetail({
  suggestion,
  applying,
  correctingId,
  onScrub,
  onDelete,
  onCorrectToggle,
  onCorrect,
}: {
  suggestion: CleanupSuggestion;
  applying: boolean;
  correctingId: string | null;
  onScrub: (id: string) => void;
  onDelete: (id: string) => void;
  onCorrectToggle: (id: string | null) => void;
  onCorrect: (id: string, feedback: string) => void;
}) {
  const memory = suggestion.memories?.[0];
  const memoryId = suggestion.memoryIds[0];

  return (
    <div className="mt-2">
      {memory && <MemoryMiniCard memory={memory} />}

      {suggestion.piiTypes && suggestion.piiTypes.length > 0 && (
        <div className="flex flex-wrap gap-1.5 mt-2 mb-2">
          {suggestion.piiTypes.map((type) => (
            <span
              key={type}
              className="text-xs px-2 py-0.5 rounded"
              style={{
                background: "var(--color-danger-bg)",
                color: "var(--color-danger)",
              }}
            >
              {type.replace(/_/g, " ")}
            </span>
          ))}
        </div>
      )}

      <p
        className="text-xs mb-3"
        style={{ color: "var(--color-text-muted)" }}
      >
        Redacting also scrubs sensitive data from event history.
      </p>

      <div className="flex items-center gap-2">
        <Button
          size="sm"
          onClick={() => onScrub(memoryId)}
          disabled={applying}
        >
          <ShieldAlert size={14} className="mr-1" />
          {applying ? "Redacting..." : "Redact"}
        </Button>
        <Button
          size="sm"
          variant="ghost"
          onClick={() =>
            onCorrectToggle(correctingId === memoryId ? null : memoryId)
          }
          disabled={applying}
        >
          <Pencil size={13} className="mr-1" />
          Edit manually
        </Button>
        <Button
          size="sm"
          variant="danger"
          onClick={() => onDelete(memoryId)}
          disabled={applying}
        >
          <Trash2 size={13} className="mr-1" />
          Delete
        </Button>
      </div>

      {correctingId === memoryId && (
        <InlineCorrection
          memoryId={memoryId}
          onSubmit={onCorrect}
          onCancel={() => onCorrectToggle(null)}
          loading={applying}
        />
      )}
    </div>
  );
}

function StaleDetail({
  suggestion,
  applying,
  correctingId,
  onConfirm,
  onCorrectToggle,
  onCorrect,
  onFlag,
  onDelete,
}: {
  suggestion: CleanupSuggestion;
  applying: boolean;
  correctingId: string | null;
  onConfirm: (id: string) => void;
  onCorrectToggle: (id: string | null) => void;
  onCorrect: (id: string, feedback: string) => void;
  onFlag: (id: string) => void;
  onDelete: (id: string) => void;
}) {
  const memory = suggestion.memories?.[0];
  const memoryId = suggestion.memoryIds[0];

  return (
    <div className="mt-2">
      {memory && <MemoryMiniCard memory={memory} />}

      <MemoryActionBar
        memoryId={memoryId}
        showConfirm
        showCorrect
        showFlag
        showDelete
        loading={applying}
        correctingId={correctingId}
        onConfirm={onConfirm}
        onCorrectToggle={onCorrectToggle}
        onFlag={onFlag}
        onDelete={onDelete}
      />

      {correctingId === memoryId && (
        <InlineCorrection
          memoryId={memoryId}
          onSubmit={onCorrect}
          onCancel={() => onCorrectToggle(null)}
          loading={applying}
        />
      )}
    </div>
  );
}

function PromoteDetail({
  suggestion,
  applying,
  onPin,
  onDelete,
}: {
  suggestion: CleanupSuggestion;
  applying: boolean;
  onPin: (id: string) => void;
  onDelete: (id: string) => void;
}) {
  const memory = suggestion.memories?.[0];
  const memoryId = suggestion.memoryIds[0];

  return (
    <div className="mt-2">
      {memory && <MemoryMiniCard memory={memory} />}
      <div className="flex items-center gap-2 mt-2">
        <Button
          size="sm"
          onClick={() => onPin(memoryId)}
          disabled={applying}
        >
          <Star size={14} className="mr-1" />
          {applying ? "Pinning..." : "Pin as Canonical"}
        </Button>
        <Button
          size="sm"
          variant="ghost"
          onClick={() => onDelete(memoryId)}
          disabled={applying}
          className="text-[var(--color-danger)] hover:text-[var(--color-danger)]"
        >
          <Trash2 size={13} className="mr-1" />
          Delete
        </Button>
      </div>
    </div>
  );
}

function ExpiredDetail({
  suggestion,
  applying,
  onDelete,
  onConfirm,
}: {
  suggestion: CleanupSuggestion;
  applying: boolean;
  onDelete: (id: string) => void;
  onConfirm: (id: string) => void;
}) {
  const memory = suggestion.memories?.[0];
  const memoryId = suggestion.memoryIds[0];

  return (
    <div className="mt-2">
      {memory && <MemoryMiniCard memory={memory} />}
      <p className="text-xs mt-2 mb-2 text-[var(--color-text-muted)]">
        This ephemeral memory has passed its expiration time.
      </p>
      <div className="flex items-center gap-2">
        <Button
          size="sm"
          variant="danger"
          onClick={() => onDelete(memoryId)}
          disabled={applying}
        >
          <Clock size={14} className="mr-1" />
          {applying ? "Deleting..." : "Delete Expired"}
        </Button>
        <Button
          size="sm"
          variant="ghost"
          onClick={() => onConfirm(memoryId)}
          disabled={applying}
        >
          <CheckCircle size={13} className="mr-1" />
          Keep (confirm)
        </Button>
      </div>
    </div>
  );
}

function StaleProjectDetail({
  suggestion,
  applying,
  onArchive,
  onDelete,
  onConfirm,
}: {
  suggestion: CleanupSuggestion;
  applying: boolean;
  onArchive: (id: string) => void;
  onDelete: (id: string) => void;
  onConfirm: (id: string) => void;
}) {
  const memory = suggestion.memories?.[0];
  const memoryId = suggestion.memoryIds[0];

  return (
    <div className="mt-2">
      {memory && <MemoryMiniCard memory={memory} />}
      <p className="text-xs mt-2 mb-2 text-[var(--color-text-muted)]">
        This project context has been idle for over 90 days with no usage or confirmation.
      </p>
      <div className="flex items-center gap-2">
        <Button
          size="sm"
          onClick={() => onArchive(memoryId)}
          disabled={applying}
        >
          <Archive size={14} className="mr-1" />
          {applying ? "Archiving..." : "Archive"}
        </Button>
        <Button
          size="sm"
          variant="ghost"
          onClick={() => onConfirm(memoryId)}
          disabled={applying}
        >
          <CheckCircle size={13} className="mr-1" />
          Still relevant
        </Button>
        <Button
          size="sm"
          variant="ghost"
          onClick={() => onDelete(memoryId)}
          disabled={applying}
          className="text-[var(--color-danger)] hover:text-[var(--color-danger)]"
        >
          <Trash2 size={13} className="mr-1" />
          Delete
        </Button>
      </div>
    </div>
  );
}

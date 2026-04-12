"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle, AlertTriangle, Trash2, Pencil, Scissors, Star, Archive, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import {
  confirmMemoryAction,
  correctMemoryAction,
  flagMemoryAction,
  deleteMemoryAction,
  proposeSplitAction,
  confirmSplitAction,
  pinMemoryAction,
  archiveMemoryAction,
  restoreMemoryAction,
} from "@/lib/actions";
import type { SplitPart } from "@/lib/actions";

interface MemoryActionsProps {
  id: string;
  currentContent: string;
  currentDetail: string | null;
  permanence: string | null;
}

export function MemoryActions({ id, currentContent, currentDetail, permanence }: MemoryActionsProps) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [correctModalOpen, setCorrectModalOpen] = useState(false);
  const [splitModalOpen, setSplitModalOpen] = useState(false);
  const [deleteModalOpen, setDeleteModalOpen] = useState(false);
  const [editContent, setEditContent] = useState(currentContent);
  const [editDetail, setEditDetail] = useState(currentDetail ?? "");
  const [splitParts, setSplitParts] = useState<SplitPart[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleAction(action: () => Promise<unknown>) {
    setLoading(true);
    setError(null);
    try {
      const result = await action();
      if (result && typeof result === "object" && "error" in result) {
        setError((result as { error: string }).error);
      } else {
        router.refresh();
      }
    } catch (e) {
      console.error(e);
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }

  async function handleProposeSplit() {
    setLoading(true);
    setError(null);
    try {
      const result = await proposeSplitAction(id);
      if ("error" in result) {
        setError(result.error);
      } else {
        setSplitParts(result.parts);
      }
    } catch (e) {
      console.error(e);
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }

  function updatePart(index: number, field: "content" | "detail", value: string) {
    if (!splitParts) return;
    const updated = [...splitParts];
    updated[index] = { ...updated[index], [field]: value || null };
    setSplitParts(updated);
  }

  function removePart(index: number) {
    if (!splitParts || splitParts.length <= 2) return;
    setSplitParts(splitParts.filter((_, i) => i !== index));
  }

  return (
    <>
      {error && (
        <div className="mb-2 p-2 text-xs text-[var(--color-danger)] bg-[var(--color-danger-bg)] rounded-lg">
          {error}
        </div>
      )}
      <div className="flex flex-wrap gap-2">
        <Button
          variant="secondary"
          size="sm"
          disabled={loading}
          onClick={() => handleAction(() => confirmMemoryAction(id))}
        >
          <CheckCircle size={14} className="mr-1" />
          Confirm
        </Button>
        <Button
          variant="secondary"
          size="sm"
          disabled={loading}
          onClick={() => setCorrectModalOpen(true)}
        >
          <Pencil size={14} className="mr-1" />
          Correct
        </Button>
        <Button
          variant="secondary"
          size="sm"
          disabled={loading}
          onClick={() => handleAction(() => flagMemoryAction(id))}
        >
          <AlertTriangle size={14} className="mr-1" />
          Flag Mistake
        </Button>
        <Button
          variant="secondary"
          size="sm"
          disabled={loading}
          onClick={() => {
            setSplitParts(null);
            setError(null);
            setSplitModalOpen(true);
          }}
        >
          <Scissors size={14} className="mr-1" />
          Split
        </Button>
        {permanence !== "canonical" && (
          <Button
            variant="secondary"
            size="sm"
            disabled={loading}
            onClick={() => handleAction(() => pinMemoryAction(id))}
          >
            <Star size={14} className="mr-1" />
            Pin as Canonical
          </Button>
        )}
        {permanence !== "archived" && (
          <Button
            variant="secondary"
            size="sm"
            disabled={loading}
            onClick={() => handleAction(() => archiveMemoryAction(id))}
          >
            <Archive size={14} className="mr-1" />
            Archive
          </Button>
        )}
        {(permanence === "canonical" || permanence === "archived") && (
          <Button
            variant="secondary"
            size="sm"
            disabled={loading}
            onClick={() => handleAction(() => restoreMemoryAction(id))}
          >
            <RotateCcw size={14} className="mr-1" />
            Restore to Active
          </Button>
        )}
        <Button
          variant="danger"
          size="sm"
          disabled={loading}
          onClick={() => setDeleteModalOpen(true)}
        >
          <Trash2 size={14} className="mr-1" />
          Delete
        </Button>
      </div>

      <Modal
        open={correctModalOpen}
        onClose={() => setCorrectModalOpen(false)}
        title="Correct Memory"
      >
        <div className="space-y-3">
          <label className="text-xs font-medium text-[var(--color-text-muted)]">Content</label>
          <textarea
            value={editContent}
            onChange={(e) => setEditContent(e.target.value)}
            placeholder="Memory content..."
            rows={2}
            className="w-full p-3 text-sm bg-[var(--color-bg-soft)] border border-[var(--color-border)] rounded-lg placeholder:text-[var(--color-text-muted)] focus:outline-none focus:ring-2 focus:ring-[var(--color-accent-solid)] resize-none"
          />
          <label className="text-xs font-medium text-[var(--color-text-muted)]">Detail (optional)</label>
          <textarea
            value={editDetail}
            onChange={(e) => setEditDetail(e.target.value)}
            placeholder="Additional context..."
            rows={2}
            className="w-full p-3 text-sm bg-[var(--color-bg-soft)] border border-[var(--color-border)] rounded-lg placeholder:text-[var(--color-text-muted)] focus:outline-none focus:ring-2 focus:ring-[var(--color-accent-solid)] resize-none"
          />
        </div>
        <div className="flex justify-end gap-2 mt-4">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setCorrectModalOpen(false)}
          >
            Cancel
          </Button>
          <Button
            variant="primary"
            size="sm"
            disabled={!editContent.trim() || loading}
            onClick={() =>
              handleAction(async () => {
                await correctMemoryAction(id, editContent.trim(), editDetail.trim() || null);
                setCorrectModalOpen(false);
              })
            }
          >
            {loading ? "Applying..." : "Apply Correction"}
          </Button>
        </div>
      </Modal>

      <Modal
        open={splitModalOpen}
        onClose={() => setSplitModalOpen(false)}
        title={splitParts ? "Review Proposed Split" : "Split Memory"}
        size="lg"
      >
        {!splitParts ? (
          <>
            <div className="space-y-3">
              <div className="text-sm text-[var(--color-text-secondary)] bg-[var(--color-bg-soft)] rounded-lg p-3 space-y-1">
                <p className="font-medium text-[var(--color-text)]">{currentContent}</p>
                {currentDetail && <p className="text-xs">{currentDetail}</p>}
              </div>
              <p className="text-xs text-[var(--color-text-muted)]">
                Splits the memory by sentences. You can edit each part in the next step.
              </p>
            </div>
            <div className="flex justify-end gap-2 mt-4">
              <Button variant="ghost" size="sm" onClick={() => setSplitModalOpen(false)}>
                Cancel
              </Button>
              <Button
                variant="primary"
                size="sm"
                disabled={loading}
                onClick={handleProposeSplit}
              >
                {loading ? "Splitting..." : "Propose Split"}
              </Button>
            </div>
          </>
        ) : (
          <>
            <p className="text-xs text-[var(--color-text-muted)] mb-3">
              Review and edit the proposed parts. The original memory will be removed.
            </p>
            <div className="space-y-3">
              {splitParts.map((part, i) => (
                <div
                  key={i}
                  className="bg-[var(--color-bg-soft)] border border-[var(--color-border)] rounded-lg p-3 space-y-2"
                >
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-medium text-[var(--color-accent-text)]">
                      Part {i + 1}
                    </span>
                    {splitParts.length > 2 && (
                      <button
                        onClick={() => removePart(i)}
                        className="text-xs text-[var(--color-text-muted)] hover:text-[var(--color-danger)]"
                      >
                        Remove
                      </button>
                    )}
                  </div>
                  <textarea
                    value={part.content}
                    onChange={(e) => updatePart(i, "content", e.target.value)}
                    rows={Math.max(2, Math.ceil(part.content.length / 50))}
                    className="w-full p-2 text-sm bg-[var(--color-card)] border border-[var(--color-border)] rounded focus:outline-none focus:ring-2 focus:ring-[var(--color-accent-solid)] resize-vertical"
                    placeholder="Content..."
                  />
                  <textarea
                    value={part.detail ?? ""}
                    onChange={(e) => updatePart(i, "detail", e.target.value)}
                    rows={Math.max(2, Math.ceil((part.detail?.length ?? 0) / 55))}
                    className="w-full p-2 text-xs bg-[var(--color-card)] border border-[var(--color-border)] rounded focus:outline-none focus:ring-1 focus:ring-[var(--color-accent-solid)] text-[var(--color-text-secondary)] resize-vertical"
                    placeholder="Detail (optional)..."
                  />
                </div>
              ))}
            </div>
            <div className="flex justify-between mt-4">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setSplitParts(null)}
              >
                Back
              </Button>
              <div className="flex gap-2">
                <Button variant="ghost" size="sm" onClick={() => setSplitModalOpen(false)}>
                  Cancel
                </Button>
                <Button
                  variant="primary"
                  size="sm"
                  disabled={loading || splitParts.some((p) => !p.content.trim())}
                  onClick={() =>
                    handleAction(async () => {
                      const result = await confirmSplitAction(id, splitParts);
                      if (result && "newIds" in result) {
                        setSplitModalOpen(false);
                        setSplitParts(null);
                        router.push("/");
                      }
                      return result;
                    })
                  }
                >
                  {loading ? "Splitting..." : `Confirm Split (${splitParts.length} parts)`}
                </Button>
              </div>
            </div>
          </>
        )}
      </Modal>

      <Modal
        open={deleteModalOpen}
        onClose={() => setDeleteModalOpen(false)}
        title="Delete Memory"
      >
        <p className="text-sm text-[var(--color-text-secondary)]">
          Are you sure you want to delete this memory? This action can be undone
          by an administrator.
        </p>
        <div className="flex justify-end gap-2 mt-4">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setDeleteModalOpen(false)}
          >
            Cancel
          </Button>
          <Button
            variant="danger"
            size="sm"
            disabled={loading}
            onClick={() =>
              handleAction(async () => {
                await deleteMemoryAction(id);
                setDeleteModalOpen(false);
                router.push("/");
              })
            }
          >
            Delete
          </Button>
        </div>
      </Modal>
    </>
  );
}

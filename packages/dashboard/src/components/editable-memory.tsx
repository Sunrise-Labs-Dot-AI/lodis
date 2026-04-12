"use client";

import { useState, useRef, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Pencil, Check, X } from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

interface EditableMemoryProps {
  id: string;
  content: string;
  detail: string | null;
}

export function EditableMemory({ id, content, detail }: EditableMemoryProps) {
  const router = useRouter();
  const [editingContent, setEditingContent] = useState(false);
  const [editingDetail, setEditingDetail] = useState(false);
  const [contentValue, setContentValue] = useState(content);
  const [detailValue, setDetailValue] = useState(detail ?? "");
  const contentRef = useRef<HTMLTextAreaElement>(null);
  const detailRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (editingContent && contentRef.current) {
      contentRef.current.focus();
      contentRef.current.selectionStart = contentRef.current.value.length;
    }
  }, [editingContent]);

  useEffect(() => {
    if (editingDetail && detailRef.current) {
      detailRef.current.focus();
      detailRef.current.selectionStart = detailRef.current.value.length;
    }
  }, [editingDetail]);

  async function saveContent() {
    if (contentValue.trim() === content) {
      setEditingContent(false);
      return;
    }
    await saveEdit(contentValue.trim(), detail);
    setEditingContent(false);
  }

  async function saveDetail() {
    const newDetail = detailValue.trim() || null;
    if (newDetail === detail) {
      setEditingDetail(false);
      return;
    }
    await saveEdit(content, newDetail);
    setEditingDetail(false);
  }

  async function saveEdit(newContent: string, newDetail: string | null) {
    const { directUpdateMemory } = await import("@/lib/db-actions");
    await directUpdateMemory(id, { content: newContent, detail: newDetail });
    router.refresh();
  }

  return (
    <div>
      {editingContent ? (
        <div className="flex items-start gap-2">
          <textarea
            ref={contentRef}
            value={contentValue}
            onChange={(e) => setContentValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); saveContent(); }
              if (e.key === "Escape") { setContentValue(content); setEditingContent(false); }
            }}
            rows={2}
            className="flex-1 p-2 text-base bg-[var(--color-bg-soft)] border border-[var(--color-accent-solid)] rounded-lg focus:outline-none resize-none"
          />
          <button onClick={saveContent} className="p-1.5 text-[var(--color-success)] hover:bg-[var(--color-success-bg)] rounded cursor-pointer">
            <Check size={16} />
          </button>
          <button onClick={() => { setContentValue(content); setEditingContent(false); }} className="p-1.5 text-[var(--color-text-muted)] hover:bg-[var(--color-bg-soft)] rounded cursor-pointer">
            <X size={16} />
          </button>
        </div>
      ) : (
        <p
          className="text-base leading-relaxed group cursor-pointer hover:bg-[var(--color-bg-soft)] rounded-lg px-2 py-1 -mx-2 -my-1 transition-colors"
          onClick={() => setEditingContent(true)}
        >
          {content}
          <Pencil size={12} className="inline ml-2 opacity-0 group-hover:opacity-50 transition-opacity" />
        </p>
      )}

      {editingDetail ? (
        <div className="flex items-start gap-2 mt-2">
          <textarea
            ref={detailRef}
            value={detailValue}
            onChange={(e) => setDetailValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); saveDetail(); }
              if (e.key === "Escape") { setDetailValue(detail ?? ""); setEditingDetail(false); }
            }}
            rows={2}
            placeholder="Add detail..."
            className="flex-1 p-2 text-sm bg-[var(--color-bg-soft)] border border-[var(--color-accent-solid)] rounded-lg focus:outline-none resize-none text-[var(--color-text-secondary)]"
          />
          <button onClick={saveDetail} className="p-1.5 text-[var(--color-success)] hover:bg-[var(--color-success-bg)] rounded cursor-pointer">
            <Check size={16} />
          </button>
          <button onClick={() => { setDetailValue(detail ?? ""); setEditingDetail(false); }} className="p-1.5 text-[var(--color-text-muted)] hover:bg-[var(--color-bg-soft)] rounded cursor-pointer">
            <X size={16} />
          </button>
        </div>
      ) : (
        <div
          className="mt-2 text-sm text-[var(--color-text-secondary)] group cursor-pointer hover:bg-[var(--color-bg-soft)] rounded-lg px-2 py-1 -mx-2 -my-1 transition-colors"
          onClick={() => setEditingDetail(true)}
        >
          {detail ? (
            <div className="prose-engrams">
              <ReactMarkdown remarkPlugins={[remarkGfm]}>{detail}</ReactMarkdown>
            </div>
          ) : (
            <span className="text-[var(--color-text-muted)] italic">Add detail...</span>
          )}
          <Pencil size={10} className="inline ml-2 opacity-0 group-hover:opacity-50 transition-opacity" />
        </div>
      )}
    </div>
  );
}

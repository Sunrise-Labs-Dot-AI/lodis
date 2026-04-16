"use client";

import { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import clsx from "clsx";
import { FileText, Search, ExternalLink, Clock, HardDrive, Globe, FolderOpen } from "lucide-react";
import { Card } from "@/components/ui/card";
import { StatusBadge } from "@/components/ui/status-badge";
import { formatDate } from "@/lib/utils";
import type { IndexedDocumentRow } from "@/lib/db";

const SORT_OPTIONS = [
  { value: "indexed", label: "Recently Indexed" },
  { value: "title", label: "Title" },
  { value: "source_modified", label: "Source Modified" },
] as const;

const SOURCE_ICONS: Record<string, typeof Globe> = {
  google_drive: HardDrive,
  notion: FileText,
  filesystem: FolderOpen,
  github: Globe,
};

const SOURCE_LABELS: Record<string, string> = {
  google_drive: "Google Drive",
  notion: "Notion",
  filesystem: "Local Files",
  github: "GitHub",
  confluence: "Confluence",
};

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function getStaleness(lastIndexedAt: string): { label: string; variant: "success" | "warning" | "danger" } {
  const hours = (Date.now() - new Date(lastIndexedAt).getTime()) / (1000 * 60 * 60);
  if (hours < 24) return { label: "Fresh", variant: "success" };
  if (hours < 168) return { label: `${Math.floor(hours / 24)}d ago`, variant: "warning" };
  return { label: `${Math.floor(hours / 24)}d ago`, variant: "danger" };
}

export function IndexClient({
  documents,
  sourceSystems,
}: {
  documents: IndexedDocumentRow[];
  sourceSystems: string[];
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [search, setSearch] = useState(searchParams.get("q") ?? "");

  const activeSort = searchParams.get("sort") ?? "indexed";
  const activeSource = searchParams.get("source") ?? "";

  function updateParam(key: string, value: string | null) {
    const params = new URLSearchParams(searchParams.toString());
    if (value) {
      params.set(key, value);
    } else {
      params.delete(key);
    }
    router.push(`/documents?${params.toString()}`);
  }

  function handleSearch(e: React.FormEvent) {
    e.preventDefault();
    updateParam("q", search.trim() || null);
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-[var(--text)] flex items-center gap-2">
            <FileText size={24} />
            Document Index
          </h1>
          <p className="text-sm mt-1 text-[var(--text-muted)]">
            {documents.length} indexed {documents.length === 1 ? "document" : "documents"}
            {activeSource && ` from ${SOURCE_LABELS[activeSource] ?? activeSource}`}
          </p>
        </div>
      </div>

      {/* Search + Sort + Source Filter */}
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
              placeholder="Search indexed documents..."
              className="w-full pl-9 pr-3 py-2 text-sm bg-[var(--bg-soft)] border border-[var(--border)] rounded-lg placeholder:text-[var(--text-dim)] focus:outline-none focus:ring-2 focus:ring-[var(--accent-solid)]"
            />
          </div>
        </form>

        <div className="flex items-center gap-1.5 text-xs">
          {SORT_OPTIONS.map(({ value, label }) => (
            <button
              key={value}
              onClick={() => updateParam("sort", value === "indexed" ? null : value)}
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

        {sourceSystems.length > 0 && (
          <div className="flex items-center gap-1.5 text-xs">
            <button
              onClick={() => updateParam("source", null)}
              className={clsx(
                "px-2 py-1 rounded-md transition-colors cursor-pointer",
                !activeSource
                  ? "bg-[var(--accent-soft)] text-[var(--accent-strong)] font-medium"
                  : "text-[var(--text-dim)] hover:text-[var(--text)] hover:bg-[var(--bg-soft)]",
              )}
            >
              All Sources
            </button>
            {sourceSystems.map((sys) => (
              <button
                key={sys}
                onClick={() => updateParam("source", sys === activeSource ? null : sys)}
                className={clsx(
                  "px-2 py-1 rounded-md transition-colors cursor-pointer",
                  activeSource === sys
                    ? "bg-[var(--accent-soft)] text-[var(--accent-strong)] font-medium"
                    : "text-[var(--text-dim)] hover:text-[var(--text)] hover:bg-[var(--bg-soft)]",
                )}
              >
                {SOURCE_LABELS[sys] ?? sys}
              </button>
            ))}
          </div>
        )}
      </div>

      {documents.length === 0 ? (
        <Card className="p-8 text-center">
          <FileText
            size={40}
            className="mx-auto mb-3 text-[var(--text-dim)]"
          />
          <p className="text-lg font-medium text-[var(--text)]">
            {searchParams.get("q") || activeSource ? "No matching documents" : "No documents indexed yet"}
          </p>
          <p className="text-sm mt-1 text-[var(--text-dim)]">
            {searchParams.get("q") || activeSource
              ? "Try a different search or filter."
              : "Ask your AI agent to index documents from Google Drive, Notion, or your filesystem using the memory_index tool."}
          </p>
        </Card>
      ) : (
        <div className="flex flex-col gap-3">
          {documents.map((doc) => {
            const data = doc.parsed_data;
            const SourceIcon = data ? (SOURCE_ICONS[data.source_system] ?? Globe) : Globe;
            const staleness = data?.last_indexed_at ? getStaleness(data.last_indexed_at) : null;

            return (
              <Card key={doc.id} hover className="p-4">
                <div className="flex items-start gap-3">
                  <div className="mt-0.5 p-2 rounded-lg bg-[var(--bg-soft)]">
                    <SourceIcon size={18} className="text-[var(--accent-strong)]" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <Link
                        href={`/memory/${doc.id}`}
                        className="text-sm font-medium text-[var(--text)] hover:text-[var(--accent-strong)] truncate"
                      >
                        {doc.entity_name ?? doc.content}
                      </Link>
                      {data?.url && (
                        <a
                          href={data.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-[var(--text-dim)] hover:text-[var(--accent-strong)] flex-shrink-0"
                        >
                          <ExternalLink size={13} />
                        </a>
                      )}
                    </div>

                    {/* Summary */}
                    <p className="text-xs text-[var(--text-muted)] mt-1 line-clamp-2">
                      {doc.content.replace(/^\[Document\]\s*/, "").replace(/^[^—]*—\s*/, "")}
                    </p>

                    {/* Metadata row */}
                    <div className="flex items-center gap-2 mt-2 flex-wrap">
                      {data?.source_system && (
                        <StatusBadge variant="accent">
                          {SOURCE_LABELS[data.source_system] ?? data.source_system}
                        </StatusBadge>
                      )}
                      {data?.mime_type && (
                        <StatusBadge variant="neutral">{data.mime_type}</StatusBadge>
                      )}
                      {data?.file_size != null && (
                        <span className="text-xs text-[var(--text-dim)]">
                          {formatFileSize(data.file_size)}
                        </span>
                      )}
                      {data?.parent_folder && (
                        <span className="text-xs text-[var(--text-dim)] flex items-center gap-1">
                          <FolderOpen size={11} />
                          {data.parent_folder}
                        </span>
                      )}
                      {staleness && (
                        <StatusBadge variant={staleness.variant}>
                          <Clock size={10} className="mr-0.5" />
                          {staleness.label}
                        </StatusBadge>
                      )}
                      {data?.tags?.map((tag) => (
                        <span
                          key={tag}
                          className="text-xs px-1.5 py-0.5 rounded bg-[var(--bg-soft)] text-[var(--text-dim)]"
                        >
                          {tag}
                        </span>
                      ))}
                    </div>
                  </div>
                </div>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}

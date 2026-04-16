"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  CheckCircle,
  Pencil,
  Trash2,
  ChevronDown,
  ChevronUp,
  ExternalLink,
  ShieldAlert,
  Star,
  Clock,
  Archive,
} from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/ui/status-badge";
import { ConfidenceBar } from "@/components/confidence-bar";
import {
  confirmMemoryAction,
  deleteMemoryAction,
  pinMemoryAction,
  archiveMemoryAction,
} from "@/lib/actions";
import { formatDate, sourceTypeLabel } from "@/lib/utils";
import type { MemoryRow } from "@/lib/db";

interface MemoryCardProps {
  memory: MemoryRow;
}

export function MemoryCard({ memory: m }: MemoryCardProps) {
  const [expanded, setExpanded] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  async function handleAction(action: () => Promise<unknown>) {
    setLoading(true);
    setError(null);
    try {
      await action();
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Action failed. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <Card className="p-4">
      <div className="flex items-start gap-3">
        <div className="flex-1 min-w-0">
          <p className="text-sm leading-relaxed">{m.content}</p>
          <div className="flex items-center gap-2 mt-2 flex-wrap">
            <StatusBadge variant="accent">{m.domain}</StatusBadge>
            {m.entity_type && (
              <StatusBadge variant="neutral" className="max-w-[16rem]">
                <span className="inline-block truncate align-bottom max-w-full">
                  {m.entity_type}
                  {m.entity_name ? `: ${m.entity_name}` : ""}
                </span>
              </StatusBadge>
            )}
            {m.permanence === "canonical" && (
              <StatusBadge variant="accent">
                <Star size={10} className="mr-0.5 inline fill-current" />
                Canonical
              </StatusBadge>
            )}
            {m.permanence === "ephemeral" && (
              <StatusBadge variant="warning">
                <Clock size={10} className="mr-0.5 inline" />
                Ephemeral
              </StatusBadge>
            )}
            {m.permanence === "archived" && (
              <StatusBadge variant="neutral">
                <Archive size={10} className="mr-0.5 inline" />
                Archived
              </StatusBadge>
            )}
            {!!m.has_pii_flag && (
              <StatusBadge variant="warning">
                <ShieldAlert size={12} className="mr-0.5 inline" />
                PII
              </StatusBadge>
            )}
            <span className="ml-auto text-xs text-[var(--text-dim)] whitespace-nowrap">
              {formatDate(m.learned_at)}
            </span>
          </div>
          <div className="mt-2 max-w-48">
            <ConfidenceBar confidence={m.confidence} />
          </div>
          {error && (
            <p
              role="alert"
              className="mt-2 text-xs text-[var(--danger)]"
            >
              {error}
            </p>
          )}
        </div>
        <div className="flex items-center gap-1">
          <Link
            href={`/memory/${m.id}`}
            aria-label="Open memory detail"
            className="p-1.5 text-[var(--text-dim)] hover:text-[var(--text)] transition-colors"
          >
            <ExternalLink size={14} />
          </Link>
          <button
            type="button"
            aria-label={expanded ? "Collapse memory details" : "Expand memory details"}
            aria-expanded={expanded}
            onClick={() => setExpanded(!expanded)}
            className="p-1.5 text-[var(--text-dim)] hover:text-[var(--text)] transition-colors cursor-pointer"
          >
            {expanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
          </button>
        </div>
      </div>

      {expanded && (
        <div className="mt-3 pt-3 border-t border-[var(--border-subtle)]">
          <dl className="mb-3 grid grid-cols-[max-content_1fr] gap-x-3 gap-y-1 text-xs text-[var(--text-dim)]">
            <dt>Source</dt>
            <dd className="text-[var(--text-muted)]">
              {sourceTypeLabel(m.source_type)}
            </dd>
            {m.source_agent_name && (
              <>
                <dt>Agent</dt>
                <dd className="text-[var(--text-muted)]">
                  {m.source_agent_name}
                </dd>
              </>
            )}
          </dl>
          {m.detail && (
            <div className="text-xs text-[var(--text-muted)] mb-3 prose-lodis">
              <ReactMarkdown remarkPlugins={[remarkGfm]}>{m.detail}</ReactMarkdown>
            </div>
          )}
          {m.source_description && (
            <p className="text-xs text-[var(--text-dim)] mb-3 italic">
              Source: {m.source_description}
            </p>
          )}
          <div className="flex items-center gap-2 flex-wrap">
            <Button
              variant="ghost"
              size="sm"
              disabled={loading}
              onClick={() => handleAction(() => confirmMemoryAction(m.id))}
            >
              <CheckCircle size={14} className="mr-1" />
              Confirm
            </Button>
            <Link href={`/memory/${m.id}`}>
              <Button variant="ghost" size="sm">
                <Pencil size={14} className="mr-1" />
                Correct
              </Button>
            </Link>
            {m.permanence !== "canonical" && (
              <Button
                variant="ghost"
                size="sm"
                disabled={loading}
                onClick={() => handleAction(() => pinMemoryAction(m.id))}
              >
                <Star size={14} className="mr-1" />
                Pin
              </Button>
            )}
            {m.permanence !== "archived" && (
              <Button
                variant="ghost"
                size="sm"
                disabled={loading}
                onClick={() => handleAction(() => archiveMemoryAction(m.id))}
              >
                <Archive size={14} className="mr-1" />
                Archive
              </Button>
            )}
            <Button
              variant="ghost"
              size="sm"
              disabled={loading}
              onClick={() => handleAction(() => deleteMemoryAction(m.id))}
              className="text-[var(--danger)] hover:bg-[var(--danger-bg)]"
            >
              <Trash2 size={14} className="mr-1" />
              Delete
            </Button>
          </div>
        </div>
      )}
    </Card>
  );
}

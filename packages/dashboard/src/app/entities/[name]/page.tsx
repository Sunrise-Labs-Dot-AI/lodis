import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, User, Building, MapPin, Folder, Heart, Calendar, Target, BookOpen, RotateCcw, Wrench, Gem, Book, Scale, ExternalLink, Clock, FolderOpen } from "lucide-react";
import { getEntityProfile, getMemoriesByEntityName, getEntityConnections } from "@/lib/db";
import { getUserId } from "@/lib/auth";
import { formatDate } from "@/lib/utils";
import { Card } from "@/components/ui/card";
import { StatusBadge } from "@/components/ui/status-badge";
import { ConfidenceBar } from "@/components/confidence-bar";

export const dynamic = "force-dynamic";

interface PageProps {
  params: Promise<{ name: string }>;
}

const ENTITY_ICONS: Record<string, typeof User> = {
  person: User,
  organization: Building,
  place: MapPin,
  project: Folder,
  preference: Heart,
  event: Calendar,
  goal: Target,
  fact: BookOpen,
  lesson: Book,
  routine: RotateCcw,
  skill: Wrench,
  resource: Gem,
  decision: Scale,
};

export default async function EntityProfilePage({ params }: PageProps) {
  const { name } = await params;
  const entityName = decodeURIComponent(name);
  const userId = await getUserId();

  const [profile, memories, connections] = await Promise.all([
    getEntityProfile(entityName, userId),
    getMemoriesByEntityName(entityName, userId),
    getEntityConnections(entityName, userId),
  ]);

  if (memories.length === 0) notFound();

  const entityType = memories[0].entity_type ?? "fact";
  const Icon = ENTITY_ICONS[entityType] ?? BookOpen;

  // Group memories by permanence
  const canonical = memories.filter((m) => m.permanence === "canonical");
  const active = memories.filter((m) => !m.permanence || m.permanence === "active");
  const ephemeral = memories.filter((m) => m.permanence === "ephemeral");
  const archived = memories.filter((m) => m.permanence === "archived");

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Link
          href="/"
          className="text-[var(--text-muted)] hover:text-[var(--text)] transition-colors"
        >
          <ArrowLeft className="w-5 h-5" />
        </Link>
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-lg bg-[var(--accent)]/10">
            <Icon className="w-6 h-6 text-[var(--accent)]" />
          </div>
          <div>
            <h1 className="text-2xl font-semibold text-[var(--text)]">
              {entityName}
            </h1>
            <p className="text-sm text-[var(--text-muted)] capitalize">
              {entityType} &middot; {memories.length} {memories.length === 1 ? "memory" : "memories"}
            </p>
          </div>
        </div>
      </div>

      {/* Profile Summary */}
      {profile ? (
        <Card className="p-6">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h2 className="text-sm font-medium text-[var(--text-muted)] mb-2">
                Profile Summary
              </h2>
              <p className="text-[var(--text)] leading-relaxed">
                {profile.summary}
              </p>
              <p className="text-xs text-[var(--text-dim)] mt-3">
                Generated {formatDate(profile.generated_at)} &middot; Based on {JSON.parse(profile.memory_ids).length} memories &middot; ~{profile.token_count} tokens
              </p>
            </div>
          </div>
        </Card>
      ) : (
        <Card className="p-6">
          <p className="text-[var(--text-muted)] text-sm">
            No entity profile generated yet. Use the <code className="text-xs bg-[var(--bg-soft)] px-1 py-0.5 rounded">memory_briefing</code> MCP tool to generate one.
          </p>
        </Card>
      )}

      {/* Document Index Metadata */}
      {(() => {
        const firstMemory = memories[0];
        if (!firstMemory?.structured_data) return null;
        try {
          const sd = JSON.parse(firstMemory.structured_data);
          if (sd.type !== "document") return null;
          const staleness = sd.last_indexed_at
            ? (() => {
                const hours = (Date.now() - new Date(sd.last_indexed_at).getTime()) / (1000 * 60 * 60);
                if (hours < 24) return { label: "Fresh", variant: "success" as const };
                if (hours < 168) return { label: `${Math.floor(hours / 24)}d ago`, variant: "warning" as const };
                return { label: `${Math.floor(hours / 24)}d ago`, variant: "danger" as const };
              })()
            : null;
          return (
            <Card className="p-6">
              <h2 className="text-sm font-medium text-[var(--text-muted)] mb-3">
                Document Source
              </h2>
              <div className="grid grid-cols-2 gap-3 text-sm">
                <div>
                  <span className="text-[var(--text-dim)]">Source</span>
                  <p className="text-[var(--text)] capitalize">{sd.source_system?.replace(/_/g, " ") ?? "Unknown"}</p>
                </div>
                <div>
                  <span className="text-[var(--text-dim)]">Location</span>
                  <p className="text-[var(--text)] truncate">{sd.location}</p>
                </div>
                {sd.mime_type && (
                  <div>
                    <span className="text-[var(--text-dim)]">Type</span>
                    <p className="text-[var(--text)]">{sd.mime_type}</p>
                  </div>
                )}
                {sd.file_size != null && (
                  <div>
                    <span className="text-[var(--text-dim)]">Size</span>
                    <p className="text-[var(--text)]">
                      {sd.file_size < 1024 * 1024
                        ? `${(sd.file_size / 1024).toFixed(1)} KB`
                        : `${(sd.file_size / (1024 * 1024)).toFixed(1)} MB`}
                    </p>
                  </div>
                )}
                {sd.parent_folder && (
                  <div>
                    <span className="text-[var(--text-dim)] flex items-center gap-1"><FolderOpen size={12} /> Folder</span>
                    <p className="text-[var(--text)]">{sd.parent_folder}</p>
                  </div>
                )}
                {sd.last_indexed_at && (
                  <div>
                    <span className="text-[var(--text-dim)] flex items-center gap-1"><Clock size={12} /> Last Indexed</span>
                    <div className="flex items-center gap-2">
                      <p className="text-[var(--text)]">{formatDate(sd.last_indexed_at)}</p>
                      {staleness && <StatusBadge variant={staleness.variant}>{staleness.label}</StatusBadge>}
                    </div>
                  </div>
                )}
              </div>
              {sd.url && (
                <a
                  href={sd.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 mt-3 text-sm text-[var(--accent-strong)] hover:underline"
                >
                  <ExternalLink size={13} />
                  Open in source
                </a>
              )}
            </Card>
          );
        } catch { return null; }
      })()}

      {/* Connected Entities */}
      {connections.length > 0 && (
        <Card className="p-6">
          <h2 className="text-sm font-medium text-[var(--text-muted)] mb-3">
            Connected Entities
          </h2>
          <div className="flex flex-wrap gap-2">
            {connections.map((conn) => {
              const ConnIcon = ENTITY_ICONS[conn.type] ?? BookOpen;
              return (
                <Link
                  key={`${conn.name}-${conn.relationship}`}
                  href={`/entities/${encodeURIComponent(conn.name)}`}
                  className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-[var(--bg-soft)] hover:bg-[var(--surface-hover)] transition-colors text-sm"
                >
                  <ConnIcon className="w-3.5 h-3.5 text-[var(--text-muted)]" />
                  <span className="text-[var(--text)]">{conn.name}</span>
                  <span className="text-xs text-[var(--text-dim)]">{conn.relationship}</span>
                </Link>
              );
            })}
          </div>
        </Card>
      )}

      {/* Memories by permanence tier */}
      {canonical.length > 0 && (
        <MemorySection title="Canonical" memories={canonical} />
      )}
      {active.length > 0 && (
        <MemorySection title="Active" memories={active} />
      )}
      {ephemeral.length > 0 && (
        <MemorySection title="Ephemeral" memories={ephemeral} />
      )}
      {archived.length > 0 && (
        <MemorySection title="Archived" memories={archived} />
      )}
    </div>
  );
}

function MemorySection({ title, memories }: { title: string; memories: Array<{ id: string; content: string; confidence: number; learned_at: string | null; permanence: string | null; domain: string }> }) {
  return (
    <div>
      <h2 className="text-sm font-medium text-[var(--text-muted)] mb-3">
        {title} ({memories.length})
      </h2>
      <div className="space-y-2">
        {memories.map((mem) => (
          <Link key={mem.id} href={`/memory/${mem.id}`}>
            <Card className="p-4 hover:border-[var(--accent)]/30 transition-colors cursor-pointer">
              <div className="flex items-start justify-between gap-4">
                <p className="text-sm text-[var(--text)] flex-1">
                  {mem.content}
                </p>
                <div className="flex items-center gap-2 shrink-0">
                  <StatusBadge variant="accent">{mem.domain}</StatusBadge>
                  <ConfidenceBar confidence={mem.confidence} />
                </div>
              </div>
              {mem.learned_at && (
                <p className="text-xs text-[var(--text-dim)] mt-1">
                  {formatDate(mem.learned_at)}
                </p>
              )}
            </Card>
          </Link>
        ))}
      </div>
    </div>
  );
}

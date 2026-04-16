import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { getMemoryById, getMemoryEvents, getMemoryConnections } from "@/lib/db";
import { getUserId } from "@/lib/auth";
import {
  formatDate,
  formatConfidence,
} from "@/lib/utils";
import { Card } from "@/components/ui/card";
import { ConfidenceBar } from "@/components/confidence-bar";
import { EventTimeline } from "@/components/event-timeline";
import { ConnectionGraph } from "@/components/connection-graph";
import { EditableMemory } from "@/components/editable-memory";
import { EditableMetadata } from "@/components/editable-metadata";
import { EditableStructuredData } from "@/components/editable-structured-data";
import { MemoryActions } from "./actions";

export const dynamic = "force-dynamic";

interface PageProps {
  params: Promise<{ id: string }>;
}

export default async function MemoryDetailPage({ params }: PageProps) {
  const { id } = await params;
  const userId = await getUserId();
  const memory = await getMemoryById(id, userId);
  if (!memory) notFound();

  const events = await getMemoryEvents(id, userId);
  const connections = await getMemoryConnections(id, userId);

  return (
    <div className="space-y-6">
      <Link
        href="/"
        className="inline-flex items-center gap-1.5 text-sm text-[var(--text-dim)] hover:text-[var(--text)] transition-colors"
      >
        <ArrowLeft size={14} />
        Back to memories
      </Link>

      <Card className="p-6">
        <div className="space-y-4">
          <EditableMemory id={memory.id} content={memory.content} detail={memory.detail} />

          <EditableMetadata
            id={memory.id}
            domain={memory.domain}
            entityType={memory.entity_type}
            entityName={memory.entity_name}
            sourceType={memory.source_type}
            sourceAgentName={memory.source_agent_name}
            sourceDescription={memory.source_description}
            permanence={memory.permanence}
            hasPiiFlag={!!memory.has_pii_flag}
          />

          <div className="max-w-xs">
            <ConfidenceBar confidence={memory.confidence} />
          </div>
        </div>
      </Card>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Card className="p-4">
          <h3 className="text-sm font-semibold mb-3">Stats</h3>
          <div className="grid grid-cols-2 gap-3 text-sm">
            <div>
              <span className="text-[var(--text-dim)]">Confidence</span>
              <p className="font-medium">{formatConfidence(memory.confidence)}</p>
            </div>
            <div>
              <span className="text-[var(--text-dim)]">Confirmed</span>
              <p className="font-medium">{memory.confirmed_count}x</p>
            </div>
            <div>
              <span className="text-[var(--text-dim)]">Corrected</span>
              <p className="font-medium">{memory.corrected_count}x</p>
            </div>
            <div>
              <span className="text-[var(--text-dim)]">Mistakes</span>
              <p className="font-medium">{memory.mistake_count}x</p>
            </div>
            <div>
              <span className="text-[var(--text-dim)]">Used</span>
              <p className="font-medium">{memory.used_count}x</p>
            </div>
            <div>
              <span className="text-[var(--text-dim)]">Learned</span>
              <p className="font-medium">{formatDate(memory.learned_at)}</p>
            </div>
          </div>
        </Card>

        <Card className="p-4">
          <h3 className="text-sm font-semibold mb-3">Actions</h3>
          <MemoryActions id={memory.id} currentContent={memory.content} currentDetail={memory.detail} permanence={memory.permanence} />
        </Card>
      </div>

      <EditableStructuredData
        id={memory.id}
        entityType={memory.entity_type}
        structuredData={memory.structured_data}
      />

      <Card className="p-4">
        <h3 className="text-sm font-semibold mb-3">Connections</h3>
        <ConnectionGraph
          outgoing={connections.outgoing}
          incoming={connections.incoming}
        />
      </Card>

      <Card className="p-4">
        <h3 className="text-sm font-semibold mb-3">
          Event Timeline ({events.length})
        </h3>
        <EventTimeline events={events} />
      </Card>
    </div>
  );
}

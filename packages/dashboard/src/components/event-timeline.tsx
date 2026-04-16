import type { EventRow } from "@/lib/db";
import { formatDate } from "@/lib/utils";
import { StatusBadge } from "@/components/ui/status-badge";

interface EventTimelineProps {
  events: EventRow[];
}

const eventVariant: Record<string, "success" | "warning" | "danger" | "neutral" | "accent"> = {
  created: "accent",
  confirmed: "success",
  corrected: "warning",
  removed: "danger",
  confidence_changed: "neutral",
  used: "neutral",
};

export function EventTimeline({ events }: EventTimelineProps) {
  if (events.length === 0) {
    return (
      <p className="text-sm text-[var(--text-dim)]">No events yet.</p>
    );
  }

  return (
    <div className="space-y-3">
      {events.map((e) => (
        <div key={e.id} className="flex items-start gap-3">
          <div className="mt-0.5">
            <StatusBadge variant={eventVariant[e.event_type] ?? "neutral"}>
              {e.event_type}
            </StatusBadge>
          </div>
          <div className="flex-1 min-w-0">
            {e.agent_name && (
              <span className="text-xs text-[var(--text-muted)]">
                by {e.agent_name}
              </span>
            )}
            {e.new_value && (
              <p className="text-xs text-[var(--text-dim)] mt-0.5 truncate">
                {e.new_value}
              </p>
            )}
          </div>
          <span className="text-xs text-[var(--text-dim)] shrink-0">
            {formatDate(e.timestamp)}
          </span>
        </div>
      ))}
    </div>
  );
}

import { Suspense } from "react";
import { getMemories, getDomains, getSourceTypes, getEntityTypes, getUnreviewedCount, getTotalMemoryCount } from "@/lib/db";
import { getUserId } from "@/lib/auth";
import { MemoryList } from "@/components/memory-list";
import { SearchBar } from "@/components/search-bar";
import { DomainFilter } from "@/components/domain-filter";
import { MemoryFilters } from "@/components/memory-filters";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Sparkles, AlertCircle } from "lucide-react";

export const dynamic = "force-dynamic";

interface PageProps {
  searchParams: Promise<{
    q?: string;
    domain?: string;
    sort?: string;
    source?: string;
    entity?: string;
    minConf?: string;
    maxConf?: string;
    permanence?: string;
    unused?: string;
    review?: string;
  }>;
}

export default async function HomePage({ searchParams }: PageProps) {
  const params = await searchParams;
  const userId = await getUserId();
  const totalCount = await getTotalMemoryCount(userId);

  // Empty state: no memories in the entire DB
  if (totalCount === 0) {
    return (
      <EmptyState
        icon={<Sparkles className="w-8 h-8" />}
        title="No memories yet"
        description={
          <>
            <p className="mb-4">
              Install the Lodis MCP server in your AI client, then ask your
              assistant to remember something. Memories will appear here as
              soon as they&rsquo;re written.
            </p>
            <p className="text-xs text-[var(--text-dim)]">
              Already have memories from another tool? Use{" "}
              <a href="/settings" className="text-[var(--accent-strong)] hover:underline">
                Settings &rarr; Import
              </a>
              .
            </p>
          </>
        }
      />
    );
  }

  const domains = await getDomains(userId);
  const sourceTypes = await getSourceTypes(userId);
  const entityTypes = await getEntityTypes(userId);
  const unreviewedCount = await getUnreviewedCount(userId);

  const sortBy = (["confidence", "recency", "used", "learned"] as const).includes(
    params.sort as "confidence" | "recency" | "used" | "learned",
  )
    ? (params.sort as "confidence" | "recency" | "used" | "learned")
    : "confidence";

  const memories = await getMemories({
    search: params.q,
    domain: params.domain,
    sortBy,
    sourceType: params.source,
    entityType: params.entity,
    minConfidence: params.minConf ? parseFloat(params.minConf) : undefined,
    maxConfidence: params.maxConf ? parseFloat(params.maxConf) : undefined,
    permanence: params.permanence,
    unused: params.unused === "1",
    needsReview: params.review === "1",
  }, userId);

  return (
    <div className="space-y-4">
      <Suspense>
        <SearchBar />
      </Suspense>
      <Suspense>
        <DomainFilter domains={domains} />
      </Suspense>
      <Suspense>
        <MemoryFilters sourceTypes={sourceTypes} entityTypes={entityTypes} />
      </Suspense>

      {unreviewedCount > 0 && params.review !== "1" && (
        <Card className="p-3 border-[var(--accent)] bg-[var(--accent-soft)]">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <AlertCircle className="w-4 h-4 text-[var(--accent)]" />
              <span className="text-sm">
                <strong>{unreviewedCount}</strong> {unreviewedCount === 1 ? "memory needs" : "memories need"} review from onboarding
              </span>
            </div>
            <a href="/?review=1" className="text-sm text-[var(--accent)] hover:underline">
              Review now
            </a>
          </div>
        </Card>
      )}

      <p className="text-xs text-[var(--text-dim)]">
        {memories.length} {memories.length === 1 ? "memory" : "memories"}
      </p>

      <MemoryList
        memories={memories}
        groupByDomain={!params.q && !params.domain}
      />
    </div>
  );
}

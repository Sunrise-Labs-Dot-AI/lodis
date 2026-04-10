import { Suspense } from "react";
import { getMemories, getDomains, getSourceTypes, getEntityTypes, getUnreviewedCount, getTotalMemoryCount } from "@/lib/db";
import { getUserId } from "@/lib/auth";
import { MemoryList } from "@/components/memory-list";
import { SearchBar } from "@/components/search-bar";
import { DomainFilter } from "@/components/domain-filter";
import { MemoryFilters } from "@/components/memory-filters";
import { Card } from "@/components/ui/card";
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
      <div className="flex flex-col items-center justify-center min-h-[60vh] text-center">
        <div className="w-16 h-16 mb-6 rounded-full bg-[var(--color-accent-soft)] flex items-center justify-center">
          <Sparkles className="w-8 h-8 text-[var(--color-accent)]" />
        </div>
        <h2 className="text-2xl font-semibold mb-2">No memories yet</h2>
        <p className="text-[var(--color-text-secondary)] max-w-md mb-8">
          Your memory database is empty. Start a conversation with your AI assistant and say:
        </p>
        <Card className="p-4 max-w-lg w-full mb-4">
          <code className="text-sm text-[var(--color-accent-text)] font-mono">
            &quot;Help me set up Engrams&quot;
          </code>
        </Card>
        <p className="text-xs text-[var(--color-text-muted)]">
          Your AI will scan your connected tools and ask a few questions to seed your memory.
        </p>
      </div>
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
    unused: params.unused === "1",
    needsReview: params.review === "1",
  }, userId);

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3 flex-wrap">
        <Suspense>
          <SearchBar />
        </Suspense>
        <Suspense>
          <DomainFilter domains={domains} />
        </Suspense>
      </div>

      <Suspense>
        <MemoryFilters sourceTypes={sourceTypes} entityTypes={entityTypes} />
      </Suspense>

      {unreviewedCount > 0 && params.review !== "1" && (
        <Card className="p-3 border-[var(--color-accent)] bg-[var(--color-accent-soft)]">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <AlertCircle className="w-4 h-4 text-[var(--color-accent)]" />
              <span className="text-sm">
                <strong>{unreviewedCount}</strong> {unreviewedCount === 1 ? "memory needs" : "memories need"} review from onboarding
              </span>
            </div>
            <a href="/?review=1" className="text-sm text-[var(--color-accent)] hover:underline">
              Review now
            </a>
          </div>
        </Card>
      )}

      <div className="flex items-center justify-between">
        <p className="text-xs text-[var(--color-text-muted)]">
          {memories.length} {memories.length === 1 ? "memory" : "memories"}
        </p>
      </div>

      <MemoryList
        memories={memories}
        groupByDomain={!params.q && !params.domain}
      />
    </div>
  );
}

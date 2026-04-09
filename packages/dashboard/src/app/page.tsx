import { Suspense } from "react";
import { getMemories, getDomains, getSourceTypes, getEntityTypes } from "@/lib/db";
import { MemoryList } from "@/components/memory-list";
import { SearchBar } from "@/components/search-bar";
import { DomainFilter } from "@/components/domain-filter";
import { MemoryFilters } from "@/components/memory-filters";

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
  }>;
}

export default async function HomePage({ searchParams }: PageProps) {
  const params = await searchParams;
  const domains = getDomains();
  const sourceTypes = getSourceTypes();
  const entityTypes = getEntityTypes();

  const sortBy = (["confidence", "recency", "used", "learned"] as const).includes(
    params.sort as "confidence" | "recency" | "used" | "learned",
  )
    ? (params.sort as "confidence" | "recency" | "used" | "learned")
    : "confidence";

  const memories = getMemories({
    search: params.q,
    domain: params.domain,
    sortBy,
    sourceType: params.source,
    entityType: params.entity,
    minConfidence: params.minConf ? parseFloat(params.minConf) : undefined,
    maxConfidence: params.maxConf ? parseFloat(params.maxConf) : undefined,
    unused: params.unused === "1",
  });

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

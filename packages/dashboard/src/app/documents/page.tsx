import { Suspense } from "react";
import { getIndexedDocuments, getIndexSourceSystems } from "@/lib/db";
import { getUserId } from "@/lib/auth";
import { IndexClient } from "./client";

export const dynamic = "force-dynamic";

interface PageProps {
  searchParams: Promise<{
    q?: string;
    source?: string;
    sort?: string;
  }>;
}

export default async function IndexPage({ searchParams }: PageProps) {
  const params = await searchParams;
  const userId = await getUserId();

  const sortBy = (["indexed", "title", "source_modified"] as const).includes(
    params.sort as "indexed" | "title" | "source_modified",
  )
    ? (params.sort as "indexed" | "title" | "source_modified")
    : "indexed";

  const [documents, sourceSystems] = await Promise.all([
    getIndexedDocuments({
      search: params.q,
      source_system: params.source,
      sortBy,
    }, userId),
    getIndexSourceSystems(userId),
  ]);

  return (
    <Suspense>
      <IndexClient documents={documents} sourceSystems={sourceSystems} />
    </Suspense>
  );
}

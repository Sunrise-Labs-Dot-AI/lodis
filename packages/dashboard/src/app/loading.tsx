import { Skeleton, SkeletonMemoryList } from "@/components/ui/skeleton";

export default function Loading() {
  return (
    <div className="space-y-4">
      <Skeleton variant="line" className="h-10 w-full max-w-md" />
      <div className="flex gap-2 flex-wrap">
        {Array.from({ length: 6 }).map((_, i) => (
          <Skeleton key={i} variant="chip" className="w-20" />
        ))}
      </div>
      <Skeleton variant="line" className="h-8 w-64" />
      <SkeletonMemoryList count={5} />
    </div>
  );
}

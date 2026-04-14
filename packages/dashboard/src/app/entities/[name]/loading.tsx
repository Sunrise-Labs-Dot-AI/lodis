import { Skeleton, SkeletonMemoryList } from "@/components/ui/skeleton";

export default function Loading() {
  return (
    <div className="space-y-4">
      <Skeleton variant="header" />
      <Skeleton variant="card" className="h-32" />
      <SkeletonMemoryList count={4} />
    </div>
  );
}

import { Skeleton, SkeletonMemoryList } from "@/components/ui/skeleton";

export default function Loading() {
  return (
    <div className="space-y-4">
      <Skeleton variant="header" />
      <Skeleton variant="line" className="h-4 w-80" />
      <SkeletonMemoryList count={4} />
    </div>
  );
}

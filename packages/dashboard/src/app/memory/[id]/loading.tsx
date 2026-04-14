import { Skeleton } from "@/components/ui/skeleton";

export default function Loading() {
  return (
    <div className="space-y-4">
      <Skeleton variant="line" className="h-4 w-40" />
      <Skeleton variant="card" className="h-48" />
      <Skeleton variant="card" className="h-32" />
    </div>
  );
}

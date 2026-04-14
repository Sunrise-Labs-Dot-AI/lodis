import clsx from "clsx";

type SkeletonVariant = "card" | "line" | "chip" | "header";

interface SkeletonProps extends React.HTMLAttributes<HTMLDivElement> {
  variant?: SkeletonVariant;
}

const variantClasses: Record<SkeletonVariant, string> = {
  card: "h-28 w-full rounded-lg",
  line: "h-4 w-full rounded",
  chip: "h-6 w-16 rounded-full",
  header: "h-8 w-48 rounded",
};

export function Skeleton({
  variant = "line",
  className,
  ...rest
}: SkeletonProps) {
  return (
    <div
      aria-hidden="true"
      className={clsx(
        "skeleton bg-[var(--color-bg-soft)] border border-[var(--color-border-light)]",
        variantClasses[variant],
        className,
      )}
      {...rest}
    />
  );
}

export function SkeletonMemoryList({ count = 4 }: { count?: number }) {
  return (
    <div className="space-y-3" role="status" aria-label="Loading memories">
      {Array.from({ length: count }).map((_, i) => (
        <div
          key={i}
          className="rounded-lg border border-[var(--color-border-light)] bg-[var(--color-card)] p-4"
        >
          <Skeleton variant="line" className="h-4 w-3/4 mb-3" />
          <Skeleton variant="line" className="h-3 w-1/2 mb-3" />
          <div className="flex gap-2">
            <Skeleton variant="chip" />
            <Skeleton variant="chip" className="w-20" />
            <Skeleton variant="chip" className="w-14" />
          </div>
        </div>
      ))}
    </div>
  );
}

import clsx from "clsx";
import type { ReactNode } from "react";

interface EmptyStateProps {
  title: string;
  description?: ReactNode;
  icon?: ReactNode;
  action?: ReactNode;
  className?: string;
}

export function EmptyState({
  title,
  description,
  icon,
  action,
  className,
}: EmptyStateProps) {
  return (
    <div
      className={clsx(
        "flex flex-col items-center justify-center text-center py-12 px-4",
        className,
      )}
    >
      {icon && (
        <div className="w-16 h-16 mb-6 rounded-full bg-[var(--color-accent-soft)] flex items-center justify-center text-[var(--color-accent)]">
          {icon}
        </div>
      )}
      <h2 className="text-xl font-semibold mb-2">{title}</h2>
      {description && (
        <div className="text-sm text-[var(--color-text-secondary)] max-w-md mb-6">
          {description}
        </div>
      )}
      {action && <div>{action}</div>}
    </div>
  );
}

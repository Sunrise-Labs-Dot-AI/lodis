import clsx from "clsx";

type BadgeVariant = "success" | "warning" | "danger" | "neutral" | "accent";

const variantStyles: Record<BadgeVariant, string> = {
  success: "bg-[var(--success-bg)] text-[var(--success)] border border-[rgba(52,211,153,0.2)]",
  warning: "bg-[var(--warning-bg)] text-[var(--warning)] border border-[rgba(251,191,36,0.2)]",
  danger: "bg-[var(--danger-bg)] text-[var(--danger)] border border-[rgba(239,68,68,0.2)]",
  neutral: "bg-[rgba(148,163,184,0.08)] text-[var(--text-muted)] border border-[rgba(148,163,184,0.1)]",
  accent: "bg-[var(--accent-soft)] text-[var(--accent-strong)] border border-[rgba(125,211,252,0.15)]",
};

interface StatusBadgeProps {
  variant?: BadgeVariant;
  children: React.ReactNode;
  className?: string;
}

export function StatusBadge({
  variant = "neutral",
  children,
  className,
}: StatusBadgeProps) {
  return (
    <span
      className={clsx(
        "inline-flex items-center px-2 py-0.5 text-xs font-medium rounded-full",
        variantStyles[variant],
        className,
      )}
    >
      {children}
    </span>
  );
}

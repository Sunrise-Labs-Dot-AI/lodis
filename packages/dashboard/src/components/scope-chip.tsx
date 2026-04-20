import clsx from "clsx";
import type { ScopeLabel } from "@/lib/agent-mode";

// Color + glyph + text token — three redundant cues so the chip is legible
// without color (WCAG 1.4.1). Color is silver-blue family for scope states;
// warm violet is deliberately reserved for sensitive-domain markers
// elsewhere in the product.
const tokenStyles: Record<ScopeLabel["token"], string> = {
  open:
    "bg-[rgba(125,211,252,0.06)] text-[var(--text-muted)] border border-[var(--border)]",
  isolated:
    "bg-[var(--accent-soft)] text-[var(--accent-strong)] border border-[var(--border-strong)]",
  allowlist:
    "bg-[var(--accent-soft)] text-[var(--accent-strong)] border border-[var(--border-strong)]",
  blocklist:
    "bg-[rgba(251,191,36,0.08)] text-[var(--warning)] border border-[rgba(251,191,36,0.2)]",
  mixed:
    "bg-[rgba(148,163,184,0.08)] text-[var(--text-muted)] border border-[rgba(148,163,184,0.16)]",
};

interface ScopeChipProps {
  label: ScopeLabel;
  size?: "sm" | "md";
  className?: string;
}

export function ScopeChip({ label, size = "sm", className }: ScopeChipProps) {
  const ariaLabel = label.detail ? `${label.text}: ${label.detail}` : label.text;
  return (
    <span
      aria-label={ariaLabel}
      data-token={label.token}
      className={clsx(
        "inline-flex items-center gap-1.5 font-medium rounded-full",
        size === "sm" ? "px-2 py-0.5 text-[11px]" : "px-2.5 py-1 text-xs",
        tokenStyles[label.token],
        className,
      )}
    >
      <span aria-hidden="true" className="font-mono leading-none">
        {label.glyph}
      </span>
      <span>{label.text}</span>
    </span>
  );
}

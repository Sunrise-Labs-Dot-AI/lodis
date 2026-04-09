"use client";

import { type ButtonHTMLAttributes } from "react";
import clsx from "clsx";

type Variant = "primary" | "secondary" | "danger" | "ghost";
type Size = "sm" | "md" | "lg";

const variantStyles: Record<Variant, string> = {
  primary:
    "bg-gradient-to-r from-[rgba(125,211,252,0.15)] to-[rgba(167,139,250,0.15)] border border-[var(--color-border-hover)] text-[var(--color-accent-text)] hover:from-[rgba(125,211,252,0.25)] hover:to-[rgba(167,139,250,0.25)] hover:shadow-[0_0_20px_rgba(125,211,252,0.12)] hover:border-[var(--color-glow)]",
  secondary:
    "bg-[var(--color-bg-soft)] text-[var(--color-text)] border border-[var(--color-border)] hover:border-[var(--color-border-hover)] hover:bg-[var(--color-card-hover)]",
  danger:
    "bg-[var(--color-danger-bg)] text-[var(--color-danger)] border border-[rgba(239,68,68,0.2)] hover:border-[rgba(239,68,68,0.4)] hover:shadow-[0_0_15px_rgba(239,68,68,0.1)]",
  ghost:
    "text-[var(--color-text-secondary)] hover:text-[var(--color-text)] hover:bg-[rgba(125,211,252,0.05)]",
};

const sizeStyles: Record<Size, string> = {
  sm: "px-2.5 py-1 text-xs rounded-md",
  md: "px-3.5 py-1.5 text-sm rounded-lg",
  lg: "px-5 py-2.5 text-base rounded-lg",
};

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
}

export function Button({
  variant = "primary",
  size = "md",
  className,
  ...props
}: ButtonProps) {
  return (
    <button
      className={clsx(
        "inline-flex items-center justify-center font-medium transition-all cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed",
        variantStyles[variant],
        sizeStyles[size],
        className,
      )}
      {...props}
    />
  );
}

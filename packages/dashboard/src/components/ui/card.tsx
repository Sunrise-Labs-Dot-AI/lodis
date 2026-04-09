import clsx from "clsx";
import { type HTMLAttributes } from "react";

interface CardProps extends HTMLAttributes<HTMLDivElement> {
  hover?: boolean;
}

export function Card({ hover, className, ...props }: CardProps) {
  return (
    <div
      className={clsx(
        "bg-[var(--color-card)] backdrop-blur-xl border border-[var(--color-border)] rounded-xl transition-all duration-300",
        hover && "hover:bg-[var(--color-card-hover)] hover:border-[var(--color-border-hover)] hover:shadow-[0_0_20px_rgba(125,211,252,0.08)] cursor-pointer",
        className,
      )}
      {...props}
    />
  );
}

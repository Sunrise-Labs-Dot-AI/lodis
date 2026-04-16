"use client";

import clsx from "clsx";

interface ToggleProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label?: string;
  disabled?: boolean;
}

export function Toggle({ checked, onChange, label, disabled }: ToggleProps) {
  return (
    <label
      className={clsx(
        "inline-flex items-center gap-2 cursor-pointer",
        disabled && "opacity-50 cursor-not-allowed",
      )}
    >
      <button
        role="switch"
        aria-checked={checked}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={clsx(
          "relative w-9 h-5 rounded-full transition-colors",
          checked
            ? "bg-[var(--accent-solid)]"
            : "bg-[var(--border)]",
        )}
      >
        <span
          className={clsx(
            "absolute top-0.5 left-0.5 w-4 h-4 bg-[var(--text)] rounded-full transition-transform",
            checked && "translate-x-4",
          )}
        />
      </button>
      {label && (
        <span className="text-sm text-[var(--text-muted)]">
          {label}
        </span>
      )}
    </label>
  );
}

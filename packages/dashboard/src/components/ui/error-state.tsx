"use client";

import { AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";

interface ErrorStateProps {
  title?: string;
  description?: string;
  error?: Error & { digest?: string };
  reset?: () => void;
}

export function ErrorState({
  title = "Something went wrong",
  description = "We couldn't load this page. Try again, or head back home.",
  error,
  reset,
}: ErrorStateProps) {
  const isDev = process.env.NODE_ENV !== "production";

  return (
    <div
      role="alert"
      className="flex flex-col items-center justify-center text-center py-16 px-4"
    >
      <div className="w-16 h-16 mb-6 rounded-full bg-[var(--danger-bg)] flex items-center justify-center text-[var(--danger)]">
        <AlertTriangle className="w-8 h-8" />
      </div>
      <h2 className="text-xl font-semibold mb-2">{title}</h2>
      <p className="text-sm text-[var(--text-muted)] max-w-md mb-6">
        {description}
      </p>
      <div className="flex items-center gap-2">
        {reset && (
          <Button variant="primary" size="sm" onClick={reset}>
            Try again
          </Button>
        )}
      </div>
      {isDev && error?.message && (
        <details className="mt-6 text-left max-w-lg w-full">
          <summary className="text-xs text-[var(--text-dim)] cursor-pointer hover:text-[var(--text)]">
            Error detail
          </summary>
          <pre className="mt-2 p-3 text-xs bg-[var(--bg-soft)] border border-[var(--border)] rounded-md overflow-auto text-[var(--text-muted)]">
            {error.message}
            {error.digest ? `\n\ndigest: ${error.digest}` : ""}
          </pre>
        </details>
      )}
    </div>
  );
}

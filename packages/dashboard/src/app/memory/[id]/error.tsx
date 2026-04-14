"use client";

import { ErrorState } from "@/components/ui/error-state";

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <ErrorState
      title="Couldn't load memory"
      description="Something went wrong while fetching this memory."
      error={error}
      reset={reset}
    />
  );
}

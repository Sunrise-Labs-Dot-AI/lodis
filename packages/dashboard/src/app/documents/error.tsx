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
      title="Couldn't load documents"
      description="Something went wrong while fetching indexed documents."
      error={error}
      reset={reset}
    />
  );
}

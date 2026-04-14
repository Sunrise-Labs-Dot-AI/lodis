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
      title="Couldn't load memories"
      description="Something went wrong while fetching your memories. Try again."
      error={error}
      reset={reset}
    />
  );
}

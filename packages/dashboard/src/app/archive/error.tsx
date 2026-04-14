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
      title="Couldn't load archive"
      description="Something went wrong while fetching archived memories."
      error={error}
      reset={reset}
    />
  );
}

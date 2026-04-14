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
      title="Couldn't load agents"
      description="Something went wrong while fetching agent permissions."
      error={error}
      reset={reset}
    />
  );
}

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
      title="Couldn't load cleanup"
      description="Something went wrong while analyzing your memory health."
      error={error}
      reset={reset}
    />
  );
}

'use client';

import { useEffect } from 'react';
import { Button } from '@/components/ui/Button';

/**
 * Route-level error boundary.
 *
 * The message is deliberately generic. A thrown error's `.message` can carry
 * query internals or upstream detail — the same reason the API routes map
 * status codes to fixed strings rather than forwarding what they received.
 * The digest is shown because it is the only thing that makes a report
 * actionable, and it is an opaque hash by construction.
 */
export default function Error({
  error,
  reset,
}: {
  readonly error: Error & { digest?: string };
  readonly reset: () => void;
}) {
  useEffect(() => {
    // Server console in dev, and the platform's log in production. Not sent
    // anywhere else: the plan rules out analytics and telemetry.
    console.error(error);
  }, [error]);

  return (
    <div className="flex h-[calc(100dvh-48px)] flex-col items-center justify-center gap-3 px-6">
      <h1 className="text-[16px] font-medium text-[var(--color-text)]">Something went wrong</h1>
      <p className="max-w-[320px] text-center text-[13px] leading-[1.5] text-[var(--color-text-muted)]">
        This page failed to load. Trying again usually works.
      </p>
      <Button variant="secondary" onClick={reset}>
        Try again
      </Button>
      {error.digest && (
        <p className="font-mono text-[12px] text-[var(--color-text-muted)]">{error.digest}</p>
      )}
    </div>
  );
}

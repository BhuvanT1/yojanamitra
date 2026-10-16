'use client';

import { useEffect } from 'react';

/**
 * The last line of defence.
 *
 * Without this, an unhandled error on a deployed instance shows a citizen a
 * blank page or a stack trace. Neither is acceptable for someone who came here
 * to find out whether they are owed money.
 *
 * The error's own message is never rendered — it can carry file paths and
 * internals — but the digest is, because that is the string a reviewer needs to
 * find the matching line in the server log.
 */
export default function Error({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error('[ym] unhandled', error);
  }, [error]);

  return (
    <div className="flex min-h-dvh flex-col items-center justify-center px-4 text-center">
      <div className="card max-w-md p-6">
        <h1 className="text-lg font-bold text-ink">Something went wrong at our end</h1>
        <p className="mt-2 text-sm leading-relaxed text-muted">
          This is a fault in the site, not in anything you typed. Nothing you entered was saved.
        </p>
        <div className="mt-5 flex flex-wrap justify-center gap-2.5">
          <button onClick={reset} className="btn-primary">
            Try again
          </button>
          <a href="/en" className="btn-secondary">
            Start over
          </a>
        </div>
        {error.digest && (
          <p className="mt-4 font-mono text-xs text-muted">
            Reference: {error.digest}
          </p>
        )}
      </div>
    </div>
  );
}

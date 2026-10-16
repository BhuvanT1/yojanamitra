import Link from 'next/link';

/**
 * 404.
 *
 * Sends people to the search rather than to a dead end, and says in one line
 * what this site is — somebody who lands here from a stale link has no other
 * context.
 */
export default function NotFound() {
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center px-4 text-center">
      <p className="text-5xl font-extrabold tabular-nums text-brand-200">404</p>
      <h1 className="mt-3 text-xl font-bold text-ink">This page does not exist</h1>
      <p className="mt-2 max-w-sm text-sm leading-relaxed text-muted">
        YojanaMitra helps you find the government schemes you qualify for. Start from the search.
      </p>
      <Link href="/en" className="btn-primary mt-6">
        Find my schemes
      </Link>
    </div>
  );
}

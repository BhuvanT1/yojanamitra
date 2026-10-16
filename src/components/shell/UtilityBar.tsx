'use client';

/**
 * The utility bar.
 *
 * Indian public-service portals carry a thin strip above the masthead with a
 * skip link and text-size controls. Those two conventions are worth adopting
 * literally, because they are the accessibility features a citizen with low
 * vision or a keyboard actually reaches for — and this audience contains more of
 * those people than a typical consumer site, not fewer.
 *
 * The choice persists per browser in localStorage. Wrapped in try/catch because
 * a private window or blocked site data makes every access throw, and a page
 * that white-screens over a font-size preference would be a poor trade.
 */

import { useEffect, useState } from 'react';

type Size = 'md' | 'lg' | 'xl';

const KEY = 'ym.textsize';
const SIZES: Size[] = ['md', 'lg', 'xl'];

export function UtilityBar() {
  const [size, setSize] = useState<Size>('md');

  // Read once on mount rather than during render: the server has no localStorage
  // and a mismatch would be a hydration error.
  useEffect(() => {
    try {
      const saved = localStorage.getItem(KEY);
      if (saved === 'lg' || saved === 'xl') apply(saved);
    } catch {
      /* private window, or site data blocked */
    }
  }, []);

  function apply(next: Size) {
    setSize(next);
    const root = document.documentElement;
    if (next === 'md') delete root.dataset.textsize;
    else root.dataset.textsize = next;
    try {
      localStorage.setItem(KEY, next);
    } catch {
      /* the setting still applies for this page view */
    }
  }

  const step = (by: number) => {
    const i = SIZES.indexOf(size);
    const next = SIZES[Math.min(SIZES.length - 1, Math.max(0, i + by))];
    if (next && next !== size) apply(next);
  };

  return (
    <div className="border-b border-brand-900/20 bg-brand-900 text-white">
      <div className="mx-auto flex max-w-6xl items-center gap-3 px-4 py-1.5 text-xs sm:px-6">
        <a
          href="#main"
          className="rounded px-1.5 py-0.5 underline underline-offset-2 hover:bg-white/10 focus:bg-white/15"
        >
          Skip to main content
        </a>

        <div className="ml-auto flex items-center gap-1">
          <span className="mr-1 hidden text-white/70 sm:inline">Text size</span>
          <button
            type="button"
            onClick={() => step(-1)}
            disabled={size === 'md'}
            aria-label="Decrease text size"
            className="rounded border border-white/25 px-2 py-0.5 font-semibold hover:bg-white/10 disabled:opacity-40"
          >
            A−
          </button>
          <button
            type="button"
            onClick={() => apply('md')}
            aria-label="Reset text size"
            aria-pressed={size === 'md'}
            className={`rounded border px-2 py-0.5 font-semibold ${
              size === 'md' ? 'border-white bg-white/15' : 'border-white/25 hover:bg-white/10'
            }`}
          >
            A
          </button>
          <button
            type="button"
            onClick={() => step(1)}
            disabled={size === 'xl'}
            aria-label="Increase text size"
            className="rounded border border-white/25 px-2 py-0.5 font-semibold hover:bg-white/10 disabled:opacity-40"
          >
            A+
          </button>
        </div>
      </div>
    </div>
  );
}

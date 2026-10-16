import Link from 'next/link';

/**
 * The wordmark.
 *
 * The mark is original: a document with a verified corner. It deliberately does
 * not imitate the State Emblem of India, a ministry logo or any official
 * insignia — this is a student project that reads government documents, not a
 * government service, and a mark that implied otherwise would be a lie told in
 * a logo.
 *
 * What it does say, in the only two shapes available to it, is the product: a
 * page (the scheme document) and a tick (the condition that was checked against
 * it). The tick sits in its own disc in the verdict green used throughout the
 * results, so the mark and the answers belong to the same system.
 */
export function Mark({ className = 'h-9 w-9' }: { className?: string }) {
  return (
    <svg viewBox="0 0 44 44" className={`shrink-0 ${className}`} aria-hidden="true" focusable="false">
      <defs>
        <linearGradient id="ym-tile" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#3a86cf" />
          <stop offset="55%" stopColor="#134e8f" />
          <stop offset="100%" stopColor="#0a2a4d" />
        </linearGradient>
      </defs>

      {/* The tile, with a hairline highlight along the top edge so it reads as
          a physical chip rather than a flat square. */}
      <rect width="44" height="44" rx="12.5" fill="url(#ym-tile)" />
      <path
        d="M12.5 1.5h19A11 11 0 0 1 42.5 12.5"
        fill="none"
        stroke="rgba(255,255,255,.28)"
        strokeWidth="1.6"
        strokeLinecap="round"
      />

      {/* The document, with its corner turned. */}
      <path
        d="M14 11.5h10.4l6.1 6.1V31a1.6 1.6 0 0 1-1.6 1.6H14A1.6 1.6 0 0 1 12.4 31V13.1A1.6 1.6 0 0 1 14 11.5Z"
        fill="#fff"
        fillOpacity=".93"
      />
      <path d="M24.4 11.5l6.1 6.1h-6.1Z" fill="#9dc2e6" />
      {/* Two ruled lines: enough to read as text, few enough to stay crisp at 24px. */}
      <path
        d="M16.4 21.4h7M16.4 25.2h5"
        stroke="#134e8f"
        strokeOpacity=".38"
        strokeWidth="1.7"
        strokeLinecap="round"
      />

      {/* The verdict. Same green as an "eligible" result. */}
      <circle cx="31.4" cy="29.6" r="7.1" fill="#136c34" stroke="#fff" strokeWidth="2.2" />
      <path
        d="m28.4 29.8 2.1 2.1 3.6-4.1"
        fill="none"
        stroke="#fff"
        strokeWidth="2.1"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function Brand({ locale, sub }: { locale: string; sub?: string }) {
  return (
    <div className="flex min-w-0 items-center gap-2.5">
      <Link
        href={`/${locale}`}
        className="group flex min-w-0 items-center gap-2.5 rounded-lg"
        aria-label="YojanaMitra"
      >
        <Mark className="h-9 w-9 transition-transform duration-200 group-hover:scale-105" />
        <span className="hidden truncate text-[1.12rem] font-extrabold leading-none tracking-tight text-brand-dark min-[360px]:inline">
          Yojana<span className="text-brand-400">Mitra</span>
        </span>
      </Link>
      {sub && (
        <span className="hidden truncate border-l border-line pl-2.5 text-sm font-medium text-muted sm:inline">
          {sub}
        </span>
      )}
    </div>
  );
}

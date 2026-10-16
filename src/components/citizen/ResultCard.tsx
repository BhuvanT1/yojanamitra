'use client';

/**
 * A scheme result.
 *
 * The card's whole reason for existing is the expandable clause list. A verdict
 * on its own is a claim; a verdict with the exact sentence the citizen satisfied,
 * quoted from the official page and linked to it, is something they can take to
 * an office and argue with. So the quote gets the serif face and the widest
 * measure on the card, and everything above it is furniture leading there.
 *
 * `likely` must never look like `eligible`. It carries a different colour, a
 * different icon, a different label AND an explicit sentence saying something is
 * unverified — colour alone would fail for a colour-blind citizen and for anyone
 * reading in bright sunlight on a cheap screen.
 */

import { useState } from 'react';
import { fieldLabel, type Messages } from '@/i18n/messages';

type Verdict = 'eligible' | 'likely_eligible' | 'ineligible';
type Status = 'satisfied' | 'violated' | 'unknown';

interface Check {
  clause_id: string;
  clause_text: string;
  source_url: string;
  status: Status;
  reason: string;
  missing_fields: string[];
}

export interface SchemeResult {
  scheme_id: string;
  scheme_name: string;
  verdict: Verdict;
  checks: Check[];
  cited_only: { clause_id: string; clause_text: string; why: string }[];
  missing_fields: string[];
  source_url: string;
}

/**
 * Icons as geometry, not glyphs.
 *
 * "✓" and "✕" were rendering at wildly different weights and baselines across
 * the font stack — and vanishing entirely on an Android without the right
 * fallback, which left a coloured pill with no symbol in it. Drawn paths render
 * identically everywhere.
 */
function StatusIcon({ status, className = 'h-3.5 w-3.5' }: { status: Status; className?: string }) {
  return (
    <svg viewBox="0 0 16 16" className={className} fill="none" aria-hidden="true">
      {status === 'satisfied' && (
        <path
          d="m3.6 8.4 2.9 2.9L12.4 5"
          stroke="currentColor"
          strokeWidth="2.2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      )}
      {status === 'violated' && (
        <path
          d="M4.4 4.4l7.2 7.2m0-7.2L4.4 11.6"
          stroke="currentColor"
          strokeWidth="2.2"
          strokeLinecap="round"
        />
      )}
      {status === 'unknown' && (
        <>
          <path
            d="M5.7 5.9a2.3 2.3 0 1 1 3.2 2.1c-.6.3-.9.8-.9 1.4v.4"
            stroke="currentColor"
            strokeWidth="1.9"
            strokeLinecap="round"
          />
          <circle cx="8" cy="12.3" r="1" fill="currentColor" />
        </>
      )}
    </svg>
  );
}

/** The verdict maps onto one of the three check statuses, visually. */
const AS_STATUS: Record<Verdict, Status> = {
  eligible: 'satisfied',
  likely_eligible: 'unknown',
  ineligible: 'violated',
};

/**
 * A white card with a coloured spine, rather than a fully tinted block.
 *
 * Tinting the whole card made a list of results read as a wall of colour and
 * pushed the scheme name — the thing a citizen actually needs to recognise —
 * into a low-contrast field. The spine and the chip carry the verdict; the
 * content sits on white where it is easiest to read.
 */
const STYLE: Record<Verdict, { spine: string; chip: string; tint: string; text: string; rule: string }> = {
  eligible: {
    spine: 'border-l-yes',
    chip: 'bg-yes text-white',
    tint: 'bg-yes-bg border-yes-line',
    text: 'text-yes',
    rule: 'border-yes-line',
  },
  likely_eligible: {
    spine: 'border-l-maybe',
    chip: 'bg-maybe text-white',
    tint: 'bg-maybe-bg border-maybe-line',
    text: 'text-maybe',
    rule: 'border-maybe-line',
  },
  ineligible: {
    spine: 'border-l-no',
    chip: 'bg-no text-white',
    tint: 'bg-no-bg border-no-line',
    text: 'text-no',
    rule: 'border-no-line',
  },
};

const CHECK_TONE: Record<Status, string> = {
  satisfied: 'bg-yes-bg text-yes border-yes-line',
  violated: 'bg-no-bg text-no border-no-line',
  unknown: 'bg-maybe-bg text-maybe border-maybe-line',
};

const QUOTE_RULE: Record<Status, string> = {
  satisfied: '!border-yes-line',
  violated: '!border-no-line',
  unknown: '!border-maybe-line',
};

export function ResultCard({
  t,
  locale,
  result,
  simulated,
  summary,
  summaryBusy,
}: {
  t: Messages;
  /** Only for field labels — `special_categories` is an identifier, not English. */
  locale: string;
  result: SchemeResult;
  simulated: boolean;
  /**
   * Plain-language wording for this verdict. Decoration only — the verdict,
   * the label and the clause list are all rendered from the engine's own output,
   * so a wrong or missing sentence cannot change what the citizen is told.
   */
  summary?: string;
  summaryBusy?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const s = STYLE[result.verdict];
  const label =
    result.verdict === 'eligible' ? t.eligible : result.verdict === 'likely_eligible' ? t.likely : t.notEligible;
  const help =
    result.verdict === 'eligible' ? t.eligibleHelp : result.verdict === 'likely_eligible' ? t.likelyHelp : '';

  const unverified = result.cited_only.filter((c) => c.why.includes('not yet approved'));

  return (
    <article className={`card-interactive border-l-[5px] p-4 sm:p-5 ${s.spine}`}>
      <div className="flex flex-wrap items-center gap-2">
        <span
          className={`inline-flex shrink-0 items-center gap-1.5 rounded-full px-3 py-1 text-[0.8rem] font-bold tracking-tight ${s.chip}`}
        >
          <StatusIcon status={AS_STATUS[result.verdict]} />
          {label}
        </span>
        {simulated && (
          <span className="rounded-full border border-no-line px-2 py-0.5 text-[0.7rem] font-bold uppercase tracking-wide text-no">
            {t.simulated}
          </span>
        )}
      </div>

      {/* The legal name is never translated — a citizen must be able to search
          for it and quote it at an office. */}
      <h3
        className="mt-2.5 text-[1.12rem] font-bold leading-snug tracking-tight text-ink sm:text-[1.24rem]"
        lang="en"
      >
        {result.scheme_name}
      </h3>
      {help && <p className="mt-1 text-sm text-muted">{help}</p>}

      {(summary || summaryBusy) && (
        <div className={`mt-3 rounded-xl border px-3.5 py-3 ${s.tint}`}>
          <p className={`eyebrow ${s.text}`}>{t.aiSummary}</p>
          {summary ? (
            <p className="mt-1 text-[0.95rem] leading-relaxed text-ink">{summary}</p>
          ) : (
            <div className="mt-2 space-y-1.5" aria-hidden="true">
              <div className="skeleton h-3.5 w-full" />
              <div className="skeleton h-3.5 w-2/3" />
            </div>
          )}
        </div>
      )}

      {result.missing_fields.length > 0 && (
        <p className="mt-3 flex items-start gap-2 rounded-xl border border-maybe-line bg-maybe-bg px-3 py-2 text-sm font-semibold text-maybe">
          <StatusIcon status="unknown" className="mt-0.5 h-4 w-4 shrink-0" />
          <span>
            {t.tellUs} {result.missing_fields.map((f) => fieldLabel(locale, f).toLowerCase()).join(', ')}
          </span>
        </p>
      )}

      <div className="mt-4 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          aria-controls={`why-${result.scheme_id}`}
          className="btn-secondary btn-sm"
        >
          <svg
            viewBox="0 0 16 16"
            className={`h-3.5 w-3.5 transition-transform duration-200 ${open ? 'rotate-90' : ''}`}
            fill="none"
            aria-hidden="true"
          >
            <path d="m6 3.5 5 4.5-5 4.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          {open ? t.hideWhy : t.whyThis}
          <span className="pill bg-ink/5 px-1.5 py-0 text-xs text-muted">{result.checks.length}</span>
        </button>
        <a
          href={result.source_url}
          target="_blank"
          rel="noreferrer noopener"
          className="btn-secondary btn-sm !text-brand hover:!border-brand"
        >
          {t.applyAt}
          <span aria-hidden="true">↗</span>
        </a>
      </div>

      {open && (
        <div
          id={`why-${result.scheme_id}`}
          className={`mt-4 animate-fade-up space-y-3 border-t pt-4 ${s.rule}`}
        >
          <p className="eyebrow text-muted">{t.conditionsTitle}</p>

          {result.checks.map((c) => {
            const statusLabel =
              c.status === 'satisfied' ? t.satisfied : c.status === 'violated' ? t.violated : t.unknown;

            return (
              <div key={c.clause_id} className="rounded-xl border border-line bg-paper p-3.5">
                <span
                  className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-xs font-bold ${CHECK_TONE[c.status]}`}
                >
                  <StatusIcon status={c.status} className="h-3 w-3" />
                  {statusLabel}
                </span>

                {/* Quoted verbatim from the official page. Never paraphrased. */}
                <figure className="mt-2.5">
                  <blockquote className={`quote rounded-r-lg ${QUOTE_RULE[c.status]}`} lang="en">
                    {c.clause_text}
                  </blockquote>
                  <figcaption className="mt-1.5 pl-4 text-[0.7rem] font-semibold uppercase tracking-[0.07em] text-muted">
                    {t.evidenceLabel}
                  </figcaption>
                </figure>

                {/* Our reading of the clause, kept visibly subordinate to the
                    clause itself. If the two ever disagree, the quote is the
                    one the citizen should trust. */}
                <p className="mt-2.5 pl-4 text-sm leading-relaxed text-muted">{c.reason}</p>
              </div>
            );
          })}

          {unverified.length > 0 && (
            <div className="rounded-xl border border-maybe-line bg-maybe-bg/60 p-3.5">
              <p className="flex items-center gap-1.5 text-sm font-bold text-maybe">
                <StatusIcon status="unknown" className="h-4 w-4" />
                {t.unverified}
              </p>
              <p className="mt-1 text-sm leading-relaxed text-ink-soft">{t.unverifiedHelp}</p>
              <ul className="mt-2.5 space-y-2">
                {unverified.slice(0, 4).map((c) => (
                  <li key={c.clause_id} className="quote rounded-r-lg !border-maybe-line text-sm" lang="en">
                    {c.clause_text.length > 170 ? `${c.clause_text.slice(0, 167)}…` : c.clause_text}
                  </li>
                ))}
              </ul>
            </div>
          )}

          <p className="break-all pt-1 text-xs text-muted">
            <a
              href={result.source_url}
              target="_blank"
              rel="noreferrer noopener"
              className="underline underline-offset-2 hover:text-brand"
            >
              {result.source_url}
            </a>
          </p>
        </div>
      )}
    </article>
  );
}

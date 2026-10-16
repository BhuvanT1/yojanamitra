'use client';

/**
 * The citizen surface.
 *
 * Deliberately one screen: type, see what we understood, see the schemes. No
 * wall, no step counter. Anything a citizen must click through before seeing a
 * result is a place they leave.
 *
 * An account is offered but never required, and the offer only ever appears
 * AFTER an answer is on screen. Nothing on the path from sentence to result asks
 * who you are, and the match endpoint neither reads nor writes the session — a
 * signed-in citizen and an anonymous one take the identical code path.
 *
 * On a wide screen the results split into two columns: the correction panel
 * stays in view on the left while the schemes scroll on the right, because the
 * two are read together — a citizen scanning results is exactly the person who
 * notices a wrong field. On a phone it stacks, correction panel first.
 */

import { use, useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { HeroInput } from '@/components/citizen/HeroInput';
import { UnderstoodPanel } from '@/components/citizen/UnderstoodPanel';
import { ResultCard, type SchemeResult } from '@/components/citizen/ResultCard';
import { Masthead } from '@/components/shell/Masthead';
import { SiteFooter, type Provenance } from '@/components/shell/SiteFooter';
import { DEFAULT_LOCALE, LOCALES, messagesFor, UNTRANSLATED, isLocale } from '@/i18n/messages';
import type { Profile } from '@/domain/profile';

interface MatchResponse {
  profile: Profile;
  unknown_fields: string[];
  eligible: SchemeResult[];
  likely_eligible: SchemeResult[];
  ineligible: SchemeResult[];
  counts: { eligible: number; likely_eligible: number; ineligible: number };
  meta: {
    simulated: boolean;
    approved_clauses: number;
    provenance: Provenance | null;
  };
}

function Skeletons() {
  return (
    <div className="space-y-3" aria-live="polite" aria-busy="true">
      <span className="sr-only">Loading results</span>
      {[0, 1, 2].map((i) => (
        <div key={i} className="card p-5">
          <div className="skeleton h-6 w-28" />
          <div className="skeleton mt-3 h-5 w-3/4" />
          <div className="skeleton mt-2 h-4 w-1/2" />
        </div>
      ))}
    </div>
  );
}

/** A small fact under the hero. Three of these, never more. */
function Trust({ children }: { children: React.ReactNode }) {
  return (
    <li className="flex items-center gap-2 rounded-full border border-line bg-paper/70 px-3 py-1.5 text-sm text-ink-soft">
      <svg viewBox="0 0 16 16" className="h-4 w-4 shrink-0 text-yes" aria-hidden="true">
        <circle cx="8" cy="8" r="7" fill="currentColor" opacity=".14" />
        <path
          d="m5 8.2 2.1 2.1L11 6.4"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
      {children}
    </li>
  );
}

/** A result-group heading: coloured rule, name, count. */
function GroupHead({
  id,
  title,
  count,
  rule,
  pill,
}: {
  id: string;
  title: string;
  count: number;
  rule: string;
  pill: string;
}) {
  return (
    <div className="group-head">
      <span aria-hidden="true" className={`group-rule ${rule}`} />
      <h2 id={id} className="text-xl font-bold tracking-tight text-ink">
        {title}
      </h2>
      <span className={`pill ${pill}`}>{count}</span>
    </div>
  );
}

export default function Page({ params }: { params: Promise<{ locale: string }> }) {
  const { locale: rawLocale } = use(params);
  const locale = isLocale(rawLocale) ? rawLocale : DEFAULT_LOCALE;
  const t = messagesFor(locale);

  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [data, setData] = useState<MatchResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  /** scheme_id → plain-language sentence, written after results are already shown. */
  const [summaries, setSummaries] = useState<Record<string, string>>({});
  const [aiProvider, setAiProvider] = useState<string | null>(null);
  /** One paragraph describing the engine's list. Never the source of the list. */
  const [summary, setSummary] = useState<{ text: string; source: string } | null>(null);
  const [aiBusy, setAiBusy] = useState(false);
  /** null while signed out, which is the normal and fully supported state. */
  const [citizen, setCitizen] = useState<{ username: string; has_saved: boolean } | null>(null);
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved'>('idle');
  const resultsRef = useRef<HTMLDivElement>(null);
  /**
   * Set only for a fresh search. A correction re-runs the match too, and
   * scrolling the page back to the top of the results every time someone fixes a
   * field yanked them away from the row they were editing.
   */
  const scrollOnNextResult = useRef(false);

  /**
   * Fetch plain-language wording AFTER results are on screen.
   *
   * Never awaited by the result render: the rule engine has already decided, and
   * a slow or missing model must not delay the answer a citizen came for.
   */
  const explain = useCallback(
    async (
      eligible: SchemeResult[],
      likely: SchemeResult[],
      counts: { eligible: number; likely_eligible: number },
    ) => {
    const matches = [...eligible, ...likely];
    if (matches.length === 0) return;
    setAiBusy(true);
    try {
      const res = await fetch('/api/explain', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        // The eligible/likely split travels with the request so the summary
        // describes the same buckets the citizen is looking at.
        body: JSON.stringify({ matches, eligible, likely, counts }),
      });
      if (!res.ok) return;
      const json = (await res.json()) as {
        explanations: { scheme_id: string; text: string }[];
        provider: string | null;
        model: string | null;
        summary: { text: string; source: string } | null;
      };
      const next: Record<string, string> = {};
      for (const e of json.explanations) next[e.scheme_id] = e.text;
      setSummaries(next);
      setSummary(json.summary);
      setAiProvider(json.provider ? `${json.provider}/${json.model}` : null);
      } catch {
        // Wording is an enhancement; failing to get it changes nothing important.
      } finally {
        setAiBusy(false);
      }
    },
    [],
  );

  const run = useCallback(
    async (body: Record<string, unknown>) => {
      setBusy(true);
      setError(null);
      setSummaries({});
      setSummary(null);
      setSaveState('idle');
      try {
        const res = await fetch('/api/match', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(body),
        });
        const json = (await res.json()) as MatchResponse & { error?: string };
        if (!res.ok) throw new Error(json.error ?? 'request failed');
        setData(json);
        void explain(json.eligible, json.likely_eligible, json.counts);
      } catch (e) {
        setError(e instanceof Error ? e.message : 'something went wrong');
      } finally {
        setBusy(false);
      }
    },
    [explain],
  );

  /**
   * Find out whether anyone is signed in, and honour `?use_saved=1`.
   *
   * Signed out is a normal 200 with a null username, not an error — the catch
   * here is for a dead network, and even then the page works.
   */
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const me = (await (await fetch('/api/citizen/me')).json()) as {
          username: string | null;
          has_saved: boolean;
        };
        if (cancelled || !me.username) return;
        setCitizen({ username: me.username, has_saved: me.has_saved });

        // Only ever on an explicit request from the account page. Auto-running a
        // stored profile the moment someone opens the site would be unnerving,
        // and would answer a question they had not asked yet.
        const wants = new URLSearchParams(window.location.search).get('use_saved') === '1';
        if (!wants || !me.has_saved) return;

        const saved = (await (await fetch('/api/citizen/profile')).json()) as { profile: Profile | null };
        if (!cancelled && saved.profile) void run({ profile: saved.profile });
      } catch {
        /* no account, no network, no problem — the search works regardless */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [run]);

  // Move to the answer once it exists, so a phone user is not left staring at
  // the box they just typed into.
  useEffect(() => {
    if (!data || busy || !scrollOnNextResult.current) return;
    scrollOnNextResult.current = false;
    resultsRef.current?.scrollIntoView({ block: 'start' });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);

  /** Explicit, and only offered once an answer is already on screen. */
  const saveDetails = useCallback(async () => {
    if (!data) return;
    setSaveState('saving');
    try {
      const res = await fetch('/api/citizen/profile', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ profile: data.profile }),
      });
      setSaveState(res.ok ? 'saved' : 'idle');
      if (res.ok) setCitizen((c) => (c ? { ...c, has_saved: true } : c));
    } catch {
      setSaveState('idle');
    }
  }, [data]);

  /**
   * `spoken` is passed when speech recognition finished and triggered the search
   * itself — the transcript is authoritative there, because React state may not
   * have caught up with the final result event yet.
   */
  const submit = (spoken?: string) => {
    const query = (spoken ?? text).trim();
    if (!query) return;
    if (spoken && spoken !== text) setText(spoken);
    scrollOnNextResult.current = true;
    void run({ text: query });
  };

  /** A correction is authoritative — we re-match from the corrected profile. */
  const correct = (field: string, value: unknown) => {
    if (!data) return;
    const next: Profile = {
      ...data.profile,
      [field]: { value, confidence: 1, evidence: [], origin: 'user_corrected' },
    };
    setData({ ...data, profile: next });
    void run({ profile: next });
  };

  const simulated = data?.meta.simulated ?? false;
  const nothingApproved = data !== null && data.meta.approved_clauses === 0;
  const hasResults = data !== null;

  return (
    <div className="flex min-h-dvh flex-col">
      <Masthead locale={locale}>
        <label htmlFor="lang" className="sr-only">
          {t.language}
        </label>
        <select
          id="lang"
          value={locale}
          onChange={(e) => {
            window.location.pathname = `/${e.target.value}`;
          }}
          className="tap max-w-[7rem] truncate rounded-lg border border-line-strong bg-paper px-2 py-2
                     text-sm font-medium text-ink hover:border-brand sm:max-w-[9rem] sm:px-2.5"
        >
          {LOCALES.map((l) => (
            <option key={l.code} value={l.code}>
              {l.native}
              {UNTRANSLATED.includes(l.code) ? ' (English)' : ''}
            </option>
          ))}
        </select>

        {/* Present but never in the way: no badge, no nudge, no modal. */}
        <Link
          href={`/${locale}/account`}
          title={t.accountNotNeeded}
          className="tap inline-flex max-w-[9rem] items-center gap-1.5 truncate rounded-lg border
                     border-line-strong px-2.5 py-2 text-sm font-medium text-ink hover:border-brand
                     hover:text-brand"
        >
          <svg viewBox="0 0 20 20" className="h-4 w-4 shrink-0" fill="none" aria-hidden="true">
            <circle cx="10" cy="6.6" r="3.1" stroke="currentColor" strokeWidth="1.6" />
            <path
              d="M4 16.4c.9-2.7 3.2-4.2 6-4.2s5.1 1.5 6 4.2"
              stroke="currentColor"
              strokeWidth="1.6"
              strokeLinecap="round"
            />
          </svg>
          <span className="hidden truncate sm:inline">{citizen ? citizen.username : t.accountLink}</span>
          <span className="sr-only sm:hidden">{t.accountLink}</span>
        </Link>
      </Masthead>

      {simulated && (
        <div role="status" className="border-b border-no-line bg-no-bg">
          <div className="mx-auto flex max-w-6xl items-start gap-2.5 px-4 py-3 sm:px-6">
            <svg viewBox="0 0 20 20" className="mt-0.5 h-4 w-4 shrink-0 text-no" fill="none" aria-hidden="true">
              <path
                d="M10 2.9 18.4 17H1.6L10 2.9Z"
                stroke="currentColor"
                strokeWidth="1.7"
                strokeLinejoin="round"
              />
              <path d="M10 8.2v3.4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
              <circle cx="10" cy="14.1" r="1" fill="currentColor" />
            </svg>
            <p className="text-sm leading-relaxed">
              <span className="font-bold text-no">{t.simulated}</span>{' '}
              <span className="text-ink-soft">{t.simulatedHelp}</span>
            </p>
          </div>
        </div>
      )}

      <main id="main" className="flex-1">
        {/* ------------------------------------------------------------ hero */}
        <section
          className={`mx-auto w-full max-w-4xl px-4 sm:px-6 ${
            hasResults ? 'pt-8 pb-6' : 'pt-10 pb-10 sm:pt-14 sm:pb-12'
          }`}
        >
          {!hasResults && (
            <div className="mx-auto max-w-3xl text-center">
              <h1 className="text-balance text-display font-extrabold tracking-tight text-brand-900">{t.heroTitle}</h1>
              {/* A short rule under the heading rather than a coloured word: the
                  accent lands without tinting any of the text a citizen reads. */}
              <span
                aria-hidden="true"
                className="mx-auto mt-5 block h-1 w-16 rounded-full bg-gradient-to-r from-saffron to-india-green"
              />
              <p className="mx-auto mt-5 max-w-xl text-lede text-muted">{t.tagline}</p>
            </div>
          )}

          <div className={`card mx-auto max-w-3xl p-4 shadow-hero sm:p-6 ${hasResults ? '' : 'mt-8'}`}>
            <HeroInput t={t} locale={locale} value={text} onChange={setText} onSubmit={submit} busy={busy} />
          </div>

          {/*
            Worked examples.

            The commonest way this product fails is a citizen looking at an empty
            box, unsure how much detail counts as an answer. A placeholder is not
            enough — it disappears the moment they type. These stay, and one tap
            fills the field with a sentence of exactly the right shape.
          */}
          {!hasResults && (
            <div className="mx-auto mt-5 max-w-3xl">
              <p className="text-center text-sm text-muted">{t.examplesLabel}</p>
              <ul className="mt-2.5 flex flex-wrap justify-center gap-2">
                {[t.exampleOne, t.exampleTwo, t.exampleThree].map((ex) => (
                  <li key={ex} className="min-w-0">
                    <button type="button" onClick={() => setText(ex)} className="chip">
                      <span className="truncate">{ex}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {!hasResults && (
            <ul className="mt-7 flex flex-wrap items-center justify-center gap-2.5">
              <Trust>{t.trustSource}</Trust>
              <Trust>{t.trustQuote}</Trust>
              <Trust>{t.trustNoAccount}</Trust>
            </ul>
          )}

          {error && (
            <p role="alert" className="mx-auto mt-4 max-w-3xl rounded-xl border border-no-line bg-no-bg p-3 text-sm text-no">
              {error}
            </p>
          )}
        </section>

        {/* --------------------------------------------------------- results */}
        <div ref={resultsRef} id="results" className="mx-auto max-w-6xl scroll-mt-6 px-4 pb-16 sm:px-6">
          {busy && !data && <Skeletons />}

          {/*
            A paragraph describing the engine's list, above the list itself.

            It is never the source of the list — the cards below render from the
            engine's own output whatever this says, and the model is given only
            the scheme names the engine produced. A summary that names something
            else, or states an amount it was never given, is discarded in favour
            of deterministic text before it ever reaches here.
          */}
          {data && !busy && (summary || aiBusy) && (
            <section
              aria-labelledby="summary-h"
              className="mb-6 animate-fade-up overflow-hidden rounded-2xl border border-brand-200 bg-brand-50"
            >
              <div className="flex items-start gap-3.5 p-5">
                <span
                  aria-hidden="true"
                  className="mt-0.5 grid h-9 w-9 shrink-0 place-items-center rounded-full bg-brand text-white"
                >
                  <svg viewBox="0 0 20 20" className="h-[18px] w-[18px]" fill="none">
                    <path
                      d="M10 2.6 12 7.4l4.8.4-3.7 3.2 1.1 4.7L10 13.2l-4.2 2.5 1.1-4.7L3.2 7.8 8 7.4Z"
                      stroke="currentColor"
                      strokeWidth="1.5"
                      strokeLinejoin="round"
                    />
                  </svg>
                </span>

                <div className="min-w-0 flex-1">
                  <h2 id="summary-h" className="eyebrow text-brand">
                    {t.summaryTitle}
                  </h2>

                  {summary ? (
                    <p className="mt-1.5 text-[1.05rem] leading-relaxed text-ink">{summary.text}</p>
                  ) : (
                    <div className="mt-2.5 space-y-2" aria-hidden="true">
                      <div className="skeleton h-4 w-full" />
                      <div className="skeleton h-4 w-11/12" />
                      <div className="skeleton h-4 w-2/3" />
                    </div>
                  )}
                </div>
              </div>

              {/*
                The provenance of the wording, in its own strip rather than as
                grey text under the paragraph. Who wrote this sentence, and the
                fact that it did not choose the schemes, is not a footnote — it
                is the thing that makes the sentence safe to show at all.
              */}
              {summary && (
                <p className="border-t border-brand-200 bg-brand-100/60 px-5 py-2.5 text-xs leading-relaxed text-brand-dark">
                  {summary.source === 'model' && aiProvider
                    ? `${t.aiWrittenBy} ${aiProvider}. ${t.summaryNote}`
                    : `${t.aiDeterministic} ${t.summaryNote}`}
                </p>
              )}
            </section>
          )}

          {data && (
            <div className="grid animate-fade-up gap-6 lg:grid-cols-[minmax(0,21rem)_minmax(0,1fr)] lg:gap-8">
              {/* ------------------------------------------------- left rail */}
              {/* On a phone the answer comes first and the correction panel
                  follows it: a citizen came for a result, not a form. On a wide
                  screen the panel returns to the left rail where both are
                  visible at once. */}
              <aside className="order-2 space-y-4 lg:order-1 lg:sticky lg:top-8 lg:self-start">
                <UnderstoodPanel
                  t={t}
                  locale={locale}
                  profile={data.profile}
                  unknownFields={data.unknown_fields}
                  onCorrect={correct}
                />

                {/*
                  The account offer, in the only place it belongs: after the
                  answer. Putting it before results would make it a wall, which
                  is exactly what this project refuses to build.
                */}
                {!busy && (
                  <div className="card p-4">
                    <span className="eyebrow rounded bg-ink/5 px-1.5 py-0.5 text-muted">{t.optional}</span>
                    {citizen ? (
                      <>
                        <button
                          onClick={saveDetails}
                          disabled={saveState !== 'idle'}
                          className={`btn btn-sm mt-2.5 w-full ${
                            saveState === 'saved'
                              ? 'border-yes-line bg-yes-bg text-yes'
                              : 'border-brand text-brand hover:bg-brand-50'
                          }`}
                        >
                          {saveState === 'saving'
                            ? t.savingDetails
                            : saveState === 'saved'
                              ? `✓ ${t.detailsSaved}`
                              : t.saveDetails}
                        </button>
                        <p className="mt-2 text-sm text-muted">{t.saveDetailsHelp}</p>
                      </>
                    ) : (
                      <p className="mt-2 text-sm text-muted">
                        <Link
                          href={`/${locale}/account`}
                          className="font-semibold text-brand underline underline-offset-2"
                        >
                          {t.saveDetails}
                        </Link>{' '}
                        — {t.saveDetailsHelp}
                      </p>
                    )}
                  </div>
                )}
              </aside>

              {/* ----------------------------------------------- result list */}
              <div className="order-1 min-w-0 space-y-6 lg:order-2">
                {nothingApproved && (
                  <p className="rounded-xl border border-maybe-line bg-maybe-bg p-4 text-sm text-ink">
                    {t.nothingApproved}
                  </p>
                )}

                {busy && <Skeletons />}

                {!busy && (
                  <>
                    {data.counts.eligible > 0 && (
                      <section aria-labelledby="h-yes" className="space-y-3">
                        <GroupHead
                          id="h-yes"
                          title={t.eligible}
                          count={data.counts.eligible}
                          rule="bg-yes"
                          pill="bg-yes-bg text-yes"
                        />
                        {data.eligible.map((r) => (
                          <ResultCard
                            key={r.scheme_id}
                            t={t}
                            locale={locale}
                            result={r}
                            simulated={simulated}
                            summary={summaries[r.scheme_id]}
                            summaryBusy={aiBusy}
                          />
                        ))}
                      </section>
                    )}

                    {data.counts.likely_eligible > 0 && (
                      <section aria-labelledby="h-maybe" className="space-y-3">
                        <GroupHead
                          id="h-maybe"
                          title={t.likely}
                          count={data.counts.likely_eligible}
                          rule="bg-maybe"
                          pill="bg-maybe-bg text-maybe"
                        />
                        {data.likely_eligible.map((r) => (
                          <ResultCard
                            key={r.scheme_id}
                            t={t}
                            locale={locale}
                            result={r}
                            simulated={simulated}
                            summary={summaries[r.scheme_id]}
                            summaryBusy={aiBusy}
                          />
                        ))}
                      </section>
                    )}

                    {data.counts.eligible === 0 && data.counts.likely_eligible === 0 && !nothingApproved && (
                      <div className="card p-8 text-center">
                        {/* An abstract mark, not a sad face. Nothing went wrong
                            here and the citizen should not be consoled. */}
                        <svg
                          viewBox="0 0 64 64"
                          className="mx-auto h-14 w-14 text-line-strong"
                          fill="none"
                          aria-hidden="true"
                        >
                          <rect x="12" y="8" width="32" height="42" rx="4" stroke="currentColor" strokeWidth="2.5" />
                          <path
                            d="M20 22h16M20 30h16M20 38h10"
                            stroke="currentColor"
                            strokeWidth="2.5"
                            strokeLinecap="round"
                          />
                          <circle cx="44" cy="44" r="11" fill="#fff" stroke="currentColor" strokeWidth="2.5" />
                          <path d="m51.8 51.8 5.2 5.2" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
                        </svg>
                        <p className="mt-3 text-lg font-semibold text-ink">{t.noResults}</p>
                        <p className="mx-auto mt-1.5 max-w-sm text-sm leading-relaxed text-muted">
                          {t.noResultsHelp}
                        </p>
                      </div>
                    )}

                    {data.counts.ineligible > 0 && (
                      <details className="card group overflow-hidden">
                        <summary className="tap flex cursor-pointer list-none items-center gap-2.5 px-4 py-3.5 text-base font-semibold text-ink marker:hidden hover:bg-surface/60">
                          <svg
                            viewBox="0 0 16 16"
                            className="h-4 w-4 shrink-0 text-muted transition-transform duration-200 group-open:rotate-90"
                            fill="none"
                            aria-hidden="true"
                          >
                            <path
                              d="m6 3.5 5 4.5-5 4.5"
                              stroke="currentColor"
                              strokeWidth="2"
                              strokeLinecap="round"
                              strokeLinejoin="round"
                            />
                          </svg>
                          {t.notEligible}
                          <span className="pill bg-ink/5 text-muted">{data.counts.ineligible}</span>
                        </summary>
                        <div className="space-y-3 border-t border-line bg-surface/60 p-4">
                          {data.ineligible.map((r) => (
                            <ResultCard key={r.scheme_id} t={t} locale={locale} result={r} simulated={simulated} />
                          ))}
                        </div>
                      </details>
                    )}
                  </>
                )}
              </div>
            </div>
          )}
        </div>
      </main>

      <SiteFooter
        t={t}
        locale={locale}
        provenance={data?.meta.provenance ?? null}
        approvedClauses={data?.meta.approved_clauses}
        aiProvider={aiProvider}
      />
    </div>
  );
}

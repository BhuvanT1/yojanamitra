/**
 * Reviewer dashboard — what is left to review, and what a field would unlock.
 *
 * A server component: it reads the annotation store directly and is protected by
 * middleware, so an unauthenticated request never reaches this code at all.
 */

import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import Link from 'next/link';
import { AnnotationStore } from '@/storage/annotation_store';
import { SESSION_COOKIE, verifySession } from '@/auth/users';
import { InviteButton } from '@/components/reviewer/InviteButton';
import { TriagePanel } from '@/components/reviewer/TriagePanel';
import { MODEL_INFO, summarise } from '@/triage/predict';
import { DraftPanel } from '@/components/reviewer/DraftPanel';
import { DRAFT_INFO, summariseDrafts } from '@/proposals/predicted';
import { SimpleHeader } from '@/components/shell/SimpleHeader';
import { DEFAULT_LOCALE, isLocale } from '@/i18n/messages';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export default async function ReviewerPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale: raw } = await params;
  const locale = isLocale(raw) ? raw : DEFAULT_LOCALE;

  const jar = await cookies();
  const username = verifySession(jar.get(SESSION_COOKIE)?.value);
  if (!username) redirect(`/${locale}/login`);

  let stats: ReturnType<AnnotationStore['stats']> | null = null;
  let triage: ReturnType<typeof summarise> | null = null;
  let drafts: ReturnType<typeof summariseDrafts> | null = null;
  let quickWinText: Record<string, string> = {};
  let draftText: Record<string, string> = {};

  try {
    const store = new AnnotationStore();
    stats = store.stats();

    // Predict only over what is still awaiting review — an already-approved
    // clause needs no triage, and including them would flatter the counts.
    const pending = store.all().filter((c) => c.annotation_state === 'proposed');
    if (pending.length > 0) {
      triage = summarise(pending.map((c) => ({ id: c.id })));
      const byId = new Map(pending.map((c) => [c.id, c.source_text]));
      quickWinText = Object.fromEntries(
        triage.quickWins.map((q) => [q.id, byId.get(q.id) ?? '']),
      );

      // Only the clauses that arrive with nothing drafted. Passing everything
      // would make the coverage figure meaningless.
      const blank = pending.filter((c) => !c.constraint).map((c) => c.id);
      drafts = summariseDrafts(blank);
      draftText = Object.fromEntries(drafts.top.map((d) => [d.id, byId.get(d.id) ?? '']));
    }
  } catch {
    stats = null;
  }

  const pct = (n: number) => (stats && stats.total ? `${((n / stats.total) * 100).toFixed(1)}%` : '—');

  return (
    <div className="flex min-h-dvh flex-col">
      <SimpleHeader locale={locale} sub="Reviewer">
        <span className="hidden text-sm text-muted sm:inline">
          signed in as <strong className="text-ink">{username}</strong>
        </span>
        <form action="/api/auth/logout" method="post">
          <button formAction="/api/auth/logout" className="btn-secondary btn-sm" type="submit">
            Sign out
          </button>
        </form>
      </SimpleHeader>

      <main id="main" className="mx-auto w-full max-w-3xl flex-1 space-y-6 px-4 py-8 sm:px-6">
        <div>
          <h1 className="text-2xl font-bold text-ink">Annotation backlog</h1>
          <p className="mt-1 text-sm text-muted">
            Approvals are recorded against <strong>{username}</strong>. Nothing in the corpus can decide a
            citizen&rsquo;s eligibility until a clause here is approved.
          </p>
        </div>

        {!stats ? (
          <p className="rounded-xl border border-maybe-line bg-maybe-bg p-4 text-sm">
            No annotation file yet. Run <code className="font-mono">npm run propose</code> first.
          </p>
        ) : (
          <>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              {[
                { label: 'Decisive', value: stats.decisive, tone: 'text-yes' },
                { label: 'Awaiting review', value: stats.by_state.proposed, tone: 'text-ink' },
                { label: 'Needs a new field', value: stats.by_state.needs_schema_extension, tone: 'text-maybe' },
                { label: 'Not checkable', value: stats.by_state.not_machine_checkable, tone: 'text-muted' },
              ].map((c) => (
                <div key={c.label} className="card p-4">
                  <p className={`text-2xl font-bold tabular-nums ${c.tone}`}>{c.value.toLocaleString('en-IN')}</p>
                  <p className="mt-0.5 text-xs text-muted">{c.label}</p>
                  <p className="text-xs text-muted">{pct(c.value)}</p>
                </div>
              ))}
            </div>

            {stats.decisive === 0 && (
              <p className="rounded-xl border border-maybe-line bg-maybe-bg p-4 text-sm text-ink">
                <strong>Zero clauses are approved.</strong> The rule engine can decide nothing for anyone, which
                is the correct behaviour — not a bug. Working the queue below is what changes it.
              </p>
            )}

            <div className="card p-4">
              <h2 className="text-base font-semibold text-ink">Schema extension backlog</h2>
              <p className="mt-1 text-sm text-muted">
                Clauses that are checkable in principle but need a profile field we do not have. Adding the
                field at the top unlocks the most clauses.
              </p>
              <table className="mt-3 w-full text-sm">
                <thead>
                  <tr className="border-b border-line text-left text-xs uppercase tracking-wide text-muted">
                    <th className="pb-2">Clauses</th>
                    <th className="pb-2">Field</th>
                  </tr>
                </thead>
                <tbody>
                  {stats.missing_fields.slice(0, 8).map((g) => (
                    <tr key={g.field} className="border-b border-line/60">
                      <td className="py-2 font-semibold tabular-nums">{g.clauses}</td>
                      <td className="py-2 font-mono text-xs">{g.field}</td>
                    </tr>
                  ))}
                  {stats.missing_fields.length === 0 && (
                    <tr>
                      <td colSpan={2} className="py-3 text-muted">
                        Nothing queued.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            <div className="rounded-2xl border border-brand-200 bg-brand-50 p-4">
              <h2 className="text-base font-semibold text-ink">Review clauses</h2>
              <p className="mt-1 text-sm text-ink/80">
                The review tool runs as its own keyboard-driven server. Start it from the project folder:
              </p>
              <code className="mt-2 block rounded bg-paper px-3 py-2 font-mono text-xs">
                REVIEWER={username} npm run review
              </code>
              {/* The review tool is a separate local process. On a deployed
                  instance there is nothing at localhost:5174, so the link would
                  be a dead end — say what it is instead of offering it. */}
              {process.env.NODE_ENV === 'development' ? (
                <p className="mt-2 text-sm">
                  <a
                    href="http://localhost:5174"
                    className="font-semibold text-brand underline underline-offset-2"
                    target="_blank"
                    rel="noreferrer noopener"
                  >
                    Open the review tool ↗
                  </a>
                </p>
              ) : (
                <p className="mt-2 text-sm text-ink/70">
                  It runs on the machine holding the annotation volume, not in the browser you are reading
                  this in.
                </p>
              )}
            </div>
          </>
        )}

        {triage && (
          <TriagePanel summary={triage} quickWinText={quickWinText} info={MODEL_INFO} />
        )}

        {drafts && (
          <DraftPanel summary={drafts} clauseText={draftText} info={DRAFT_INFO} />
        )}

        {/* Outside the stats branch: inviting a colleague does not depend on the
            annotation file existing yet. */}
        <InviteButton locale={locale} />
      </main>
    </div>
  );
}

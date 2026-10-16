'use client';

/**
 * Reviewer signup.
 *
 * Two states, and the page says plainly which one it is in:
 *
 *   Bootstrap — no reviewer exists yet, so this form is open. Shown with a
 *   warning, because the person who fills it in becomes the first account that
 *   can approve eligibility clauses.
 *
 *   Invite-only — at least one reviewer exists, so a code is required. The form
 *   still renders; hiding it would just make people think the app is broken.
 *
 * As on the sign-in page, the first thing a citizen sees is that none of this is
 * for them.
 */

import { use, useEffect, useState } from 'react';
import Link from 'next/link';
import { SimpleHeader } from '@/components/shell/SimpleHeader';
import { DEFAULT_LOCALE, isLocale, messagesFor } from '@/i18n/messages';

export default function SignupPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale: raw } = use(params);
  const locale = isLocale(raw) ? raw : DEFAULT_LOCALE;
  const t = messagesFor(locale);

  const [needsInvite, setNeedsInvite] = useState<boolean | null>(null);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [invite, setInvite] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/auth/signup')
      .then((r) => r.json() as Promise<{ needs_invite: boolean }>)
      .then((d) => setNeedsInvite(d.needs_invite))
      .catch(() => setNeedsInvite(true));
  }, []);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/auth/signup', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ username, password, invite: invite || undefined }),
      });
      const data = (await res.json()) as { error?: string };
      if (!res.ok) {
        setError(data.error ?? 'Could not create the account.');
        return;
      }
      window.location.pathname = `/${locale}/reviewer`;
    } catch {
      setError('Could not reach the server.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-dvh flex-col">
      <SimpleHeader locale={locale} sub="New reviewer" />

      <main id="main" className="mx-auto w-full max-w-md flex-1 px-4 py-10 sm:py-14">
        <div className="rounded-xl border border-brand-200 bg-brand-50 p-4">
          <p className="text-sm text-ink">
            <strong>Citizens do not need an account.</strong> This is for reviewers who approve eligibility
            conditions.
          </p>
          <Link
            href={`/${locale}`}
            className="tap mt-1.5 inline-block text-sm font-semibold text-brand underline underline-offset-2"
          >
            {t.backToSearch}
          </Link>
        </div>

        <div className="card mt-6 p-6">
          <h1 className="text-xl font-bold text-ink">Create a reviewer account</h1>

          {needsInvite === false && (
            <div role="status" className="mt-3 rounded-xl border border-maybe-line bg-maybe-bg p-3 text-sm">
              <p className="font-bold text-maybe">You will be the first reviewer</p>
              <p className="mt-1 text-ink">
                No reviewer exists yet, so this form is open. Once you create this account it closes, and
                anyone else needs an invite code from you.
              </p>
            </div>
          )}

          {needsInvite === true && (
            <p className="mt-1 text-sm text-muted">
              Reviewer accounts are invite-only. Ask an existing reviewer for a code — they can issue one from
              their dashboard.
            </p>
          )}

          <form onSubmit={submit} className="mt-6 space-y-4">
            <div>
              <label htmlFor="username" className="label">
                {t.username}
              </label>
              <input
                id="username"
                name="username"
                autoComplete="username"
                autoFocus
                required
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                className="field mt-1.5"
              />
              <p className="mt-1 text-xs text-muted">
                This name is stamped on every clause you approve, so use your real one.
              </p>
            </div>

            <div>
              <label htmlFor="password" className="label">
                {t.password}
              </label>
              <input
                id="password"
                name="password"
                type="password"
                autoComplete="new-password"
                required
                minLength={8}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="field mt-1.5"
              />
              <p className="mt-1 text-xs text-muted">At least 8 characters.</p>
            </div>

            {needsInvite !== false && (
              <div>
                <label htmlFor="invite" className="label">
                  Invite code
                </label>
                <input
                  id="invite"
                  name="invite"
                  required={needsInvite === true}
                  value={invite}
                  placeholder="XXXX-XXXX-XXXX-XXXX"
                  onChange={(e) => setInvite(e.target.value)}
                  className="field mt-1.5 font-mono uppercase tracking-wider"
                />
              </div>
            )}

            {error && (
              <p role="alert" className="rounded-xl border border-no-line bg-no-bg p-3 text-sm text-no">
                {error}
              </p>
            )}

            <button
              type="submit"
              disabled={busy || needsInvite === null}
              className="btn-primary w-full"
            >
              {busy ? 'Creating…' : 'Create account'}
            </button>
          </form>
        </div>

        <p className="mt-5 text-center text-sm text-muted">
          <Link href={`/${locale}/login`} className="font-semibold text-brand underline underline-offset-2">
            Already a reviewer? Sign in
          </Link>
        </p>
      </main>
    </div>
  );
}

'use client';

/**
 * Reviewer sign-in.
 *
 * This page says plainly who it is for, because a login screen with no context
 * makes a citizen think they need an account. They do not, and the page tells
 * them so with a link straight back to the search.
 */

import { use, useState } from 'react';
import Link from 'next/link';
import { SimpleHeader } from '@/components/shell/SimpleHeader';
import { DEFAULT_LOCALE, isLocale, messagesFor } from '@/i18n/messages';

export default function LoginPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale: raw } = use(params);
  const locale = isLocale(raw) ? raw : DEFAULT_LOCALE;
  const t = messagesFor(locale);

  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hint, setHint] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setHint(null);
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ username, password }),
      });
      const data = (await res.json()) as { error?: string; message?: string };
      if (!res.ok) {
        if (data.error === 'no_users') setHint(data.message ?? null);
        else setError(data.error ?? 'Sign in failed.');
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
      <SimpleHeader locale={locale} sub="Reviewer sign-in" />

      <main id="main" className="mx-auto w-full max-w-md flex-1 px-4 py-10 sm:py-14">
        {/* Said first, before the form, so nobody assumes they need an account. */}
        <div className="rounded-xl border border-brand-200 bg-brand-50 p-4">
          <p className="text-sm text-ink">
            <strong>Citizens do not need an account.</strong> This sign-in is only for reviewers who approve
            eligibility conditions.
          </p>
          <Link
            href={`/${locale}`}
            className="tap mt-1.5 inline-block text-sm font-semibold text-brand underline underline-offset-2"
          >
            {t.backToSearch}
          </Link>
        </div>

        <div className="card mt-6 p-6">
          <h1 className="text-xl font-bold text-ink">Reviewer sign-in</h1>
          <p className="mt-1 text-sm text-muted">
            Approvals are recorded against your name, which is why this is not anonymous.
          </p>

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
            </div>

            <div>
              <label htmlFor="password" className="label">
                {t.password}
              </label>
              <input
                id="password"
                name="password"
                type="password"
                autoComplete="current-password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="field mt-1.5"
              />
            </div>

            {error && (
              <p role="alert" className="rounded-xl border border-no-line bg-no-bg p-3 text-sm text-no">
                {error}
              </p>
            )}

            {hint && (
              <div role="status" className="rounded-xl border border-maybe-line bg-maybe-bg p-3 text-sm text-ink">
                <p className="font-bold text-maybe">No reviewer accounts exist yet</p>
                <p className="mt-1">
                  Signup is open until the first one is created.{' '}
                  <Link
                    href={`/${locale}/signup`}
                    className="font-semibold text-brand underline underline-offset-2"
                  >
                    Create the first reviewer account
                  </Link>
                  , or run <code className="font-mono text-xs">npm run reviewer:add -- yourname</code> from the
                  project folder.
                </p>
              </div>
            )}

            <button type="submit" disabled={busy} className="btn-primary w-full">
              {busy ? 'Signing in…' : t.signIn}
            </button>
          </form>
        </div>

        <p className="mt-5 text-center text-sm text-muted">
          Have an invite code?{' '}
          <Link href={`/${locale}/signup`} className="font-semibold text-brand underline underline-offset-2">
            Create a reviewer account
          </Link>
        </p>
      </main>
    </div>
  );
}

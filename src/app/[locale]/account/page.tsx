'use client';

/**
 * The optional citizen account.
 *
 * Every design decision on this page follows from one rule: nobody is ever sent
 * here to get an answer. The search works signed out, so this page has to earn
 * its existence by being useful, and it has to say plainly what it stores. The
 * first block on the screen is the reassurance, not the form.
 *
 * It also has to be honest about the trade. Saving details means holding facts
 * about a real person's income, land and family, so the page shows exactly what
 * is held, and puts deletion one tap away rather than three menus deep.
 */

import { use, useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { SimpleHeader } from '@/components/shell/SimpleHeader';
import { DEFAULT_LOCALE, fieldLabel, isLocale, messagesFor } from '@/i18n/messages';
import { PROFILE_FIELDS, type Profile } from '@/domain/profile';

type Mode = 'signin' | 'signup';

function formatValue(value: unknown, locale: string): string {
  if (Array.isArray(value)) return value.join(', ');
  if (typeof value === 'number') return value.toLocaleString(locale === 'en' ? 'en-IN' : locale);
  return String(value);
}

export default function AccountPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale: raw } = use(params);
  const locale = isLocale(raw) ? raw : DEFAULT_LOCALE;
  const t = messagesFor(locale);

  const [loading, setLoading] = useState(true);
  const [username, setUsername] = useState<string | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [savedAt, setSavedAt] = useState<string | null>(null);

  /**
   * Opened from the welcome screen's "Create an account" button, this must land
   * on the signup form. Landing on sign-in and making someone hunt for the
   * toggle is a small bug with a large drop-off.
   */
  const [mode, setMode] = useState<Mode>('signin');
  useEffect(() => {
    if (new URLSearchParams(window.location.search).get('mode') === 'signup') setMode('signup');
  }, []);
  const [nameField, setNameField] = useState('');
  const [passField, setPassField] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const me = (await (await fetch('/api/citizen/me')).json()) as { username: string | null };
      setUsername(me.username);
      if (me.username) {
        const p = (await (await fetch('/api/citizen/profile')).json()) as {
          profile: Profile | null;
          saved_at: string | null;
        };
        setProfile(p.profile);
        setSavedAt(p.saved_at);
      }
    } catch {
      setUsername(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(mode === 'signup' ? '/api/citizen/signup' : '/api/citizen/login', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ username: nameField, password: passField }),
      });
      const data = (await res.json()) as { error?: string };
      if (!res.ok) {
        setError(data.error ?? 'Something went wrong.');
        return;
      }
      setPassField('');
      await refresh();
    } catch {
      setError('Could not reach the server.');
    } finally {
      setBusy(false);
    }
  }

  async function signOut() {
    await fetch('/api/citizen/logout', { method: 'POST' });
    setUsername(null);
    setProfile(null);
  }

  async function forgetDetails() {
    await fetch('/api/citizen/profile', { method: 'DELETE' });
    setProfile(null);
    setSavedAt(null);
  }

  async function closeAccount() {
    await fetch('/api/citizen/me', { method: 'DELETE' });
    setUsername(null);
    setProfile(null);
    setSavedAt(null);
  }

  const savedFields = profile
    ? PROFILE_FIELDS.filter((f) => f !== 'dependents').filter(
        (f) => (profile as unknown as Record<string, unknown>)[f] !== undefined,
      )
    : [];

  return (
    <div className="flex min-h-dvh flex-col">
      <SimpleHeader locale={locale} sub={t.accountLink}>
        {username && (
          <button onClick={signOut} className="btn-secondary btn-sm">
            {t.signOut}
          </button>
        )}
      </SimpleHeader>

      <main id="main" className="mx-auto w-full max-w-md flex-1 px-4 py-10">
        {/* Said before anything else, so nobody fills in a form they never needed. */}
        <div className="rounded-xl border border-brand-200 bg-brand-50 p-4">
          <p className="eyebrow text-brand">{t.optional}</p>
          <p className="mt-1.5 text-sm leading-relaxed text-ink">{t.accountNotNeeded}</p>
          <Link
            href={`/${locale}`}
            className="tap mt-1.5 inline-block text-sm font-semibold text-brand underline underline-offset-2"
          >
            {t.backToSearch}
          </Link>
        </div>

        {loading && <p className="mt-8 text-sm text-muted">…</p>}

        {!loading && !username && (
          <div className="card mt-6 p-6">
            <h1 className="text-xl font-bold text-ink">{mode === 'signup' ? t.createAccount : t.signIn}</h1>

            <form onSubmit={submit} className="mt-5 space-y-4">
              <div>
                <label htmlFor="u" className="label">
                  {t.username}
                </label>
                <input
                  id="u"
                  autoComplete="username"
                  required
                  value={nameField}
                  onChange={(e) => setNameField(e.target.value)}
                  className="field mt-1.5"
                />
              </div>
              <div>
                <label htmlFor="p" className="label">
                  {t.password}
                </label>
                <input
                  id="p"
                  type="password"
                  autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
                  required
                  minLength={mode === 'signup' ? 8 : undefined}
                  value={passField}
                  onChange={(e) => setPassField(e.target.value)}
                  className="field mt-1.5"
                />
              </div>

              {error && (
                <p role="alert" className="rounded-xl border border-no-line bg-no-bg p-3 text-sm text-no">
                  {error}
                </p>
              )}

              <button type="submit" disabled={busy} className="btn-primary w-full">
                {busy ? '…' : mode === 'signup' ? t.createAccount : t.signIn}
              </button>
            </form>

            <button
              onClick={() => {
                setMode(mode === 'signup' ? 'signin' : 'signup');
                setError(null);
              }}
              className="tap mt-4 w-full text-center text-sm font-semibold text-brand underline underline-offset-2"
            >
              {mode === 'signup' ? t.haveAccount : t.noAccount}
            </button>
          </div>
        )}

        {!loading && username && (
          <>
            <div className="card mt-6 overflow-hidden">
              <div className="border-b border-line bg-surface/60 px-5 py-4">
                <h1 className="text-lg font-bold text-ink">{t.accountTitle}</h1>
                <p className="mt-0.5 text-sm text-muted">
                  <strong className="text-ink">{username}</strong>
                  {savedAt && ` · ${new Date(savedAt).toLocaleDateString()}`}
                </p>
              </div>

              {savedFields.length === 0 ? (
                <p className="px-5 py-6 text-sm text-muted">{t.savedNothingYet}</p>
              ) : (
                <>
                  <dl className="divide-y divide-line px-5">
                    {savedFields.map((f) => (
                      <div key={f} className="flex items-baseline gap-3 py-2.5">
                        <dt className="w-2/5 shrink-0 text-sm text-muted">{fieldLabel(locale, f)}</dt>
                        <dd className="text-sm font-semibold text-ink">
                          {formatValue(
                            ((profile as unknown as Record<string, { value: unknown }>)[f] ?? {}).value,
                            locale,
                          )}
                        </dd>
                      </div>
                    ))}
                    {profile && profile.dependents.length > 0 && (
                      <div className="flex items-baseline gap-3 py-2.5">
                        <dt className="w-2/5 shrink-0 text-sm text-muted">
                          {fieldLabel(locale, 'dependents')}
                        </dt>
                        <dd className="text-sm font-semibold text-ink">{profile.dependents.length}</dd>
                      </div>
                    )}
                  </dl>
                  <p className="border-t border-line bg-surface/60 px-5 py-3 text-xs leading-relaxed text-muted">
                    {t.whatWeStore}
                  </p>
                </>
              )}
            </div>

            {savedFields.length > 0 && (
              <div className="mt-4 space-y-2.5">
                <Link href={`/${locale}?use_saved=1`} className="btn-primary w-full">
                  {t.useSavedDetails}
                </Link>
                <button onClick={forgetDetails} className="btn-secondary btn-sm w-full">
                  {t.forgetDetails}
                </button>
              </div>
            )}

            <div className="mt-8 rounded-xl border border-no-line bg-no-bg p-4">
              <p className="text-sm font-bold text-no">{t.deleteAccount}</p>
              <p className="mt-1 text-sm leading-relaxed text-ink-soft">{t.deleteAccountHelp}</p>
              <button
                onClick={closeAccount}
                className="btn btn-sm mt-3 border-no-line bg-paper text-no hover:border-no"
              >
                {t.deleteAccount}
              </button>
            </div>
          </>
        )}
      </main>
    </div>
  );
}

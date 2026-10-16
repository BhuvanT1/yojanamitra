import Link from 'next/link';
import { Mark } from '@/components/shell/Brand';
import { AccentRule } from '@/components/shell/AccentRule';
import { DEFAULT_LOCALE, LOCALES, UNTRANSLATED, isLocale, messagesFor } from '@/i18n/messages';

/**
 * The welcome screen.
 *
 * A door, not a gate. The order of the three choices is the whole design:
 * "Continue without signing in" is the primary button, on top, in solid brand
 * colour, and the two account options sit below it in quieter styling. A citizen
 * who cannot read confidently should be able to land here, press the biggest
 * button, and be searching.
 *
 * That ordering is not decoration. A welcome screen that leads with a login form
 * is a signup wall with an escape hatch, and every extra decision between a
 * person and finding out they are owed money is a person who does not find out.
 * The escape hatch is the main road here; the account is the detour.
 *
 * A server component, deliberately: no JavaScript is needed to choose a door, so
 * the language choices are plain links and the whole page works before any
 * script loads. `/<locale>` — the search itself — remains directly reachable, so
 * a bookmark or a returning visitor never sees this screen at all.
 */
export default async function WelcomePage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale: raw } = await params;
  const locale = isLocale(raw) ? raw : DEFAULT_LOCALE;
  const t = messagesFor(locale);

  return (
    <div className="flex min-h-dvh flex-col">
      {/* The same accent rule the masthead carries, so the first screen belongs
          to the same site as every screen after it. */}
      <AccentRule />

      <main id="main" className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center px-4 py-12 sm:py-16">
        {/* ------------------------------------------------------------ brand */}
        <div className="text-center">
          {/* The mark on a soft disc, so it sits on the page rather than
              floating on it. One ring, no glow. */}
          <span className="mx-auto grid h-24 w-24 place-items-center rounded-full bg-paper shadow-card ring-1 ring-line">
            <Mark className="h-[66px] w-[66px]" />
          </span>

          <h1 className="mt-5 text-[2.1rem] font-extrabold tracking-tight text-brand-900 sm:text-[2.45rem]">
            Yojana<span className="text-brand-400">Mitra</span>
          </h1>

          {/* Stated on the very first screen, not buried in a footer. */}
          <p className="mx-auto mt-2.5 inline-flex items-center gap-1.5 rounded-full border border-line-strong bg-paper px-3 py-1 text-xs font-semibold text-ink-soft">
            <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-maybe" />
            A student project · Not an official Government service
          </p>

          <p className="mx-auto mt-4 max-w-sm text-[1rem] leading-relaxed text-muted">{t.welcomeLead}</p>
        </div>

        {/* ---------------------------------------------------------- choices */}
        <div className="card mt-8 p-5 shadow-lift">
          {/* First, biggest, and the only solid button on the page. */}
          <Link href={`/${locale}`} className="btn-primary group w-full text-[1.05rem]">
            {t.continueWithout}
            <svg viewBox="0 0 16 16" className="h-4 w-4 transition-transform duration-200 group-hover:translate-x-0.5" fill="none" aria-hidden="true">
              <path d="M2.5 8h11m-4.2-4.2L13.5 8l-4.2 4.2" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </Link>
          <p className="mt-2.5 text-center text-sm text-muted">{t.continueWithoutHelp}</p>

          <div className="my-5 flex items-center gap-3" aria-hidden="true">
            <span className="h-px flex-1 bg-line" />
            <span className="text-xs font-semibold uppercase tracking-wider text-muted">{t.or}</span>
            <span className="h-px flex-1 bg-line" />
          </div>

          <div className="space-y-2.5">
            <Link href={`/${locale}/account`} className="btn-secondary w-full">
              {t.signIn}
            </Link>
            <Link href={`/${locale}/account?mode=signup`} className="btn-secondary w-full">
              {t.createAccount}
            </Link>
          </div>
          <p className="mt-2.5 text-center text-sm text-muted">{t.createAccountHelp}</p>
        </div>

        {/* --------------------------------------------------------- language */}
        <div className="mt-8">
          <p className="text-center text-xs font-semibold uppercase tracking-wider text-muted">
            {t.language}
          </p>
          <ul className="mt-2.5 flex flex-wrap items-center justify-center gap-2">
            {LOCALES.map((l) => {
              const active = l.code === locale;
              return (
                <li key={l.code}>
                  <Link
                    href={`/${l.code}/welcome`}
                    lang={l.code}
                    aria-current={active ? 'true' : undefined}
                    className={`tap inline-flex items-center rounded-full border px-3.5 py-2 text-sm font-medium ${
                      active
                        ? 'border-brand bg-brand text-white'
                        : 'border-line-strong bg-paper text-ink hover:border-brand hover:text-brand'
                    }`}
                  >
                    {l.native}
                    {UNTRANSLATED.includes(l.code) && (
                      <span className={`ml-1 text-xs ${active ? 'text-white/70' : 'text-muted'}`}>(EN)</span>
                    )}
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      </main>

      <footer className="border-t border-line bg-paper">
        <div className="mx-auto max-w-md space-y-2 px-4 py-6 text-center">
          <p className="text-sm text-muted">{t.disclaimer}</p>
          {/* Quietest thing on the page: a citizen should never wonder whether
              this link was meant for them. */}
          <p className="text-sm">
            <Link
              href={`/${locale}/login`}
              className="text-muted underline underline-offset-2 hover:text-brand"
            >
              {t.reviewerLink}
            </Link>
          </p>
        </div>
      </footer>
    </div>
  );
}

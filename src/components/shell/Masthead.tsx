import Link from 'next/link';
import { Brand } from './Brand';
import { AccentRule } from './AccentRule';

/**
 * The masthead.
 *
 * Built to the conventions of an Indian government service portal — tricolour
 * accent rule, formal masthead band, breadcrumb strip — under this project's own
 * identity. What it deliberately does NOT carry: the State Emblem, a "Government
 * of India" lockup, a ministry name, or any other official insignia.
 *
 * That restraint is the point. Everything else in this codebase exists to stop
 * the system asserting an eligibility verdict it cannot justify; dressing the
 * result in government livery would undo all of it at the last step, because a
 * citizen who believes an unverified verdict came from the government has been
 * misled by the design rather than by the engine.
 *
 * Hence the disclosure band, which is not removable by a prop: every page states
 * what this is. It was moved out of the masthead row and onto its own full-width
 * strip because wedged between the wordmark and the controls it read as a
 * stray caption — which is the one thing a disclosure must not do.
 */
export function Masthead({
  locale,
  section,
  children,
  breadcrumb,
}: {
  locale: string;
  /** Shown beside the wordmark: "Reviewer", "Saved details", and so on. */
  section?: string;
  /** Controls for the right-hand side of the masthead. */
  children?: React.ReactNode;
  /** Trailing crumb. "Home ›" is always prepended. */
  breadcrumb?: string;
}) {
  return (
    /*
      Deliberately NOT sticky. It was, briefly: with the accent rule, the
      masthead row and the disclosure band it stands about 120px tall, which is
      a seventh of a phone screen surrendered on every scroll — on the one screen
      where the thing being scrolled is the answer the citizen came for. A
      language switcher within reach does not buy that back.
    */
    <header className="bg-paper">
      <AccentRule />

      <div className="border-b border-line">
        <div className="mx-auto flex max-w-6xl items-center gap-x-4 px-4 py-3 sm:px-6">
          <Brand locale={locale} sub={section} />
          {children && <div className="ml-auto flex items-center gap-2">{children}</div>}
        </div>
      </div>

      {/* The disclosure. Its own band, full width, on every page. */}
      <p className="border-b border-line bg-surface/80">
        <span className="mx-auto block max-w-6xl px-4 py-1.5 text-xs leading-snug text-muted sm:px-6">
          A student project that reads published scheme documents.{' '}
          <strong className="font-semibold text-ink-soft">Not an official Government service.</strong>
        </span>
      </p>

      {breadcrumb && (
        <nav aria-label="Breadcrumb" className="border-b border-line bg-paper">
          <ol className="mx-auto flex max-w-6xl items-center gap-1.5 px-4 py-2 text-xs text-muted sm:px-6">
            <li>
              <Link href={`/${locale}`} className="underline underline-offset-2 hover:text-brand">
                Home
              </Link>
            </li>
            <li aria-hidden="true">›</li>
            <li aria-current="page" className="font-semibold text-ink-soft">
              {breadcrumb}
            </li>
          </ol>
        </nav>
      )}
    </header>
  );
}

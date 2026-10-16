import Link from 'next/link';
import { AccentRule } from './AccentRule';
import type { Messages } from '@/i18n/messages';

export interface Provenance {
  dataset: string;
  dataset_url: string;
  commit_sha: string;
  license: string;
  schemes: number;
  ingested_at: string;
}

/**
 * The footer, in the shape public-service portals use: a dark band of link
 * columns over a legal strip.
 *
 * It carries the two claims the project is answerable for — that this is
 * guidance rather than a decision, and exactly which corpus at which commit
 * produced the answer. Both are stated plainly rather than buried in small grey
 * text, because they are the difference between a demo and something a person
 * could act on.
 */
export function SiteFooter({
  t,
  locale,
  provenance,
  approvedClauses,
  aiProvider,
}: {
  t: Messages;
  locale: string;
  provenance?: Provenance | null;
  approvedClauses?: number;
  aiProvider?: string | null;
}) {
  return (
    <footer className="mt-auto">
      <AccentRule />

      <div className="bg-brand-900 text-white/80">
        <div className="mx-auto grid max-w-6xl gap-8 px-4 py-10 sm:px-6 md:grid-cols-3">
          <div>
            <p className="text-base font-bold text-white">{t.title}</p>
            <p className="mt-2 max-w-sm text-sm leading-relaxed">{t.disclaimer}</p>
            <p className="mt-3 inline-block rounded border border-white/25 px-2 py-1 text-xs font-semibold text-white">
              Not an official Government service
            </p>
          </div>

          <div>
            <p className="eyebrow text-white/60">Where the answers come from</p>
            {provenance ? (
              <p className="mt-2 text-sm leading-relaxed">
                {t.sourceNote}{' '}
                <a
                  href={provenance.dataset_url}
                  target="_blank"
                  rel="noreferrer noopener"
                  className="font-medium text-white underline underline-offset-2"
                >
                  {provenance.dataset}
                </a>{' '}
                @ <span className="font-mono text-[0.8em]">{provenance.commit_sha.slice(0, 7)}</span> (
                {provenance.license})
                <br />
                {provenance.schemes.toLocaleString('en-IN')} schemes ·{' '}
                {(approvedClauses ?? 0).toLocaleString('en-IN')} conditions verified by a person
              </p>
            ) : (
              <p className="mt-2 text-sm leading-relaxed">
                Scheme text is read from the published documents and quoted verbatim, never paraphrased.
              </p>
            )}
            <p className="mt-2 text-sm leading-relaxed">
              {aiProvider
                ? `${t.aiWrittenBy} ${aiProvider}. Eligibility itself is decided only by the rule engine, never by a model.`
                : t.aiDeterministic}
            </p>
          </div>

          <div className="md:justify-self-end">
            <p className="eyebrow text-white/60">Links</p>
            <ul className="mt-2 space-y-1.5 text-sm">
              <li>
                <Link href={`/${locale}`} className="underline underline-offset-2 hover:text-white">
                  {t.find}
                </Link>
              </li>
              <li>
                <Link href={`/${locale}/account`} className="underline underline-offset-2 hover:text-white">
                  {t.accountLink}{' '}
                  <span className="text-white/50">({t.optional.toLowerCase()})</span>
                </Link>
              </li>
              <li>
                {/* Last, and visually quietest: a citizen should never wonder
                    whether this link was something they were meant to use. */}
                <Link href={`/${locale}/login`} className="underline underline-offset-2 hover:text-white">
                  {t.reviewerLink}
                </Link>
              </li>
              <li>
                <a
                  href="/api/health"
                  className="text-white/50 underline underline-offset-2 hover:text-white"
                >
                  Service status
                </a>
              </li>
            </ul>
          </div>
        </div>

        <div className="border-t border-white/15">
          <p className="mx-auto max-w-6xl px-4 py-4 text-xs leading-relaxed text-white/60 sm:px-6">
            YojanaMitra is an academic project. It is not affiliated with, endorsed by, or operated by any
            government body. Scheme information is reproduced from published documents for reference; always
            confirm eligibility on the scheme&rsquo;s own official page before applying.
          </p>
        </div>
      </div>
    </footer>
  );
}

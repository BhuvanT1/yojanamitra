import type { Metadata, Viewport } from 'next';
import { UtilityBar } from '@/components/shell/UtilityBar';
import './globals.css';

export const metadata: Metadata = {
  title: 'YojanaMitra — find the government schemes you qualify for',
  description:
    'A student project. Describe your situation in your own language and see which Indian government schemes you may qualify for, with the exact eligibility clause quoted from the published source. Not an official Government service.',
  /**
   * Deliberately not indexable.
   *
   * This site carries the visual conventions of a public-service portal and
   * answers questions about real entitlements. Someone searching for the
   * official service should not land here by accident and mistake a
   * demonstration verdict for a government decision. Remove this only once the
   * annotation backlog is genuinely reviewed and the site is meant to be found.
   */
  robots: { index: false, follow: false, nocache: true },
  applicationName: 'YojanaMitra',
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  // Never disable zoom: a citizen with low vision must be able to enlarge text.
  maximumScale: 5,
  themeColor: '#0a2a4d',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <UtilityBar />
        {children}
      </body>
    </html>
  );
}

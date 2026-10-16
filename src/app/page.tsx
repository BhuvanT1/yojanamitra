import { redirect } from 'next/navigation';
import { DEFAULT_LOCALE } from '@/i18n/messages';

/**
 * The root sends a first-time visitor to the welcome screen, where they pick a
 * language and choose whether to sign in at all.
 *
 * `/<locale>` is still the search and is still directly reachable, so a bookmark
 * or a returning visitor skips this entirely.
 */
export default function Root() {
  redirect(`/${DEFAULT_LOCALE}/welcome`);
}

/**
 * Route protection.
 *
 * Next 16 renamed this file convention from `middleware` to `proxy`; the export
 * is renamed with it. The behaviour is unchanged.
 *
 * Only `/<locale>/reviewer` is gated. Everything a citizen touches — the search,
 * the results, the API that produces them — is deliberately open.
 *
 * The middleware checks only for the PRESENCE of a session cookie. It cannot
 * verify the token, because verification reads the user file and middleware runs
 * on the Edge runtime. The page itself calls `verifySession` and redirects if the
 * token is invalid or expired, so a forged cookie gets past this and is then
 * rejected by the real check. This is the fast path, not the gate.
 */

import { NextResponse, type NextRequest } from 'next/server';

const SESSION_COOKIE = 'ym_reviewer';

export function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;
  const parts = pathname.split('/').filter(Boolean);
  const locale = parts[0] ?? 'en';

  if (!req.cookies.get(SESSION_COOKIE)?.value) {
    const url = req.nextUrl.clone();
    url.pathname = `/${locale}/login`;
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}

export const config = {
  matcher: ['/:locale/reviewer/:path*'],
};

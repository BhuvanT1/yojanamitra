/**
 * One place for session cookie flags, so reviewer and citizen sessions cannot
 * drift apart and quietly lose `httpOnly` on one of them.
 */

import type { NextResponse } from 'next/server';

export function setSessionCookie(
  res: NextResponse,
  name: string,
  token: string,
  expiresAt: string,
): NextResponse {
  res.cookies.set(name, token, {
    httpOnly: true, // not readable from JavaScript, so XSS cannot steal it
    sameSite: 'lax', // not sent on cross-site POSTs
    path: '/',
    secure: process.env.NODE_ENV === 'production',
    expires: new Date(expiresAt),
  });
  return res;
}

export function clearSessionCookie(res: NextResponse, name: string): NextResponse {
  res.cookies.set(name, '', { path: '/', expires: new Date(0) });
  return res;
}

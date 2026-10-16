import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { revokeSession, SESSION_COOKIE } from '@/auth/users';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST() {
  const jar = await cookies();
  // Revoke server-side as well as clearing the cookie: a token that still
  // works after "log out" is not logged out.
  revokeSession(jar.get(SESSION_COOKIE)?.value);
  const res = NextResponse.json({ ok: true });
  res.cookies.set(SESSION_COOKIE, '', { path: '/', expires: new Date(0) });
  return res;
}

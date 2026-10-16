/**
 * Reviewer sign-in.
 *
 * Deliberately slow to brute-force (scrypt) and deliberately vague about why a
 * login failed — the response never distinguishes "no such user" from "wrong
 * password", so it cannot be used to enumerate reviewer accounts.
 */

import { NextResponse } from 'next/server';
import { authenticate, hasAnyUser, SESSION_COOKIE } from '@/auth/users';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  let body: { username?: string; password?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'invalid request' }, { status: 400 });
  }

  if (!hasAnyUser()) {
    return NextResponse.json(
      { error: 'no_users', message: 'No reviewer accounts exist yet. Run: npm run reviewer:add -- <username>' },
      { status: 503 },
    );
  }

  const session = authenticate(body.username ?? '', body.password ?? '');
  if (!session) {
    // One message for both failure modes.
    return NextResponse.json({ error: 'Incorrect username or password.' }, { status: 401 });
  }

  const res = NextResponse.json({ ok: true, username: session.username });
  res.cookies.set(SESSION_COOKIE, session.token, {
    httpOnly: true,           // not readable from JavaScript
    sameSite: 'lax',          // not sent on cross-site POSTs
    path: '/',
    secure: process.env.NODE_ENV === 'production',
    expires: new Date(session.expires_at),
  });
  return res;
}

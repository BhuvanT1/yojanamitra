/**
 * Reviewer signup.
 *
 * Open while zero reviewers exist, invite-only forever after. The decision lives
 * in `registerReviewer`; this route is transport.
 */

import { NextResponse } from 'next/server';
import { registerReviewer, signupNeedsInvite } from '@/auth/signup';
import { SESSION_COOKIE } from '@/auth/users';
import { recordFailure, retryAfter, throttleKey } from '@/auth/throttle';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Tells the form whether to show the invite field. Reveals no account names. */
export async function GET() {
  return NextResponse.json({ needs_invite: signupNeedsInvite() });
}

export async function POST(req: Request) {
  let body: { username?: string; password?: string; invite?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'invalid request' }, { status: 400 });
  }

  // Guessing invite codes is the attack this rate limit exists for.
  const key = throttleKey('signup', body.username ?? '', req);
  const wait = retryAfter(key);
  if (wait > 0) {
    return NextResponse.json(
      { error: `Too many attempts. Try again in ${Math.ceil(wait / 60)} minute(s).` },
      { status: 429, headers: { 'retry-after': String(wait) } },
    );
  }

  const result = registerReviewer({
    username: body.username ?? '',
    password: body.password ?? '',
    invite: body.invite,
  });

  if (!result.ok) {
    if (result.reason.startsWith('invite')) recordFailure(key);
    return NextResponse.json(
      { error: result.message, reason: result.reason },
      { status: result.reason === 'username_taken' ? 409 : 400 },
    );
  }

  const res = NextResponse.json({ ok: true, username: result.session.username, mode: result.mode });
  res.cookies.set(SESSION_COOKIE, result.session.token, {
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    secure: process.env.NODE_ENV === 'production',
    expires: new Date(result.session.expires_at),
  });
  return res;
}

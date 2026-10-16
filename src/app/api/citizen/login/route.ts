import { NextResponse } from 'next/server';
import { authenticateCitizen, CITIZEN_COOKIE } from '@/auth/citizens';
import { setSessionCookie } from '@/auth/cookie';
import { clearFailures, recordFailure, retryAfter, throttleKey } from '@/auth/throttle';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  let body: { username?: string; password?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'invalid request' }, { status: 400 });
  }

  const key = throttleKey('citizen', body.username ?? '', req);
  const wait = retryAfter(key);
  if (wait > 0) {
    return NextResponse.json(
      { error: `Too many attempts. Try again in ${Math.ceil(wait / 60)} minute(s).` },
      { status: 429, headers: { 'retry-after': String(wait) } },
    );
  }

  const session = authenticateCitizen(body.username ?? '', body.password ?? '');
  if (!session) {
    recordFailure(key);
    // One message for both failure modes, so this cannot enumerate accounts.
    return NextResponse.json({ error: 'Incorrect username or password.' }, { status: 401 });
  }

  clearFailures(key);
  const res = NextResponse.json({ ok: true, username: session.username });
  return setSessionCookie(res, CITIZEN_COOKIE, session.token, session.expires_at);
}

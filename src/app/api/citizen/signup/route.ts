/**
 * Create an optional citizen account.
 *
 * Open signup, unlike the reviewer side, because a citizen account carries no
 * authority over anyone: it stores that person's own details and nothing else.
 * Nothing here gates the search — a citizen who never comes to this endpoint
 * gets exactly the same answers.
 */

import { NextResponse } from 'next/server';
import { authenticateCitizen, CITIZEN_COOKIE, createCitizen } from '@/auth/citizens';
import { setSessionCookie } from '@/auth/cookie';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  let body: { username?: string; password?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'invalid request' }, { status: 400 });
  }

  const username = (body.username ?? '').trim();
  const password = body.password ?? '';

  try {
    createCitizen(username, password);
  } catch (e) {
    const message = (e as Error).message;
    return NextResponse.json({ error: message }, { status: /already exists/.test(message) ? 409 : 400 });
  }

  const session = authenticateCitizen(username, password);
  if (!session) return NextResponse.json({ error: 'Account created, but sign-in failed.' }, { status: 500 });

  const res = NextResponse.json({ ok: true, username: session.username });
  return setSessionCookie(res, CITIZEN_COOKIE, session.token, session.expires_at);
}

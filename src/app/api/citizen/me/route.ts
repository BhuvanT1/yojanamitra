/**
 * Who, if anyone, is signed in — and the one endpoint that deletes them.
 *
 * GET is safe to call on every page load: signed out is a 200 with a null
 * username, not an error, because being signed out is the normal state.
 */

import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import {
  CITIZEN_COOKIE,
  deleteAccount,
  getSavedProfile,
  revokeCitizenSession,
  verifyCitizenSession,
} from '@/auth/citizens';
import { clearSessionCookie } from '@/auth/cookie';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  const jar = await cookies();
  const username = verifyCitizenSession(jar.get(CITIZEN_COOKIE)?.value);
  if (!username) return NextResponse.json({ username: null, has_saved: false });

  const saved = getSavedProfile(username);
  return NextResponse.json({
    username,
    has_saved: saved.profile !== null,
    saved_at: saved.saved_at ?? null,
  });
}

/** Close the account. Hard delete — the record is gone, not flagged. */
export async function DELETE() {
  const jar = await cookies();
  const token = jar.get(CITIZEN_COOKIE)?.value;
  const username = verifyCitizenSession(token);
  if (!username) return NextResponse.json({ error: 'not signed in' }, { status: 401 });

  revokeCitizenSession(token);
  deleteAccount(username);

  return clearSessionCookie(NextResponse.json({ ok: true, deleted: username }), CITIZEN_COOKIE);
}

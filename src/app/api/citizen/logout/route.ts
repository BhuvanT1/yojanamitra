import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { CITIZEN_COOKIE, revokeCitizenSession } from '@/auth/citizens';
import { clearSessionCookie } from '@/auth/cookie';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST() {
  const jar = await cookies();
  // Revoked server-side as well as cleared: a token that still works after
  // "sign out" is not signed out.
  revokeCitizenSession(jar.get(CITIZEN_COOKIE)?.value);
  return clearSessionCookie(NextResponse.json({ ok: true }), CITIZEN_COOKIE);
}

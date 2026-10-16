/**
 * The saved details of a signed-in citizen.
 *
 * PUT is the ONLY way anything reaches disk, and it only runs because the person
 * pressed save. Searching while signed in stores nothing — the match endpoint
 * does not know or care whether a session cookie is present.
 *
 * What is written is `toSavedProfile`'s output: the structured field values with
 * the evidence substrings and the raw sentence removed. See `citizens.ts`.
 */

import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import {
  CITIZEN_COOKIE,
  clearSavedProfile,
  getSavedProfile,
  saveProfile,
  verifyCitizenSession,
} from '@/auth/citizens';
import type { Profile } from '@/domain/profile';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

async function currentCitizen(): Promise<string | null> {
  const jar = await cookies();
  return verifyCitizenSession(jar.get(CITIZEN_COOKIE)?.value);
}

export async function GET() {
  const username = await currentCitizen();
  if (!username) return NextResponse.json({ error: 'not signed in' }, { status: 401 });
  const saved = getSavedProfile(username);
  return NextResponse.json({ profile: saved.profile, saved_at: saved.saved_at ?? null });
}

export async function PUT(req: Request) {
  const username = await currentCitizen();
  if (!username) return NextResponse.json({ error: 'not signed in' }, { status: 401 });

  let body: { profile?: Profile };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'invalid request' }, { status: 400 });
  }
  if (!body.profile || typeof body.profile !== 'object') {
    return NextResponse.json({ error: 'profile required' }, { status: 400 });
  }

  try {
    const stored = saveProfile(username, body.profile);
    return NextResponse.json({ ok: true, profile: stored });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}

/** Forget the details, keep the account. */
export async function DELETE() {
  const username = await currentCitizen();
  if (!username) return NextResponse.json({ error: 'not signed in' }, { status: 401 });
  clearSavedProfile(username);
  return NextResponse.json({ ok: true });
}

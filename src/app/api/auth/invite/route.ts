/**
 * Issue a reviewer invite.
 *
 * Only a signed-in reviewer can mint one, and the code is returned exactly once
 * — only its hash is kept, so it cannot be looked up again afterwards.
 */

import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { SESSION_COOKIE, verifySession } from '@/auth/users';
import { createInvite, listInvites } from '@/auth/invites';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

async function requireReviewer(): Promise<string | null> {
  const jar = await cookies();
  return verifySession(jar.get(SESSION_COOKIE)?.value);
}

export async function GET() {
  const username = await requireReviewer();
  if (!username) return NextResponse.json({ error: 'not signed in' }, { status: 401 });
  return NextResponse.json({ invites: listInvites(username) });
}

export async function POST() {
  const username = await requireReviewer();
  if (!username) return NextResponse.json({ error: 'not signed in' }, { status: 401 });

  const invite = createInvite(username);
  return NextResponse.json({ ...invite, issued_by: username });
}

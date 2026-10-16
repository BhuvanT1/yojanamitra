/**
 * Who is allowed to become a reviewer.
 *
 * One rule, in one place, so it cannot drift between the API route and the page:
 *
 *   - While ZERO reviewers exist, signup is open. Somebody has to be first, and
 *     making that person use a terminal means the project cannot be set up on a
 *     machine that only has a browser.
 *   - The moment one reviewer exists, signup requires a single-use invite code
 *     issued by an existing reviewer.
 *
 * Kept out of the route handler so it can be tested without HTTP, because this
 * is the function that decides who gets to decide who gets money.
 */

import { authenticate, createUser, getUser, hasAnyUser } from './users';
import { redeemInvite } from './invites';
import { assertPassword, assertUsername, normaliseUsername, type Session } from './accounts';

export type SignupFailure =
  | 'invalid_username'
  | 'invalid_password'
  | 'username_taken'
  | 'invite_required'
  | 'invite_unknown'
  | 'invite_already_used'
  | 'invite_expired';

export type SignupResult =
  | { ok: true; session: Session; mode: 'bootstrap' | 'invite' }
  | { ok: false; reason: SignupFailure; message: string };

/** Whether the signup form should ask for an invite code. */
export function signupNeedsInvite(): boolean {
  return hasAnyUser();
}

export function registerReviewer(input: {
  username: string;
  password: string;
  invite?: string;
}): SignupResult {
  const username = normaliseUsername(input.username ?? '');
  const password = input.password ?? '';

  // Validated BEFORE an invite is touched, so a typo in the username does not
  // burn a single-use code.
  try {
    assertUsername(username);
  } catch (e) {
    return { ok: false, reason: 'invalid_username', message: (e as Error).message };
  }
  try {
    assertPassword(password);
  } catch (e) {
    return { ok: false, reason: 'invalid_password', message: (e as Error).message };
  }
  if (getUser(username)) {
    return { ok: false, reason: 'username_taken', message: 'That username is taken.' };
  }

  // Note: this is a check-then-act on a JSON file. Under the single Node process
  // this app runs in, that is safe. Behind multiple processes the bootstrap
  // window would need a lock — worth knowing before this is deployed that way.
  const bootstrap = !hasAnyUser();

  if (bootstrap) {
    createUser(username, password, { created_via: 'bootstrap' });
  } else {
    const code = (input.invite ?? '').trim();
    if (!code) {
      return {
        ok: false,
        reason: 'invite_required',
        message: 'Reviewer accounts are invite-only. Ask an existing reviewer for a code.',
      };
    }

    const redeemed = redeemInvite(code, username);
    if (!redeemed.ok) {
      const message =
        redeemed.reason === 'already_used'
          ? 'That invite code has already been used.'
          : redeemed.reason === 'expired'
            ? 'That invite code has expired. Ask for a new one.'
            : 'That invite code is not valid.';
      const reason: SignupFailure =
        redeemed.reason === 'already_used'
          ? 'invite_already_used'
          : redeemed.reason === 'expired'
            ? 'invite_expired'
            : 'invite_unknown';
      return { ok: false, reason, message };
    }

    createUser(username, password, { created_via: 'invite', invited_by: redeemed.issued_by });
  }

  // Sign them straight in. Asking someone to type the password they just chose
  // is friction with no security value.
  const session = authenticate(username, password);
  if (!session) {
    // Unreachable unless the store is broken; failing loudly beats a blank page.
    return { ok: false, reason: 'invalid_password', message: 'Account created, but sign-in failed.' };
  }

  return { ok: true, session, mode: bootstrap ? 'bootstrap' : 'invite' };
}

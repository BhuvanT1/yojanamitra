/**
 * Reviewer accounts.
 *
 * Who this is for, and who it is NOT for.
 *
 * Citizens do not need this. They can optionally keep an account of their own
 * (see `citizens.ts`) to save their details, but it is never required to get an
 * answer, and it is a completely separate store with no authority here.
 *
 * Reviewers log in because approving a clause is the act that decides who gets
 * money. An approval carries `approved_by` and `approved_at` — an audit trail is
 * worthless if anyone can write any name into it.
 *
 * The crypto lives in `accounts.ts`; this module is the reviewer instance of it,
 * plus the rule about who is allowed to become a reviewer in the first place.
 */

import { createAccountStore, type AccountRecord } from './accounts';
import { join } from 'node:path';
import { AUTH_DIR } from '../config/paths';

const USERS_PATH = process.env.YM_USERS_FILE ?? join(AUTH_DIR, 'reviewers.json');

export interface ReviewerUser extends AccountRecord {
  /** How this account came to exist. Part of the audit trail, not decoration. */
  created_via?: 'bootstrap' | 'invite' | 'cli';
  /** Username of the reviewer whose invite was redeemed, when created_via is 'invite'. */
  invited_by?: string;
}

const store = createAccountStore<ReviewerUser>({
  file: USERS_PATH,
  cookie: 'ym_reviewer',
  sessionHours: 12,
});

export type { Session } from './accounts';

export const SESSION_COOKIE = store.cookie;

export const hasAnyUser = (): boolean => store.hasAny();
export const listUsernames = (): string[] => store.list();
export const getUser = (username: string): ReviewerUser | null => store.get(username);

export function createUser(
  username: string,
  password: string,
  provenance: { created_via?: ReviewerUser['created_via']; invited_by?: string } = {},
): void {
  store.create(username, password, {
    created_via: provenance.created_via ?? 'cli',
    ...(provenance.invited_by ? { invited_by: provenance.invited_by } : {}),
  } as Partial<ReviewerUser>);
}

export const setPassword = (username: string, password: string): void => store.setPassword(username, password);
export const authenticate = (username: string, password: string) => store.authenticate(username, password);
export const verifySession = (token: string | undefined): string | null => store.verifySession(token);
export const revokeSession = (token: string | undefined): void => store.revokeSession(token);

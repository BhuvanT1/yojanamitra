/**
 * Authentication invariants.
 *
 * An approval carries a reviewer's name. If any of these break, that name means
 * nothing and the audit trail is decoration.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

function freshStore(): string {
  const dir = mkdtempSync(join(tmpdir(), 'ym-auth-'));
  process.env.YM_USERS_FILE = join(dir, 'reviewers.json');
  return dir;
}

/** The module reads YM_USERS_FILE at import time, so import after setting it. */
async function loadAuth() {
  return import(`../src/auth/users.js?t=${Date.now()}`) as Promise<typeof import('../src/auth/users.js')>;
}

test('a correct password issues a session; a wrong one does not', async () => {
  const dir = freshStore();
  const auth = await loadAuth();

  auth.createUser('bhuvan', 'correct-horse-battery');
  assert.equal(auth.authenticate('bhuvan', 'wrong-password'), null);
  assert.equal(auth.authenticate('nobody', 'correct-horse-battery'), null, 'unknown user must also fail');

  const session = auth.authenticate('bhuvan', 'correct-horse-battery');
  assert.ok(session);
  assert.equal(session!.username, 'bhuvan');
  assert.equal(auth.verifySession(session!.token), 'bhuvan');

  rmSync(dir, { recursive: true, force: true });
});

test('the password is never stored, and neither is the session token', async () => {
  const dir = freshStore();
  const auth = await loadAuth();

  auth.createUser('bhuvan', 'super-secret-passphrase');
  const session = auth.authenticate('bhuvan', 'super-secret-passphrase')!;

  const onDisk = readFileSync(process.env.YM_USERS_FILE!, 'utf8');
  assert.ok(!onDisk.includes('super-secret-passphrase'), 'plaintext password must never touch disk');
  assert.ok(!onDisk.includes(session.token), 'raw session token must never touch disk');
  assert.ok(onDisk.includes('"hash"') && onDisk.includes('"salt"'));

  rmSync(dir, { recursive: true, force: true });
});

test('two users with the same password get different hashes', async () => {
  const dir = freshStore();
  const auth = await loadAuth();

  auth.createUser('alice', 'identical-password');
  auth.createUser('bob', 'identical-password');

  const users = JSON.parse(readFileSync(process.env.YM_USERS_FILE!, 'utf8')) as { salt: string; hash: string }[];
  assert.notEqual(users[0]!.salt, users[1]!.salt, 'salts must be unique');
  assert.notEqual(users[0]!.hash, users[1]!.hash, 'a shared password must not produce a shared hash');

  rmSync(dir, { recursive: true, force: true });
});

test('a garbage or absent token is rejected', async () => {
  const dir = freshStore();
  const auth = await loadAuth();

  auth.createUser('bhuvan', 'correct-horse-battery');
  auth.authenticate('bhuvan', 'correct-horse-battery');

  assert.equal(auth.verifySession(undefined), null);
  assert.equal(auth.verifySession(''), null);
  assert.equal(auth.verifySession('a'.repeat(64)), null, 'a forged token must not authenticate');

  rmSync(dir, { recursive: true, force: true });
});

test('logging out actually revokes the token server-side', async () => {
  const dir = freshStore();
  const auth = await loadAuth();

  auth.createUser('bhuvan', 'correct-horse-battery');
  const session = auth.authenticate('bhuvan', 'correct-horse-battery')!;
  assert.equal(auth.verifySession(session.token), 'bhuvan');

  auth.revokeSession(session.token);
  assert.equal(auth.verifySession(session.token), null, 'a token that still works is not logged out');

  rmSync(dir, { recursive: true, force: true });
});

test('changing a password invalidates every existing session', async () => {
  const dir = freshStore();
  const auth = await loadAuth();

  auth.createUser('bhuvan', 'old-password-here');
  const session = auth.authenticate('bhuvan', 'old-password-here')!;

  auth.setPassword('bhuvan', 'new-password-here');
  assert.equal(auth.verifySession(session.token), null);
  assert.equal(auth.authenticate('bhuvan', 'old-password-here'), null);
  assert.ok(auth.authenticate('bhuvan', 'new-password-here'));

  rmSync(dir, { recursive: true, force: true });
});

test('weak passwords and duplicate usernames are refused', async () => {
  const dir = freshStore();
  const auth = await loadAuth();

  assert.throws(() => auth.createUser('bhuvan', 'short'), /at least 8/);
  auth.createUser('bhuvan', 'long-enough-password');
  assert.throws(() => auth.createUser('bhuvan', 'another-password'), /already exists/);
  assert.throws(() => auth.createUser('BHUVAN', 'another-password'), /already exists/, 'names are case-insensitive');

  rmSync(dir, { recursive: true, force: true });
});

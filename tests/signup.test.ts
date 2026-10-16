/**
 * Who is allowed to become a reviewer.
 *
 * A reviewer's approval is what turns a clause into something that can decide a
 * citizen's eligibility. If signup is wrong, every other guarantee in this
 * project is decoration — so these tests are about the door, not the form.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Set before the modules are imported: both read their paths at import time.
const dir = mkdtempSync(join(tmpdir(), 'ym-signup-'));
const USERS = join(dir, 'reviewers.json');
const INVITES = join(dir, 'invites.json');
process.env.YM_USERS_FILE = USERS;
process.env.YM_INVITES_FILE = INVITES;

const { registerReviewer, signupNeedsInvite } = await import('../src/auth/signup.js');
const { createInvite, listInvites } = await import('../src/auth/invites.js');
const { getUser, verifySession } = await import('../src/auth/users.js');

test('the first reviewer can sign up with no invite, and is signed straight in', () => {
  assert.equal(signupNeedsInvite(), false, 'with zero reviewers, the door is open');

  const result = registerReviewer({ username: 'bhuvan', password: 'first-reviewer-pw' });
  assert.ok(result.ok, 'bootstrap signup must succeed');
  assert.equal(result.mode, 'bootstrap');
  assert.equal(verifySession(result.session.token), 'bhuvan', 'they arrive signed in');
  assert.equal(getUser('bhuvan')?.created_via, 'bootstrap', 'how the account was made is recorded');
});

test('the door closes the moment one reviewer exists', () => {
  assert.equal(signupNeedsInvite(), true);

  const result = registerReviewer({ username: 'stranger', password: 'walked-in-off-street' });
  assert.equal(result.ok, false);
  assert.equal(result.ok === false && result.reason, 'invite_required');
  assert.equal(getUser('stranger'), null, 'and no account was created');
});

test('a valid invite opens it again, exactly once', () => {
  const { code } = createInvite('bhuvan');

  const first = registerReviewer({ username: 'priya', password: 'second-reviewer-pw', invite: code });
  assert.ok(first.ok);
  assert.equal(first.mode, 'invite');
  assert.equal(getUser('priya')?.invited_by, 'bhuvan', 'the chain of trust is recorded');

  const replay = registerReviewer({ username: 'imposter', password: 'reusing-the-code', invite: code });
  assert.equal(replay.ok, false);
  assert.equal(replay.ok === false && replay.reason, 'invite_already_used');
  assert.equal(getUser('imposter'), null);
});

test('a guessed code is refused', () => {
  const result = registerReviewer({
    username: 'guesser',
    password: 'hoping-for-the-best',
    invite: 'AAAA-BBBB-CCCC-DDDD',
  });
  assert.equal(result.ok, false);
  assert.equal(result.ok === false && result.reason, 'invite_unknown');
});

test('formatting does not matter, but the code does', () => {
  const { code } = createInvite('bhuvan');
  const mangled = code.toLowerCase().replace(/-/g, ' ');

  const result = registerReviewer({ username: 'ravi', password: 'typed-it-by-hand', invite: mangled });
  assert.ok(result.ok, 'a code read aloud and retyped should still work');
});

test('an expired invite is refused', () => {
  const { code } = createInvite('bhuvan');

  // Reach into the file and age it, rather than waiting seven days.
  const records = JSON.parse(readFileSync(INVITES, 'utf8')) as { expires_at: string; redeemed_by?: string }[];
  const pending = records.filter((r) => !r.redeemed_by);
  pending[pending.length - 1]!.expires_at = new Date(Date.now() - 1000).toISOString();
  writeFileSync(INVITES, JSON.stringify(records, null, 2));

  const result = registerReviewer({ username: 'latecomer', password: 'a-week-too-late', invite: code });
  assert.equal(result.ok, false);
  assert.equal(result.ok === false && result.reason, 'invite_expired');
});

test('invite codes are never stored in a usable form', () => {
  const { code } = createInvite('bhuvan');
  const onDisk = readFileSync(INVITES, 'utf8');

  assert.ok(!onDisk.includes(code), 'the raw code must never touch disk');
  assert.ok(!onDisk.includes(code.replace(/-/g, '')), 'nor its unformatted form');
  assert.ok(onDisk.includes('"code_hash"'));

  assert.ok(
    listInvites('bhuvan').every((i) => !JSON.stringify(i).includes(code)),
    'and the dashboard cannot reveal it either',
  );
});

test('a typo in the username does not burn the invite', () => {
  const { code } = createInvite('bhuvan');

  const typo = registerReviewer({ username: 'x', password: 'valid-password-here', invite: code });
  assert.equal(typo.ok, false);
  assert.equal(typo.ok === false && typo.reason, 'invalid_username');

  const retry = registerReviewer({ username: 'xavier', password: 'valid-password-here', invite: code });
  assert.ok(retry.ok, 'the same code must still work after a rejected attempt');
});

test('a weak password is refused before the invite is touched', () => {
  const { code } = createInvite('bhuvan');

  const weak = registerReviewer({ username: 'weakling', password: 'short', invite: code });
  assert.equal(weak.ok, false);
  assert.equal(weak.ok === false && weak.reason, 'invalid_password');

  const retry = registerReviewer({ username: 'weakling', password: 'long-enough-now', invite: code });
  assert.ok(retry.ok);
});

test('an existing username cannot be taken over', () => {
  const { code } = createInvite('bhuvan');
  const result = registerReviewer({ username: 'bhuvan', password: 'trying-to-take-over', invite: code });

  assert.equal(result.ok, false);
  assert.equal(result.ok === false && result.reason, 'username_taken');

  const before = JSON.parse(readFileSync(USERS, 'utf8')) as { username: string; created_via?: string }[];
  assert.equal(
    before.find((u) => u.username === 'bhuvan')?.created_via,
    'bootstrap',
    'the original account is untouched',
  );
});

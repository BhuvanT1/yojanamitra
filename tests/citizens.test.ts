/**
 * Optional citizen accounts.
 *
 * Two things are being protected here, and they are different things.
 *
 * The first is separation: a citizen account must never carry reviewer
 * authority. The second is minimisation: what a citizen chooses to save must be
 * the structured facts and nothing more — never the sentence they typed, which
 * is the most revealing string in the whole system.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const dir = mkdtempSync(join(tmpdir(), 'ym-citizen-'));
const CITIZENS = join(dir, 'citizens.json');
process.env.YM_CITIZENS_FILE = CITIZENS;
process.env.YM_USERS_FILE = join(dir, 'reviewers.json');

const citizens = await import('../src/auth/citizens.js');
const reviewers = await import('../src/auth/users.js');

import type { Profile } from '../src/domain/profile.js';

/** A realistic extraction, evidence and all — the shape the engine hands back. */
const RAW_SENTENCE = 'I am a 62 year old widow in Telangana with 1.5 acres and no income';

function profileFromSearch(): Profile {
  return {
    raw: { text: RAW_SENTENCE, detected_language: 'en', detection_confidence: 0.99 },
    age: { value: 62, confidence: 0.9, evidence: ['62 year old'], origin: 'extracted' },
    land_acres: { value: 1.5, confidence: 0.9, evidence: ['1.5 acres'], origin: 'extracted' },
    state: { value: 'Telangana', confidence: 0.95, evidence: ['Telangana'], origin: 'extracted' },
    special_categories: { value: ['widow'], confidence: 0.8, evidence: ['widow'], origin: 'extracted' },
    dependents: [
      {
        id: 'dep_1',
        relation: { value: 'daughter', confidence: 0.8, evidence: ['my daughter'], origin: 'extracted' },
        age: { value: 14, confidence: 0.8, evidence: ['14'], origin: 'extracted' },
      },
    ],
  };
}

// ---------------------------------------------------------------- separation

test('a citizen session is not a reviewer session, in either direction', () => {
  citizens.createCitizen('lakshmi', 'a-citizen-password');
  reviewers.createUser('bhuvan', 'a-reviewer-password');

  const citizenSession = citizens.authenticateCitizen('lakshmi', 'a-citizen-password')!;
  const reviewerSession = reviewers.authenticate('bhuvan', 'a-reviewer-password')!;

  assert.equal(
    reviewers.verifySession(citizenSession.token),
    null,
    'a citizen token must never resolve to a reviewer — this is the whole point of two stores',
  );
  assert.equal(citizens.verifyCitizenSession(reviewerSession.token), null);

  // And it holds even when both people chose the same username.
  citizens.createCitizen('bhuvan', 'same-name-different-person');
  const twin = citizens.authenticateCitizen('bhuvan', 'same-name-different-person')!;
  assert.equal(reviewers.verifySession(twin.token), null, 'a shared username grants nothing');
});

test('the two stores are different files, and the cookies are different names', () => {
  assert.notEqual(citizens.CITIZEN_COOKIE, reviewers.SESSION_COOKIE);
  const onDisk = readFileSync(CITIZENS, 'utf8');
  assert.ok(!onDisk.includes('a-reviewer-password'));
  assert.ok(!/"created_via"/.test(onDisk), 'reviewer provenance has no business in the citizen file');
});

// ---------------------------------------------------------------- minimisation

test('saving details keeps the facts and discards the sentence', () => {
  const stored = citizens.saveProfile('lakshmi', profileFromSearch());

  assert.equal(stored.age?.value, 62, 'the facts survive');
  assert.equal(stored.land_acres?.value, 1.5);
  assert.equal(stored.state?.value, 'Telangana');
  assert.deepEqual(stored.special_categories?.value, ['widow']);
  assert.equal(stored.dependents[0]?.age?.value, 14, 'including dependents');

  assert.equal(stored.raw.text, '', 'the sentence is gone');
  assert.deepEqual(stored.age?.evidence, [], 'and so are the quoted fragments of it');
  assert.deepEqual(stored.dependents[0]?.relation?.evidence, []);
});

test('nothing a citizen typed reaches disk', () => {
  citizens.saveProfile('lakshmi', profileFromSearch());
  const onDisk = readFileSync(CITIZENS, 'utf8');

  assert.ok(!onDisk.includes(RAW_SENTENCE), 'the raw sentence must never be written');
  for (const fragment of ['62 year old', '1.5 acres', 'my daughter']) {
    assert.ok(!onDisk.includes(fragment), `evidence fragment "${fragment}" must not be written`);
  }
  // The normalised values are there — that is the part the citizen asked to keep.
  assert.ok(onDisk.includes('Telangana'));
});

test('the guard catches a profile that was not sanitised', () => {
  assert.throws(() => citizens.assertNothingRawWasSaved(profileFromSearch()), /raw input text/);

  const halfDone = citizens.toSavedProfile(profileFromSearch());
  halfDone.age!.evidence = ['62 year old'];
  assert.throws(() => citizens.assertNothingRawWasSaved(halfDone), /evidence survived/);
});

test('a saved profile is the shape the match endpoint already accepts', () => {
  const stored = citizens.saveProfile('lakshmi', profileFromSearch());
  for (const f of [stored.age, stored.land_acres, stored.state]) {
    assert.equal(f?.origin, 'user_corrected', 'restored fields travel the corrected-profile path');
    assert.equal(f?.confidence, 1);
  }
});

// ---------------------------------------------------------------- forgetting

test('details can be forgotten without closing the account', () => {
  citizens.saveProfile('lakshmi', profileFromSearch());
  assert.ok(citizens.getSavedProfile('lakshmi').profile);

  citizens.clearSavedProfile('lakshmi');
  assert.equal(citizens.getSavedProfile('lakshmi').profile, null);
  assert.ok(citizens.authenticateCitizen('lakshmi', 'a-citizen-password'), 'the account still works');
});

test('closing an account is a hard delete, not a flag', () => {
  citizens.createCitizen('temporary', 'closing-this-soon');
  citizens.saveProfile('temporary', profileFromSearch());

  assert.equal(citizens.deleteAccount('temporary'), true);
  assert.equal(citizens.authenticateCitizen('temporary', 'closing-this-soon'), null);

  const onDisk = readFileSync(CITIZENS, 'utf8');
  assert.ok(!onDisk.includes('temporary'), 'no tombstone, no "deleted" flag, nothing left to restore');
  assert.equal(citizens.deleteAccount('temporary'), false, 'deleting twice is a no-op, not a crash');
});

test('signing out revokes the token server-side', () => {
  const session = citizens.authenticateCitizen('lakshmi', 'a-citizen-password')!;
  assert.equal(citizens.verifyCitizenSession(session.token), 'lakshmi');

  citizens.revokeCitizenSession(session.token);
  assert.equal(citizens.verifyCitizenSession(session.token), null);
});

test('saving for a citizen who does not exist fails loudly', () => {
  assert.throws(() => citizens.saveProfile('ghost', profileFromSearch()), /no such citizen/);
});

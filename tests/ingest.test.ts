/**
 * Ingest invariants.
 *
 * The splitter is a heuristic over legal prose, so these tests pin the cases
 * that were actually wrong on the real corpus, not invented ones.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { splitEligibility, dedupKey, isAbbreviationBoundary } from '../src/ingest/clauses.js';
import { fixMojibake, normaliseText, PARA_SEP } from '../src/ingest/pdf_text.js';
import {
  splitConcatenatedTags,
  matchState,
  indexOfIgnoringSpaces,
} from '../src/ingest/sections.js';
import { canonicalSlug } from '../src/ingest/dedup.js';

// ---------------------------------------------------------------- splitting

test('a run-together list splits at sentence-end + capital', () => {
  const text =
    'Children destitute during the Corona period, identified by the Women Welfare Department.' +
    'Orphan children of duly registered construction workers are eligible.' +
    'A maximum of 02 children per registered worker can avail benefits.';
  const { clauses } = splitEligibility(text);
  assert.equal(clauses.length, 3);
  assert.ok(clauses[0]!.text.startsWith('Children destitute'));
  assert.ok(clauses[1]!.text.startsWith('Orphan children'));
  assert.ok(clauses[2]!.text.startsWith('A maximum of 02'));
});

test('dotted initialisms do not split — the U.T. of Lakshadweep bug', () => {
  const text =
    'The applicant must be a permanent resident of the U.T. of Lakshadweep holding a valid certificate issued by the administration.';
  const { clauses } = splitEligibility(text);
  assert.equal(clauses.length, 1, 'must stay one clause');
  assert.ok(!clauses.some((c) => c.text.startsWith('T. of')));
});

test('common abbreviations do not split', () => {
  for (const frag of [
    'The income must not exceed Rs. Two lakh per annum for the applicant household.',
    'Applications close on 31 March. No. of seats is limited to fifty per district.',
  ]) {
    const { clauses } = splitEligibility(frag);
    assert.ok(clauses.every((c) => c.text.length >= 25));
  }
  assert.equal(isAbbreviationBoundary('Rs. 6000', 2), true);
  assert.equal(isAbbreviationBoundary('U.T. of X', 3), true);
  assert.equal(isAbbreviationBoundary('India. The', 5), false);
});

test('spans point back at the original text', () => {
  const text = 'A'.repeat(30) + '.' + 'B'.repeat(30) + '.';
  const { clauses } = splitEligibility(text, 1000);
  for (const c of clauses) {
    assert.ok(c.start >= 1000);
    assert.equal(c.end - c.start, c.text.length);
  }
});

test('text too short to be a clause is reported as uncovered, never dropped silently', () => {
  const text = 'Note:' + PARA_SEP + 'The applicant must be a permanent resident of the state concerned.';
  const res = splitEligibility(text);
  assert.ok(res.uncovered.includes('Note:'));
  assert.equal(res.clauses.length, 1);
});

// ---------------------------------------------------------------- dedup

test('dedup key ignores punctuation and case but not meaning', () => {
  assert.equal(
    dedupKey('The applicant should be a citizen of India.'),
    dedupKey('The Applicant should be a  citizen of India'),
  );
  assert.notEqual(
    dedupKey('The applicant should be a farmer.'),
    dedupKey('The applicant should be a student.'),
  );
});

test('income figures stay distinct after normalisation', () => {
  assert.notEqual(dedupKey('Income below ₹2,00,000'), dedupKey('Income below ₹8,00,000'));
});

// ---------------------------------------------------------------- text repair

test('mojibake is repaired run by run, surviving a broken sequence', () => {
  assert.ok(fixMojibake('â‚¹ 6000').includes('₹'));
  assert.ok(/[ऀ-ॿ]/.test(fixMojibake('à¤¹à¤¿à¤‚à¤¦à¥€')));
  // A repairable run next to an unrepairable one: the good run still recovers.
  const mixed = fixMojibake('â‚¹ 6000 and a stray â€ token');
  assert.ok(mixed.includes('₹'));
});

test('clean ASCII is left untouched', () => {
  const s = 'The applicant should be a citizen of India.';
  assert.equal(fixMojibake(s), s);
});

test('the source BOM becomes a paragraph separator, not a dropped character', () => {
  assert.ok(normaliseText('A﻿B').includes(PARA_SEP));
});

// ---------------------------------------------------------------- headers

test('concatenated tag pills split at case boundaries', () => {
  assert.deepEqual(splitConcatenatedTags('Agricultural InputsAgricultureFarmersIncome SupportKisan'), [
    'Agricultural Inputs',
    'Agriculture',
    'Farmers',
    'Income Support',
    'Kisan',
  ]);
});

test('state detection is exact, never a guess', () => {
  assert.equal(matchState('Uttar Pradesh'), 'uttar pradesh');
  assert.equal(matchState('Government Of Kerala'), 'kerala');
  assert.equal(matchState('Ministry Of Agriculture and Farmers Welfare'), null);
  assert.equal(matchState('Some Board Of Something'), null);
});

test('whitespace-insensitive search finds names broken across wrapped lines', () => {
  const header = 'Ministry Of Science And TechnologyAccess To Knowledge';
  const at = indexOfIgnoringSpaces(header, 'Access  To\nKnowledge');
  assert.ok(at > 0);
  assert.equal(header.slice(at, at + 6), 'Access');
});

// ---------------------------------------------------------------- file dedup

test('duplicate filename shapes collapse to one slug', () => {
  for (const f of ['aavy.pdf', 'aavy copy.pdf', 'aavy(1).pdf', 'aavy(2) copy.pdf']) {
    assert.equal(canonicalSlug(f), 'aavy');
  }
  assert.equal(canonicalSlug('pm-kisan.pdf'), 'pm-kisan');
});

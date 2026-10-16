/**
 * Extraction invariants.
 *
 * The three headline inputs are the ones from the project brief, verbatim —
 * plain English, romanised code-mixed, and Telugu.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { extractProfile, applyCorrection } from '../src/extraction/extract.js';
import { assertEvidenceIsGrounded } from '../src/domain/profile.js';
import { detectScript } from '../src/extraction/detect.js';
import {
  parseAge,
  parseLandAcres,
  parseMoney,
  parseNumbers,
  parseSchoolClass,
  asciiDigits,
} from '../src/extraction/numbers.js';

const PLAIN =
  "I'm 33, a farmer in Telangana with 1.5 acres of land in my village, OBC, my yearly income is around 1.5 lakh.";
const TELEGRAPHIC = 'widow, 52, bihar, no land, bpl card hai';
const TELUGU = 'మా అమ్మాయి 11వ తరగతి, నేను రైతుని';

// ---------------------------------------------------------------- the brief's personas

test('plain English persona extracts every stated field', () => {
  const { profile, rejected } = extractProfile(PLAIN);
  assert.deepEqual(rejected, []);
  assert.equal(profile.age?.value, 33);
  assert.equal(profile.annual_income_inr?.value, 150000, '1.5 lakh → 150000');
  assert.equal(profile.land_acres?.value, 1.5);
  assert.deepEqual(profile.occupation?.value, ['farmer']);
  assert.equal(profile.state?.value, 'telangana');
  assert.equal(profile.residence?.value, 'rural');
  assert.equal(profile.category?.value, 'obc');
});

test('plain English persona does NOT invent a gender', () => {
  const { profile, unknown_fields } = extractProfile(PLAIN);
  assert.equal(profile.gender, undefined, 'the text never says — absent is the honest answer');
  assert.ok(unknown_fields.includes('gender'));
});

test('romanised telegraphic persona', () => {
  const { profile, rejected } = extractProfile(TELEGRAPHIC);
  assert.deepEqual(rejected, []);
  assert.equal(profile.age?.value, 52, 'a bare number in a comma list is the age');
  assert.equal(profile.state?.value, 'bihar');
  assert.ok(profile.special_categories?.value.includes('bpl'));
  assert.ok(profile.special_categories?.value.includes('widow'));
  assert.ok(profile.special_categories?.value.includes('landless'), '"no land" → landless');
  assert.equal(profile.gender?.value, 'female', 'inferred from "widow", citing "widow"');
  assert.deepEqual(profile.gender?.evidence, ['widow']);
});

test('Telugu persona: the class belongs to the DAUGHTER, not the parent', () => {
  const { profile, rejected } = extractProfile(TELUGU);
  assert.deepEqual(rejected, []);

  assert.deepEqual(profile.occupation?.value, ['farmer'], 'రైతుని → farmer');
  assert.equal(profile.education_stage, undefined, 'the parent is not the student');

  assert.equal(profile.dependents.length, 1);
  const dep = profile.dependents[0]!;
  assert.equal(dep.relation?.value, 'daughter');
  assert.equal(dep.gender?.value, 'female');
  assert.equal(dep.education_stage?.value, 'class_11_12', '11వ తరగతి → class 11');
});

test('Telugu is detected without being translated', () => {
  const { profile } = extractProfile(TELUGU);
  assert.equal(profile.raw.detected_language, 'te');
  assert.equal(profile.raw.script, 'native');
  assert.equal(profile.raw.translated_text, undefined, 'extraction reads the original');
});

// ---------------------------------------------------------------- grounding

test('every evidence span is a verbatim substring of the original input', () => {
  for (const input of [PLAIN, TELEGRAPHIC, TELUGU]) {
    const { profile } = extractProfile(input);
    assert.deepEqual(assertEvidenceIsGrounded(profile), [], input);

    const check = (f: { evidence: string[] } | undefined) => {
      for (const e of f?.evidence ?? []) assert.ok(input.includes(e), `${e} not in input`);
    };
    check(profile.age);
    check(profile.annual_income_inr);
    check(profile.land_acres);
    check(profile.occupation);
    check(profile.state);
    for (const d of profile.dependents) {
      check(d.relation);
      check(d.gender);
      check(d.education_stage);
    }
  }
});

test('land evidence stops at the unit, not at a fixed offset', () => {
  const { profile } = extractProfile(PLAIN);
  assert.equal(profile.land_acres?.evidence[0], '1.5 acres');
});

// ---------------------------------------------------------------- numbers

test('Indian and Indic number formats', () => {
  assert.equal(parseMoney('income is around 1.5 lakh')[0]?.value, 150000);
  assert.equal(parseMoney('₹1,50,000 per year')[0]?.value, 150000);
  assert.equal(parseMoney('2 crore')[0]?.value, 20000000);
  assert.equal(asciiDigits('११वीं'), '11वीं');
  assert.equal(parseNumbers('मेरी उम्र ४५ साल')[0]?.value, 45);
});

test('a comma-separated number does not swallow the comma', () => {
  const hits = parseNumbers('widow, 52, bihar');
  assert.equal(hits[0]?.text, '52', 'trailing comma is a list separator, not a digit group');
});

test('hectares convert to acres', () => {
  const land = parseLandAcres('I own 2 hectares');
  assert.ok(land);
  assert.ok(Math.abs(land!.value - 4.942) < 0.01);
});

test('school class parses in three scripts', () => {
  const words = ['class', 'तरगती', 'कक्षा', 'తరగతి'];
  assert.equal(parseSchoolClass('my daughter is in 11th class', words)?.value, 11);
  assert.equal(parseSchoolClass('11వ తరగతి', words)?.value, 11);
  assert.equal(parseSchoolClass('कक्षा 8 में', words)?.value, 8);
});

test('age is never taken from a figure already claimed as money', () => {
  const text = 'my income is 50000 rupees';
  const money = parseMoney(text);
  assert.equal(parseAge(text, money), null, 'must not read 50000 as an age');
});

// ---------------------------------------------------------------- detection

test('script detection labels honestly and never blocks extraction', () => {
  assert.equal(detectScript('మా అమ్మాయి').language, 'te');
  assert.equal(detectScript('मेरी बेटी').language, 'hi');
  assert.equal(detectScript('bpl card hai').script, 'romanised');
  assert.equal(detectScript('bpl card hai').language, 'und', 'romanised Hindi is not labelled English');
  // Two Indic scripts at once: real, but not something to label confidently.
  const mixed = detectScript('మా అమ్మాయి और मेरी बेटी');
  assert.equal(mixed.language, 'und');
  assert.ok(mixed.confidence < 0.5);
});

// ---------------------------------------------------------------- corrections

test('a citizen correction overrides extraction and needs no evidence', () => {
  const { profile } = extractProfile(PLAIN);
  const fixed = applyCorrection(profile, 'state', 'kerala');
  assert.equal(fixed.state?.value, 'kerala');
  assert.equal(fixed.state?.origin, 'user_corrected');
  assert.equal(fixed.state?.confidence, 1);
  assert.deepEqual(assertEvidenceIsGrounded(fixed), [], 'the citizen is the source');
});

// ---------------------------------------------------------------- safety

test('gibberish yields an empty profile, not a populated one', () => {
  const { profile, unknown_fields } = extractProfile('asdf qwerty zxcv');
  assert.equal(unknown_fields.length, 10, 'every field unknown');
  assert.equal(profile.dependents.length, 0);
});

test('an empty input is handled without throwing', () => {
  const { profile } = extractProfile('');
  assert.equal(profile.raw.text, '');
  assert.equal(profile.dependents.length, 0);
});

test('two children and one class number: the class is not bound to either', () => {
  const { profile } = extractProfile('I have a son and a daughter, one is in 9th class');
  assert.equal(profile.dependents.length, 2);
  for (const d of profile.dependents) {
    assert.equal(d.education_stage, undefined, 'cannot tell whose class it is');
  }
});

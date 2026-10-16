/**
 * Proposer tests.
 *
 * Every input string here is taken verbatim from the ingested corpus, so a
 * passing test means the pattern works on real prose, not on prose written to
 * make it pass.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { proposeConstraint, isNegativePolarity } from '../src/annotations/propose.js';
import { parseAmounts } from '../src/annotations/amounts.js';
import { validateExpr } from '../src/domain/constraint.js';
import type { Predicate, AllOf, Exclusion } from '../src/domain/constraint.js';

// ---------------------------------------------------------------- amounts

test('Indian money formats all parse', () => {
  const cases: [string, number][] = [
    ['₹24,000', 24000],
    ['₹ 1.2 lakhs', 120000],
    ['Rs. 1,00,000', 100000],
    ['₹5.00 lakhs', 500000],
    ['₹ 20,00,000', 2000000],
    ['Rs 2 crore', 20000000],
    ['₹ 3,00,000', 300000],
  ];
  for (const [text, expected] of cases) {
    const got = parseAmounts(text);
    assert.equal(got[0]?.value, expected, `${text} → ${got[0]?.value}, expected ${expected}`);
  }
});

test('a shared lakh multiplier is applied to a bare lower bound, and flagged', () => {
  const p = proposeConstraint(
    'Families with annual income between ₹1.2 and ₹5 lakhs are eligible under this Scheme.',
  );
  assert.match(p.note ?? '', /multiplier to both/i);
});

test('lakh notation without a currency symbol still parses', () => {
  assert.equal(parseAmounts('annual income between 1.2 and 5 lakhs')[0]?.value, 500000);
});

// ---------------------------------------------------------------- income

test('income ceiling: "not exceeding"', () => {
  const p = proposeConstraint('The applicant should have an annual family income not exceeding ₹24,000.');
  const c = p.constraint as Predicate;
  assert.equal(c.kind, 'predicate');
  assert.equal(c.field, 'annual_income_inr');
  assert.equal(c.op, 'lte');
  assert.equal(c.value, 24000);
});

test('income ceiling: "less than" is strict', () => {
  const p = proposeConstraint('The family income of the applicant should be less than ₹5.00 lakhs per annum.');
  const c = p.constraint as Predicate;
  assert.equal(c.op, 'lt');
  assert.equal(c.value, 500000);
});

test('income range produces an AND of two bounds', () => {
  const p = proposeConstraint(
    'All families (with annual income between ₹1.2 and ₹5 lakhs) are also eligible to enroll.',
  );
  const c = p.constraint as AllOf;
  assert.equal(c.kind, 'all');
  const bounds = c.children as Predicate[];
  assert.equal(bounds[0]!.op, 'gte');
  assert.equal(
    bounds[0]!.value,
    120000,
    'the "lakhs" on the upper bound governs both — a floor of 1.2 would admit everyone',
  );
  assert.equal(bounds[1]!.op, 'lte');
  assert.equal(bounds[1]!.value, 500000);
});

test('a bare income figure is proposed as a ceiling but flagged', () => {
  const p = proposeConstraint('Annual family income ₹50,000 as certified by the competent authority.');
  assert.match(p.note ?? '', /assumed a ceiling/i);
});

// ---------------------------------------------------------------- age

test('age range', () => {
  const p = proposeConstraint('1. Age Limit: The scheme is open to individuals between the ages of 18 and 59 years.');
  const c = p.constraint as AllOf;
  assert.equal(c.kind, 'all');
  const [lo, hi] = c.children as Predicate[];
  assert.deepEqual([lo!.field, lo!.op, lo!.value], ['age', 'gte', 18]);
  assert.deepEqual([hi!.field, hi!.op, hi!.value], ['age', 'lte', 59]);
});

test('"above 18 years of age" is proposed as >= and the ambiguity is surfaced', () => {
  const p = proposeConstraint(
    'Any individual above 18 years of age including Women, ex-servicemen is eligible to apply under the scheme.',
  );
  assert.match(p.note ?? '', /ambiguous/i);
});

test('"no age limit" produces no age constraint', () => {
  const p = proposeConstraint('There will be no age limit for coverage under the scheme.');
  const s = JSON.stringify(p.constraint ?? {});
  assert.ok(!s.includes('"age"'));
});

// ---------------------------------------------------------------- polarity

test('negative phrasing becomes an exclusion, not a positive rule', () => {
  const p = proposeConstraint('5. The scheme does not cover individuals who are above 59 years of age.');
  const c = p.constraint as Exclusion;
  assert.equal(c.kind, 'exclusion', 'must not admit exactly the people the scheme excludes');
  assert.match(p.note ?? '', /EXCLUSION/);
});

test('a leading "No ... are eligible" is negative — found in the live corpus', () => {
  // "Feed The Seed" carries this clause. Before the fix the proposer read it as
  // a positive requirement and the engine reported a farmer as SATISFIED on a
  // clause that disqualifies them.
  const text = 'No livestock farmers are eligible for the scheme.';
  assert.equal(isNegativePolarity(text), true);
  const p = proposeConstraint(text);
  assert.equal((p.constraint as Exclusion)?.kind, 'exclusion');
});

test('other negative constructions substring matching misses', () => {
  for (const s of [
    'Applicants who have already availed the benefit shall be disqualified.',
    'Defaulters are debarred from the scheme.',
    'Such applicants are not entitled to assistance.',
  ]) {
    assert.equal(isNegativePolarity(s), true, s);
  }
});

test('polarity markers are detected', () => {
  assert.equal(isNegativePolarity('shall not be eligible for benefit'), true);
  assert.equal(isNegativePolarity('Any farmer of Gujarat state other than SC/ST'), true);
  assert.equal(isNegativePolarity('The applicant should be a farmer.'), false);
});

// ---------------------------------------------------------------- subject

test('"girl child" binds to a dependent, not the applicant', () => {
  const p = proposeConstraint('The girl child of the applicant should be born after 1-4-2005.');
  const c = p.constraint as Predicate;
  assert.equal(c.subject.kind, 'dependent');
  assert.match(p.note ?? '', /DEPENDENT/);
});

test('"Women" binds to the applicant', () => {
  const p = proposeConstraint('The applicant should be a woman engaged in agriculture.');
  const s = JSON.stringify(p.constraint);
  assert.ok(s.includes('"self"'));
});

// ---------------------------------------------------------------- schema gaps

test('citizenship is reported as a schema gap, not silently dropped', () => {
  const p = proposeConstraint('The applicant should be a citizen of India.');
  assert.equal(p.state, 'needs_schema_extension');
  assert.equal(p.missing_field, 'citizenship');
  assert.equal(p.constraint, null);
});

test('marks thresholds are reported as a schema gap', () => {
  const p = proposeConstraint(
    'All the students belonging to the Scheduled Caste who secured 65% and above marks in the 10th Standard shall be eligible.',
  );
  assert.equal(p.state, 'needs_schema_extension');
  assert.equal(p.missing_field, 'marks_percentage');
});

test('income-tax-payer exclusion is a schema gap, not an income rule', () => {
  const p = proposeConstraint('2. The scheme does not cover individuals who are income taxpayers.');
  assert.equal(p.state, 'needs_schema_extension');
  assert.equal(p.missing_field, 'is_income_tax_payer');
});

// ---------------------------------------------------------------- kinds

test('application steps are classified procedural', () => {
  const p = proposeConstraint('Get the application form and fill it out completely, then submit it in the same office.');
  assert.equal(p.kind, 'procedural');
  assert.equal(p.constraint, null);
});

test('notes are classified informational', () => {
  const p = proposeConstraint('Note: The area of operation of the scheme is in all inhabitant islands of Lakshadweep.');
  assert.equal(p.kind, 'informational');
});

// ---------------------------------------------------------------- safety

test('nothing the proposer emits is ever approved', () => {
  for (const text of [
    'The applicant should be a citizen of India.',
    'The applicant should be a farmer.',
    'The family income should be less than ₹5.00 lakhs per annum.',
    'Note: something informational.',
  ]) {
    const p = proposeConstraint(text);
    assert.notEqual(p.state as string, 'approved');
  }
});

test('every emitted constraint is structurally valid', () => {
  for (const text of [
    'The applicant should be a permanent resident of Meghalaya.',
    'The beneficiaries shall be persons belonging to SC/ST communities.',
    'The applicant should be a Building/Construction Worker in a rural area.',
    'All individuals from Below Poverty Line (BPL) families are eligible.',
  ]) {
    const p = proposeConstraint(text);
    if (p.constraint) assert.deepEqual(validateExpr(p.constraint), [], text);
  }
});

test('multiple conditions combine with AND and say so', () => {
  const p = proposeConstraint(
    'The applicant should be a farmer and a permanent resident of Telangana.',
  );
  const c = p.constraint as AllOf;
  assert.equal(c.kind, 'all');
  assert.match(p.note ?? '', /combined with AND/);
});

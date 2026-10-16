/**
 * Rule engine invariants.
 *
 * These are the tests that matter most in the whole repository. Everything else
 * shapes data; this decides whether a citizen is told they are entitled to money.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { evaluateClause, evaluateScheme } from '../src/rules/evaluate.js';
import { matchFromProfile } from '../src/rules/match.js';
import { extractProfile } from '../src/extraction/extract.js';
import type { Clause } from '../src/domain/clause.js';
import type { ConstraintExpr } from '../src/domain/constraint.js';
import type { Profile } from '../src/domain/profile.js';
import type { Scheme } from '../src/domain/scheme.js';

// ---------------------------------------------------------------- fixtures

function approved(id: string, constraint: ConstraintExpr, over: Partial<Clause> = {}): Clause {
  return {
    id,
    scheme_id: 's1',
    source_text: 'source prose for ' + id,
    source_span: { start: 0, end: 10 },
    source_url: 'https://www.myscheme.gov.in/schemes/s1',
    kind: 'eligibility_requirement',
    annotation_state: 'approved',
    constraint,
    approved_by: 'bhuvan',
    approved_at: '2026-01-01T00:00:00Z',
    revision: 2,
    history: [],
    ...over,
  };
}

function scheme(clauses: Clause[], over: Partial<Scheme> = {}): Scheme {
  return {
    id: 's1',
    name: 'Test Scheme',
    level: 'central',
    state: null,
    category: [],
    documents: [],
    eligibility_text: 'x',
    clauses,
    source_coverage: {
      eligibility_text_length: 10,
      covered_chars: 10,
      uncovered_fragments: [],
      complete: true,
    },
    source_url: 'https://www.myscheme.gov.in/schemes/s1',
    source_record: { file: 's1.pdf', sha256: 'x' },
    ...over,
  };
}

const FARMER = extractProfile(
  "I'm 33, a farmer in Telangana with 1.5 acres of land in my village, OBC, my yearly income is around 1.5 lakh.",
).profile;

const SPARSE: Profile = { raw: { text: 'hello', detected_language: 'en', detection_confidence: 0.7 }, dependents: [] };

const pred = (field: string, op: string, value: unknown): ConstraintExpr =>
  ({ kind: 'predicate', subject: { kind: 'self' }, field, op, value }) as ConstraintExpr;

// ---------------------------------------------------------------- predicates

test('a satisfied predicate explains itself from the profile', () => {
  const c = evaluateClause(approved('c1', pred('annual_income_inr', 'lte', 200000)), FARMER);
  assert.equal(c.status, 'satisfied');
  assert.match(c.reason, /150000/);
});

test('a violated predicate says what was required', () => {
  const c = evaluateClause(approved('c2', pred('annual_income_inr', 'lte', 100000)), FARMER);
  assert.equal(c.status, 'violated');
  assert.match(c.reason, /at most 100000/);
});

test('a field the citizen never stated is UNKNOWN, never a pass or a fail', () => {
  const c = evaluateClause(approved('c3', pred('age', 'gte', 18)), SPARSE);
  assert.equal(c.status, 'unknown');
  assert.deepEqual(c.missing_fields, ['age']);
  assert.match(c.reason, /you did not say/);
});

test('set membership works on multi-valued fields', () => {
  const yes = evaluateClause(approved('c4', pred('occupation', 'contains_any', ['farmer', 'weaver'])), FARMER);
  assert.equal(yes.status, 'satisfied');
  const no = evaluateClause(approved('c5', pred('occupation', 'contains_any', ['artist'])), FARMER);
  assert.equal(no.status, 'violated');
});

// ---------------------------------------------------------------- all / any

test('all: one violation violates the whole', () => {
  const expr: ConstraintExpr = {
    kind: 'all',
    children: [pred('occupation', 'contains_any', ['farmer']), pred('annual_income_inr', 'lte', 1000)],
  };
  assert.equal(evaluateClause(approved('a1', expr), FARMER).status, 'violated');
});

test('all: an unknown child makes the whole unknown', () => {
  const expr: ConstraintExpr = {
    kind: 'all',
    children: [pred('occupation', 'contains_any', ['farmer']), pred('gender', 'eq', 'female')],
  };
  assert.equal(evaluateClause(approved('a2', expr), FARMER).status, 'unknown');
});

test('any: one satisfied route wins, even beside an unknown sibling', () => {
  const expr: ConstraintExpr = {
    kind: 'any',
    children: [pred('occupation', 'contains_any', ['farmer']), pred('gender', 'eq', 'female')],
  };
  const c = evaluateClause(approved('a3', expr), FARMER);
  assert.equal(c.status, 'satisfied', 'qualifying by one route makes the others irrelevant');
  assert.deepEqual(c.missing_fields, []);
});

test('any: all routes violated violates the whole', () => {
  const expr: ConstraintExpr = {
    kind: 'any',
    children: [pred('occupation', 'contains_any', ['artist']), pred('category', 'eq', 'sc')],
  };
  assert.equal(evaluateClause(approved('a4', expr), FARMER).status, 'violated');
});

// ---------------------------------------------------------------- exclusions

test('exclusion: the citizen matches the exclusion → VIOLATED', () => {
  const expr: ConstraintExpr = { kind: 'exclusion', child: pred('category', 'eq', 'obc') };
  const c = evaluateClause(approved('x1', expr), FARMER);
  assert.equal(c.status, 'violated');
  assert.match(c.reason, /excluded/);
});

test('exclusion: the citizen does not match it → SATISFIED', () => {
  const expr: ConstraintExpr = { kind: 'exclusion', child: pred('category', 'eq', 'sc') };
  assert.equal(evaluateClause(approved('x2', expr), FARMER).status, 'satisfied');
});

test('exclusion under an unknown is UNKNOWN, not a silent pass', () => {
  // "excluding income-tax payers" against a profile that never mentions tax.
  const expr: ConstraintExpr = { kind: 'exclusion', child: pred('gender', 'eq', 'male') };
  const c = evaluateClause(approved('x3', expr), FARMER);
  assert.equal(
    c.status,
    'unknown',
    'a negation would read this as "not known to be excluded" and admit them',
  );
  assert.match(c.reason, /cannot tell/);
});

// ---------------------------------------------------------------- verdicts

test('all clauses satisfied and coverage complete → eligible', () => {
  const s = scheme([approved('v1', pred('occupation', 'contains_any', ['farmer']))]);
  assert.equal(evaluateScheme(s, FARMER).verdict, 'eligible');
});

test('an unknown clause caps the verdict at likely_eligible', () => {
  const s = scheme([
    approved('v2', pred('occupation', 'contains_any', ['farmer'])),
    approved('v3', pred('gender', 'eq', 'female')),
  ]);
  const m = evaluateScheme(s, FARMER);
  assert.equal(m.verdict, 'likely_eligible');
  assert.deepEqual(m.missing_fields, ['gender']);
});

test('unparsed eligibility text caps the verdict even when everything passed', () => {
  const s = scheme([approved('v4', pred('occupation', 'contains_any', ['farmer']))], {
    source_coverage: {
      eligibility_text_length: 100,
      covered_chars: 60,
      uncovered_fragments: ['and other conditions'],
      complete: false,
    },
  });
  assert.equal(evaluateScheme(s, FARMER).verdict, 'likely_eligible');
});

test('an unapproved eligibility requirement caps the verdict', () => {
  const s = scheme([
    approved('v5', pred('occupation', 'contains_any', ['farmer'])),
    approved('v6', pred('age', 'gte', 18), { annotation_state: 'proposed' }),
  ]);
  assert.equal(evaluateScheme(s, FARMER).verdict, 'likely_eligible');
});

test('an approved PROCEDURAL clause never decides', () => {
  const s = scheme([
    approved('v7', pred('occupation', 'contains_any', ['farmer'])),
    approved('v8', pred('age', 'gte', 200), { kind: 'procedural' }),
  ]);
  const m = evaluateScheme(s, FARMER);
  assert.equal(m.verdict, 'eligible', 'a procedural clause cannot fail a citizen');
  assert.equal(m.checks.length, 1);
  assert.equal(m.cited_only.length, 1);
});

test('a scheme with nothing approved never reaches eligible', () => {
  const s = scheme([approved('v9', pred('occupation', 'contains_any', ['farmer']), { annotation_state: 'proposed' })]);
  const m = evaluateScheme(s, FARMER);
  assert.notEqual(m.verdict, 'eligible');
  assert.equal(m.checks.length, 0);
});

test('evaluating a non-decisive clause throws rather than quietly deciding', () => {
  const c = approved('z1', pred('age', 'gte', 18), { annotation_state: 'proposed' });
  assert.throws(() => evaluateClause(c, FARMER), /non-decisive/);
});

// ---------------------------------------------------------------- dependents

test('dependent clauses bind to ONE person across the whole scheme', () => {
  const family = extractProfile('I have a son and a daughter').profile;
  family.dependents[0]!.age = { value: 9, confidence: 1, evidence: [], origin: 'user_corrected' };
  family.dependents[1]!.age = { value: 17, confidence: 1, evidence: [], origin: 'user_corrected' };

  const depPred = (field: string, op: string, value: unknown): ConstraintExpr =>
    ({ kind: 'predicate', subject: { kind: 'dependent', selector: { match: 'any' } }, field, op, value }) as ConstraintExpr;

  // "a child under 10 who is female" — true of neither child individually.
  const s = scheme([
    approved('d1', depPred('age', 'lte', 10)),
    approved('d2', depPred('gender', 'eq', 'female')),
  ]);

  const m = evaluateScheme(s, family);
  assert.notEqual(
    m.verdict,
    'eligible',
    'the 9-year-old son and the 17-year-old daughter must not be combined into one child',
  );
});

test('a single dependent satisfying every clause is eligible, and is named', () => {
  const family = extractProfile('my daughter is in 11th class').profile;
  const depPred = (field: string, op: string, value: unknown): ConstraintExpr =>
    ({ kind: 'predicate', subject: { kind: 'dependent', selector: { match: 'any' } }, field, op, value }) as ConstraintExpr;

  const s = scheme([
    approved('d3', depPred('gender', 'eq', 'female')),
    approved('d4', depPred('education_stage', 'eq', 'class_11_12')),
  ]);
  const m = evaluateScheme(s, family);
  assert.equal(m.verdict, 'eligible');
  assert.equal(m.bound_dependent, 'dep_1');
});

// ---------------------------------------------------------------- pipeline

test('retrieval drops state schemes from other states but keeps central ones', () => {
  const schemes = [
    scheme([approved('r1', pred('occupation', 'contains_any', ['farmer']))], { id: 'central-1' }),
    scheme([approved('r2', pred('occupation', 'contains_any', ['farmer']))], {
      id: 'tg-1', level: 'state', state: 'telangana',
    }),
    scheme([approved('r3', pred('occupation', 'contains_any', ['farmer']))], {
      id: 'kl-1', level: 'state', state: 'kerala',
    }),
  ];
  const out = matchFromProfile(schemes, FARMER);
  const ids = [...out.eligible, ...out.likely_eligible, ...out.ineligible].map((m) => m.scheme_id);
  assert.ok(ids.includes('central-1'));
  assert.ok(ids.includes('tg-1'));
  assert.ok(!ids.includes('kl-1'), 'a Kerala scheme cannot apply to a Telangana citizen');
  assert.equal(out.retrieval.excluded_wrong_state, 1);
});

test('the pipeline reports which missing field would resolve the most schemes', () => {
  const schemes = [
    scheme([approved('g1', pred('gender', 'eq', 'female'))], { id: 'a' }),
    scheme([approved('g2', pred('gender', 'eq', 'female'))], { id: 'b' }),
    scheme([approved('g3', pred('education_stage', 'eq', 'undergraduate'))], { id: 'c' }),
  ];
  const out = matchFromProfile(schemes, FARMER);
  assert.equal(out.would_resolve_most[0]?.field, 'gender');
  assert.equal(out.would_resolve_most[0]?.schemes, 2);
});

test('an unreviewed corpus produces no eligible results at all', () => {
  const schemes = [
    scheme([approved('u1', pred('occupation', 'contains_any', ['farmer']), { annotation_state: 'proposed' })], { id: 'u' }),
  ];
  const out = matchFromProfile(schemes, FARMER);
  assert.equal(out.eligible.length, 0);
  assert.equal(out.retrieval.excluded_unreviewed, 1);
});

/**
 * Domain invariants. These are the properties that make the system auditable —
 * if any of these break, the app can tell a citizen something untrue.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { assertEvidenceIsGrounded, isKnown } from '../src/domain/profile.js';
import type { Profile } from '../src/domain/profile.js';
import { validateExpr, allowedOps, fieldsUsed } from '../src/domain/constraint.js';
import type { ConstraintExpr } from '../src/domain/constraint.js';
import { isDecisive, applyApproval, applyEdit } from '../src/domain/clause.js';
import type { Clause } from '../src/domain/clause.js';
import { combineVerdict, canProduceMatch } from '../src/domain/scheme.js';
import type { Scheme } from '../src/domain/scheme.js';

// ---------------------------------------------------------------- helpers

function baseClause(over: Partial<Clause> = {}): Clause {
  return {
    id: 'c1',
    scheme_id: 's1',
    source_text: 'The applicant must be a farmer.',
    source_span: { start: 0, end: 30 },
    source_url: 'https://example.gov.in/s1',
    kind: 'eligibility_requirement',
    annotation_state: 'proposed',
    constraint: {
      kind: 'predicate',
      subject: { kind: 'self' },
      field: 'occupation',
      op: 'contains_any',
      value: ['farmer'],
    },
    revision: 1,
    history: [],
    ...over,
  };
}

function baseProfile(over: Partial<Profile> = {}): Profile {
  return {
    raw: {
      text: 'I am 33, a farmer in Telangana with 1.5 acres',
      detected_language: 'en',
      detection_confidence: 0.99,
    },
    dependents: [],
    ...over,
  };
}

// ---------------------------------------------------------------- profile

test('absent field is unknown, zero is a real value', () => {
  const p = baseProfile({ land_acres: { value: 0, confidence: 1, evidence: ['1.5 acres'], origin: 'extracted' } });
  assert.equal(isKnown(p.land_acres), true, 'zero acres is a known value');
  assert.equal(isKnown(p.age), false, 'unstated age is unknown');
});

test('evidence must be a verbatim substring of the ORIGINAL input', () => {
  const grounded = baseProfile({
    occupation: { value: ['farmer'], confidence: 0.9, evidence: ['a farmer'], origin: 'extracted' },
  });
  assert.deepEqual(assertEvidenceIsGrounded(grounded), []);

  const invented = baseProfile({
    occupation: { value: ['farmer'], confidence: 0.9, evidence: ['works the land'], origin: 'extracted' },
  });
  const problems = assertEvidenceIsGrounded(invented);
  assert.equal(problems.length, 1);
  assert.match(problems[0]!, /not a substring/);
});

test('extraction with no evidence is rejected', () => {
  const p = baseProfile({
    age: { value: 33, confidence: 0.9, evidence: [], origin: 'extracted' },
  });
  assert.match(assertEvidenceIsGrounded(p)[0]!, /no evidence/);
});

test('a user correction does not need evidence in the original text', () => {
  const p = baseProfile({
    state: { value: 'kerala', confidence: 1, evidence: [], origin: 'user_corrected' },
  });
  assert.deepEqual(assertEvidenceIsGrounded(p), []);
});

// ---------------------------------------------------------------- constraints

test('op/field type mismatches are rejected', () => {
  const bad: ConstraintExpr = {
    kind: 'predicate',
    subject: { kind: 'self' },
    field: 'age',
    op: 'contains_any',
    value: ['x'],
  };
  assert.ok(validateExpr(bad).some((p) => /not valid for field/.test(p)));
});

test('numeric field rejects a string value', () => {
  const bad: ConstraintExpr = {
    kind: 'predicate',
    subject: { kind: 'self' },
    field: 'annual_income_inr',
    op: 'lte',
    value: 'two lakh' as unknown as number,
  };
  assert.ok(validateExpr(bad).some((p) => /numeric but value is string/.test(p)));
});

test('empty all/any is rejected as vacuously true', () => {
  assert.ok(validateExpr({ kind: 'all', children: [] }).some((p) => /vacuously true/.test(p)));
  assert.ok(validateExpr({ kind: 'any', children: [] }).some((p) => /vacuously true/.test(p)));
});

test('a dependent subject cannot test a household-level field', () => {
  const bad: ConstraintExpr = {
    kind: 'predicate',
    subject: { kind: 'dependent', selector: { match: 'any' } },
    field: 'land_acres',
    op: 'gt',
    value: 0,
  };
  assert.ok(validateExpr(bad).some((p) => /cannot be tested on a dependent/.test(p)));
});

test('disjunction with exclusion validates and reports its fields', () => {
  const expr: ConstraintExpr = {
    kind: 'all',
    children: [
      {
        kind: 'any',
        children: [
          { kind: 'predicate', subject: { kind: 'self' }, field: 'gender', op: 'eq', value: 'female' },
          { kind: 'predicate', subject: { kind: 'self' }, field: 'category', op: 'in', value: ['sc', 'st'] },
        ],
      },
      {
        kind: 'exclusion',
        child: {
          kind: 'predicate',
          subject: { kind: 'self' },
          field: 'annual_income_inr',
          op: 'gt',
          value: 700000,
        },
      },
    ],
  };
  assert.deepEqual(validateExpr(expr), []);
  assert.deepEqual(fieldsUsed(expr).sort(), ['annual_income_inr', 'category', 'gender']);
});

test('allowedOps is field-type driven', () => {
  assert.ok(allowedOps('age').includes('gte'));
  assert.ok(!allowedOps('age').includes('contains_any'));
  assert.ok(allowedOps('occupation').includes('contains_any'));
  assert.deepEqual(allowedOps('nonsense_field'), []);
});

// ---------------------------------------------------------------- clauses

test('only an approved eligibility requirement is decisive', () => {
  assert.equal(isDecisive(baseClause({ annotation_state: 'approved' })), true);
  assert.equal(isDecisive(baseClause({ annotation_state: 'proposed' })), false);
  assert.equal(isDecisive(baseClause({ annotation_state: 'needs_schema_extension' })), false);
  assert.equal(isDecisive(baseClause({ annotation_state: 'not_machine_checkable' })), false);
});

test('a procedural clause never decides, even when approved', () => {
  const aadhaar = baseClause({
    annotation_state: 'approved',
    kind: 'procedural',
    source_text: 'Aadhaar seeding and e-KYC are mandatory for release of instalments.',
  });
  assert.equal(isDecisive(aadhaar), false);
});

test('approving without a proposed constraint throws', () => {
  assert.throws(() => applyApproval(baseClause({ constraint: null }), 'bhuvan'), /no constraint proposed/);
});

test('editing an approved clause revokes its approval', () => {
  const approved = applyApproval(baseClause(), 'bhuvan');
  assert.equal(approved.annotation_state, 'approved');
  assert.ok(approved.approved_at);

  const edited = applyEdit(
    approved,
    { kind: 'predicate', subject: { kind: 'self' }, field: 'age', op: 'gte', value: 18 },
    'bhuvan',
  );
  assert.equal(edited.annotation_state, 'proposed');
  assert.equal(edited.approved_by, undefined);
  assert.equal(edited.approved_at, undefined);
  assert.equal(edited.revision, approved.revision + 1);
  assert.equal(edited.history.at(-1)?.action, 'edited');
});

test('bulk approval records the dedup group on each clause', () => {
  const c = applyApproval(baseClause(), 'bhuvan', 'grp_income_700k');
  assert.equal(c.history.at(-1)?.group_id, 'grp_income_700k');
});

// ---------------------------------------------------------------- verdicts

const fullCoverage = { hasUnapprovedRequirement: false, coverageComplete: true };

test('any violation is decisive', () => {
  assert.equal(combineVerdict(['satisfied', 'violated', 'unknown'], fullCoverage), 'ineligible');
});

test('all satisfied with full coverage is eligible', () => {
  assert.equal(combineVerdict(['satisfied', 'satisfied'], fullCoverage), 'eligible');
});

test('an unknown clause caps the verdict at likely_eligible', () => {
  assert.equal(combineVerdict(['satisfied', 'unknown'], fullCoverage), 'likely_eligible');
});

test('an unapproved requirement caps the verdict, even if every checked clause passed', () => {
  assert.equal(
    combineVerdict(['satisfied'], { hasUnapprovedRequirement: true, coverageComplete: true }),
    'likely_eligible',
  );
});

test('unparsed eligibility text caps the verdict', () => {
  assert.equal(
    combineVerdict(['satisfied'], { hasUnapprovedRequirement: false, coverageComplete: false }),
    'likely_eligible',
  );
});

test('a scheme with no decisive clause can never produce a match', () => {
  const scheme = {
    clauses: [baseClause({ annotation_state: 'proposed' }), baseClause({ id: 'c2', kind: 'informational' })],
  } as unknown as Scheme;
  assert.equal(canProduceMatch(scheme), false);

  const reviewed = {
    clauses: [baseClause({ annotation_state: 'approved' })],
  } as unknown as Scheme;
  assert.equal(canProduceMatch(reviewed), true);
});

test('zero clauses is never eligible', () => {
  assert.equal(combineVerdict([], fullCoverage), 'likely_eligible');
});

/**
 * Model-drafted constraint structure.
 *
 * The thing these tests protect is the boundary. A drafted constraint looks
 * enough like a real one that the natural mistake — now or in six months when
 * someone extends this — is to let it count. It must not: a clause is decisive
 * only when a named reviewer has approved it, and the model's output is a
 * starting point for that reviewer, nothing more.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { draftFor, summariseDrafts, DRAFT_INFO } from '../src/proposals/predicted.js';
import { isDecisive } from '../src/domain/clause.js';
import type { Clause } from '../src/domain/clause.js';

const PROFILE_FIELDS = new Set([
  'age', 'annual_income_inr', 'occupation', 'land_acres', 'state', 'residence',
  'gender', 'category', 'education_stage', 'special_categories', 'dependents',
]);

const OPERATORS = new Set([
  'lt', 'lte', 'gt', 'gte', 'eq', 'neq', 'contains_any', 'contains_all', 'in', 'not_in',
]);

// ------------------------------------------------------------ the boundary

test('a drafted constraint does not make a clause decisive', () => {
  const clause = {
    id: 'x-e1',
    scheme_id: 'x',
    source_text: 'Applicant must be a woman farmer owning not more than 2 hectares.',
    source_span: { start: 0, end: 10 },
    source_url: 'https://example.invalid',
    kind: 'eligibility_requirement',
    // The state a model-drafted clause is in. Never 'approved'.
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
  } as unknown as Clause;

  assert.equal(
    isDecisive(clause),
    false,
    'a proposed constraint — however it was produced — can never decide anything',
  );
});

test('the model card keeps its own caveat attached', () => {
  assert.match(DRAFT_INFO.caveat, /upper bound/i);
  assert.match(DRAFT_INFO.caveat, /reviewer to approve/i);
  assert.ok(DRAFT_INFO.trainedOn > 1000);
  assert.ok(DRAFT_INFO.coverage > 0 && DRAFT_INFO.coverage < 1);
});

// ------------------------------------------------------------ the data

test('every draft names real fields and real operators', () => {
  const raw = JSON.parse(readFileSync(join('src', 'proposals', 'predicted.json'), 'utf8')) as {
    drafts: Record<string, { fields: Record<string, number>; ops: string[]; confidence: number }>;
  };

  const bad: string[] = [];
  for (const [id, d] of Object.entries(raw.drafts)) {
    for (const [f, p] of Object.entries(d.fields)) {
      if (!PROFILE_FIELDS.has(f)) bad.push(`${id}: unknown field ${f}`);
      // Below the threshold a field should not have been emitted at all.
      if (!(p >= 0.6 && p <= 1)) bad.push(`${id}: ${f} at p=${p}`);
    }
    for (const o of d.ops) if (!OPERATORS.has(o)) bad.push(`${id}: unknown operator ${o}`);
    if (Object.keys(d.fields).length === 0) bad.push(`${id}: drafted with no fields`);
  }

  assert.equal(bad.length, 0, `${bad.length} malformed drafts, e.g. ${bad.slice(0, 5).join(', ')}`);
});

test('drafts only exist for clauses that had no constraint', () => {
  const clauses = JSON.parse(readFileSync(join('data', 'annotations', 'clauses.json'), 'utf8')) as {
    id: string;
    constraint: unknown;
  }[];

  const withConstraint = clauses.filter((c) => c.constraint).map((c) => c.id);
  const overlap = withConstraint.filter((id) => draftFor(id) !== null);

  assert.equal(
    overlap.length,
    0,
    `${overlap.length} clauses have BOTH a proposer constraint and a model draft — ` +
      'the model would be second-guessing a rule that already matched',
  );
});

test('an unknown id returns null rather than a prototype member', () => {
  assert.equal(draftFor('no-such-clause'), null);
  assert.equal(draftFor('constructor'), null);
  assert.equal(draftFor('__proto__'), null);
});

// ------------------------------------------------------------ the summary

test('coverage is measured against the blank pile, not the whole corpus', () => {
  const clauses = JSON.parse(readFileSync(join('data', 'annotations', 'clauses.json'), 'utf8')) as {
    id: string;
    constraint: unknown;
    annotation_state: string;
  }[];

  const blank = clauses.filter((c) => c.annotation_state === 'proposed' && !c.constraint).map((c) => c.id);
  const s = summariseDrafts(blank);

  assert.equal(s.blank, blank.length);
  assert.ok(s.drafted > 0, 'the model drafted nothing at all');
  assert.ok(s.drafted <= s.blank, 'more drafts than blank clauses is impossible');
  assert.ok(s.strong <= s.drafted);
  assert.ok(s.exclusions <= s.drafted);
});

test('the strongest drafts come first and carry their fields', () => {
  const clauses = JSON.parse(readFileSync(join('data', 'annotations', 'clauses.json'), 'utf8')) as {
    id: string;
    constraint: unknown;
    annotation_state: string;
  }[];
  const blank = clauses.filter((c) => c.annotation_state === 'proposed' && !c.constraint).map((c) => c.id);
  const s = summariseDrafts(blank, 6);

  assert.ok(s.top.length > 0 && s.top.length <= 6);
  for (let i = 1; i < s.top.length; i++) {
    assert.ok(s.top[i - 1]!.confidence >= s.top[i]!.confidence, 'ordered by confidence');
  }
  assert.ok(
    s.top.every((d) => Object.keys(d.fields).length > 0),
    'a draft with no fields is not a draft',
  );
  assert.ok(s.fieldTally.length > 0);
  for (let i = 1; i < s.fieldTally.length; i++) {
    assert.ok(s.fieldTally[i - 1]!.clauses >= s.fieldTally[i]!.clauses, 'tally is ordered');
  }
});

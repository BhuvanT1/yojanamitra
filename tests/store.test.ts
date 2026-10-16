/**
 * Annotation store invariants.
 *
 * These are the concurrency and approval-integrity properties. If any of them
 * breaks, an approval can be attributed to a reviewer who never made it.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { AnnotationStore, StaleRevisionError, InvalidConstraintError } from '../src/storage/annotation_store.js';
import type { Clause } from '../src/domain/clause.js';
import type { ConstraintExpr } from '../src/domain/constraint.js';

const GOOD: ConstraintExpr = {
  kind: 'predicate',
  subject: { kind: 'self' },
  field: 'annual_income_inr',
  op: 'lte',
  value: 240000,
};

function clause(id: string, over: Partial<Clause> = {}): Clause {
  return {
    id,
    scheme_id: 'scheme-' + id,
    source_text: 'The applicant should have an annual family income not exceeding ₹2,40,000.',
    source_span: { start: 0, end: 70 },
    source_url: 'https://www.myscheme.gov.in/schemes/x',
    kind: 'eligibility_requirement',
    annotation_state: 'proposed',
    constraint: GOOD,
    dedup_group_id: 'grp_income',
    revision: 1,
    history: [],
    ...over,
  };
}

function freshStore(): { store: AnnotationStore; dir: string } {
  const dir = mkdtempSync(join(tmpdir(), 'ym-'));
  const store = new AnnotationStore(join(dir, 'clauses.json'));
  return { store, dir };
}

test('a stale revision is rejected rather than clobbering an approval', () => {
  const { store, dir } = freshStore();
  store.put(clause('c1'));

  store.approve('c1', 1, 'bhuvan');
  // A second tab still holding revision 1 tries to write.
  assert.throws(() => store.approve('c1', 1, 'someone-else'), StaleRevisionError);

  rmSync(dir, { recursive: true, force: true });
});

test('an invalid constraint can never be approved', () => {
  const { store, dir } = freshStore();
  store.put(
    clause('c2', {
      constraint: {
        kind: 'predicate',
        subject: { kind: 'self' },
        field: 'age',
        op: 'contains_any',
        value: ['x'],
      },
    }),
  );
  assert.throws(() => store.approve('c2', 1, 'bhuvan'), InvalidConstraintError);
  assert.equal(store.get('c2')!.annotation_state, 'proposed');
  rmSync(dir, { recursive: true, force: true });
});

test('editing an approved clause revokes the approval and bumps the revision', () => {
  const { store, dir } = freshStore();
  store.put(clause('c3'));
  const approved = store.approve('c3', 1, 'bhuvan');
  assert.equal(approved.annotation_state, 'approved');

  const edited = store.edit('c3', approved.revision, { ...GOOD, value: 300000 }, 'bhuvan');
  assert.equal(edited.annotation_state, 'proposed');
  assert.equal(edited.approved_by, undefined);
  rmSync(dir, { recursive: true, force: true });
});

test('group approval is one decision recorded on every member', () => {
  const { store, dir } = freshStore();
  for (const id of ['g1', 'g2', 'g3']) store.put(clause(id));

  const { approved, skipped } = store.approveGroup('grp_income', 'bhuvan');
  assert.equal(approved.length, 3);
  assert.equal(skipped.length, 0);
  for (const c of approved) {
    assert.equal(c.annotation_state, 'approved');
    assert.equal(c.approved_by, 'bhuvan');
    assert.equal(c.history.at(-1)?.group_id, 'grp_income');
  }
  assert.equal(store.stats().decisive, 3);
  rmSync(dir, { recursive: true, force: true });
});

test('group approval skips members that are not awaiting review', () => {
  const { store, dir } = freshStore();
  store.put(clause('h1'));
  store.put(clause('h2', { annotation_state: 'not_machine_checkable', constraint: null }));

  const { approved, skipped } = store.approveGroup('grp_income', 'bhuvan');
  assert.equal(approved.length, 1);
  assert.deepEqual(skipped, ['h2']);
  rmSync(dir, { recursive: true, force: true });
});

test('reclassifying away from eligibility_requirement removes decisiveness', () => {
  const { store, dir } = freshStore();
  store.put(clause('r1'));
  const a = store.approve('r1', 1, 'bhuvan');
  assert.equal(store.stats().decisive, 1);

  store.reclassify('r1', a.revision, 'procedural', 'bhuvan');
  assert.equal(store.stats().decisive, 0, 'an approved procedural clause must not decide');
  rmSync(dir, { recursive: true, force: true });
});

test('rejecting clears the constraint and records the reason', () => {
  const { store, dir } = freshStore();
  store.put(clause('j1'));
  const out = store.reject('j1', 1, 'bhuvan', 'prose is ambiguous about whose income');
  assert.equal(out.annotation_state, 'not_machine_checkable');
  assert.equal(out.constraint, null);
  assert.match(out.review_reason!, /ambiguous/);
  assert.equal(out.history.at(-1)?.action, 'rejected');
  rmSync(dir, { recursive: true, force: true });
});

test('writes survive a reload', () => {
  const dir = mkdtempSync(join(tmpdir(), 'ym-'));
  const path = join(dir, 'clauses.json');

  const a = new AnnotationStore(path);
  a.put(clause('p1'));
  a.approve('p1', 1, 'bhuvan');
  a.save();

  const b = new AnnotationStore(path);
  assert.equal(b.get('p1')!.annotation_state, 'approved');
  assert.equal(b.stats().decisive, 1);
  rmSync(dir, { recursive: true, force: true });
});

test('the schema-extension backlog is ordered by how many clauses a field unlocks', () => {
  const { store, dir } = freshStore();
  store.put(clause('m1', { annotation_state: 'needs_schema_extension', missing_field: 'marks_percentage', constraint: null }));
  store.put(clause('m2', { annotation_state: 'needs_schema_extension', missing_field: 'marks_percentage', constraint: null }));
  store.put(clause('m3', { annotation_state: 'needs_schema_extension', missing_field: 'citizenship', constraint: null }));

  const gaps = store.stats().missing_fields;
  assert.deepEqual(gaps[0], { field: 'marks_percentage', clauses: 2 });
  assert.deepEqual(gaps[1], { field: 'citizenship', clauses: 1 });
  rmSync(dir, { recursive: true, force: true });
});

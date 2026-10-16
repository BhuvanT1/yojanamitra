/**
 * The shipped triage table.
 *
 * Inference happens in Python and the app reads a lookup table, so there is no
 * reimplementation to drift — the failure mode moved from "the two feature
 * extractors disagree" to "the table is stale, truncated, or does not cover the
 * corpus". These tests are aimed at that.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

import { lookup, summarise, MODEL_INFO, type TriageClass } from '../src/triage/predict.js';

const VALID: TriageClass[] = [
  'machine_checkable',
  'needs_schema_extension',
  'no_pattern',
  'not_machine_checkable',
];

test('the model card reports an out-of-fold score, not a fitted one', () => {
  assert.equal(MODEL_INFO.classes.length, 4);
  assert.deepEqual([...MODEL_INFO.classes].sort(), [...VALID].sort());
  assert.ok(MODEL_INFO.macroF1 > 0.5, `macro-F1 ${MODEL_INFO.macroF1} looks wrong`);
  assert.ok(MODEL_INFO.macroF1 < 1, 'a perfect score would mean the split leaked');
  assert.match(MODEL_INFO.caveat, /never decides eligibility/);
});

test('the table covers the whole corpus it claims to', () => {
  assert.ok(MODEL_INFO.clauses > 10_000, `only ${MODEL_INFO.clauses} clauses`);

  const path = join('src', 'triage', 'predictions.json');
  const raw = JSON.parse(readFileSync(path, 'utf8')) as {
    predictions: Record<string, [number, number]>;
  };
  assert.equal(
    Object.keys(raw.predictions).length,
    MODEL_INFO.clauses,
    'the table has a different number of rows than the card claims',
  );
});

test('every prediction is a valid class with a real probability', () => {
  const raw = JSON.parse(readFileSync(join('src', 'triage', 'predictions.json'), 'utf8')) as {
    predictions: Record<string, [number, number]>;
  };

  const bad: string[] = [];
  for (const [id, [classIdx, conf]] of Object.entries(raw.predictions)) {
    if (!Number.isInteger(classIdx) || classIdx < 0 || classIdx > 3) bad.push(`${id}: class ${classIdx}`);
    // A four-class argmax cannot win with less than a quarter of the mass.
    if (!(conf > 0.2 && conf <= 1)) bad.push(`${id}: confidence ${conf}`);
  }
  assert.equal(bad.length, 0, `${bad.length} malformed rows, e.g. ${bad.slice(0, 5).join(', ')}`);
});

test('the table matches the annotation store it was generated from', () => {
  // Skipped where the corpus is not checked out; where it is, this is the test
  // that catches a re-ingest without a re-run of ml/predict_all.py.
  const clausesPath = join('data', 'annotations', 'clauses.json');
  if (!existsSync(clausesPath)) return;

  const clauses = JSON.parse(readFileSync(clausesPath, 'utf8')) as { id: string }[];
  const missing = clauses.filter((c) => lookup(c.id) === null);

  assert.equal(
    missing.length,
    0,
    `${missing.length} clauses have no prediction — re-run "python ml/predict_all.py" ` +
      `(first: ${missing.slice(0, 3).map((c) => c.id).join(', ')})`,
  );
});

test('an unknown clause id returns null rather than a wrong answer', () => {
  assert.equal(lookup('no-such-clause-id'), null);
  assert.equal(lookup(''), null);
  // A crafted id must not reach through the object into a prototype method.
  assert.equal(lookup('constructor'), null);
  assert.equal(lookup('__proto__'), null);
});

test('summarise counts every clause exactly once and flags uncovered ones', () => {
  const clauses = JSON.parse(readFileSync(join('data', 'annotations', 'clauses.json'), 'utf8')) as {
    id: string;
  }[];
  const sample = clauses.slice(0, 400).map((c) => ({ id: c.id }));
  sample.push({ id: 'definitely-not-in-the-table' });

  const s = summarise(sample, 5);

  assert.equal(s.unpredicted, 1, 'an uncovered clause is reported, not silently dropped');
  assert.equal(s.total, 400);
  assert.equal(
    Object.values(s.counts).reduce((a, b) => a + b, 0),
    400,
    'every covered clause lands in exactly one class',
  );
});

test('the worklist is confirmable clauses, most confident first', () => {
  const clauses = JSON.parse(readFileSync(join('data', 'annotations', 'clauses.json'), 'utf8')) as {
    id: string;
  }[];
  const s = summarise(clauses.slice(0, 2000).map((c) => ({ id: c.id })), 6);

  assert.ok(s.quickWins.length > 0 && s.quickWins.length <= 6);
  assert.ok(
    s.quickWins.every((q) => q.label === 'machine_checkable'),
    'the queue only ever offers clauses that already have a draft constraint',
  );
  for (let i = 1; i < s.quickWins.length; i++) {
    assert.ok(s.quickWins[i - 1]!.confidence >= s.quickWins[i]!.confidence);
  }
});

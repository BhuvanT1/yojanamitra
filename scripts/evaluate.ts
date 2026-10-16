/**
 * Stage 6 — the evaluation runner.
 *
 * Usage:
 *   npm run eval              measure against the real annotation state
 *   npm run eval -- --simulate  treat proposed constraints as approved (in memory)
 *
 * Writes evaluation/reports/latest.json alongside the console report.
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

import {
  evaluateExtraction,
  fieldAccuracy,
  profileFromSpec,
  PHRASINGS,
  SCORED_FIELDS,
  type PersonaSpec,
} from '../evaluation/harness/extraction_eval';
import { evaluateSchemes, type PersonaTruth } from '../evaluation/harness/scheme_eval';
import type { Scheme } from '../src/domain/scheme';
import type { Clause } from '../src/domain/clause';

const simulate = process.argv.includes('--simulate');

const personasFile = 'evaluation/personas/personas.json';
const corpusFile = 'data/normalized/schemes.json';
const annFile = 'data/annotations/clauses.json';

function pct(x: number): string {
  return `${(x * 100).toFixed(1)}%`;
}

function bar(x: number, width = 18): string {
  const n = Math.round(x * width);
  return '█'.repeat(n) + '░'.repeat(width - n);
}

function main() {
  if (!existsSync(personasFile)) {
    console.error(`missing ${personasFile}`);
    process.exit(1);
  }
  const gold = JSON.parse(readFileSync(personasFile, 'utf8')) as {
    methodology: string;
    expected_schemes_status: string;
    personas: (PersonaSpec & { expected_schemes?: string[] })[];
  };

  // ---------------------------------------------------------------- extraction
  const ex = evaluateExtraction(gold.personas);

  console.log('');
  console.log('STAGE 6 — EVALUATION');
  console.log('='.repeat(74));
  console.log(`personas ${gold.personas.length} × ${PHRASINGS.length} phrasings = ${ex.utterances} utterances`);
  console.log('');
  console.log('EXTRACTION ACCURACY BY FIELD');
  console.log('  (denominator = cases where the ground truth states a value)');
  console.log('');
  console.log('  field                  acc     n   correct  missed   wrong  spurious');
  console.log('  ' + '-'.repeat(68));

  const fieldRows = SCORED_FIELDS.map((f) => {
    const t = ex.byField[f]!;
    const { accuracy, attempted } = fieldAccuracy(t);
    return { f, t, accuracy, attempted };
  }).sort((a, b) => a.accuracy - b.accuracy);

  for (const { f, t, accuracy, attempted } of fieldRows) {
    console.log(
      `  ${f.padEnd(21)} ${pct(accuracy).padStart(6)} ${String(attempted).padStart(4)}` +
        `   ${String(t.correct).padStart(5)}  ${String(t.missed).padStart(6)}  ${String(t.wrong).padStart(5)}` +
        `  ${String(t.spurious).padStart(8)}`,
    );
  }

  console.log('');
  console.log('EXTRACTION ACCURACY BY PHRASING');
  console.log('  (this is why every persona is written three ways)');
  console.log('');
  for (const p of PHRASINGS) {
    const t = ex.byPhrasing[p];
    const { accuracy, attempted } = fieldAccuracy(t);
    console.log(`  ${p.padEnd(14)} ${bar(accuracy)}  ${pct(accuracy).padStart(6)}  (n=${attempted})`);
  }

  console.log('');
  console.log('DEPENDENTS');
  console.log(`  expected ${ex.dependents.expected}  ·  found ${ex.dependents.found}` +
    `  ·  relation correct ${ex.dependents.relationCorrect}` +
    `  ·  education stage correct ${ex.dependents.stageCorrect}`);

  console.log('');
  console.log(`UNGROUNDED EVIDENCE SPANS: ${ex.ungrounded}  (must be 0)`);

  if (ex.failures.length) {
    console.log('');
    console.log(`FAILURES (${ex.failures.length}) — every number above traces to one of these`);
    const worst = ex.failures.filter((f) => f.outcome === 'wrong' || f.outcome === 'spurious');
    const shown = [...worst, ...ex.failures.filter((f) => f.outcome === 'missed')].slice(0, 14);
    for (const f of shown) {
      console.log(
        `  [${f.outcome.toUpperCase().padEnd(8)}] ${f.persona} / ${f.phrasing} / ${f.field}` +
          `\n             expected ${JSON.stringify(f.expected)}  got ${JSON.stringify(f.got)}`,
      );
    }
    if (ex.failures.length > shown.length) {
      console.log(`  …and ${ex.failures.length - shown.length} more in the report file`);
    }
  }

  // ---------------------------------------------------------------- schemes
  let schemeReport: ReturnType<typeof evaluateSchemes> | null = null;

  if (existsSync(corpusFile)) {
    const schemes: Scheme[] = JSON.parse(readFileSync(corpusFile, 'utf8'));
    if (existsSync(annFile)) {
      const annotated: Clause[] = JSON.parse(readFileSync(annFile, 'utf8'));
      const byId = new Map(annotated.map((c) => [c.id, c]));
      for (const s of schemes) s.clauses = s.clauses.map((c) => byId.get(c.id) ?? c);
    }
    if (simulate) {
      for (const s of schemes) {
        s.clauses = s.clauses.map((c) =>
          c.annotation_state === 'proposed' && c.constraint
            ? { ...c, annotation_state: 'approved' as const, approved_by: 'SIMULATED', approved_at: 'n/a' }
            : c,
        );
      }
    }
    const approved = schemes.reduce(
      (n, s) => n + s.clauses.filter((c) => c.annotation_state === 'approved').length,
      0,
    );

    const truths: PersonaTruth[] = gold.personas.map((p) => ({
      id: p.id,
      profile: profileFromSpec(p.profile),
      expected_schemes: p.expected_schemes ?? null,
    }));

    schemeReport = evaluateSchemes(schemes, truths, approved);

    console.log('');
    console.log('SCHEME MATCHING');
    console.log(`  corpus ${schemeReport.corpus_schemes} schemes · ${schemeReport.approved_clauses} approved clauses` +
      (simulate ? '  \x1b[33m(SIMULATED)\x1b[0m' : ''));

    if (schemeReport.status === 'not_measurable') {
      console.log('');
      console.log('  \x1b[33mNOT MEASURABLE\x1b[0m');
      for (const line of (schemeReport.reason ?? '').match(/.{1,70}(\s|$)/g) ?? []) {
        console.log(`  ${line.trim()}`);
      }
      console.log('');
      console.log('  What would make it measurable:');
      console.log('    1. Approve clauses in `npm run review` (≈3,000 decisions for the');
      console.log('       central slice — see the workload table in the README).');
      console.log('    2. Fill in expected_schemes for each persona, verified by a person');
      console.log('       against those approved clauses.');
      console.log('  Until both are done, any precision/recall figure would be measuring the');
      console.log('  empty annotation backlog rather than the system.');
    } else {
      const s = schemeReport.strict!;
      const i = schemeReport.inclusive!;
      const b = schemeReport.majority_baseline!;
      console.log('');
      console.log('  ELIGIBLE CLASS ONLY — precision/recall, never accuracy');
      console.log(`    strict     P ${pct(s.precision)}  R ${pct(s.recall)}  F1 ${s.f1.toFixed(3)}  F2 ${s.f2.toFixed(3)}`);
      console.log(`    inclusive  P ${pct(i.precision)}  R ${pct(i.recall)}  F1 ${i.f1.toFixed(3)}  F2 ${i.f2.toFixed(3)}`);
      console.log(`    missed entitlements (false negatives): ${s.false_negatives}  <- the costly error`);
      console.log('');
      console.log('  MAJORITY-CLASS BASELINE (always "not eligible")');
      console.log(`    accuracy ${pct(b.accuracy)}   recall ${pct(b.recall)}`);
      console.log(`    ${b.note}`);
      console.log('');
      console.log('  Tuning target is F2, not F1: it weights recall twice as heavily as');
      console.log('  precision, because a missed entitlement costs a citizen money and a');
      console.log('  false positive costs them an application.');
    }
  }

  // ---------------------------------------------------------------- persist
  mkdirSync('evaluation/reports', { recursive: true });
  const payload = {
    generated_at: new Date().toISOString(),
    simulated: simulate,
    methodology: gold.methodology,
    expected_schemes_status: gold.expected_schemes_status,
    extraction: ex,
    schemes: schemeReport,
  };
  writeFileSync(join('evaluation', 'reports', 'latest.json'), JSON.stringify(payload, null, 2));

  console.log('');
  console.log('report written → evaluation/reports/latest.json');
  console.log('='.repeat(74));
}

main();

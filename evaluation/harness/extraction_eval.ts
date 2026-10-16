/**
 * Extraction evaluation.
 *
 * This is the half of the evaluation that is measurable TODAY. The ground-truth
 * profiles were authored by hand, not derived from the system's own output, so
 * comparing extraction against them is a real measurement rather than a
 * tautology.
 *
 * Scored per field and per phrasing, never as one aggregate number:
 *
 *   Per field, because "83% accurate" hides that income is fine and category is
 *   broken. A field-level table tells you what to fix next.
 *
 *   Per phrasing, because the whole reason the gold set writes every persona
 *   three ways is to find out whether the system only understands well-formed
 *   English. An aggregate score would average that failure away.
 *
 * Three outcomes per field, and they are not the same failure:
 *
 *   correct  — extracted, and it matches the ground truth
 *   missed   — the truth states a value, the system found none. Costly: a missing
 *              field makes constraints UNKNOWN and caps verdicts at
 *              likely_eligible, so the citizen never gets a clean answer.
 *   wrong    — the system found a DIFFERENT value. Far worse than missed: it
 *              produces a confident verdict built on a false fact. Tracked
 *              separately for exactly that reason.
 *   spurious — the truth is silent, the system invented a value. Also a
 *              correctness failure, and the thing the grounding gate exists to
 *              prevent.
 */

import type { Profile } from '../../src/domain/profile';
import { extractProfile } from '../../src/extraction/extract';

export type Phrasing = 'plain' | 'telegraphic' | 'code_mixed';
export const PHRASINGS: Phrasing[] = ['plain', 'telegraphic', 'code_mixed'];

export interface PersonaSpec {
  id: string;
  note?: string;
  profile: Record<string, unknown> & {
    dependents?: { relation?: string; gender?: string; education_stage?: string }[];
  };
  phrasings: Record<Phrasing, string>;
}

export const SCORED_FIELDS = [
  'age',
  'annual_income_inr',
  'land_acres',
  'occupation',
  'state',
  'residence',
  'gender',
  'category',
  'education_stage',
  'special_categories',
] as const;

export type ScoredField = (typeof SCORED_FIELDS)[number];
export type Outcome = 'correct' | 'missed' | 'wrong' | 'spurious' | 'true_negative';

const SET_FIELDS = new Set<string>(['occupation', 'special_categories']);

function normalise(v: unknown): string {
  if (Array.isArray(v)) return [...v.map((x) => String(x).toLowerCase())].sort().join('|');
  if (typeof v === 'number') return String(v);
  return String(v).toLowerCase();
}

/**
 * Set fields are scored by overlap, not equality.
 *
 * "widow, bpl, landless" vs "widow, bpl" is a partial success, not a total
 * failure — the profile is still usable. Scoring it as `wrong` would be as
 * misleading as scoring it as `correct`.
 */
function compareSet(expected: unknown, actual: unknown): Outcome {
  const e = new Set((expected as string[]).map((x) => x.toLowerCase()));
  const a = new Set((actual as string[]).map((x) => String(x).toLowerCase()));
  const hits = [...e].filter((x) => a.has(x)).length;
  if (hits === 0) return 'wrong';
  if (hits === e.size && a.size === e.size) return 'correct';
  // Found some of what was expected: counted as missed, since the gap is what
  // costs the citizen a verdict.
  return 'missed';
}

export function scoreField(field: string, expected: unknown, actual: unknown): Outcome {
  const expectedStated = expected !== undefined && expected !== null;
  const actualFound = actual !== undefined && actual !== null;

  if (!expectedStated && !actualFound) return 'true_negative';
  if (!expectedStated && actualFound) return 'spurious';
  if (expectedStated && !actualFound) return 'missed';

  if (SET_FIELDS.has(field)) return compareSet(expected, actual);
  return normalise(expected) === normalise(actual) ? 'correct' : 'wrong';
}

export interface FieldTally {
  correct: number;
  missed: number;
  wrong: number;
  spurious: number;
  true_negative: number;
}

const emptyTally = (): FieldTally => ({ correct: 0, missed: 0, wrong: 0, spurious: 0, true_negative: 0 });

export interface ExtractionReport {
  utterances: number;
  byField: Record<string, FieldTally>;
  byPhrasing: Record<Phrasing, FieldTally>;
  /** Every individual failure, so a number in the table can be traced to a case. */
  failures: {
    persona: string;
    phrasing: Phrasing;
    field: string;
    outcome: Outcome;
    expected: unknown;
    got: unknown;
    text: string;
  }[];
  /** Dependent extraction, scored separately — it binds facts to a person. */
  dependents: { expected: number; found: number; relationCorrect: number; stageCorrect: number };
  /** Evidence spans that were not verbatim. Must be zero. */
  ungrounded: number;
}

export function evaluateExtraction(personas: PersonaSpec[]): ExtractionReport {
  const byField: Record<string, FieldTally> = {};
  const byPhrasing: Record<Phrasing, FieldTally> = {
    plain: emptyTally(),
    telegraphic: emptyTally(),
    code_mixed: emptyTally(),
  };
  for (const f of SCORED_FIELDS) byField[f] = emptyTally();

  const report: ExtractionReport = {
    utterances: 0,
    byField,
    byPhrasing,
    failures: [],
    dependents: { expected: 0, found: 0, relationCorrect: 0, stageCorrect: 0 },
    ungrounded: 0,
  };

  for (const persona of personas) {
    for (const phrasing of PHRASINGS) {
      const text = persona.phrasings[phrasing];
      if (!text) continue;
      report.utterances++;

      const { profile, rejected } = extractProfile(text);
      report.ungrounded += rejected.length;

      for (const field of SCORED_FIELDS) {
        const expected = persona.profile[field];
        const got = (profile as unknown as Record<string, { value: unknown } | undefined>)[field]?.value;
        const outcome = scoreField(field, expected, got);

        byField[field]![outcome]++;
        byPhrasing[phrasing][outcome]++;

        if (outcome === 'missed' || outcome === 'wrong' || outcome === 'spurious') {
          report.failures.push({
            persona: persona.id,
            phrasing,
            field,
            outcome,
            expected: expected ?? null,
            got: got ?? null,
            text,
          });
        }
      }

      // Dependents: scored on whether the right person was identified at all.
      const expectedDeps = persona.profile.dependents ?? [];
      report.dependents.expected += expectedDeps.length;
      report.dependents.found += Math.min(profile.dependents.length, expectedDeps.length);
      for (let i = 0; i < expectedDeps.length; i++) {
        const e = expectedDeps[i]!;
        const a = profile.dependents[i];
        if (!a) continue;
        if (e.relation && a.relation?.value === e.relation) report.dependents.relationCorrect++;
        if (e.education_stage && a.education_stage?.value === e.education_stage) {
          report.dependents.stageCorrect++;
        }
      }
    }
  }

  return report;
}

/**
 * Accuracy over the cases where the ground truth actually states a value.
 *
 * `true_negative` is excluded from the denominator on purpose: a field nobody
 * mentioned and nobody extracted is not a success worth claiming credit for, and
 * counting it would let a system that extracts nothing score well.
 */
export function fieldAccuracy(t: FieldTally): { accuracy: number; attempted: number } {
  const attempted = t.correct + t.missed + t.wrong;
  return { accuracy: attempted === 0 ? 1 : t.correct / attempted, attempted };
}

export function profileFromSpec(spec: PersonaSpec['profile']): Profile {
  const p: Profile = {
    raw: { text: '(ground truth)', detected_language: 'en', detection_confidence: 1 },
    dependents: [],
  };
  for (const f of SCORED_FIELDS) {
    const v = spec[f];
    if (v === undefined) continue;
    (p as unknown as Record<string, unknown>)[f] = {
      value: v,
      confidence: 1,
      evidence: [],
      origin: 'user_corrected',
    };
  }
  (spec.dependents ?? []).forEach((d, i) => {
    p.dependents.push({
      id: `dep_${i + 1}`,
      relation: d.relation ? { value: d.relation, confidence: 1, evidence: [], origin: 'user_corrected' } : undefined,
      gender: d.gender ? { value: d.gender as 'female' | 'male', confidence: 1, evidence: [], origin: 'user_corrected' } : undefined,
      education_stage: d.education_stage
        ? { value: d.education_stage, confidence: 1, evidence: [], origin: 'user_corrected' }
        : undefined,
    });
  });
  return p;
}

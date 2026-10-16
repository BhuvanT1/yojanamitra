/**
 * Scheme-matching evaluation.
 *
 * Reports precision and recall **on the eligible class**, never accuracy.
 *
 * The reason is arithmetic, not taste. A citizen qualifies for a small minority
 * of 2,066 schemes — on the order of 10. A system that returns nothing at all
 * therefore scores about 99.5% accuracy while being completely useless. That
 * majority-class baseline is computed and printed alongside every run, so the
 * comparison is visible rather than something a reader has to work out.
 *
 * Asymmetric costs are stated rather than assumed:
 *
 *   A **false negative** — failing to surface a scheme the citizen qualifies for
 *   — means someone never learns about money they were entitled to. It is the
 *   failure the project exists to prevent.
 *
 *   A **false positive** wastes an application and erodes trust, but is
 *   recoverable.
 *
 * So recall on the eligible class is the headline, and F2 (which weights recall
 * twice as heavily as precision) is reported as the single tuning number rather
 * than F1. Tuning against F1 would silently trade away the error that matters.
 *
 * NOTE ON WHAT THIS CAN MEASURE. Scheme metrics need two things this project does
 * not yet have: approved clauses, and human-validated expected entitlements per
 * persona. Until both exist the harness reports `status: not_measurable` and
 * explains why, rather than printing a number that looks like an accuracy claim.
 */

import type { Scheme } from '../../src/domain/scheme';
import type { Profile } from '../../src/domain/profile';
import { matchFromProfile } from '../../src/rules/match';

export interface PersonaTruth {
  id: string;
  profile: Profile;
  /** Null until a human has verified entitlements against approved clauses. */
  expected_schemes: string[] | null;
}

export interface ClassMetrics {
  true_positives: number;
  false_positives: number;
  false_negatives: number;
  precision: number;
  recall: number;
  f1: number;
  /** Recall-weighted. The number to tune on, given the asymmetric costs. */
  f2: number;
}

function metrics(tp: number, fp: number, fn: number): ClassMetrics {
  const precision = tp + fp === 0 ? 0 : tp / (tp + fp);
  const recall = tp + fn === 0 ? 0 : tp / (tp + fn);
  const f = (b: number) =>
    precision + recall === 0 ? 0 : ((1 + b * b) * precision * recall) / (b * b * precision + recall);
  return {
    true_positives: tp,
    false_positives: fp,
    false_negatives: fn,
    precision,
    recall,
    f1: f(1),
    f2: f(2),
  };
}

export interface SchemeReport {
  status: 'measured' | 'not_measurable';
  reason?: string;
  corpus_schemes: number;
  approved_clauses: number;
  personas_with_truth: number;
  /** Counting ELIGIBLE only. */
  strict?: ClassMetrics;
  /** Counting ELIGIBLE + LIKELY_ELIGIBLE, i.e. what a citizen actually sees. */
  inclusive?: ClassMetrics;
  /**
   * Always-predict-nothing. Its accuracy looks excellent and its recall is zero,
   * which is the entire argument for not reporting accuracy.
   */
  majority_baseline?: {
    accuracy: number;
    recall: number;
    note: string;
  };
  per_persona?: {
    id: string;
    expected: number;
    eligible: number;
    likely: number;
    missed: string[];
    spurious: string[];
  }[];
}

export function evaluateSchemes(
  schemes: Scheme[],
  personas: PersonaTruth[],
  approvedClauses: number,
): SchemeReport {
  const withTruth = personas.filter((p) => p.expected_schemes !== null);

  const base = {
    corpus_schemes: schemes.length,
    approved_clauses: approvedClauses,
    personas_with_truth: withTruth.length,
  };

  if (approvedClauses === 0) {
    return {
      status: 'not_measurable',
      reason:
        'No clause in the corpus has been approved by a human, so the rule engine cannot ' +
        'produce an eligible verdict for anyone. Scheme metrics would all be zero and would ' +
        'measure the empty annotation backlog, not the system.',
      ...base,
    };
  }

  if (withTruth.length === 0) {
    return {
      status: 'not_measurable',
      reason:
        'No persona has human-validated expected_schemes. The harness and the personas are ' +
        'written; a person must verify which schemes each persona is genuinely entitled to ' +
        'before precision and recall mean anything.',
      ...base,
    };
  }

  let sTp = 0, sFp = 0, sFn = 0;
  let iTp = 0, iFp = 0, iFn = 0;
  let totalExpected = 0;
  let totalPairs = 0;

  const per_persona: NonNullable<SchemeReport['per_persona']> = [];

  for (const persona of withTruth) {
    const expected = new Set(persona.expected_schemes!);
    const out = matchFromProfile(schemes, persona.profile, 2000);

    const eligible = new Set(out.eligible.map((m) => m.scheme_id));
    const inclusive = new Set([...eligible, ...out.likely_eligible.map((m) => m.scheme_id)]);

    for (const id of eligible) (expected.has(id) ? sTp++ : sFp++);
    for (const id of expected) if (!eligible.has(id)) sFn++;

    for (const id of inclusive) (expected.has(id) ? iTp++ : iFp++);
    for (const id of expected) if (!inclusive.has(id)) iFn++;

    totalExpected += expected.size;
    totalPairs += schemes.length;

    per_persona.push({
      id: persona.id,
      expected: expected.size,
      eligible: eligible.size,
      likely: out.likely_eligible.length,
      missed: [...expected].filter((id) => !eligible.has(id)),
      spurious: [...eligible].filter((id) => !expected.has(id)),
    });
  }

  return {
    status: 'measured',
    ...base,
    strict: metrics(sTp, sFp, sFn),
    inclusive: metrics(iTp, iFp, iFn),
    majority_baseline: {
      // Predict "not eligible" for every (persona, scheme) pair.
      accuracy: totalPairs === 0 ? 0 : (totalPairs - totalExpected) / totalPairs,
      recall: 0,
      note:
        'Always predicts "not eligible". Scores high accuracy while recommending nothing ' +
        'to anybody. Any model must beat its RECALL, not its accuracy.',
    },
    per_persona,
  };
}

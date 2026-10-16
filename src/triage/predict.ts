/**
 * Triage predictions for the annotation backlog.
 *
 * WHY THIS IS A LOOKUP AND NOT AN INFERENCE ENGINE
 *
 * The model is a histogram gradient-boosting ensemble over TF-IDF features —
 * 800 trees, 0.934 macro-F1. Reimplementing that in TypeScript would mean a
 * multi-megabyte model file, a hand-written vectoriser, and a standing risk that
 * the Python and TypeScript feature extractors drift apart, at which point every
 * prediction is quietly wrong and nothing raises an error.
 *
 * None of it is needed. The corpus only changes when `npm run ingest` runs, so
 * inference happens once in Python (`ml/predict_all.py`) and the app reads the
 * answer. That also means the app ships the BEST model rather than the most
 * portable one.
 *
 * Every value in the table is an OUT-OF-FOLD prediction: 5-fold grouped
 * cross-validation, each clause classified by the fold that had never seen it.
 * The quoted macro-F1 describes exactly these predictions, not a fitted score.
 *
 * WHAT IT PREDICTS
 *
 * What kind of work a clause needs from a human reviewer. It has no opinion
 * about whether any citizen qualifies for anything, never appears on a
 * citizen-facing page, and a clause becomes decisive only when a named reviewer
 * approves it. This orders a worklist.
 */

import table from './predictions.json';

export type TriageClass =
  | 'machine_checkable'
  | 'needs_schema_extension'
  | 'no_pattern'
  | 'not_machine_checkable';

export interface Prediction {
  label: TriageClass;
  /** The model's probability for the winning class, 0..1. Ranks a queue. */
  confidence: number;
}

const CLASSES = table.classes as TriageClass[];
// The JSON import types each row as number[]; assert the pair shape once here
// rather than at every call site.
const PREDICTIONS = table.predictions as unknown as Record<string, [number, number] | undefined>;

export const MODEL_INFO = {
  model: table.model,
  features: table.features,
  classes: CLASSES,
  /** Out-of-fold, over the whole corpus. Not a training-set score. */
  macroF1: table.macro_f1_out_of_fold,
  clauses: table.n_clauses,
  schemes: table.n_schemes,
  dedupGroups: table.n_dedup_groups,
  caveat: table.caveat,
};

/** Null for a clause the table does not cover — a corpus newer than the model. */
export function lookup(clauseId: string): Prediction | null {
  // Own-property check: an id like "constructor" or "__proto__" would otherwise
  // reach a prototype member and be treated as a prediction.
  if (!Object.prototype.hasOwnProperty.call(PREDICTIONS, clauseId)) return null;
  const hit = PREDICTIONS[clauseId];
  if (!hit || hit.length !== 2) return null;
  const label = CLASSES[hit[0]!];
  if (!label) return null;
  return { label, confidence: hit[1]! };
}

export interface TriageInput {
  id: string;
  source_text?: string;
}

export interface TriageResult extends Prediction {
  id: string;
}

export interface TriageSummary {
  /** Clauses the table covers. */
  total: number;
  /**
   * Clauses with no prediction, because the corpus was re-ingested without
   * re-running `ml/predict_all.py`. Surfaced rather than hidden: a silently
   * shrinking denominator would make the panel quietly lie about the backlog.
   */
  unpredicted: number;
  counts: Record<TriageClass, number>;
  /**
   * The cheapest work: clauses most confidently predicted to already carry a
   * usable constraint, so the reviewer only has to confirm a draft.
   */
  quickWins: TriageResult[];
}

export function summarise(clauses: TriageInput[], quickWinLimit = 8): TriageSummary {
  const counts: Record<TriageClass, number> = {
    machine_checkable: 0,
    needs_schema_extension: 0,
    no_pattern: 0,
    not_machine_checkable: 0,
  };

  const results: TriageResult[] = [];
  let unpredicted = 0;

  for (const c of clauses) {
    const p = lookup(c.id);
    if (!p) {
      unpredicted += 1;
      continue;
    }
    counts[p.label] += 1;
    results.push({ id: c.id, ...p });
  }

  const quickWins = results
    .filter((r) => r.label === 'machine_checkable')
    .sort((a, b) => b.confidence - a.confidence)
    .slice(0, quickWinLimit);

  return { total: results.length, unpredicted, counts, quickWins };
}

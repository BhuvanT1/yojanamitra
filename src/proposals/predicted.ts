/**
 * Model-drafted constraint structure for clauses no regex could parse.
 *
 * WHAT THIS IS
 *
 * 6,589 clauses reached the review queue with nothing drafted, because no
 * pattern in the rule proposer recognised their phrasing. A model trained on the
 * 4,962 the proposer DID handle predicts, for each of them, which profile fields
 * the clause tests, which operators it uses, and whether it disqualifies rather
 * than qualifies.
 *
 * WHAT IT IS NOT
 *
 * A decision, or an approval, or a constraint. It is a starting point placed in
 * front of a named reviewer, who approves, corrects or rejects it — the same
 * gate every regex-proposed constraint already passes through. `isDecisive()`
 * still requires `annotation_state === 'approved'`, and nothing here changes
 * that. A clause with a model-drafted structure is exactly as un-decisive as one
 * with nothing.
 *
 * The honest caveat travels with the data: the model was cross-validated on
 * clauses the regexes matched, and these are the ones they missed — systematically
 * the harder ones. The CV scores are an upper bound, not an estimate. That is why
 * every draft carries a confidence and the queue is ordered by it.
 */

import data from './predicted.json';

export interface Draft {
  /** Predicted profile field → probability. Only fields above threshold appear. */
  fields: Record<string, number>;
  /** Comparison operators the clause is predicted to use. */
  ops: string[];
  /** The clause disqualifies rather than qualifies. Getting this backwards inverts the rule. */
  exclusion: boolean;
  /** The strongest field's probability. What the worklist is ordered by. */
  confidence: number;
}

const DRAFTS = data.drafts as unknown as Record<string, Draft | undefined>;

export const DRAFT_INFO = {
  model: data.model,
  trainedOn: data.trained_on,
  predictedFor: data.predicted_for,
  drafted: data.drafted,
  coverage: data.coverage,
  thresholds: data.thresholds,
  caveat: data.caveat,
};

export function draftFor(clauseId: string): Draft | null {
  if (!Object.prototype.hasOwnProperty.call(DRAFTS, clauseId)) return null;
  return DRAFTS[clauseId] ?? null;
}

export interface DraftedClause extends Draft {
  id: string;
}

export interface DraftSummary {
  /** Clauses handed to the reviewer with no regex-proposed constraint. */
  blank: number;
  /** Of those, how many the model drafted structure for. */
  drafted: number;
  /** Drafted at p >= 0.9 — worth a reviewer's time first. */
  strong: number;
  /** Predicted to be disqualifiers. */
  exclusions: number;
  /** field → how many drafts name it. */
  fieldTally: { field: string; clauses: number }[];
  /** Highest-confidence drafts, for the "start here" list. */
  top: DraftedClause[];
}

/**
 * Summarise over the clauses that actually need it.
 *
 * `blankClauseIds` must be the clauses with NO constraint — the ones a reviewer
 * would otherwise open to a blank form. Passing everything would make the
 * coverage figure meaningless.
 */
export function summariseDrafts(blankClauseIds: string[], topLimit = 8): DraftSummary {
  const drafted: DraftedClause[] = [];
  const tally = new Map<string, number>();

  for (const id of blankClauseIds) {
    const d = draftFor(id);
    if (!d) continue;
    drafted.push({ id, ...d });
    for (const f of Object.keys(d.fields)) tally.set(f, (tally.get(f) ?? 0) + 1);
  }

  return {
    blank: blankClauseIds.length,
    drafted: drafted.length,
    strong: drafted.filter((d) => d.confidence >= 0.9).length,
    exclusions: drafted.filter((d) => d.exclusion).length,
    fieldTally: [...tally.entries()]
      .map(([field, clauses]) => ({ field, clauses }))
      .sort((a, b) => b.clauses - a.clauses),
    top: [...drafted].sort((a, b) => b.confidence - a.confidence).slice(0, topLimit),
  };
}

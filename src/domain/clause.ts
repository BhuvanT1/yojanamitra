/**
 * Clauses: a chunk of a scheme's eligibility prose, plus whatever machine-readable
 * constraint a human has approved for it.
 *
 * Two distinctions this file exists to keep straight, because collapsing either
 * one produces a system that quietly decides things it shouldn't:
 *
 *   annotation_state — how far through review a clause is. `constraint === null`
 *     is NOT a state. "Nobody has looked at this yet", "a human decided it can
 *     never be machine-checked" and "it would be checkable if we added a field"
 *     are three different futures and need three different names.
 *
 *   kind — whether the clause is an eligibility criterion at all. Scheme prose
 *     mixes real criteria with procedural notes ("Aadhaar seeding is mandatory
 *     for release of instalments"). That is mandatory, but it is not something a
 *     citizen can fail at the point of asking. If procedural clauses gate the
 *     verdict, every otherwise-clean match degrades to LIKELY_ELIGIBLE and the
 *     product becomes useless.
 */

import type { ConstraintExpr } from './constraint';

export type AnnotationState =
  /** Proposed by the annotator, nobody has reviewed it. Decides nothing. */
  | 'proposed'
  /** A human approved the constraint. The ONLY state that can decide a verdict. */
  | 'approved'
  /** A human judged this prose inherently un-checkable. Cited, never evaluated. */
  | 'not_machine_checkable'
  /**
   * Checkable in principle, but the profile schema has no field for it —
   * domicile duration, disability percentage, prior benefit receipt.
   *
   * Its own state, not a `review_reason` string, so the backlog can be sorted by
   * missing field: "adding `disability_percentage` unlocks 41 schemes" is a
   * decision you can act on; "37 clauses are un-checkable" is not.
   */
  | 'needs_schema_extension';

export type ClauseKind =
  /** A condition the citizen can pass or fail. Only this kind gates the verdict. */
  | 'eligibility_requirement'
  /** A step in applying: documents, e-KYC, Aadhaar seeding, deadlines. */
  | 'procedural'
  /** Context, benefit description, contact details. */
  | 'informational';

export interface ReviewAction {
  action: 'proposed' | 'approved' | 'rejected' | 'edited' | 'reclassified';
  by: string;
  at: string; // ISO 8601
  note?: string;
  /** Set when this action came from approving a whole dedup group at once. */
  group_id?: string;
}

export interface Clause {
  id: string;
  scheme_id: string;

  /** Exact prose from the source PDF. Never paraphrased, never translated in place. */
  source_text: string;
  /** Character offsets into the scheme's extracted eligibility text. */
  source_span: { start: number; end: number };
  source_url: string;

  kind: ClauseKind;
  annotation_state: AnnotationState;

  /** Null until something is proposed. Non-null does NOT mean approved. */
  constraint: ConstraintExpr | null;

  /** Why it is not approved: rejection reason, ambiguity, or the missing field. */
  review_reason?: string;
  /** For needs_schema_extension: which field would unlock it. Drives the backlog. */
  missing_field?: string;

  approved_by?: string;
  approved_at?: string;

  /**
   * Identical/near-identical clause text recurs across dozens of schemes (income
   * ceilings, BPL conditions). Clauses sharing a group are reviewed once and the
   * decision applied to all, with the group id recorded here so provenance stays
   * per-clause.
   */
  dedup_group_id?: string;

  revision: number;
  history: ReviewAction[];
}

/**
 * The single gate. A clause may only decide a verdict if a human approved a
 * structurally valid constraint AND it is an actual eligibility criterion.
 *
 * Every call site that evaluates a clause must go through this.
 */
export function isDecisive(clause: Clause): boolean {
  return (
    clause.annotation_state === 'approved' &&
    clause.kind === 'eligibility_requirement' &&
    clause.constraint !== null
  );
}

/** Clauses shown to the citizen as context but never evaluated. */
export function isCitableOnly(clause: Clause): boolean {
  return !isDecisive(clause);
}

/**
 * Editing an approved constraint invalidates the approval. Without this, a
 * reviewer could tweak a threshold on an approved rule and the audit trail would
 * still claim the original was signed off.
 */
export function applyEdit(
  clause: Clause,
  next: ConstraintExpr | null,
  by: string,
  note?: string,
): Clause {
  return {
    ...clause,
    constraint: next,
    annotation_state: 'proposed',
    approved_by: undefined,
    approved_at: undefined,
    revision: clause.revision + 1,
    history: [...clause.history, { action: 'edited', by, at: new Date().toISOString(), note }],
  };
}

export function applyApproval(clause: Clause, by: string, groupId?: string): Clause {
  if (clause.constraint === null) {
    throw new Error(`cannot approve clause ${clause.id}: no constraint proposed`);
  }
  const at = new Date().toISOString();
  return {
    ...clause,
    annotation_state: 'approved',
    approved_by: by,
    approved_at: at,
    revision: clause.revision + 1,
    history: [...clause.history, { action: 'approved', by, at, group_id: groupId }],
  };
}

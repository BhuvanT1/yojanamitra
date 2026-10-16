/**
 * Schemes, verdicts, and dataset provenance.
 */

import type { Clause } from './clause';
import { isDecisive } from './clause';

/** Outcome of evaluating one clause against one profile. */
export type ClauseStatus = 'satisfied' | 'violated' | 'unknown';

export type Verdict =
  /** Every decisive clause satisfied AND the source prose fully accounted for. */
  | 'eligible'
  /** Nothing violated, but something is unknown, unapproved, or unparsed. */
  | 'likely_eligible'
  /** An approved eligibility requirement failed. */
  | 'ineligible';

/**
 * Whether the scheme's eligibility prose was fully turned into clauses.
 *
 * This matters more than it looks. If the splitter dropped a sentence and that
 * sentence was a requirement, an ELIGIBLE verdict would be claiming the citizen
 * passed a condition nobody ever checked. Incomplete coverage caps the verdict at
 * LIKELY_ELIGIBLE no matter how many clauses passed.
 */
export interface SourceCoverage {
  eligibility_text_length: number;
  covered_chars: number;
  /** Text the splitter could not assign to any clause. */
  uncovered_fragments: string[];
  complete: boolean;
  reviewed_by?: string;
  reviewed_at?: string;
}

export interface Scheme {
  id: string;
  name: string;
  /** Never translated in place — see `name_translations`. */
  name_translations?: Record<string, string>;

  level: 'central' | 'state' | 'unknown';
  state: string | null;
  ministry?: string;
  category: string[];

  description?: string;
  benefits?: string;
  application_process?: string;
  documents: string[];

  /** Verbatim eligibility prose, the substrate for every clause span. */
  eligibility_text: string;
  clauses: Clause[];
  source_coverage: SourceCoverage;

  apply_url?: string;
  source_url: string;

  /** Which raw dataset file this came from. */
  source_record: { file: string; sha256: string };
}

export interface Provenance {
  dataset: string;
  dataset_url: string;
  commit_sha: string;
  license: string;
  cloned_at: string;
  ingested_at: string;
  /** Files present in the clone, before de-duplication. */
  raw_files: number;
  /** Distinct schemes after de-duplication. */
  schemes: number;
  notes: string[];
}

/**
 * A scheme with no decisive clause is never shown as a match.
 *
 * Zero conditions evaluates to vacuous truth: everyone would be "eligible" for
 * every unreviewed scheme, which with ~1000 unreviewed schemes would bury the
 * real answers and tell citizens things that are not true.
 */
export function canProduceMatch(scheme: Scheme): boolean {
  return scheme.clauses.some(isDecisive);
}

export function decisiveClauses(scheme: Scheme): Clause[] {
  return scheme.clauses.filter(isDecisive);
}

/**
 * Combine clause statuses into a scheme verdict.
 *
 * Order matters: any violation is decisive and ends it. Otherwise incomplete
 * knowledge — an unknown clause, an unapproved requirement, or eligibility prose
 * the splitter never covered — caps the result at likely_eligible.
 */
export function combineVerdict(
  statuses: ClauseStatus[],
  opts: { hasUnapprovedRequirement: boolean; coverageComplete: boolean },
): Verdict {
  if (statuses.includes('violated')) return 'ineligible';
  if (statuses.length === 0) return 'likely_eligible';
  if (statuses.includes('unknown')) return 'likely_eligible';
  if (opts.hasUnapprovedRequirement) return 'likely_eligible';
  if (!opts.coverageComplete) return 'likely_eligible';
  return 'eligible';
}

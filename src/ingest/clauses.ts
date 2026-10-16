/**
 * Splitting eligibility prose into clause-sized chunks.
 *
 * The source renders eligibility as an HTML list, and the PDF text layer
 * concatenates the items with no separator at all:
 *
 *   "Children destitute during the Corona period...Lucknow.Children for the Chief
 *    Minister Child Service Scheme (General) are eligible.Orphan children and..."
 *
 * So a sentence terminator immediately followed by a capital is a list-item
 * boundary. That is a heuristic, and heuristics on legal text need a safety net:
 * every character that does NOT end up inside a clause is recorded as uncovered,
 * and uncovered eligibility text caps the scheme's verdict at LIKELY_ELIGIBLE.
 * A splitter bug can therefore cost recall, but it can never cause the system to
 * claim a citizen passed a condition nobody checked.
 */

import { PARA_SEP } from './pdf_text';

/** Abbreviations whose full stop is not a sentence end. */
const ABBREVIATIONS = [
  'rs', 'no', 'nos', 'etc', 'viz', 'dr', 'mr', 'mrs', 'ms', 'shri', 'smt', 'sh',
  'i.e', 'e.g', 'vs', 'approx', 'sr', 'jr', 'pvt', 'ltd', 'govt', 'deptt', 'dept',
  'yrs', 'hrs', 'min', 'max', 'st', 'nd', 'rd', 'th',
];

const MIN_CLAUSE_CHARS = 25;

export interface SplitClause {
  text: string;
  start: number;
  end: number;
}

export interface SplitResult {
  clauses: SplitClause[];
  /** Text that did not make it into any clause — the honest coverage gap. */
  uncovered: string[];
  coveredChars: number;
  totalChars: number;
}

export function isAbbreviationBoundary(text: string, dotIndex: number): boolean {
  // Look back over the token ending at the full stop.
  let i = dotIndex - 1;
  let token = '';
  while (i >= 0 && /[A-Za-z.]/.test(text[i]!)) {
    token = text[i] + token;
    i--;
  }
  if (ABBREVIATIONS.includes(token.toLowerCase())) return true;

  // Dotted initialisms: "U.T. of Lakshadweep", "A.P. Government", "Dr. B.R.
  // Ambedkar". Splitting inside one of these produces a clause beginning "T. of
  // Lakshadweep...", which is both wrong and unreviewable.
  if (/^(?:[A-Za-z]\.)+[A-Za-z]?$/.test(token)) return true;

  // A bare single letter before the stop is an initial, not a sentence end.
  if (token.length === 1 && /[A-Za-z]/.test(token)) return true;

  return false;
}

/**
 * Split on:
 *   - explicit paragraph separators (U+FEFF in the source markup)
 *   - a sentence terminator followed directly by a capital or '('
 *   - numbered list markers like "1:" or "2."
 */
export function splitEligibility(text: string, baseOffset = 0): SplitResult {
  const totalChars = text.length;
  const boundaries = new Set<number>([0, totalChars]);

  for (let i = 0; i < text.length - 1; i++) {
    const ch = text[i]!;
    const next = text[i + 1]!;

    if (ch === PARA_SEP) {
      boundaries.add(i);
      boundaries.add(i + 1);
      continue;
    }

    if ((ch === '.' || ch === ';' || ch === ':') && /[A-Z(]/.test(next)) {
      if (ch === '.' && isAbbreviationBoundary(text, i)) continue;
      boundaries.add(i + 1);
    }
  }

  // Numbered list markers: "...benefits.1: Supporting..." or "1. Item"
  const numbered = /(?<=[.;:\s])(\d{1,2}[.:)])\s*(?=[A-Z])/g;
  for (let m = numbered.exec(text); m; m = numbered.exec(text)) {
    boundaries.add(m.index);
  }

  const sorted = [...boundaries].sort((a, b) => a - b);
  const clauses: SplitClause[] = [];
  const uncovered: string[] = [];
  let coveredChars = 0;

  for (let i = 0; i < sorted.length - 1; i++) {
    const from = sorted[i]!;
    const to = sorted[i + 1]!;
    const raw = text.slice(from, to);
    const trimmed = raw.replace(new RegExp(`^[\\s${PARA_SEP}]+|[\\s${PARA_SEP}]+$`, 'g'), '');
    if (trimmed.length === 0) continue;

    if (trimmed.length < MIN_CLAUSE_CHARS) {
      uncovered.push(trimmed);
      continue;
    }

    const lead = raw.indexOf(trimmed);
    clauses.push({
      text: trimmed,
      start: baseOffset + from + lead,
      end: baseOffset + from + lead + trimmed.length,
    });
    coveredChars += trimmed.length;
  }

  return { clauses, uncovered, coveredChars, totalChars };
}

/**
 * Normalised key for grouping clauses that say the same thing across schemes.
 *
 * Income ceilings and BPL conditions recur near-verbatim across dozens of
 * schemes. Grouping them means one review decision covers the whole group, which
 * is the difference between a day of annotation work and a week of it.
 */
export function dedupKey(clauseText: string): string {
  return clauseText
    .toLowerCase()
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[^a-z0-9₹%]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

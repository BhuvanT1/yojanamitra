/**
 * Narrowing 2,066 schemes to a candidate set before rule evaluation.
 *
 * Retrieval favours recall. It is not a second eligibility gate — the rule
 * engine is the only gate — so its job is to avoid dropping a scheme the citizen
 * might qualify for, not to be precise. Anything it wrongly keeps is caught and
 * explained downstream; anything it wrongly drops is an entitlement the citizen
 * never hears about, which is the costly error.
 *
 * Two filters only, both of which are facts rather than guesses:
 *
 *   1. A state scheme does not apply outside its state. Applied only when the
 *      citizen actually stated a state — an unknown state keeps everything.
 *   2. A scheme with no approved clause can never produce a match, so it cannot
 *      reach the results list. It remains retrievable as source information.
 *
 * Everything else is scored and ranked, never excluded.
 */

import type { Profile } from '../domain/profile';
import { isKnown } from '../domain/profile';
import type { Scheme } from '../domain/scheme';
import { canProduceMatch } from '../domain/scheme';
import { isDecisive } from '../domain/clause';
import { fieldsUsed } from '../domain/constraint';

export interface Candidate {
  scheme: Scheme;
  score: number;
  /** Why it ranked where it did — shown in debug output, never to the citizen. */
  signals: string[];
}

export interface RetrievalOptions {
  /** Hard cap on candidates handed to the rule engine. */
  limit?: number;
  /** Include schemes with no approved clause (they can never match). */
  includeUnreviewed?: boolean;
}

export interface RetrievalResult {
  candidates: Candidate[];
  total_schemes: number;
  excluded_wrong_state: number;
  excluded_unreviewed: number;
  /** True when the cap bit, i.e. some scheme was dropped purely by rank. */
  truncated: boolean;
}

export function retrieve(
  schemes: Scheme[],
  profile: Profile,
  opts: RetrievalOptions = {},
): RetrievalResult {
  const limit = opts.limit ?? 200;
  const citizenState = isKnown(profile.state) ? profile.state.value : null;

  const occupations = isKnown(profile.occupation) ? profile.occupation.value.map(String) : [];
  const specials = isKnown(profile.special_categories)
    ? profile.special_categories.value.map(String)
    : [];
  const category = isKnown(profile.category) ? String(profile.category.value) : null;

  let excluded_wrong_state = 0;
  let excluded_unreviewed = 0;
  const scored: Candidate[] = [];

  for (const scheme of schemes) {
    // 1. A state scheme in a different state is a fact, not a guess.
    if (citizenState && scheme.level === 'state' && scheme.state && scheme.state !== citizenState) {
      excluded_wrong_state++;
      continue;
    }

    // 2. Nothing approved → cannot produce a match.
    if (!opts.includeUnreviewed && !canProduceMatch(scheme)) {
      excluded_unreviewed++;
      continue;
    }

    const signals: string[] = [];
    let score = 0;

    if (scheme.level === 'central') {
      score += 1;
      signals.push('central');
    }
    if (citizenState && scheme.state === citizenState) {
      score += 4;
      signals.push(`state match: ${citizenState}`);
    }

    const haystack = `${scheme.name} ${scheme.category.join(' ')} ${scheme.eligibility_text}`.toLowerCase();
    for (const o of occupations) {
      if (haystack.includes(o)) {
        score += 3;
        signals.push(`occupation: ${o}`);
      }
    }
    for (const s of specials) {
      if (haystack.includes(s.replace('_', ' '))) {
        score += 3;
        signals.push(`special: ${s}`);
      }
    }
    if (category && haystack.includes(category)) {
      score += 2;
      signals.push(`category: ${category}`);
    }

    // A scheme whose approved clauses test fields the citizen actually stated is
    // more likely to resolve to a real verdict rather than to "unknown".
    const testedFields = new Set(
      scheme.clauses.filter(isDecisive).flatMap((c) => fieldsUsed(c.constraint!)),
    );
    const known = [...testedFields].filter(
      (f) => (profile as unknown as Record<string, unknown>)[f] !== undefined,
    );
    score += known.length;
    if (known.length) signals.push(`answerable fields: ${known.join(', ')}`);

    scored.push({ scheme, score, signals });
  }

  scored.sort((a, b) => b.score - a.score || a.scheme.id.localeCompare(b.scheme.id));

  return {
    candidates: scored.slice(0, limit),
    total_schemes: schemes.length,
    excluded_wrong_state,
    excluded_unreviewed,
    truncated: scored.length > limit,
  };
}

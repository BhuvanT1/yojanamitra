/**
 * The end-to-end match pipeline: free text in, explained verdicts out.
 *
 * The ordering here is the architecture. Extraction produces a profile;
 * retrieval narrows the corpus; the rule engine decides. Nothing downstream of
 * the rule engine can change a verdict — the explanation layer may only quote
 * what the engine already concluded.
 */

import { extractProfile, type ExtractionResult } from '../extraction/extract';
import { retrieve, type RetrievalResult } from '../retrieval/candidates';
import { evaluateScheme, type SchemeMatch } from './evaluate';
import type { Profile } from '../domain/profile';
import type { Scheme, Verdict } from '../domain/scheme';

export interface MatchResult {
  extraction: ExtractionResult;
  retrieval: Omit<RetrievalResult, 'candidates'> & { candidates: number };
  eligible: SchemeMatch[];
  likely_eligible: SchemeMatch[];
  ineligible: SchemeMatch[];
  /** Fields that, if the citizen supplied them, would resolve the most unknowns. */
  would_resolve_most: { field: string; schemes: number }[];
}

const ORDER: Verdict[] = ['eligible', 'likely_eligible', 'ineligible'];

export function matchFromProfile(schemes: Scheme[], profile: Profile, limit = 200): Omit<MatchResult, 'extraction'> {
  const r = retrieve(schemes, profile, { limit });
  const matches = r.candidates.map((c) => evaluateScheme(c.scheme, profile));

  const byVerdict = (v: Verdict) =>
    matches
      .filter((m) => m.verdict === v)
      // Fewer unresolved fields first: those are the most actionable results.
      .sort((a, b) => a.missing_fields.length - b.missing_fields.length);

  const gap = new Map<string, Set<string>>();
  for (const m of matches) {
    if (m.verdict !== 'likely_eligible') continue;
    for (const f of m.missing_fields) {
      const set = gap.get(f) ?? new Set<string>();
      set.add(m.scheme_id);
      gap.set(f, set);
    }
  }

  return {
    retrieval: { ...r, candidates: r.candidates.length },
    eligible: byVerdict('eligible'),
    likely_eligible: byVerdict('likely_eligible'),
    ineligible: byVerdict('ineligible'),
    would_resolve_most: [...gap.entries()]
      .map(([field, s]) => ({ field, schemes: s.size }))
      .sort((a, b) => b.schemes - a.schemes)
      .slice(0, 5),
  };
}

export function match(schemes: Scheme[], text: string, limit = 200): MatchResult {
  const extraction = extractProfile(text);
  return { extraction, ...matchFromProfile(schemes, extraction.profile, limit) };
}

export { ORDER as VERDICT_ORDER };

/**
 * Free text → structured profile.
 *
 * Three rules this module never breaks:
 *
 *   1. **Evidence is verbatim.** Every field carries substrings of the citizen's
 *      original text. The result is checked against `assertEvidenceIsGrounded`
 *      before it is returned; a field whose evidence does not appear in the input
 *      is dropped rather than shown.
 *
 *   2. **No field is guessed.** A term that is not in the lexicon produces
 *      nothing. Absent is a valid, meaningful state — it makes a constraint
 *      UNKNOWN, which caps the verdict at likely_eligible, which is the honest
 *      answer. Inventing a value would instead produce a confident wrong one.
 *
 *   3. **Nothing here decides eligibility.** This module outputs a profile. The
 *      rule engine, and only the rule engine, decides what that profile qualifies
 *      for.
 */

import type {
  Dependent,
  ExtractedField,
  Gender,
  Profile,
  RawInput,
  Residence,
  SocialCategory,
} from '../domain/profile';
import { assertEvidenceIsGrounded } from '../domain/profile';
import {
  CATEGORY_TERMS,
  EDUCATION_STAGE_TERMS,
  EDUCATION_WORDS,
  GENDER_TERMS,
  OCCUPATION_TERMS,
  RELATION_TERMS,
  RESIDENCE_TERMS,
  SPECIAL_TERMS,
  STATE_TERMS,
  stageForClass,
  type TermTable,
} from './lexicon';
import { detectScript } from './detect';
import { parseAge, parseLandAcres, parseMoney, parseSchoolClass, type NumberHit } from './numbers';

interface Match {
  value: string;
  surface: string;
  confidence: number;
  index: number;
}

/**
 * Find lexicon terms in the original text.
 *
 * Word boundaries are applied only for Latin-script terms: Devanagari and Telugu
 * are written without spaces between a stem and its inflection, so `\b` would
 * miss "రైతుని" when the lexicon holds "రైతు".
 */
function findTerms(text: string, table: TermTable<string>[]): Match[] {
  const hay = text.toLowerCase();
  const out: Match[] = [];

  for (const entry of table) {
    for (const term of entry.terms) {
      const needle = term.surface.toLowerCase();
      const latin = /^[\x20-\x7F]+$/.test(needle);

      let at = hay.indexOf(needle);
      while (at >= 0) {
        let ok = true;
        if (latin) {
          const before = at === 0 ? ' ' : hay[at - 1]!;
          const after = hay[at + needle.length] ?? ' ';
          ok = !/[a-z0-9]/.test(before) && !/[a-z0-9]/.test(after);
        }
        if (ok) {
          out.push({
            value: entry.value,
            surface: text.slice(at, at + needle.length),
            confidence: term.confidence,
            index: at,
          });
          break;
        }
        at = hay.indexOf(needle, at + 1);
      }
    }
  }
  return out;
}

/** Best single value from a set of matches — highest confidence wins. */
function single(matches: Match[]): { value: string; confidence: number; evidence: string[] } | null {
  if (matches.length === 0) return null;
  const byValue = new Map<string, Match[]>();
  for (const m of matches) {
    byValue.set(m.value, [...(byValue.get(m.value) ?? []), m]);
  }
  const ranked = [...byValue.entries()]
    .map(([value, ms]) => ({
      value,
      confidence: Math.max(...ms.map((m) => m.confidence)),
      evidence: [...new Set(ms.map((m) => m.surface))],
    }))
    .sort((a, b) => b.confidence - a.confidence);

  const top = ranked[0]!;
  // A genuine tie means the text supports two readings; say so by lowering
  // confidence rather than picking one and sounding certain.
  if (ranked.length > 1 && ranked[1]!.confidence === top.confidence) {
    return { ...top, confidence: top.confidence * 0.6 };
  }
  return top;
}

function field<T>(value: T, confidence: number, evidence: string[]): ExtractedField<T> {
  return { value, confidence: Number(confidence.toFixed(2)), evidence, origin: 'extracted' };
}

// ---------------------------------------------------------------- dependents

/**
 * Household members.
 *
 * "my daughter is in 11th class" is a fact about a dependent, not the applicant.
 * Getting this wrong means testing the parent's education against a scholarship
 * meant for the child — a whole scheme decided against the wrong person.
 */
function extractDependents(text: string): Dependent[] {
  const relations = findTerms(text, RELATION_TERMS);
  if (relations.length === 0) return [];

  const schoolClass = parseSchoolClass(text, EDUCATION_WORDS.map((t) => t.surface));
  const deps: Dependent[] = [];

  relations
    .sort((a, b) => a.index - b.index)
    .forEach((rel, i) => {
      const dep: Dependent = {
        id: `dep_${i + 1}`,
        relation: field(rel.value, rel.confidence, [rel.surface]),
      };

      if (rel.value === 'daughter') {
        dep.gender = field<Gender>('female', rel.confidence, [rel.surface]);
      } else if (rel.value === 'son') {
        dep.gender = field<Gender>('male', rel.confidence, [rel.surface]);
      }

      // Attach a class number only when there is exactly one relation mentioned;
      // with two children and one class number we cannot tell whose it is, and
      // guessing would bind the constraint to the wrong person.
      if (schoolClass && relations.length === 1) {
        const stage = stageForClass(schoolClass.value);
        if (stage) dep.education_stage = field(stage, 0.85, [schoolClass.text]);
      }

      deps.push(dep);
    });

  return deps;
}

// ---------------------------------------------------------------- entry point

export interface ExtractionResult {
  profile: Profile;
  /** Fields dropped because their evidence was not verbatim. Should be empty. */
  rejected: string[];
  /** Fields the text did not mention, for the "what I understood" panel. */
  unknown_fields: string[];
}

export function extractProfile(rawText: string): ExtractionResult {
  const text = rawText.trim();
  const script = detectScript(text);

  const raw: RawInput = {
    text,
    detected_language: script.language,
    detection_confidence: script.confidence,
    script: script.script,
  };

  const profile: Profile = { raw, dependents: [] };

  // --- numbers first, so later parsers can avoid double-claiming a figure ---
  const money = parseMoney(text);
  const land = parseLandAcres(text);
  const schoolClass = parseSchoolClass(text, EDUCATION_WORDS.map((t) => t.surface));

  const claimed: NumberHit[] = [...money];
  if (land) claimed.push(land);
  if (schoolClass) claimed.push(schoolClass);

  const age = parseAge(text, claimed);
  if (age) profile.age = field(age.value, 0.9, [age.text]);

  if (money.length > 0) {
    // The largest figure with a currency or lakh marker is the income; a smaller
    // one is usually a fee or an instalment.
    const best = money.reduce((a, b) => (b.value > a.value ? b : a));
    const incomeCue = /(income|earn|salary|कमा|आय|आमदनी|సంపాదన|ఆదాయ)/i.test(text);
    profile.annual_income_inr = field(best.value, incomeCue ? 0.9 : 0.6, [best.text]);
  }

  if (land) profile.land_acres = field(land.value, 0.9, [land.text]);

  const occ = findTerms(text, OCCUPATION_TERMS);
  if (occ.length > 0) {
    const values = [...new Set(occ.map((m) => m.value))];
    profile.occupation = field(
      values,
      Math.max(...occ.map((m) => m.confidence)),
      [...new Set(occ.map((m) => m.surface))],
    );
  }

  const state = single(findTerms(text, STATE_TERMS));
  if (state) profile.state = field(state.value, state.confidence, state.evidence);

  const residence = single(findTerms(text, RESIDENCE_TERMS));
  if (residence) {
    profile.residence = field<Residence>(residence.value as Residence, residence.confidence, residence.evidence);
  }

  const category = single(findTerms(text, CATEGORY_TERMS));
  if (category) {
    profile.category = field<SocialCategory>(
      category.value as SocialCategory,
      category.confidence,
      category.evidence,
    );
  }

  const special = findTerms(text, SPECIAL_TERMS);
  if (special.length > 0) {
    profile.special_categories = field(
      [...new Set(special.map((m) => m.value))],
      Math.max(...special.map((m) => m.confidence)),
      [...new Set(special.map((m) => m.surface))],
    );
  }

  // "widow" says the applicant is female; the special category already carries
  // the evidence, so reuse it rather than inventing a new span.
  const gender = single(findTerms(text, GENDER_TERMS));
  if (gender) {
    profile.gender = field<Gender>(gender.value as Gender, gender.confidence, gender.evidence);
  } else {
    const widow = special.find((s) => s.value === 'widow');
    if (widow) profile.gender = field<Gender>('female', 0.85, [widow.surface]);
  }

  profile.dependents = extractDependents(text);

  // The applicant's own education stage — only when no dependent claimed the
  // class number, otherwise a parent inherits their child's schooling.
  if (profile.dependents.length === 0) {
    const stageTerm = single(findTerms(text, EDUCATION_STAGE_TERMS));
    if (stageTerm) {
      profile.education_stage = field(stageTerm.value, stageTerm.confidence, stageTerm.evidence);
    } else if (schoolClass) {
      const stage = stageForClass(schoolClass.value);
      if (stage) profile.education_stage = field(stage, 0.8, [schoolClass.text]);
    }
  }

  // --- the grounding gate -------------------------------------------------
  // Anything whose evidence is not verbatim is removed, not shown with a caveat.
  const rejected: string[] = [];
  for (const problem of assertEvidenceIsGrounded(profile)) {
    const path = problem.split(':')[0]!;
    rejected.push(problem);
    if (path.startsWith('dependents[')) {
      const id = path.slice('dependents['.length, path.indexOf(']'));
      profile.dependents = profile.dependents.filter((d) => d.id !== id);
    } else {
      delete (profile as unknown as Record<string, unknown>)[path];
    }
  }

  const unknown_fields = (
    [
      'age', 'annual_income_inr', 'occupation', 'land_acres', 'state',
      'residence', 'gender', 'category', 'education_stage', 'special_categories',
    ] as const
  ).filter((f) => profile[f] === undefined);

  return { profile, rejected, unknown_fields };
}

/**
 * Apply a citizen's correction. Their word is final: confidence 1, origin
 * `user_corrected`, and no evidence required — they are the source.
 */
export function applyCorrection<T>(profile: Profile, fieldName: string, value: T): Profile {
  return {
    ...profile,
    [fieldName]: { value, confidence: 1, evidence: [], origin: 'user_corrected' } as ExtractedField<T>,
  };
}

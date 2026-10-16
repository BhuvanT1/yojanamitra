/**
 * The citizen profile: the only thing the rule engine is allowed to evaluate
 * constraints against.
 *
 * Two invariants this file exists to enforce:
 *
 *   1. A field that was never stated is ABSENT, not zero and not null. "No land
 *      mentioned" and "owns zero acres" are different facts and must stay
 *      different, because a constraint `land_acres > 0` should be UNKNOWN for
 *      the first and VIOLATED for the second.
 *
 *   2. Every extracted value carries the substring of the ORIGINAL input that
 *      produced it. Not the translation, not the normalised form — the text the
 *      citizen actually typed, so the correction panel can highlight it.
 */

/** Fixed profile schema. Extending this list is a human decision, never an inference. */
export const PROFILE_FIELDS = [
  'age',
  'annual_income_inr',
  'occupation',
  'land_acres',
  'state',
  'residence',
  'gender',
  'category',
  'education_stage',
  'special_categories',
  'dependents',
] as const;

export type ProfileField = (typeof PROFILE_FIELDS)[number];

/** Fields a constraint may target on a dependent. `dependents` itself is not recursive. */
export const DEPENDENT_FIELDS = [
  'age',
  'gender',
  'education_stage',
  'occupation',
  'category',
  'special_categories',
] as const;

export type DependentField = (typeof DEPENDENT_FIELDS)[number];

export const GENDERS = ['male', 'female', 'transgender'] as const;
export const RESIDENCE = ['rural', 'urban'] as const;
export const SOCIAL_CATEGORIES = ['general', 'obc', 'sc', 'st', 'ews'] as const;

export type Gender = (typeof GENDERS)[number];
export type Residence = (typeof RESIDENCE)[number];
export type SocialCategory = (typeof SOCIAL_CATEGORIES)[number];

/**
 * A single extracted attribute plus the evidence that produced it.
 *
 * `evidence` entries MUST be exact substrings of `RawInput.text` — the original,
 * untranslated input. Enforced by `assertEvidenceIsGrounded`.
 */
export interface ExtractedField<T> {
  value: T;
  /** 0..1. Only ever orders results; never decides eligibility. */
  confidence: number;
  evidence: string[];
  origin: 'extracted' | 'user_corrected';
}

/** A household member. Has a stable id so constraints bind to ONE person. */
export interface Dependent {
  /** Stable within a profile. A constraint referencing dep_1 always means dep_1. */
  id: string;
  relation?: ExtractedField<string>;
  age?: ExtractedField<number>;
  gender?: ExtractedField<Gender>;
  education_stage?: ExtractedField<string>;
  occupation?: ExtractedField<string[]>;
  category?: ExtractedField<SocialCategory>;
  special_categories?: ExtractedField<string[]>;
}

/** What the citizen actually typed or said, before anything was done to it. */
export interface RawInput {
  text: string;
  /** BCP-47 where detectable. 'und' when detection failed — never guessed. */
  detected_language: string;
  detection_confidence: number;
  /** Set only when the pipeline translated. Never the evidence source. */
  translated_text?: string;
  script?: 'native' | 'romanised' | 'mixed';
}

export interface Profile {
  raw: RawInput;

  age?: ExtractedField<number>;
  annual_income_inr?: ExtractedField<number>;
  occupation?: ExtractedField<string[]>;
  land_acres?: ExtractedField<number>;
  state?: ExtractedField<string>;
  residence?: ExtractedField<Residence>;
  gender?: ExtractedField<Gender>;
  category?: ExtractedField<SocialCategory>;
  education_stage?: ExtractedField<string>;
  special_categories?: ExtractedField<string[]>;

  dependents: Dependent[];
}

/** Absent means unknown. Never coerce a missing field to a default. */
export function isKnown<T>(f: ExtractedField<T> | undefined): f is ExtractedField<T> {
  return f !== undefined && f.value !== null && f.value !== undefined;
}

export function getDependent(profile: Profile, id: string): Dependent | undefined {
  return profile.dependents.find((d) => d.id === id);
}

/**
 * Every piece of evidence must be a verbatim substring of the original input.
 *
 * This is the check that stops an LLM from inventing a justification. If a model
 * claims `occupation: farmer` on evidence "works the land" and those words are
 * not in what the citizen wrote, the extraction is rejected rather than shown.
 */
export function assertEvidenceIsGrounded(profile: Profile): string[] {
  const problems: string[] = [];
  const source = profile.raw.text;

  const check = (path: string, f: ExtractedField<unknown> | undefined) => {
    if (!f) return;
    if (f.origin === 'user_corrected') return; // the citizen is the authority
    for (const ev of f.evidence) {
      if (!source.includes(ev)) {
        problems.push(`${path}: evidence ${JSON.stringify(ev)} is not a substring of the original input`);
      }
    }
    if (f.evidence.length === 0) {
      problems.push(`${path}: extracted with no evidence`);
    }
  };

  check('age', profile.age);
  check('annual_income_inr', profile.annual_income_inr);
  check('occupation', profile.occupation);
  check('land_acres', profile.land_acres);
  check('state', profile.state);
  check('residence', profile.residence);
  check('gender', profile.gender);
  check('category', profile.category);
  check('education_stage', profile.education_stage);
  check('special_categories', profile.special_categories);

  for (const dep of profile.dependents) {
    for (const f of DEPENDENT_FIELDS) {
      check(`dependents[${dep.id}].${f}`, dep[f] as ExtractedField<unknown> | undefined);
    }
  }

  return problems;
}

/**
 * Turning eligibility prose into PROPOSED typed constraints.
 *
 * Nothing here decides anything. Every output lands as `annotation_state:
 * 'proposed'` and a proposed constraint is invisible to the rule engine until a
 * human approves it. That is the point: this module's job is to make review fast,
 * not to be trusted.
 *
 * It is deliberately deterministic — regular expressions over a fixed vocabulary,
 * no model call. Three reasons:
 *
 *   1. It is reproducible. The same corpus yields the same proposals, so a
 *      reviewer's work is not invalidated by a model version bump.
 *   2. It is testable, and it is tested against real corpus strings.
 *   3. It needs no API key, so `npm run propose` works offline.
 *
 * An LLM proposer can be added behind `ProposalSource` later; it would improve
 * recall on prose these patterns miss, and it would change nothing about the
 * approval gate.
 */

import type { ConstraintExpr, Predicate, Subject } from '../domain/constraint';
import { validateExpr } from '../domain/constraint';
import type { AnnotationState, ClauseKind } from '../domain/clause';
import { parseAmounts, parseIntegers } from './amounts';
import { INDIAN_STATES } from '../ingest/sections';

export interface Proposal {
  constraint: ConstraintExpr | null;
  state: AnnotationState;
  /** Suggested reclassification — a human still confirms it. */
  kind: ClauseKind;
  /** Which field would unlock this, when state is needs_schema_extension. */
  missing_field?: string;
  /** Shown in the review UI so the reviewer knows what to check. */
  note?: string;
  /** Substrings that drove the proposal, for highlighting. */
  evidence: string[];
}

const SELF: Subject = { kind: 'self' };
const ANY_DEPENDENT: Subject = { kind: 'dependent', selector: { match: 'any' } };

// ---------------------------------------------------------------- polarity

/**
 * Phrases that flip a clause from "must satisfy" to "must NOT satisfy".
 *
 * Getting this wrong is the worst failure this module can produce: it would
 * propose a constraint that admits exactly the people the scheme excludes. So
 * the detection is conservative, and a clause whose polarity looks negative but
 * whose pattern is uncertain is left for the reviewer rather than guessed.
 */
const NEGATIVE_MARKERS = [
  'shall not be eligible',
  'are not eligible',
  'is not eligible',
  'not be eligible',
  'does not cover',
  'shall not cover',
  'are excluded',
  'stand excluded',
  'excluding',
  'other than',
  'ineligible',
  'not admissible',
  'shall not apply',
];

/**
 * Negative constructions that no substring can catch.
 *
 * "No livestock farmers are eligible for the scheme" contains none of the
 * markers above — the negation is a leading "No", far from the word "eligible".
 * Found by running the engine in simulation against the real corpus, where it
 * had turned a disqualifying clause into a positive requirement for farmers.
 */
const NEGATIVE_PATTERNS: RegExp[] = [
  /\bno\b[\w\s,'()/-]{0,40}\b(?:are|is|shall\s+be|will\s+be|would\s+be)\s+eligible\b/i,
  /\bnone\s+of\b[\w\s,'()/-]{0,40}\b(?:are|is|shall\s+be)\s+eligible\b/i,
  /\bneither\b[\w\s,'()/-]{0,40}\beligible\b/i,
  /\bnot\s+(?:be\s+)?(?:entitled|considered|permitted|allowed)\b/i,
  /\bdisqualif(?:y|ied|ication)\b/i,
  /\bdebarred\b/i,
];

export function isNegativePolarity(text: string): boolean {
  const t = text.toLowerCase();
  if (NEGATIVE_MARKERS.some((m) => t.includes(m))) return true;
  return NEGATIVE_PATTERNS.some((re) => re.test(text));
}

// ---------------------------------------------------------------- vocabularies

const OCCUPATIONS: Record<string, string[]> = {
  farmer: ['farmer', 'farmers', 'cultivator', 'agriculturist', 'bonafide farmer'],
  student: ['student', 'students', 'scholar', 'pupil'],
  artisan: ['artisan', 'artisans', 'craftsperson', 'handicraft'],
  weaver: ['weaver', 'weavers', 'handloom weaver'],
  fisherman: ['fisherman', 'fishermen', 'fisher folk', 'fisherfolk'],
  labourer: ['labourer', 'labour', 'worker', 'construction worker', 'building worker'],
  shopkeeper: ['shopkeeper', 'street vendor', 'vendor', 'trader'],
  artist: ['artist', 'artists', 'performer'],
  entrepreneur: ['entrepreneur', 'entrepreneurs'],
  teacher: ['teacher', 'teachers'],
};

const SPECIAL_CATEGORIES: Record<string, string[]> = {
  bpl: ['below poverty line', 'bpl', 'antyodaya'],
  widow: ['widow', 'widows', 'widowed'],
  differently_abled: [
    'differently abled', 'differently-abled', 'person with disability',
    'persons with disabilities', 'divyang', 'physically handicapped', 'handicapped',
  ],
  ex_serviceman: ['ex-serviceman', 'ex-servicemen', 'ex serviceman'],
  landless: ['landless'],
  orphan: ['orphan', 'orphans', 'destitute'],
  senior_citizen: ['senior citizen', 'senior citizens', 'old age'],
};

const SOCIAL_CATEGORY_WORDS: Record<string, string[]> = {
  sc: ['scheduled caste', 'sc category', 'sc communities', 'sc/st', 'sc & st', 'sc and st'],
  st: ['scheduled tribe', 'st category', 'st communities', 'sc/st', 'sc & st', 'sc and st'],
  obc: ['other backward class', 'obc', 'backward class'],
  ews: ['economically weaker section', 'ews'],
  general: ['general category', 'general &', 'general and'],
};

/**
 * Requirements the profile schema cannot express, mapped to the field that would
 * unlock them. Sorting the backlog by these counts is how we decide which schema
 * extension is worth making.
 */
const SCHEMA_GAPS: { pattern: RegExp; field: string }[] = [
  { pattern: /\bcitizen of india\b|\bindian citizen\b|\bcitizenship\b/i, field: 'citizenship' },
  { pattern: /\b\d{1,3}\s*%\s*(and above|or more|aggregate|marks)|\bmarks\b|\bpercentage of marks\b/i, field: 'marks_percentage' },
  { pattern: /\b(for at least|for a minimum of|residing for)\s+\d+\s*(years?|months?)\b/i, field: 'domicile_years' },
  { pattern: /\b\d{1,3}\s*%\s*(disability|handicap)|degree of disability|disability of not less than/i, field: 'disability_percentage' },
  { pattern: /\bincome tax\s*(payer|payee|assessee)|\bpaid income tax\b/i, field: 'is_income_tax_payer' },
  { pattern: /\balready (availed|received|benefit)|\bprior benefit\b|\bpreviously availed\b/i, field: 'prior_benefit_received' },
  { pattern: /\baadhaar\b|\bbank account\b|\be-?kyc\b/i, field: 'documents_held' },
  { pattern: /\bration card\b/i, field: 'ration_card_type' },
  { pattern: /\bcaste certificate\b|\bdomicile certificate\b/i, field: 'documents_held' },
];

/** Clauses that are steps in applying, not conditions a citizen can fail. */
const PROCEDURAL = /\b(apply|application form|submit|attach|upload|registration|register|documents? required|self-?declaration|e-?kyc|seeding)\b/i;
/** Clauses that state no condition at all. */
const INFORMATIONAL = /^(note|objective|the scheme aims|the objective|negative list|for agencies)\b/i;

// ---------------------------------------------------------------- helpers

function pred(field: string, op: Predicate['op'], value: Predicate['value'], subject = SELF): Predicate {
  return { kind: 'predicate', subject, field: field as Predicate['field'], op, value };
}

function findAny(text: string, table: Record<string, string[]>): { key: string; hit: string }[] {
  const t = text.toLowerCase();
  const found: { key: string; hit: string }[] = [];
  for (const [key, words] of Object.entries(table)) {
    for (const w of words) {
      if (t.includes(w)) {
        found.push({ key, hit: w });
        break;
      }
    }
  }
  return found;
}

// ---------------------------------------------------------------- rules

function proposeIncome(text: string): { expr: ConstraintExpr; evidence: string[]; note?: string } | null {
  if (!/\bincome\b/i.test(text)) return null;
  const amounts = parseAmounts(text);
  if (amounts.length === 0) return null;

  const t = text.toLowerCase();
  const between = /\bbetween\b[\s\S]{0,40}\band\b|\bfrom\b[\s\S]{0,30}\bto\b/.test(t);

  if (between && amounts.length >= 2) {
    const lo = amounts[0]!;
    const hi = amounts[1]!;

    // "between ₹1.2 and ₹5 lakhs" states the multiplier once, on the upper
    // bound. Read literally the floor is ₹1.2, which would admit every citizen
    // in India. When the lower bound is bare and the upper one carries a
    // lakh/crore word, the word governs both.
    let loValue = lo.value;
    let sharedMultiplierNote: string | undefined;
    if (!lo.hadMultiplierWord && hi.hadMultiplierWord && hi.multiplier > 1) {
      loValue = lo.value * hi.multiplier;
      sharedMultiplierNote =
        `Lower bound was bare; applied the "${hi.text.trim()}" multiplier to both, ` +
        `giving ${loValue.toLocaleString('en-IN')}. Confirm against the source.`;
    }

    return {
      expr: {
        kind: 'all',
        children: [
          pred('annual_income_inr', 'gte', loValue),
          pred('annual_income_inr', 'lte', hi.value),
        ],
      },
      evidence: [lo.text, hi.text],
      note: sharedMultiplierNote,
    };
  }

  const a = amounts[0]!;
  if (/\b(less than or equal to|not exceed(ing)?|up to|upto|maximum of|not more than|within)\b/.test(t)) {
    return { expr: pred('annual_income_inr', 'lte', a.value), evidence: [a.text] };
  }
  if (/\b(less than|below|under)\b/.test(t)) {
    return { expr: pred('annual_income_inr', 'lt', a.value), evidence: [a.text] };
  }
  if (/\b(more than|above|exceed(s|ing)?|at least|minimum)\b/.test(t)) {
    return { expr: pred('annual_income_inr', 'gt', a.value), evidence: [a.text] };
  }
  // A bare figure next to "income" is almost always a ceiling, but "almost
  // always" is exactly the kind of guess a reviewer needs told about.
  return {
    expr: pred('annual_income_inr', 'lte', a.value),
    evidence: [a.text],
    note: 'No comparison word found; assumed a ceiling. Confirm the direction.',
  };
}

function proposeAge(text: string): { expr: ConstraintExpr; evidence: string[]; note?: string } | null {
  if (!/\bage[ds]?\b|\byears?\b/i.test(text)) return null;
  if (/\bno age limit\b|\birrespective of .{0,20}age\b/i.test(text)) return null;

  const t = text.toLowerCase();
  const ints = parseIntegers(text).filter((n) => n.value >= 1 && n.value <= 120);
  if (ints.length === 0) return null;

  const range = t.match(/\b(?:between|from)\s+(?:the\s+)?(?:ages?\s+of\s+)?(\d{1,3})\s*(?:and|to|-|–)\s*(\d{1,3})\s*years?\b/);
  const bareRange = t.match(/\b(\d{1,3})\s*(?:to|-|–)\s*(\d{1,3})\s*years?\b/);
  const r = range ?? bareRange;
  if (r) {
    const lo = Number(r[1]);
    const hi = Number(r[2]);
    if (lo < hi) {
      return {
        expr: {
          kind: 'all',
          children: [pred('age', 'gte', lo), pred('age', 'lte', hi)],
        },
        evidence: [r[0]!],
      };
    }
  }

  const n = ints.find((x) => new RegExp(`${x.value}\\s*years?`, 'i').test(text)) ?? ints[0]!;

  if (/\b(at least|minimum|not less than|completed)\b/.test(t)) {
    return { expr: pred('age', 'gte', n.value), evidence: [n.text] };
  }
  if (/\b(above|over|more than|exceed)\b/.test(t)) {
    return {
      expr: pred('age', 'gte', n.value),
      evidence: [n.text],
      note: `"above ${n.value}" is ambiguous — proposed as >= ${n.value}. Change to > if the scheme means strictly older.`,
    };
  }
  if (/\b(below|under|less than|not more than|not exceed(ing)?|up to|upto|maximum|age limit)\b/.test(t)) {
    return { expr: pred('age', 'lte', n.value), evidence: [n.text] };
  }
  return null;
}

function proposeCategory(text: string): { expr: ConstraintExpr; evidence: string[] } | null {
  const hits = findAny(text, SOCIAL_CATEGORY_WORDS);
  if (hits.length === 0) return null;
  const keys = [...new Set(hits.map((h) => h.key))];
  const evidence = [...new Set(hits.map((h) => h.hit))];
  if (keys.length === 1) return { expr: pred('category', 'eq', keys[0]!), evidence };
  return { expr: pred('category', 'in', keys), evidence };
}

function proposeOccupation(text: string): { expr: ConstraintExpr; evidence: string[] } | null {
  const hits = findAny(text, OCCUPATIONS);
  if (hits.length === 0) return null;
  return {
    expr: pred('occupation', 'contains_any', [...new Set(hits.map((h) => h.key))]),
    evidence: [...new Set(hits.map((h) => h.hit))],
  };
}

function proposeSpecial(text: string): { expr: ConstraintExpr; evidence: string[] } | null {
  const hits = findAny(text, SPECIAL_CATEGORIES);
  if (hits.length === 0) return null;
  return {
    expr: pred('special_categories', 'contains_any', [...new Set(hits.map((h) => h.key))]),
    evidence: [...new Set(hits.map((h) => h.hit))],
  };
}

function proposeState(text: string): { expr: ConstraintExpr; evidence: string[] } | null {
  const t = text.toLowerCase();
  if (!/\b(resident|domicile|native|belonging to|permanent resident|of the state)\b/.test(t)) return null;
  for (const s of INDIAN_STATES) {
    if (t.includes(s)) return { expr: pred('state', 'eq', s), evidence: [s] };
  }
  return null;
}

function proposeResidence(text: string): { expr: ConstraintExpr; evidence: string[] } | null {
  const t = text.toLowerCase();
  if (/\brural area|\bin a village\b|\brural\b/.test(t)) {
    return { expr: pred('residence', 'eq', 'rural'), evidence: ['rural'] };
  }
  if (/\burban area|\bmunicipal\b|\burban\b/.test(t)) {
    return { expr: pred('residence', 'eq', 'urban'), evidence: ['urban'] };
  }
  return null;
}

function proposeGender(text: string): { expr: ConstraintExpr; evidence: string[]; note?: string } | null {
  const t = text.toLowerCase();
  // "girl child" is about a dependent, not the applicant — the distinction the
  // subject field exists for.
  if (/\bgirl child\b|\bgirl children\b|\bdaughter\b/.test(t)) {
    return {
      expr: pred('gender', 'eq', 'female', ANY_DEPENDENT),
      evidence: [/girl child/.test(t) ? 'girl child' : 'daughter'],
      note: 'Proposed against a DEPENDENT, not the applicant. Confirm whose gender the clause means.',
    };
  }
  if (/\b(women|woman|female|mahila)\b/.test(t)) {
    return { expr: pred('gender', 'eq', 'female'), evidence: ['women'] };
  }
  return null;
}

// ---------------------------------------------------------------- entry point

export function proposeConstraint(clauseText: string): Proposal {
  const text = clauseText.trim();

  // 1. Is this an eligibility criterion at all?
  if (INFORMATIONAL.test(text)) {
    return {
      constraint: null,
      state: 'not_machine_checkable',
      kind: 'informational',
      note: 'Reads as context rather than a condition.',
      evidence: [],
    };
  }
  if (PROCEDURAL.test(text) && !/\b(income|age|resident|belong)\b/i.test(text)) {
    return {
      constraint: null,
      state: 'not_machine_checkable',
      kind: 'procedural',
      note: 'Reads as an application step, not a condition the citizen can fail.',
      evidence: [],
    };
  }

  // 2. Does it need a field we do not have?
  for (const gap of SCHEMA_GAPS) {
    if (gap.pattern.test(text)) {
      return {
        constraint: null,
        state: 'needs_schema_extension',
        kind: 'eligibility_requirement',
        missing_field: gap.field,
        note: `Checkable in principle, but the profile schema has no '${gap.field}' field.`,
        evidence: [],
      };
    }
  }

  // 3. Collect every pattern that fires.
  const parts: { expr: ConstraintExpr; evidence: string[]; note?: string }[] = [];
  for (const rule of [
    proposeIncome,
    proposeAge,
    proposeCategory,
    proposeOccupation,
    proposeSpecial,
    proposeState,
    proposeResidence,
    proposeGender,
  ]) {
    const r = rule(text);
    if (r) parts.push(r);
  }

  if (parts.length === 0) {
    return {
      constraint: null,
      state: 'proposed',
      kind: 'eligibility_requirement',
      note: 'No pattern matched. Needs a constraint written by hand, or marking not machine-checkable.',
      evidence: [],
    };
  }

  const notes = parts.map((p) => p.note).filter(Boolean) as string[];
  const evidence = [...new Set(parts.flatMap((p) => p.evidence))];
  const inner: ConstraintExpr =
    parts.length === 1 ? parts[0]!.expr : { kind: 'all', children: parts.map((p) => p.expr) };

  const negative = isNegativePolarity(text);
  const expr: ConstraintExpr = negative ? { kind: 'exclusion', child: inner } : inner;

  if (negative) {
    notes.unshift('Negative phrasing detected — proposed as an EXCLUSION. Check the polarity carefully.');
  }
  if (parts.length > 1) {
    notes.push(`${parts.length} conditions combined with AND. If the clause means OR, change the node.`);
  }

  const problems = validateExpr(expr);
  if (problems.length > 0) {
    return {
      constraint: null,
      state: 'proposed',
      kind: 'eligibility_requirement',
      note: `Proposal failed validation and was withheld: ${problems.join('; ')}`,
      evidence,
    };
  }

  return {
    constraint: expr,
    state: 'proposed',
    kind: 'eligibility_requirement',
    note: notes.length ? notes.join(' ') : undefined,
    evidence,
  };
}

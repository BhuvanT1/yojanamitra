/**
 * The deterministic rule engine.
 *
 * This is the only module in the system permitted to decide whether someone is
 * eligible. It is a pure function of (approved constraint, profile) — no model
 * call, no network, no randomness, no clock. The same inputs always produce the
 * same verdict and the same explanation.
 *
 * The hard part is not the comparisons; it is what happens when the profile does
 * not say. Three rules govern that, and each one is a deliberate choice to
 * return UNKNOWN rather than a convenient answer:
 *
 *   `all`  — one VIOLATED child violates the whole. Otherwise any UNKNOWN child
 *            makes it UNKNOWN. Only all-satisfied is SATISFIED.
 *
 *   `any`  — one SATISFIED child satisfies the whole, even if a sibling is
 *            unknown: you qualify by one route, so the others do not matter.
 *            All VIOLATED is VIOLATED. Anything else is UNKNOWN.
 *
 *   `exclusion` — the reason this is its own node rather than a negation.
 *            Child SATISFIED  → VIOLATED  (the citizen is disqualified)
 *            Child VIOLATED   → SATISFIED (the exclusion does not catch them)
 *            Child UNKNOWN    → UNKNOWN
 *
 *            A plain negation would turn that last case into "not known to be
 *            excluded", i.e. a pass. For "excluding income-tax payers" against a
 *            profile that never mentions tax, that would silently admit someone
 *            the scheme may exclude. UNKNOWN is the honest answer and caps the
 *            verdict at likely_eligible.
 */

import type { ConstraintExpr, Predicate, Subject } from '../domain/constraint';
import type { Clause } from '../domain/clause';
import { isDecisive } from '../domain/clause';
import type { Dependent, ExtractedField, Profile } from '../domain/profile';
import { isKnown } from '../domain/profile';
import type { ClauseStatus, Scheme, Verdict } from '../domain/scheme';
import { combineVerdict } from '../domain/scheme';

export interface ClauseCheck {
  clause_id: string;
  /** Verbatim source text — what the citizen is shown. Never paraphrased. */
  clause_text: string;
  source_url: string;
  status: ClauseStatus;
  /** Plain-language reason, built from the profile, not from a model. */
  reason: string;
  /** Which household member this was tested against, when not the applicant. */
  subject_id?: string;
  /** Profile fields the clause needed but the citizen did not state. */
  missing_fields: string[];
}

export interface SchemeMatch {
  scheme_id: string;
  scheme_name: string;
  verdict: Verdict;
  checks: ClauseCheck[];
  /** Clauses shown for context but that decided nothing. */
  cited_only: { clause_id: string; clause_text: string; why: string }[];
  missing_fields: string[];
  /** Which dependent the dependent-clauses were bound to, if any. */
  bound_dependent?: string;
  source_url: string;
}

// ---------------------------------------------------------------- predicates

function fieldValue(profile: Profile, subject: Subject, field: string, bound?: Dependent): unknown {
  if (subject.kind === 'self') {
    const f = (profile as unknown as Record<string, ExtractedField<unknown> | undefined>)[field];
    return isKnown(f) ? f.value : undefined;
  }
  if (!bound) return undefined;
  const f = (bound as unknown as Record<string, ExtractedField<unknown> | undefined>)[field];
  return isKnown(f) ? f.value : undefined;
}

function compare(op: Predicate['op'], actual: unknown, expected: Predicate['value']): ClauseStatus {
  const asArray = (v: unknown): string[] =>
    Array.isArray(v) ? v.map(String) : v === undefined || v === null ? [] : [String(v)];

  switch (op) {
    case 'lt':
    case 'lte':
    case 'gt':
    case 'gte': {
      if (typeof actual !== 'number' || typeof expected !== 'number') return 'unknown';
      const ok =
        op === 'lt' ? actual < expected :
        op === 'lte' ? actual <= expected :
        op === 'gt' ? actual > expected :
        actual >= expected;
      return ok ? 'satisfied' : 'violated';
    }
    case 'eq':
      if (actual === undefined) return 'unknown';
      if (typeof actual === 'number' && typeof expected === 'number') {
        return actual === expected ? 'satisfied' : 'violated';
      }
      return String(actual).toLowerCase() === String(expected).toLowerCase() ? 'satisfied' : 'violated';
    case 'neq':
      if (actual === undefined) return 'unknown';
      return String(actual).toLowerCase() !== String(expected).toLowerCase() ? 'satisfied' : 'violated';
    case 'in': {
      if (actual === undefined) return 'unknown';
      const want = asArray(expected).map((s) => s.toLowerCase());
      return want.includes(String(actual).toLowerCase()) ? 'satisfied' : 'violated';
    }
    case 'not_in': {
      if (actual === undefined) return 'unknown';
      const want = asArray(expected).map((s) => s.toLowerCase());
      return want.includes(String(actual).toLowerCase()) ? 'violated' : 'satisfied';
    }
    case 'contains_any': {
      if (actual === undefined) return 'unknown';
      const have = asArray(actual).map((s) => s.toLowerCase());
      const want = asArray(expected).map((s) => s.toLowerCase());
      return want.some((w) => have.includes(w)) ? 'satisfied' : 'violated';
    }
    case 'contains_all': {
      if (actual === undefined) return 'unknown';
      const have = asArray(actual).map((s) => s.toLowerCase());
      const want = asArray(expected).map((s) => s.toLowerCase());
      return want.every((w) => have.includes(w)) ? 'satisfied' : 'violated';
    }
  }
}

interface NodeResult {
  status: ClauseStatus;
  reason: string;
  missing: string[];
}

/**
 * Field names a citizen can read. `annual_income_inr` is a column name, not
 * something to show someone asking whether they can feed their family.
 */
const FIELD_WORDS: Record<string, string> = {
  age: 'age',
  annual_income_inr: 'yearly income',
  land_acres: 'land',
  occupation: 'work',
  state: 'state',
  residence: 'where you live',
  gender: 'gender',
  category: 'category',
  education_stage: 'education',
  special_categories: 'situation',
};

function humanField(field: string): string {
  return FIELD_WORDS[field] ?? field.replace(/_/g, ' ');
}

function describe(op: Predicate['op'], value: Predicate['value']): string {
  const v = Array.isArray(value) ? value.join(' or ') : String(value);
  switch (op) {
    case 'lt': return `below ${v}`;
    case 'lte': return `at most ${v}`;
    case 'gt': return `above ${v}`;
    case 'gte': return `at least ${v}`;
    case 'eq': return `${v}`;
    case 'neq': return `not ${v}`;
    case 'in': return `one of ${v}`;
    case 'not_in': return `not one of ${v}`;
    // No "includes" prefix: these are read as the complement of "requires",
    // where "requires includes student" is not a sentence.
    case 'contains_any': return v;
    case 'contains_all': return `all of ${v}`;
  }
}

function evalNode(expr: ConstraintExpr, profile: Profile, bound?: Dependent): NodeResult {
  switch (expr.kind) {
    case 'predicate': {
      const actual = fieldValue(profile, expr.subject, expr.field, bound);
      const status = actual === undefined ? 'unknown' : compare(expr.op, actual, expr.value);
      const who =
        expr.subject.kind === 'self' ? 'your' : `your ${bound?.relation?.value ?? 'family member'}'s`;
      const need = describe(expr.op, expr.value);
      const label = humanField(expr.field);

      if (status === 'unknown') {
        return {
          status,
          reason: `needs ${who} ${label} — you did not say`,
          missing: [expr.field],
        };
      }
      const shown = Array.isArray(actual) ? actual.join(', ') : String(actual);

      // Numeric comparisons read naturally as "is at most 700000". Categorical
      // and set ones do not — "your work is includes farmer" is machine-shaped —
      // so those state the value and say whether it was what the scheme wanted.
      const numeric = expr.op === 'lt' || expr.op === 'lte' || expr.op === 'gt' || expr.op === 'gte';

      if (numeric) {
        return {
          status,
          reason:
            status === 'satisfied'
              ? `${who} ${label} (${shown}) is ${need}`
              : `${who} ${label} (${shown}) must be ${need}`,
          missing: [],
        };
      }
      return {
        status,
        reason:
          status === 'satisfied'
            ? `${who} ${label} is ${shown}, as this scheme requires`
            : `${who} ${label} is ${shown}, but this scheme requires ${need}`,
        missing: [],
      };
    }

    case 'all': {
      const kids = expr.children.map((c) => evalNode(c, profile, bound));
      const missing = kids.flatMap((k) => k.missing);
      const violated = kids.find((k) => k.status === 'violated');
      if (violated) return { status: 'violated', reason: violated.reason, missing };
      if (kids.some((k) => k.status === 'unknown')) {
        const u = kids.find((k) => k.status === 'unknown')!;
        return { status: 'unknown', reason: u.reason, missing };
      }
      // A clause often tests the same field twice ("a farmer" and "a bonafide
      // farmer"); repeating the identical sentence reads like a machine.
      const reasons = [...new Set(kids.map((k) => k.reason))];
      return { status: 'satisfied', reason: reasons.slice(0, 3).join(', and '), missing };
    }

    case 'any': {
      const kids = expr.children.map((c) => evalNode(c, profile, bound));
      const missing = kids.flatMap((k) => k.missing);
      const sat = kids.find((k) => k.status === 'satisfied');
      // One satisfied route is enough; an unknown sibling cannot take it away.
      if (sat) return { status: 'satisfied', reason: sat.reason, missing: [] };
      if (kids.every((k) => k.status === 'violated')) {
        return { status: 'violated', reason: kids.map((k) => k.reason).join('; and neither: '), missing };
      }
      const u = kids.find((k) => k.status === 'unknown')!;
      return { status: 'unknown', reason: u.reason, missing };
    }

    case 'exclusion': {
      const inner = evalNode(expr.child, profile, bound);
      if (inner.status === 'satisfied') {
        return { status: 'violated', reason: `excluded: ${inner.reason}`, missing: inner.missing };
      }
      if (inner.status === 'violated') {
        return { status: 'satisfied', reason: `not excluded — ${inner.reason}`, missing: [] };
      }
      return {
        status: 'unknown',
        reason: `cannot tell whether an exclusion applies — ${inner.reason}`,
        missing: inner.missing,
      };
    }
  }
}

// ---------------------------------------------------------------- clauses

/** Every dependent selector in an expression, so we know if binding is needed. */
function usesDependent(expr: ConstraintExpr): boolean {
  switch (expr.kind) {
    case 'predicate': return expr.subject.kind === 'dependent';
    case 'all':
    case 'any': return expr.children.some(usesDependent);
    case 'exclusion': return usesDependent(expr.child);
  }
}

export function evaluateClause(clause: Clause, profile: Profile, bound?: Dependent): ClauseCheck {
  if (!isDecisive(clause)) {
    throw new Error(
      `evaluateClause called on a non-decisive clause (${clause.id}). ` +
        `Only approved eligibility requirements may be evaluated.`,
    );
  }
  const r = evalNode(clause.constraint!, profile, bound);
  return {
    clause_id: clause.id,
    clause_text: clause.source_text,
    source_url: clause.source_url,
    status: r.status,
    reason: r.reason,
    subject_id: bound?.id,
    missing_fields: [...new Set(r.missing)],
  };
}

// ---------------------------------------------------------------- schemes

const RANK: Record<Verdict, number> = { eligible: 2, likely_eligible: 1, ineligible: 0 };

/**
 * Evaluate a whole scheme against a profile.
 *
 * Dependent binding is the subtle part. A scheme whose clauses talk about a
 * child must test ONE child throughout — otherwise a family with a 9-year-old
 * son and a 17-year-old daughter could satisfy "child aged under 10" from one
 * and "girl in class 11–12" from the other, and qualify on a household that does
 * not exist. So we evaluate once per candidate dependent and keep the best
 * binding, recording which person it was.
 */
export function evaluateScheme(scheme: Scheme, profile: Profile): SchemeMatch {
  const decisive = scheme.clauses.filter(isDecisive);

  const cited_only = scheme.clauses
    .filter((c) => !isDecisive(c))
    .map((c) => ({
      clause_id: c.id,
      clause_text: c.source_text,
      why:
        c.kind !== 'eligibility_requirement'
          ? `${c.kind} — not an eligibility condition`
          : c.annotation_state === 'approved'
            ? 'approved but has no constraint'
            : `not yet approved (${c.annotation_state})`,
    }));

  const base: Omit<SchemeMatch, 'verdict' | 'checks' | 'missing_fields'> = {
    scheme_id: scheme.id,
    scheme_name: scheme.name,
    cited_only,
    source_url: scheme.source_url,
  };

  // A scheme with nothing approved can never be a match: zero conditions is
  // vacuously true, which would make everyone eligible for everything unreviewed.
  if (decisive.length === 0) {
    return { ...base, verdict: 'likely_eligible', checks: [], missing_fields: [] };
  }

  const needsBinding = decisive.some((c) => usesDependent(c.constraint!));
  const candidates: (Dependent | undefined)[] = needsBinding
    ? profile.dependents.length > 0
      ? profile.dependents
      : [undefined]
    : [undefined];

  let best: SchemeMatch | null = null;

  for (const bound of candidates) {
    const checks = decisive.map((c) => evaluateClause(c, profile, bound));
    const statuses = checks.map((c) => c.status);
    const missing = [...new Set(checks.flatMap((c) => c.missing_fields))];

    const hasUnapprovedRequirement = scheme.clauses.some(
      (c) => c.kind === 'eligibility_requirement' && c.annotation_state !== 'approved',
    );

    const verdict = combineVerdict(statuses, {
      hasUnapprovedRequirement,
      coverageComplete: scheme.source_coverage.complete,
    });

    const candidate: SchemeMatch = {
      ...base,
      verdict,
      checks,
      missing_fields: missing,
      bound_dependent: bound?.id,
    };

    if (!best || RANK[candidate.verdict] > RANK[best.verdict]) best = candidate;
  }

  return best!;
}

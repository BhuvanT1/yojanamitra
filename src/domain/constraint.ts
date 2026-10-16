/**
 * Typed constraint expressions — the only thing that may decide eligibility.
 *
 * An expression tree rather than a flat {field, op, value} because real
 * eligibility prose is not flat:
 *
 *   "A woman farmer or an SC/ST farmer, excluding income-tax payers"
 *
 * is one clause containing a disjunction and an exclusion. Flattening it into
 * three separate clauses loses the fact that satisfying ONE of the first two is
 * enough, and would make the rule engine quietly wrong.
 */

import type { DependentField, ProfileField } from './profile';

/**
 * Whose circumstances a predicate is about.
 *
 * `self` is the person asking. A dependent subject binds to ONE household member
 * by id for the whole evaluation of a scheme, so one child's age can never be
 * combined with a different child's education stage.
 */
export type Subject =
  | { kind: 'self' }
  | { kind: 'dependent'; /** Bound at evaluation time, not annotation time. */ selector: DependentSelector };

/**
 * How the evaluator picks which dependent to test.
 * `any` = the clause holds if some dependent satisfies it, and the evaluator
 * records WHICH one, so the explanation can name them.
 */
export type DependentSelector =
  | { match: 'any' }
  | { match: 'all' }
  | { match: 'by_relation'; relation: string };

export type NumericOp = 'lt' | 'lte' | 'gt' | 'gte' | 'eq' | 'neq';
export type SetOp = 'in' | 'not_in' | 'contains_any' | 'contains_all';
export type Op = NumericOp | SetOp;

export const NUMERIC_FIELDS = ['age', 'annual_income_inr', 'land_acres'] as const;
export const CATEGORICAL_FIELDS = [
  'state',
  'residence',
  'gender',
  'category',
  'education_stage',
] as const;
export const SET_FIELDS = ['occupation', 'special_categories'] as const;

/** A single testable condition. The leaf of the tree. */
export interface Predicate {
  kind: 'predicate';
  subject: Subject;
  field: ProfileField | DependentField;
  op: Op;
  value: number | string | string[];
}

/** Every child must hold. */
export interface AllOf {
  kind: 'all';
  children: ConstraintExpr[];
}

/** At least one child must hold. */
export interface AnyOf {
  kind: 'any';
  children: ConstraintExpr[];
}

/**
 * An explicit disqualifier: if the inner expression holds, the clause is
 * VIOLATED.
 *
 * Deliberately its own node rather than a negated predicate, because
 * "excluding income-tax payers" behaves differently under unknowns. If we do not
 * know whether someone pays income tax, a negation would silently pass; an
 * exclusion returns UNKNOWN, which is the honest answer.
 */
export interface Exclusion {
  kind: 'exclusion';
  child: ConstraintExpr;
}

export type ConstraintExpr = Predicate | AllOf | AnyOf | Exclusion;

/** Ops that are legal for a given field, by field type. */
export function allowedOps(field: string): Op[] {
  if ((NUMERIC_FIELDS as readonly string[]).includes(field)) {
    return ['lt', 'lte', 'gt', 'gte', 'eq', 'neq'];
  }
  if ((SET_FIELDS as readonly string[]).includes(field)) {
    return ['contains_any', 'contains_all', 'in', 'not_in'];
  }
  if ((CATEGORICAL_FIELDS as readonly string[]).includes(field)) {
    return ['eq', 'neq', 'in', 'not_in'];
  }
  return [];
}

/**
 * Structural validation. A constraint that fails this can never be approved —
 * the review UI refuses the approval rather than storing something the evaluator
 * would crash on or, worse, silently mis-handle.
 */
export function validateExpr(expr: ConstraintExpr, path = 'root'): string[] {
  const problems: string[] = [];

  switch (expr.kind) {
    case 'predicate': {
      const ops = allowedOps(expr.field);
      if (ops.length === 0) {
        problems.push(`${path}: unknown field '${expr.field}'`);
        break;
      }
      if (!ops.includes(expr.op)) {
        problems.push(
          `${path}: op '${expr.op}' is not valid for field '${expr.field}' (allowed: ${ops.join(', ')})`,
        );
      }
      const numeric = (NUMERIC_FIELDS as readonly string[]).includes(expr.field);
      if (numeric && typeof expr.value !== 'number') {
        problems.push(`${path}: field '${expr.field}' is numeric but value is ${typeof expr.value}`);
      }
      if (!numeric && typeof expr.value === 'number') {
        problems.push(`${path}: field '${expr.field}' is not numeric but value is a number`);
      }
      if ((expr.op === 'in' || expr.op === 'not_in') && !Array.isArray(expr.value)) {
        problems.push(`${path}: op '${expr.op}' requires an array value`);
      }
      if (expr.subject.kind === 'dependent') {
        const depOk = ['age', 'gender', 'education_stage', 'occupation', 'category', 'special_categories'];
        if (!depOk.includes(expr.field)) {
          problems.push(`${path}: field '${expr.field}' cannot be tested on a dependent`);
        }
      }
      break;
    }
    case 'all':
    case 'any': {
      if (expr.children.length === 0) {
        problems.push(`${path}: '${expr.kind}' with no children would be vacuously true`);
      }
      expr.children.forEach((c, i) => problems.push(...validateExpr(c, `${path}.${expr.kind}[${i}]`)));
      break;
    }
    case 'exclusion': {
      problems.push(...validateExpr(expr.child, `${path}.exclusion`));
      break;
    }
    default: {
      problems.push(`${path}: unknown expression kind`);
    }
  }

  return problems;
}

/** Every profile field an expression touches — used to drive retrieval and the "why" panel. */
export function fieldsUsed(expr: ConstraintExpr): string[] {
  switch (expr.kind) {
    case 'predicate':
      return [expr.field];
    case 'all':
    case 'any':
      return expr.children.flatMap(fieldsUsed);
    case 'exclusion':
      return fieldsUsed(expr.child);
  }
}

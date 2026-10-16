/**
 * The annotation store.
 *
 * JSON on disk, not a database, so the corpus stays diffable in git and a bad
 * approval is a revertable commit. Two properties matter more than speed:
 *
 *   Atomic writes — a crash mid-save must not leave a half-written annotations
 *   file. Write to a temp file in the same directory, then rename; rename is
 *   atomic on both POSIX and NTFS.
 *
 *   Revision checks — the reviewer will have two tabs open eventually. A write
 *   carrying a stale revision is rejected rather than silently clobbering an
 *   approval someone already made.
 */

import { readFileSync, writeFileSync, renameSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { ANNOTATIONS_FILE } from '../config/paths';

import type { Clause, AnnotationState, ClauseKind, ReviewAction } from '../domain/clause';
import { applyApproval, applyEdit } from '../domain/clause';
import type { ConstraintExpr } from '../domain/constraint';
import { validateExpr } from '../domain/constraint';

export class StaleRevisionError extends Error {
  constructor(
    readonly clauseId: string,
    readonly expected: number,
    readonly actual: number,
  ) {
    super(
      `clause ${clauseId}: expected revision ${expected} but the store is at ${actual}. ` +
        `Someone else changed it — reload before writing.`,
    );
    this.name = 'StaleRevisionError';
  }
}

export class InvalidConstraintError extends Error {
  constructor(readonly problems: string[]) {
    super(`constraint is not structurally valid: ${problems.join('; ')}`);
    this.name = 'InvalidConstraintError';
  }
}

function atomicWriteJson(path: string, data: unknown): void {
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify(data, null, 1));
  renameSync(tmp, path);
}

export interface StoreStats {
  total: number;
  by_state: Record<AnnotationState, number>;
  by_kind: Record<ClauseKind, number>;
  decisive: number;
  missing_fields: { field: string; clauses: number }[];
}

export class AnnotationStore {
  private clauses = new Map<string, Clause>();

  constructor(private readonly path = ANNOTATIONS_FILE) {
    if (existsSync(this.path)) this.load();
  }

  load(): void {
    const raw: Clause[] = JSON.parse(readFileSync(this.path, 'utf8'));
    this.clauses = new Map(raw.map((c) => [c.id, c]));
  }

  save(): void {
    atomicWriteJson(this.path, [...this.clauses.values()]);
  }

  get(id: string): Clause | undefined {
    return this.clauses.get(id);
  }

  all(): Clause[] {
    return [...this.clauses.values()];
  }

  put(clause: Clause): void {
    this.clauses.set(clause.id, clause);
  }

  private require(id: string, expectedRevision: number): Clause {
    const c = this.clauses.get(id);
    if (!c) throw new Error(`unknown clause ${id}`);
    if (c.revision !== expectedRevision) {
      throw new StaleRevisionError(id, expectedRevision, c.revision);
    }
    return c;
  }

  /**
   * Approve one clause. Refuses a constraint that would not survive evaluation —
   * an invalid expression must never reach the rule engine wearing an approval.
   */
  approve(id: string, expectedRevision: number, by: string, groupId?: string): Clause {
    const c = this.require(id, expectedRevision);
    if (!c.constraint) throw new Error(`cannot approve ${id}: no constraint proposed`);
    const problems = validateExpr(c.constraint);
    if (problems.length) throw new InvalidConstraintError(problems);
    const next = applyApproval(c, by, groupId);
    this.clauses.set(id, next);
    return next;
  }

  /** Replace the constraint. Revokes any existing approval (see applyEdit). */
  edit(id: string, expectedRevision: number, expr: ConstraintExpr | null, by: string, note?: string): Clause {
    const c = this.require(id, expectedRevision);
    if (expr) {
      const problems = validateExpr(expr);
      if (problems.length) throw new InvalidConstraintError(problems);
    }
    const next = applyEdit(c, expr, by, note);
    this.clauses.set(id, next);
    return next;
  }

  reject(id: string, expectedRevision: number, by: string, reason: string): Clause {
    const c = this.require(id, expectedRevision);
    const action: ReviewAction = { action: 'rejected', by, at: new Date().toISOString(), note: reason };
    const next: Clause = {
      ...c,
      annotation_state: 'not_machine_checkable',
      constraint: null,
      review_reason: reason,
      approved_by: undefined,
      approved_at: undefined,
      revision: c.revision + 1,
      history: [...c.history, action],
    };
    this.clauses.set(id, next);
    return next;
  }

  reclassify(id: string, expectedRevision: number, kind: ClauseKind, by: string): Clause {
    const c = this.require(id, expectedRevision);
    const action: ReviewAction = { action: 'reclassified', by, at: new Date().toISOString(), note: kind };
    // Reclassifying away from eligibility_requirement removes the clause from
    // the decisive set, so any approval it carried no longer means anything.
    const losesDecisiveness = c.kind === 'eligibility_requirement' && kind !== 'eligibility_requirement';
    const next: Clause = {
      ...c,
      kind,
      annotation_state: losesDecisiveness ? 'not_machine_checkable' : c.annotation_state,
      approved_by: losesDecisiveness ? undefined : c.approved_by,
      approved_at: losesDecisiveness ? undefined : c.approved_at,
      revision: c.revision + 1,
      history: [...c.history, action],
    };
    this.clauses.set(id, next);
    return next;
  }

  /**
   * Approve every clause sharing a dedup group, in one reviewer decision.
   *
   * The group is the unit of review; the clause is still the unit of provenance,
   * so each clause records the approval individually with the group id attached.
   * All-or-nothing: if any member would fail validation, none are approved.
   */
  approveGroup(groupId: string, by: string): { approved: Clause[]; skipped: string[] } {
    const members = this.all().filter((c) => c.dedup_group_id === groupId);
    if (members.length === 0) throw new Error(`unknown group ${groupId}`);

    const eligible = members.filter((c) => c.constraint !== null && c.annotation_state === 'proposed');
    const skipped = members.filter((c) => !eligible.includes(c)).map((c) => c.id);

    for (const c of eligible) {
      const problems = validateExpr(c.constraint!);
      if (problems.length) throw new InvalidConstraintError(problems);
    }

    const approved = eligible.map((c) => {
      const next = applyApproval(c, by, groupId);
      this.clauses.set(c.id, next);
      return next;
    });

    return { approved, skipped };
  }

  stats(): StoreStats {
    const by_state = {
      proposed: 0,
      approved: 0,
      not_machine_checkable: 0,
      needs_schema_extension: 0,
    } as Record<AnnotationState, number>;
    const by_kind = {
      eligibility_requirement: 0,
      procedural: 0,
      informational: 0,
    } as Record<ClauseKind, number>;
    const gaps = new Map<string, number>();
    let decisive = 0;

    for (const c of this.clauses.values()) {
      by_state[c.annotation_state]++;
      by_kind[c.kind]++;
      if (c.annotation_state === 'approved' && c.kind === 'eligibility_requirement' && c.constraint) {
        decisive++;
      }
      if (c.annotation_state === 'needs_schema_extension' && c.missing_field) {
        gaps.set(c.missing_field, (gaps.get(c.missing_field) ?? 0) + 1);
      }
    }

    return {
      total: this.clauses.size,
      by_state,
      by_kind,
      decisive,
      missing_fields: [...gaps.entries()]
        .map(([field, clauses]) => ({ field, clauses }))
        .sort((a, b) => b.clauses - a.clauses),
    };
  }
}

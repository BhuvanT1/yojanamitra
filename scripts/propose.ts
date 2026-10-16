/**
 * Stage 2a — run the proposer over the whole corpus.
 *
 * Writes data/annotations/clauses.json, where every clause carries a PROPOSED
 * constraint (or a reason it has none). Approved count after this runs: zero.
 *
 * Usage:  npm run propose
 */

import { readFileSync, existsSync } from 'node:fs';

import { proposeConstraint } from '../src/annotations/propose';
import { AnnotationStore } from '../src/storage/annotation_store';
import type { Scheme } from '../src/domain/scheme';
import type { Clause } from '../src/domain/clause';

const CORPUS = 'data/normalized/schemes.json';

function main() {
  if (!existsSync(CORPUS)) {
    console.error(`missing ${CORPUS} — run: npm run ingest`);
    process.exit(1);
  }

  const schemes: Scheme[] = JSON.parse(readFileSync(CORPUS, 'utf8'));
  const store = new AnnotationStore();

  let withConstraint = 0;
  let withNote = 0;

  for (const scheme of schemes) {
    for (const clause of scheme.clauses) {
      const p = proposeConstraint(clause.source_text);
      if (p.constraint) withConstraint++;
      if (p.note) withNote++;

      const next: Clause = {
        ...clause,
        kind: p.kind,
        annotation_state: p.state,
        constraint: p.constraint,
        review_reason: p.note,
        missing_field: p.missing_field,
        revision: clause.revision + 1,
        history: [
          ...clause.history,
          { action: 'proposed', by: 'proposer/deterministic-v1', at: new Date().toISOString(), note: p.note },
        ],
      };
      store.put(next);
    }
  }

  store.save();
  const s = store.stats();

  const pct = (n: number) => `${((n / Math.max(s.total, 1)) * 100).toFixed(1)}%`;

  console.log('');
  console.log('STAGE 2a — CONSTRAINT PROPOSAL');
  console.log('='.repeat(66));
  console.log(`clauses processed                 ${s.total}`);
  console.log('');
  console.log('ANNOTATION STATE');
  console.log(`  proposed (awaiting review)      ${s.by_state.proposed}  ${pct(s.by_state.proposed)}`);
  console.log(`    ...of which carry a constraint ${withConstraint}  ${pct(withConstraint)}`);
  console.log(`  needs_schema_extension          ${s.by_state.needs_schema_extension}  ${pct(s.by_state.needs_schema_extension)}`);
  console.log(`  not_machine_checkable           ${s.by_state.not_machine_checkable}  ${pct(s.by_state.not_machine_checkable)}`);
  console.log(`  APPROVED                        ${s.by_state.approved}`);
  console.log('');
  console.log('CLAUSE KIND (proposed classification, not yet confirmed)');
  console.log(`  eligibility_requirement         ${s.by_kind.eligibility_requirement}`);
  console.log(`  procedural                      ${s.by_kind.procedural}`);
  console.log(`  informational                   ${s.by_kind.informational}`);
  console.log('');
  console.log(`clauses carrying a reviewer note  ${withNote}  ${pct(withNote)}`);
  console.log('');
  console.log('SCHEMA EXTENSION BACKLOG — add the field, unlock the clauses');
  for (const g of s.missing_fields) {
    console.log(`  ${String(g.clauses).padStart(5)}  ${g.field}`);
  }
  console.log('');
  console.log(`DECISIVE CLAUSES: ${s.decisive} — the rule engine can still decide nothing.`);
  console.log('='.repeat(66));
}

main();

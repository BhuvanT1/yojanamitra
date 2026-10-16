/**
 * Stage 4 demo — free text to explained verdicts, against the real corpus.
 *
 * Usage:
 *   npm run match -- "I am 33, a farmer in Telangana with 1.5 acres"
 *   npm run match -- --simulate "..."      see below
 *
 * WITHOUT --simulate this reflects reality: no clause in the corpus has been
 * human-approved, so nothing can be eligible and the output says so. That is the
 * correct behaviour, not a bug — review clauses with `npm run review` and the
 * results fill in.
 *
 * WITH --simulate every PROPOSED constraint is treated as approved **in memory
 * only**. data/annotations is never written. Every verdict is labelled SIMULATED.
 * It exists to exercise the engine before the annotation backlog is worked, and
 * its output must never be shown to a citizen or quoted as an accuracy figure.
 */

import { readFileSync, existsSync } from 'node:fs';

import { match } from '../src/rules/match';
import type { Scheme } from '../src/domain/scheme';
import type { Clause } from '../src/domain/clause';
import type { SchemeMatch } from '../src/rules/evaluate';

const CORPUS = 'data/normalized/schemes.json';
const ANNOTATIONS = 'data/annotations/clauses.json';

const argv = process.argv.slice(2);
const simulate = argv.includes('--simulate');
const text =
  argv.filter((a) => !a.startsWith('--')).join(' ').trim() ||
  "I'm 33, a farmer in Telangana with 1.5 acres of land in my village, OBC, my yearly income is around 1.5 lakh.";

function load(): Scheme[] {
  if (!existsSync(CORPUS)) {
    console.error(`missing ${CORPUS} — run: npm run ingest`);
    process.exit(1);
  }
  const schemes: Scheme[] = JSON.parse(readFileSync(CORPUS, 'utf8'));

  if (existsSync(ANNOTATIONS)) {
    const annotated: Clause[] = JSON.parse(readFileSync(ANNOTATIONS, 'utf8'));
    const byId = new Map(annotated.map((c) => [c.id, c]));
    for (const s of schemes) {
      s.clauses = s.clauses.map((c) => byId.get(c.id) ?? c);
    }
  }

  if (simulate) {
    for (const s of schemes) {
      s.clauses = s.clauses.map((c) =>
        c.annotation_state === 'proposed' && c.constraint
          ? { ...c, annotation_state: 'approved' as const, approved_by: 'SIMULATED', approved_at: 'n/a' }
          : c,
      );
    }
  }
  return schemes;
}

function banner() {
  if (!simulate) return;
  console.log('');
  console.log('\x1b[43m\x1b[30m ⚠  SIMULATED RUN — no human approved any of these constraints. \x1b[0m');
  console.log('\x1b[33m    Proposed constraints are being treated as approved, in memory only.');
  console.log('    data/annotations is untouched. Do not quote these as accuracy figures,');
  console.log('    and do not show them to a citizen.\x1b[0m');
}

function show(m: SchemeMatch, tag: string) {
  console.log('');
  console.log(`  ${tag}  ${m.scheme_name}`);
  console.log(`         ${m.source_url}`);
  if (m.bound_dependent) console.log(`         (evaluated for ${m.bound_dependent})`);
  for (const c of m.checks) {
    const mark = c.status === 'satisfied' ? '✓' : c.status === 'violated' ? '✗' : '?';
    const quote = c.clause_text.length > 96 ? c.clause_text.slice(0, 93) + '…' : c.clause_text;
    console.log(`         ${mark} "${quote}"`);
    console.log(`           → ${c.reason}`);
  }
  if (m.missing_fields.length) {
    console.log(`         tell us your ${m.missing_fields.join(', ')} to resolve this`);
  }
}

function main() {
  const schemes = load();
  banner();

  console.log('');
  console.log('INPUT');
  console.log(`  ${text}`);

  const out = match(schemes, text);
  const p = out.extraction.profile;

  console.log('');
  console.log(`UNDERSTOOD  (${p.raw.detected_language} / ${p.raw.script})`);
  for (const [k, v] of Object.entries(p)) {
    if (k === 'raw' || k === 'dependents') continue;
    const f = v as { value: unknown; confidence: number; evidence: string[] };
    console.log(`  ${k.padEnd(20)} ${JSON.stringify(f.value).padEnd(26)} ${f.confidence}  from ${JSON.stringify(f.evidence)}`);
  }
  for (const d of p.dependents) {
    console.log(`  dependent ${d.id}         relation=${d.relation?.value} gender=${d.gender?.value ?? '—'} stage=${d.education_stage?.value ?? '—'}`);
  }
  if (out.extraction.unknown_fields.length) {
    console.log(`  not stated: ${out.extraction.unknown_fields.join(', ')}`);
  }

  console.log('');
  console.log('RETRIEVAL');
  console.log(`  corpus ${out.retrieval.total_schemes} → candidates ${out.retrieval.candidates}`);
  console.log(`  dropped: ${out.retrieval.excluded_wrong_state} wrong state, ${out.retrieval.excluded_unreviewed} with no approved clause`);

  console.log('');
  console.log(`ELIGIBLE (${out.eligible.length})`);
  if (out.eligible.length === 0) {
    console.log('  none' + (simulate ? '' : ' — no clause in the corpus has been approved yet, so nothing can be decided.'));
  }
  for (const m of out.eligible.slice(0, 5)) show(m, simulate ? '[SIMULATED]' : '[ELIGIBLE]');

  console.log('');
  console.log(`LIKELY ELIGIBLE (${out.likely_eligible.length}) — nothing failed, something is unverified`);
  for (const m of out.likely_eligible.slice(0, 3)) show(m, '[LIKELY]');

  console.log('');
  console.log(`NOT ELIGIBLE (${out.ineligible.length})`);
  for (const m of out.ineligible.slice(0, 2)) show(m, '[NO]');

  if (out.would_resolve_most.length) {
    console.log('');
    console.log('ANSWERING THESE WOULD RESOLVE THE MOST');
    for (const g of out.would_resolve_most) {
      console.log(`  ${String(g.schemes).padStart(4)} schemes waiting on: ${g.field}`);
    }
  }

  banner();
  console.log('');
  console.log('This is guidance, not an official determination.');
}

main();

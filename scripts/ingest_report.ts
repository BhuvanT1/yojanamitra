/**
 * Review-workload analysis over the ingested corpus.
 *
 * Stage 1's headline number — distinct clause texts — is the whole corpus. The
 * decision it feeds is narrower: which slice do we annotate first. This script
 * prices each candidate slice so that choice is made on evidence.
 *
 * Usage:  npm run ingest:report
 */

import { readFileSync } from 'node:fs';
import type { Scheme } from '../src/domain/scheme';
import { dedupKey } from '../src/ingest/clauses';

const SECONDS_PER_DECISION = 20;
const PRIORITY_STATES = ['telangana', 'andhra pradesh'];

const schemes: Scheme[] = JSON.parse(readFileSync('data/normalized/schemes.json', 'utf8'));

function price(label: string, subset: Scheme[]) {
  const keys = new Set<string>();
  let clauses = 0;
  for (const s of subset) {
    for (const c of s.clauses) {
      clauses++;
      keys.add(dedupKey(c.source_text));
    }
  }
  const hours = (keys.size * SECONDS_PER_DECISION) / 3600;
  console.log(
    `  ${label.padEnd(38)} ${String(subset.length).padStart(5)} schemes  ` +
      `${String(clauses).padStart(6)} clauses  ${String(keys.size).padStart(6)} distinct  ` +
      `~${hours.toFixed(1)}h`,
  );
  return keys.size;
}

const central = schemes.filter((s) => s.level === 'central');
const priority = schemes.filter(
  (s) => s.level === 'central' || (s.state !== null && PRIORITY_STATES.includes(s.state)),
);

console.log('');
console.log('REVIEW WORKLOAD BY SLICE');
console.log('='.repeat(96));
console.log(`  (one decision = ${SECONDS_PER_DECISION}s; dedup applied within each slice)`);
console.log('');
price('everything', schemes);
price('central only', central);
price('central + Telangana + Andhra', priority);
console.log('');

// Where does the long tail live?
const byState = new Map<string, number>();
for (const s of schemes) {
  if (s.level !== 'state' || !s.state) continue;
  byState.set(s.state, (byState.get(s.state) ?? 0) + 1);
}
console.log('SCHEMES PER STATE (top 12)');
for (const [st, n] of [...byState.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12)) {
  console.log(`  ${st.padEnd(30)} ${String(n).padStart(5)}`);
}
console.log('');

// How many clauses even look machine-checkable? A clause with no number, no
// recognised category word and no state name is unlikely to become a constraint.
const SIGNALS =
  /\b(age|years?|income|lakh|crore|rs\.?|₹|acre|hectare|sc|st|obc|bpl|widow|woman|women|female|male|farmer|student|resident|domicile|below|above|minimum|maximum|between|at least|not exceed)\b|\d/i;
let signal = 0;
let noSignal = 0;
const noSignalSamples: string[] = [];
for (const s of schemes) {
  for (const c of s.clauses) {
    if (SIGNALS.test(c.source_text)) signal++;
    else {
      noSignal++;
      if (noSignalSamples.length < 6) noSignalSamples.push(c.source_text.slice(0, 100));
    }
  }
}
console.log('CONSTRAINT SIGNAL (crude keyword probe, not a classifier)');
console.log(`  clauses containing a number or an eligibility keyword  ${signal}`);
console.log(`  clauses containing neither                             ${noSignal}`);
console.log('  examples with no signal:');
for (const x of noSignalSamples) console.log(`    - ${x}`);
console.log('='.repeat(96));

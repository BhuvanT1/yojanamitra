/**
 * A tiny corpus, for looking at the interface.
 *
 * Not part of the product: the real corpus is 2,066 schemes built by
 * `npm run ingest`. This exists so the results view can be rendered and
 * inspected without 17MB of PDFs, and so a screenshot shows one of each verdict
 * rather than whatever the first three matches happen to be.
 *
 *   node scripts/fixture.mjs
 *   YM_CORPUS_DIR=data/fixture YM_PROVENANCE_FILE=data/fixture/provenance.json \
 *     YM_SIMULATE=1 npm run dev
 *
 * It writes to `data/fixture/`, NOT to `data/normalized/`, and that is
 * deliberate: an earlier version wrote to the real corpus path, which means one
 * careless run would have silently replaced 2,066 ingested schemes with three
 * hand-written ones — and the app would have carried on answering, which is the
 * worst kind of failure. The corpus directory is only ever written by the
 * ingest pipeline.
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const URL_BASE = 'https://www.myscheme.gov.in/schemes';

function clause(schemeId, n, text, constraint, extra = {}) {
  return {
    id: `${schemeId}-e${n}`,
    scheme_id: schemeId,
    source_text: text,
    source_span: { start: 0, end: text.length },
    source_url: `${URL_BASE}/${schemeId}`,
    kind: 'eligibility_requirement',
    annotation_state: 'proposed',
    constraint,
    revision: 1,
    history: [],
    ...extra,
  };
}

const pred = (field, op, value) => ({
  kind: 'predicate',
  subject: { kind: 'self' },
  field,
  op,
  value,
});

function scheme(id, name, level, state, clauses, prose) {
  return {
    id,
    name,
    level,
    state,
    category: ['Agriculture'],
    documents: ['Aadhaar card', 'Land records (pattadar passbook)', 'Bank passbook'],
    eligibility_text: prose,
    clauses,
    source_coverage: {
      eligibility_text_length: prose.length,
      covered_chars: prose.length,
      uncovered_fragments: [],
      complete: true,
    },
    source_url: `${URL_BASE}/${id}`,
    source_record: { file: `${id}.pdf`, sha256: 'fixture' },
  };
}

// ---------------------------------------------------------------- eligible
const a = (() => {
  const prose =
    'The applicant must be a farmer cultivating land in the State of Telangana. ' +
    'The applicant should have attained 18 years of age. ' +
    'The total extent of land held by the family should not exceed 5 acres.';
  return scheme(
    'rythu-bharosa-support',
    'Rythu Bharosa Farmer Support Scheme',
    'state',
    'telangana',
    [
      clause('rythu-bharosa-support', 1, 'The applicant must be a farmer cultivating land in the State of Telangana.', {
        kind: 'all',
        children: [pred('occupation', 'contains_any', ['farmer']), pred('state', 'eq', 'telangana')],
      }),
      clause('rythu-bharosa-support', 2, 'The applicant should have attained 18 years of age.', pred('age', 'gte', 18)),
      clause(
        'rythu-bharosa-support',
        3,
        'The total extent of land held by the family should not exceed 5 acres.',
        pred('land_acres', 'lte', 5),
      ),
    ],
    prose,
  );
})();

// ------------------------------------------------------------------ likely
const b = (() => {
  const prose =
    'All landholding farmer families which have cultivable land in their names are eligible. ' +
    'The land held by the family should not be more than 2 hectares. ' +
    'Persons who paid income tax in the last assessment year are excluded from the benefit.';
  return scheme(
    'pm-kisan-samman-nidhi',
    'Pradhan Mantri Kisan Samman Nidhi (PM-KISAN)',
    'central',
    null,
    [
      clause(
        'pm-kisan-samman-nidhi',
        1,
        'All landholding farmer families which have cultivable land in their names are eligible.',
        pred('occupation', 'contains_any', ['farmer']),
      ),
      clause(
        'pm-kisan-samman-nidhi',
        2,
        'The land held by the family should not be more than 2 hectares.',
        pred('land_acres', 'lte', 4.94),
      ),
      // Nothing in the sentence the citizen typed says whether they pay income
      // tax, so this is UNKNOWN and the verdict is capped at likely_eligible.
      clause(
        'pm-kisan-samman-nidhi',
        3,
        'Persons who paid income tax in the last assessment year are excluded from the benefit.',
        { kind: 'exclusion', child: pred('special_categories', 'contains_any', ['income_tax_payer']) },
      ),
      // Cited, never evaluated — this is what the "not yet verified" block shows.
      clause(
        'pm-kisan-samman-nidhi',
        4,
        'Aadhaar seeding of the bank account is mandatory for release of subsequent instalments.',
        null,
        { kind: 'procedural', annotation_state: 'proposed' },
      ),
    ],
    prose,
  );
})();

// -------------------------------------------------------------- ineligible
const c = (() => {
  const prose =
    'The applicant must be a student enrolled in a recognised institution. ' +
    'The applicant should not be more than 25 years of age as on 1st July of the academic year. ' +
    'The annual family income should not exceed Rs. 2,50,000.';
  return scheme(
    'national-merit-scholarship',
    'National Merit-cum-Means Scholarship',
    'central',
    null,
    [
      clause(
        'national-merit-scholarship',
        1,
        'The applicant should not be more than 25 years of age as on 1st July of the academic year.',
        pred('age', 'lte', 25),
      ),
      clause(
        'national-merit-scholarship',
        2,
        'The annual family income should not exceed Rs. 2,50,000.',
        pred('annual_income_inr', 'lte', 250000),
      ),
    ],
    prose,
  );
})();

const dir = join(process.cwd(), 'data', 'fixture');
mkdirSync(dir, { recursive: true });
writeFileSync(join(dir, 'schemes.json'), JSON.stringify([a, b, c], null, 1));

writeFileSync(
  join(dir, 'provenance.json'),
  JSON.stringify(
    {
      dataset: 'shrijayan/gov_myscheme',
      dataset_url: 'https://huggingface.co/datasets/shrijayan/gov_myscheme',
      commit_sha: '2e7a91a1cd99c0d6a584b237022116fa21d2e88',
      license: 'apache-2.0',
      cloned_at: new Date().toISOString(),
      ingested_at: new Date().toISOString(),
      raw_files: 3,
      schemes: 3,
      notes: ['FIXTURE — three hand-written schemes for inspecting the interface. Not the real corpus.'],
    },
    null,
    1,
  ),
);

console.log('fixture written to data/fixture/ (3 schemes) — the real corpus in data/normalized/ was not touched');

/**
 * Stage 1 — corpus ingest.
 *
 * Reads the gov_myscheme clone, turns every scheme PDF into a normalised record,
 * splits eligibility prose into clauses, and writes:
 *
 *   data/normalized/schemes.json   the corpus
 *   data/normalized/dedup.json     clause dedup groups, largest first
 *   data/provenance.json           dataset identity + ingest counts
 *
 * Nothing here proposes a constraint or decides eligibility. Every clause lands
 * as `annotation_state: 'proposed'` with `constraint: null` — i.e. decides
 * nothing — until stage 2 proposes and a human approves.
 *
 * Usage:  npm run ingest
 */

import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, readdirSync, mkdirSync, existsSync } from 'node:fs';
import { join, basename } from 'node:path';

import { extractPdfText } from '../src/ingest/pdf_text';
import { parseSections } from '../src/ingest/sections';
import { splitEligibility, dedupKey } from '../src/ingest/clauses';
import { canonicalSlug } from '../src/ingest/dedup';
import type { Clause } from '../src/domain/clause';
import type { Scheme, Provenance } from '../src/domain/scheme';

const RAW_DIR = 'data/raw/gov_myscheme/text_data';
const OUT_DIR = 'data/normalized';

const DATASET = 'shrijayan/gov_myscheme';
const DATASET_URL = 'https://huggingface.co/datasets/shrijayan/gov_myscheme';
const COMMIT_SHA = '2e7a91a1cd99c0d6a584b237022116fa21d2e88';
const LICENSE = 'apache-2.0';

interface Counts {
  raw_files: number;
  distinct_by_hash: number;
  distinct_by_slug: number;
  parsed_ok: number;
  parse_failed: number;
  with_eligibility: number;
  without_eligibility: number;
  with_exclusions: number;
  level_central: number;
  level_state: number;
  level_unknown: number;
  clauses_total: number;
  clauses_distinct: number;
  schemes_with_uncovered_text: number;
  uncovered_fragments: number;
  nav_section_missing: number;
}

async function main() {
  if (!existsSync(RAW_DIR)) {
    console.error(`missing ${RAW_DIR} — clone the dataset first`);
    process.exit(1);
  }
  mkdirSync(OUT_DIR, { recursive: true });

  const files = readdirSync(RAW_DIR).filter((f) => f.toLowerCase().endsWith('.pdf'));
  const counts: Counts = {
    raw_files: files.length,
    distinct_by_hash: 0,
    distinct_by_slug: 0,
    parsed_ok: 0,
    parse_failed: 0,
    with_eligibility: 0,
    without_eligibility: 0,
    with_exclusions: 0,
    level_central: 0,
    level_state: 0,
    level_unknown: 0,
    clauses_total: 0,
    clauses_distinct: 0,
    schemes_with_uncovered_text: 0,
    uncovered_fragments: 0,
    nav_section_missing: 0,
  };

  // ---- de-duplicate files by content hash ------------------------------
  const bySlug = new Map<string, { file: string; sha: string }>();
  const seenHashes = new Set<string>();

  for (const f of files) {
    const bytes = readFileSync(join(RAW_DIR, f));
    const sha = createHash('sha256').update(bytes).digest('hex');
    seenHashes.add(sha);
    const slug = canonicalSlug(f);
    // Prefer the plainest filename for a given slug.
    const existing = bySlug.get(slug);
    if (!existing || f.length < existing.file.length) bySlug.set(slug, { file: f, sha });
  }
  counts.distinct_by_hash = seenHashes.size;
  counts.distinct_by_slug = bySlug.size;

  // ---- parse each distinct scheme --------------------------------------
  const schemes: Scheme[] = [];
  const failures: { file: string; error: string }[] = [];
  const dedupGroups = new Map<string, { key: string; sample: string; clauses: string[] }>();

  let done = 0;
  for (const [slug, { file, sha }] of bySlug) {
    done++;
    if (done % 200 === 0) process.stderr.write(`  parsed ${done}/${bySlug.size}\n`);

    let text: string;
    try {
      const bytes = readFileSync(join(RAW_DIR, file));
      const out = await extractPdfText(new Uint8Array(bytes));
      text = out.text;
    } catch (err) {
      counts.parse_failed++;
      failures.push({ file, error: String(err instanceof Error ? err.message : err) });
      continue;
    }

    const parsed = parseSections(text);
    counts.parsed_ok++;
    if (parsed.warnings.some((w) => w.includes('nav bar advertised'))) counts.nav_section_missing++;

    if (parsed.level === 'central') counts.level_central++;
    else if (parsed.level === 'state') counts.level_state++;
    else counts.level_unknown++;

    const eligibility = parsed.sections['Eligibility'];
    const exclusions = parsed.sections['Exclusions'];
    if (exclusions) counts.with_exclusions++;

    const clauses: Clause[] = [];
    let uncovered: string[] = [];
    let covered = 0;
    let total = 0;

    const addClausesFrom = (
      sectionText: string,
      offset: number,
      origin: 'eligibility' | 'exclusions',
    ) => {
      const res = splitEligibility(sectionText, offset);
      total += res.totalChars;
      covered += res.coveredChars;
      uncovered = uncovered.concat(res.uncovered);
      for (const c of res.clauses) {
        const key = dedupKey(c.text);
        const id = `${slug}-${origin === 'exclusions' ? 'x' : 'e'}${clauses.length + 1}`;
        clauses.push({
          id,
          scheme_id: slug,
          source_text: c.text,
          source_span: { start: c.start, end: c.end },
          source_url: `https://www.myscheme.gov.in/schemes/${slug}`,
          // Kind is a human judgement; ingest does not guess it. Everything
          // starts as an eligibility requirement and is reclassified in review.
          kind: 'eligibility_requirement',
          annotation_state: 'proposed',
          constraint: null,
          dedup_group_id: `grp_${createHash('sha1').update(key).digest('hex').slice(0, 12)}`,
          revision: 1,
          history: [{ action: 'proposed', by: 'ingest', at: new Date().toISOString() }],
        });

        const gid = `grp_${createHash('sha1').update(key).digest('hex').slice(0, 12)}`;
        const g = dedupGroups.get(gid) ?? { key, sample: c.text, clauses: [] };
        g.clauses.push(id);
        dedupGroups.set(gid, g);
      }
    };

    if (eligibility) {
      counts.with_eligibility++;
      addClausesFrom(eligibility.text, eligibility.start, 'eligibility');
    } else {
      counts.without_eligibility++;
    }
    if (exclusions) {
      addClausesFrom(exclusions.text, exclusions.start, 'exclusions');
    }

    counts.clauses_total += clauses.length;
    if (uncovered.length > 0) {
      counts.schemes_with_uncovered_text++;
      counts.uncovered_fragments += uncovered.length;
    }

    schemes.push({
      id: slug,
      name: parsed.scheme_name ?? slug,
      level: parsed.level,
      state: parsed.state,
      ministry: parsed.ministry,
      category: parsed.tags,
      description: parsed.sections['Details']?.text,
      benefits: parsed.sections['Benefits']?.text,
      application_process: parsed.sections['Application Process']?.text,
      documents: parsed.sections['Documents Required']
        ? [parsed.sections['Documents Required']!.text]
        : [],
      eligibility_text: eligibility?.text ?? '',
      clauses,
      source_coverage: {
        eligibility_text_length: total,
        covered_chars: covered,
        uncovered_fragments: uncovered,
        complete: uncovered.length === 0 && total > 0,
      },
      source_url: `https://www.myscheme.gov.in/schemes/${slug}`,
      source_record: { file, sha256: sha },
    });
  }

  counts.clauses_distinct = dedupGroups.size;

  // ---- write outputs ----------------------------------------------------
  const provenance: Provenance = {
    dataset: DATASET,
    dataset_url: DATASET_URL,
    commit_sha: COMMIT_SHA,
    license: LICENSE,
    cloned_at: new Date().toISOString(),
    ingested_at: new Date().toISOString(),
    raw_files: counts.raw_files,
    schemes: schemes.length,
    notes: [
      'Dataset card claims CSV/JSON/Parquet; the repository contains PDFs only.',
      'Card says 723 files; the clone contains ' + counts.raw_files + '.',
      'No clause is human-approved. Nothing in this corpus can decide eligibility yet.',
    ],
  };

  writeFileSync(join(OUT_DIR, 'schemes.json'), JSON.stringify(schemes, null, 1));
  writeFileSync(
    join(OUT_DIR, 'dedup.json'),
    JSON.stringify(
      [...dedupGroups.entries()]
        .map(([id, g]) => ({ id, size: g.clauses.length, sample: g.sample, clauses: g.clauses }))
        .sort((a, b) => b.size - a.size),
      null,
      1,
    ),
  );
  writeFileSync('data/provenance.json', JSON.stringify({ ...provenance, counts }, null, 2));
  if (failures.length) {
    writeFileSync(join(OUT_DIR, 'parse_failures.json'), JSON.stringify(failures, null, 1));
  }

  // ---- report -----------------------------------------------------------
  const groupsBySize = [...dedupGroups.values()].sort((a, b) => b.clauses.length - a.clauses.length);
  const inGroups = groupsBySize.filter((g) => g.clauses.length > 1);
  const clausesInGroups = inGroups.reduce((n, g) => n + g.clauses.length, 0);

  console.log('');
  console.log('STAGE 1 — CORPUS INGEST');
  console.log('='.repeat(62));
  console.log(`dataset            ${DATASET} @ ${COMMIT_SHA.slice(0, 7)} (${LICENSE})`);
  console.log('');
  console.log('FILES');
  console.log(`  raw files in clone              ${counts.raw_files}`);
  console.log(`  distinct by content hash        ${counts.distinct_by_hash}`);
  console.log(`  distinct schemes (by slug)      ${counts.distinct_by_slug}`);
  console.log('');
  console.log('PARSING');
  console.log(`  parsed                          ${counts.parsed_ok}`);
  console.log(`  failed to parse                 ${counts.parse_failed}`);
  console.log(`  nav advertised a missing section ${counts.nav_section_missing}`);
  console.log('');
  console.log('CLASSIFICATION');
  console.log(`  central                         ${counts.level_central}`);
  console.log(`  state                           ${counts.level_state}`);
  console.log(`  level undetermined              ${counts.level_unknown}`);
  console.log('');
  console.log('ELIGIBILITY TEXT');
  console.log(`  schemes WITH eligibility text   ${counts.with_eligibility}`);
  console.log(`  schemes WITHOUT any             ${counts.without_eligibility}   <- can never match`);
  console.log(`  schemes with an Exclusions block ${counts.with_exclusions}`);
  console.log('');
  console.log('CLAUSES');
  console.log(`  clauses split                   ${counts.clauses_total}`);
  console.log(`  DISTINCT clause texts           ${counts.clauses_distinct}   <- the review workload`);
  console.log(`  clauses inside a shared group   ${clausesInGroups} across ${inGroups.length} groups`);
  const saving = counts.clauses_total - counts.clauses_distinct;
  console.log(
    `  decisions saved by dedup        ${saving} (${((saving / Math.max(counts.clauses_total, 1)) * 100).toFixed(1)}%)`,
  );
  console.log('');
  console.log('COVERAGE');
  console.log(`  schemes with uncovered text     ${counts.schemes_with_uncovered_text}`);
  console.log(`  uncovered fragments             ${counts.uncovered_fragments}`);
  console.log('');
  console.log('TOP 10 SHARED CLAUSE GROUPS');
  for (const g of groupsBySize.slice(0, 10)) {
    const s = g.sample.length > 96 ? g.sample.slice(0, 93) + '...' : g.sample;
    console.log(`  ${String(g.clauses.length).padStart(4)}x  ${s}`);
  }
  console.log('');
  console.log('APPROVED CLAUSES: 0 — nothing in this corpus can decide eligibility yet.');
  console.log('='.repeat(62));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

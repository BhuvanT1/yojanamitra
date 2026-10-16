/**
 * The match endpoint.
 *
 * Server-side only, for three reasons that all matter:
 *
 *   1. The corpus is 17MB. It is read once into module scope and never shipped
 *      to a phone on a slow connection.
 *   2. The rule engine must not be modifiable by the client. Verdicts are
 *      computed here or not at all.
 *   3. Citizen text never leaves this process. It is not logged with the
 *      response, not persisted, and not sent anywhere.
 */

import { NextResponse } from 'next/server';
import { readFileSync, existsSync } from 'node:fs';

import { ANNOTATIONS_FILE, CORPUS_FILE, PROVENANCE_FILE, SIMULATE } from '@/config/paths';

import { match, matchFromProfile } from '@/rules/match';
import type { Scheme, Provenance } from '@/domain/scheme';
import type { Clause } from '@/domain/clause';
import type { Profile } from '@/domain/profile';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';


interface Corpus {
  schemes: Scheme[];
  provenance: Provenance | null;
  approvedClauses: number;
}

let cached: Corpus | null = null;

function loadCorpus(): Corpus {
  if (cached) return cached;

  if (!existsSync(CORPUS_FILE)) {
    // An empty corpus is a deployment fault, not a user error. Say so in the
    // log; the endpoint still answers rather than 500-ing on every request.
    console.error(`[match] corpus missing at ${CORPUS_FILE} — set YM_CORPUS_DIR`);
    cached = { schemes: [], provenance: null, approvedClauses: 0 };
    return cached;
  }

  const schemes: Scheme[] = JSON.parse(readFileSync(CORPUS_FILE, 'utf8'));

  if (existsSync(ANNOTATIONS_FILE)) {
    const annotated: Clause[] = JSON.parse(readFileSync(ANNOTATIONS_FILE, 'utf8'));
    const byId = new Map(annotated.map((c) => [c.id, c]));
    for (const s of schemes) s.clauses = s.clauses.map((c) => byId.get(c.id) ?? c);
  }

  let approvedClauses = schemes.reduce(
    (n, s) => n + s.clauses.filter((c) => c.annotation_state === 'approved').length,
    0,
  );

  if (SIMULATE) {
    for (const s of schemes) {
      s.clauses = s.clauses.map((c) =>
        c.annotation_state === 'proposed' && c.constraint
          ? { ...c, annotation_state: 'approved' as const, approved_by: 'SIMULATED', approved_at: 'n/a' }
          : c,
      );
    }
    approvedClauses = schemes.reduce(
      (n, s) => n + s.clauses.filter((c) => c.annotation_state === 'approved').length,
      0,
    );
  }

  const provenance: Provenance | null = existsSync(PROVENANCE_FILE)
    ? JSON.parse(readFileSync(PROVENANCE_FILE, 'utf8'))
    : null;

  cached = { schemes, provenance, approvedClauses };
  return cached;
}

/** Trim the payload: a phone does not need every clause of every scheme. */
function slim(m: ReturnType<typeof matchFromProfile>) {
  const take = <T,>(xs: T[], n: number) => xs.slice(0, n);
  return {
    eligible: take(m.eligible, 20),
    likely_eligible: take(m.likely_eligible, 20),
    ineligible: take(m.ineligible, 10),
    counts: {
      eligible: m.eligible.length,
      likely_eligible: m.likely_eligible.length,
      ineligible: m.ineligible.length,
    },
    retrieval: m.retrieval,
    would_resolve_most: m.would_resolve_most,
  };
}

export async function POST(req: Request) {
  let body: { text?: string; profile?: Profile };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'invalid JSON body' }, { status: 400 });
  }

  const { schemes, provenance, approvedClauses } = loadCorpus();

  const meta = {
    simulated: SIMULATE,
    approved_clauses: approvedClauses,
    provenance: provenance
      ? {
          dataset: provenance.dataset,
          dataset_url: provenance.dataset_url,
          commit_sha: provenance.commit_sha,
          license: provenance.license,
          schemes: provenance.schemes,
          ingested_at: provenance.ingested_at,
        }
      : null,
  };

  // A corrected profile comes back whole, so the citizen's edits are authoritative
  // and we do not re-extract over their correction.
  if (body.profile) {
    const out = matchFromProfile(schemes, body.profile);
    return NextResponse.json({ profile: body.profile, unknown_fields: [], ...slim(out), meta });
  }

  const text = (body.text ?? '').trim();
  if (!text) return NextResponse.json({ error: 'text required' }, { status: 400 });
  if (text.length > 2000) return NextResponse.json({ error: 'text too long' }, { status: 413 });

  const out = match(schemes, text);
  return NextResponse.json({
    profile: out.extraction.profile,
    unknown_fields: out.extraction.unknown_fields,
    ...slim(out),
    meta,
  });
}

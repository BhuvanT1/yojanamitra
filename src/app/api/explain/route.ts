/**
 * Plain-language explanations for verdicts the engine already produced.
 *
 * A separate endpoint from /api/match on purpose: results render immediately
 * from the rule engine, and the wording arrives afterwards. A slow or missing
 * model delays nothing a citizen needs — they already have their answer and the
 * clause that produced it.
 */

import { NextResponse } from 'next/server';
import { explainMatches } from '@/llm/explain';
import { summariseEligible } from '@/llm/summary';
import type { SchemeMatch } from '@/rules/evaluate';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Counts arrive from the client, so they are not trusted: they are only ever
 * rendered as numbers in a sentence, but a negative or absurd value would still
 * be a lie shown to a citizen. Anything that is not a sane non-negative integer
 * is dropped, and the summary falls back to counting the arrays.
 */
function safeCounts(
  c: { eligible: number; likely_eligible: number } | undefined,
): { eligible: number; likely_eligible: number } | undefined {
  if (!c) return undefined;
  const ok = (n: unknown) => Number.isInteger(n) && (n as number) >= 0 && (n as number) <= 10_000;
  return ok(c.eligible) && ok(c.likely_eligible)
    ? { eligible: c.eligible, likely_eligible: c.likely_eligible }
    : undefined;
}

export async function POST(req: Request) {
  let body: {
    matches?: SchemeMatch[];
    eligible?: SchemeMatch[];
    likely?: SchemeMatch[];
    counts?: { eligible: number; likely_eligible: number };
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'invalid request' }, { status: 400 });
  }

  const matches = Array.isArray(body.matches) ? body.matches : [];
  if (matches.length === 0) {
    return NextResponse.json({
      explanations: [],
      provider: null,
      model: null,
      rejected_ids: [],
      summary: null,
    });
  }
  if (matches.length > 40) {
    return NextResponse.json({ error: 'too many schemes' }, { status: 413 });
  }

  // The eligible/likely split comes from the engine, not from re-deriving it
  // here: the summary must describe exactly the verdicts the citizen is looking
  // at, and a second opinion about which bucket a scheme belongs in is precisely
  // the thing this layer is not allowed to have.
  const eligible = Array.isArray(body.eligible) ? body.eligible : [];
  const likely = Array.isArray(body.likely) ? body.likely : [];

  // Run together: neither is on the path to the citizen's answer, which is
  // already on screen by the time this endpoint is called.
  const [explained, summary] = await Promise.all([
    explainMatches(matches),
    summariseEligible(eligible, likely, { counts: safeCounts(body.counts) }),
  ]);

  return NextResponse.json({ ...explained, summary });
}

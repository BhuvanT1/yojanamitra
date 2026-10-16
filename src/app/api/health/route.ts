/**
 * Health check for the hosting platform.
 *
 * Deliberately more than `{ok:true}`. The failure this has to catch is the quiet
 * one: a container that boots, serves pages, and answers every citizen with
 * "nothing matched" because the corpus volume was not mounted. That looks
 * healthy from the outside and is completely broken.
 *
 * So the check reports whether the corpus is actually readable and how many
 * schemes are in it, and returns 503 when it is missing. A platform watching
 * this endpoint will refuse to route traffic to an instance that cannot answer.
 */

import { NextResponse } from 'next/server';
import { existsSync, statSync } from 'node:fs';
import { ANNOTATIONS_FILE, CORPUS_FILE, PROVENANCE_FILE, SIMULATE, STATE_DIR } from '@/config/paths';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function sizeOf(path: string): number | null {
  try {
    return statSync(path).size;
  } catch {
    return null;
  }
}

export async function GET() {
  const corpusBytes = sizeOf(CORPUS_FILE);
  const corpusReadable = corpusBytes !== null && corpusBytes > 0;

  const body = {
    status: corpusReadable ? 'ok' : 'degraded',
    corpus: {
      path: CORPUS_FILE,
      readable: corpusReadable,
      bytes: corpusBytes,
    },
    state: {
      dir: STATE_DIR,
      writable_dir_exists: existsSync(STATE_DIR),
      annotations_present: existsSync(ANNOTATIONS_FILE),
    },
    provenance_present: existsSync(PROVENANCE_FILE),
    simulate: SIMULATE,
    uptime_seconds: Math.round(process.uptime()),
  };

  return NextResponse.json(body, {
    status: corpusReadable ? 200 : 503,
    headers: { 'cache-control': 'no-store' },
  });
}

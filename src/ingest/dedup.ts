/**
 * De-duplication of the raw clone.
 *
 * The dataset ships the same scheme several times over — "aavy.pdf",
 * "aavy copy.pdf", "aavy(1).pdf", "aavy(2).pdf" — and the copies are
 * byte-identical (verified by sha256 across the corpus). Filename shape and
 * content hash therefore agree; the hash is the authority, the filename only
 * picks which spelling becomes the canonical slug.
 */

import { basename } from 'node:path';

export function canonicalSlug(filename: string): string {
  return basename(filename, '.pdf')
    .replace(/\s*copy\s*$/i, '')
    .replace(/\s*\(\d+\)\s*$/, '')
    .replace(/\s*copy\s*$/i, '')
    .trim();
}

/**
 * Where the data lives.
 *
 * Two directories, and keeping them apart is what makes this deployable.
 *
 *   The CORPUS is read-only and large — 19MB of normalised schemes plus the
 *   provenance record. It is baked into the container image, never written, and
 *   identical for every instance.
 *
 *   The STATE is small and must survive a redeploy: reviewer and citizen
 *   accounts, invite codes, and the clause annotations that reviewers approve.
 *   It lives on a mounted volume.
 *
 * Before this split both sat under `data/`, which is a trap: mounting a volume
 * at `data/` to keep the accounts alive would shadow the corpus baked into the
 * image, and the app would start up with zero schemes and no error. Splitting
 * them means the volume holds only what has to persist.
 *
 * Every path is overridable by environment variable so the same build runs from
 * a checkout, from a container, and from a test with a temp directory.
 */

import { join } from 'node:path';

const cwd = () => process.cwd();

/** Read-only. Ships with the image. */
export const CORPUS_DIR = process.env.YM_CORPUS_DIR ?? join(cwd(), 'data', 'normalized');

export const CORPUS_FILE = join(CORPUS_DIR, 'schemes.json');

export const PROVENANCE_FILE = process.env.YM_PROVENANCE_FILE ?? join(cwd(), 'data', 'provenance.json');

/** Writable. Must be a mounted volume in production, or nothing survives a deploy. */
export const STATE_DIR = process.env.YM_STATE_DIR ?? join(cwd(), 'data');

export const ANNOTATIONS_FILE = process.env.YM_ANNOTATIONS_FILE ?? join(STATE_DIR, 'annotations', 'clauses.json');

export const AUTH_DIR = join(STATE_DIR, 'auth');

/**
 * Demonstration mode: treat proposed constraints as approved, in memory only.
 *
 * Read here rather than in five call sites so the UI banner and the rule engine
 * can never disagree about whether it is on.
 */
export const SIMULATE = process.env.YM_SIMULATE === '1';

/**
 * Optional citizen accounts.
 *
 * OPTIONAL is the whole design. A citizen can type a sentence and get an answer
 * with no account, no cookie and no trace — that path is untouched by this file
 * and must stay that way. An account exists only so somebody who checks back
 * next month does not have to describe their family again.
 *
 * Because that convenience means holding real data about real people, this
 * module is deliberately stingy:
 *
 *   The raw sentence is never stored. "I am a widow with 1.5 acres and no
 *   income" is the most sensitive string in the system. The engine has already
 *   reduced it to the fields that mattered, so only those are kept — and the
 *   `evidence` substrings, which are verbatim fragments of that sentence, are
 *   stripped out with it. `assertNothingRawWasSaved` enforces this.
 *
 *   Nothing is stored until the citizen presses save. Results are not saved as a
 *   side effect of searching while signed in.
 *
 *   Delete means delete. `deleteAccount` removes the record outright — no
 *   tombstone, no "deleted" flag, nothing to restore.
 *
 * This store is separate from `users.ts` in every way that matters: its own
 * file, its own cookie, its own session namespace. A citizen session token does
 * not resolve to a reviewer, because reviewer verification never reads this
 * file.
 */

import { join } from 'node:path';
import { AUTH_DIR } from '../config/paths';
import { createAccountStore, type AccountRecord } from './accounts';
import type { Dependent, ExtractedField, Profile } from '../domain/profile';

const CITIZENS_PATH = process.env.YM_CITIZENS_FILE ?? join(AUTH_DIR, 'citizens.json');

/** Long, because the point of an account is to come back months later. */
const SESSION_HOURS = 24 * 30;

export interface CitizenUser extends AccountRecord {
  /** Structured fields only, evidence and raw text removed. Null until saved. */
  saved_profile: Profile | null;
  saved_at?: string;
}

const store = createAccountStore<CitizenUser>({
  file: CITIZENS_PATH,
  cookie: 'ym_citizen',
  sessionHours: SESSION_HOURS,
});

export const CITIZEN_COOKIE = store.cookie;

export const hasAnyCitizen = (): boolean => store.hasAny();

export function createCitizen(username: string, password: string): void {
  store.create(username, password, { saved_profile: null } as Partial<CitizenUser>);
}

export const authenticateCitizen = (username: string, password: string) =>
  store.authenticate(username, password);
export const verifyCitizenSession = (token: string | undefined): string | null => store.verifySession(token);
export const revokeCitizenSession = (token: string | undefined): void => store.revokeSession(token);
export const setCitizenPassword = (username: string, password: string): void =>
  store.setPassword(username, password);

// ---------------------------------------------------------------- minimisation

/**
 * Keep the value, drop the evidence.
 *
 * `evidence` holds verbatim substrings of what the citizen typed, which is the
 * thing we are refusing to store. Marking the result `user_corrected` is not a
 * cosmetic choice: it is already the shape the correction panel produces and the
 * match endpoint accepts, so a restored profile travels the proven path.
 */
function stripField<T>(f: ExtractedField<T> | undefined): ExtractedField<T> | undefined {
  if (!f) return undefined;
  return { value: f.value, confidence: 1, evidence: [], origin: 'user_corrected' };
}

function stripDependent(d: Dependent): Dependent {
  return {
    id: d.id,
    ...(d.relation ? { relation: stripField(d.relation) } : {}),
    ...(d.age ? { age: stripField(d.age) } : {}),
    ...(d.gender ? { gender: stripField(d.gender) } : {}),
    ...(d.education_stage ? { education_stage: stripField(d.education_stage) } : {}),
    ...(d.occupation ? { occupation: stripField(d.occupation) } : {}),
    ...(d.category ? { category: stripField(d.category) } : {}),
    ...(d.special_categories ? { special_categories: stripField(d.special_categories) } : {}),
  } as Dependent;
}

/** The only shape allowed to reach disk. */
export function toSavedProfile(profile: Profile): Profile {
  const out: Profile = {
    raw: {
      // Emptied, not omitted: downstream code expects `raw` to exist.
      text: '',
      detected_language: profile.raw?.detected_language ?? 'und',
      detection_confidence: 0,
    },
    dependents: (profile.dependents ?? []).map(stripDependent),
  };

  for (const key of [
    'age',
    'annual_income_inr',
    'occupation',
    'land_acres',
    'state',
    'residence',
    'gender',
    'category',
    'education_stage',
    'special_categories',
  ] as const) {
    const stripped = stripField(profile[key] as ExtractedField<unknown> | undefined);
    if (stripped) (out as unknown as Record<string, unknown>)[key] = stripped;
  }

  return out;
}

/**
 * Belt and braces. Walks the sanitised object and throws if any free text
 * survived, so a future field added to `Profile` cannot quietly start carrying a
 * citizen's own words to disk.
 */
export function assertNothingRawWasSaved(saved: Profile): void {
  if (saved.raw.text !== '') throw new Error('saved profile still carries raw input text');
  const walk = (node: unknown, path: string): void => {
    if (Array.isArray(node)) {
      node.forEach((v, i) => walk(v, `${path}[${i}]`));
      return;
    }
    if (node && typeof node === 'object') {
      for (const [k, v] of Object.entries(node)) {
        if (k === 'evidence') {
          if (Array.isArray(v) && v.length > 0) throw new Error(`evidence survived at ${path}.${k}`);
          continue;
        }
        walk(v, `${path}.${k}`);
      }
    }
  };
  walk(saved, 'profile');
}

// ---------------------------------------------------------------- saved profile

export function saveProfile(username: string, profile: Profile): Profile {
  const sanitised = toSavedProfile(profile);
  assertNothingRawWasSaved(sanitised);

  const ok = store.update(username, (record) => {
    record.saved_profile = sanitised;
    record.saved_at = new Date().toISOString();
  });
  if (!ok) throw new Error(`no such citizen: ${username}`);
  return sanitised;
}

export function getSavedProfile(username: string): { profile: Profile | null; saved_at?: string } {
  const record = store.get(username);
  if (!record) return { profile: null };
  return { profile: record.saved_profile ?? null, ...(record.saved_at ? { saved_at: record.saved_at } : {}) };
}

/** Forget the details but keep the account. */
export function clearSavedProfile(username: string): boolean {
  return store.update(username, (record) => {
    record.saved_profile = null;
    delete record.saved_at;
  });
}

/** Hard delete, account and details together. There is nothing left afterwards. */
export function deleteAccount(username: string): boolean {
  return store.remove(username);
}

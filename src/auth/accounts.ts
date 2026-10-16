/**
 * The account machinery, shared by two populations that must never be confused
 * with each other.
 *
 * Reviewers and citizens both need a password and a session, so they share the
 * crypto here. They share nothing else: each store is created with its own file
 * and its own cookie name, and a token issued by one store is meaningless to the
 * other because `verifySession` only ever reads its own file. That separation is
 * the point of this module. A citizen account is a convenience; a reviewer
 * account is the authority to decide who gets money. One must never become the
 * other through a shared table and a `role` column somebody forgot to check.
 *
 * Passwords are hashed with scrypt and a per-user random salt, compared in
 * constant time. Sessions are bearer tokens of which only the SHA-256 is stored,
 * so a leaked accounts file cannot be replayed as a login.
 */

import { randomBytes, scryptSync, timingSafeEqual, createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

/** scrypt cost. 2^15 keeps a wrong guess slow without stalling a real login. */
const SCRYPT_N = 32768;
const SCRYPT_R = 8;
const KEY_LEN = 64;

/**
 * scrypt needs roughly 128 * N * r bytes — 32 MiB at these parameters, which is
 * exactly Node's default `maxmem` and therefore throws
 * ERR_CRYPTO_INVALID_SCRYPT_PARAMS. Raising the ceiling is required, not
 * optional; without it account creation fails on every machine.
 */
const SCRYPT_MAXMEM = 128 * SCRYPT_N * SCRYPT_R * 2;

export interface SessionRecord {
  token_hash: string;
  issued_at: string;
  expires_at: string;
}

export interface AccountRecord {
  username: string;
  /** Hex salt, unique per user. */
  salt: string;
  /** Hex scrypt hash of (password, salt). The password itself is never stored. */
  hash: string;
  created_at: string;
  sessions: SessionRecord[];
}

export interface Session {
  token: string;
  username: string;
  expires_at: string;
}

export const MIN_PASSWORD = 8;

/**
 * Usernames are lowercased and restricted so one account cannot impersonate
 * another through whitespace, homoglyphs or a trailing dot.
 */
const USERNAME_RE = /^[a-z0-9][a-z0-9._-]{2,31}$/;

export function normaliseUsername(raw: string): string {
  return raw.trim().toLowerCase();
}

export function assertUsername(name: string): void {
  if (!name) throw new Error('username is required');
  if (!USERNAME_RE.test(name)) {
    throw new Error('username must be 3–32 characters, using letters, numbers, dot, dash or underscore');
  }
}

export function assertPassword(password: string): void {
  if (password.length < MIN_PASSWORD) throw new Error(`password must be at least ${MIN_PASSWORD} characters`);
}

function derive(password: string, salt: string): string {
  return scryptSync(password, salt, KEY_LEN, {
    N: SCRYPT_N,
    r: SCRYPT_R,
    p: 1,
    maxmem: SCRYPT_MAXMEM,
  }).toString('hex');
}

export const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');

export interface AccountStore<R extends AccountRecord = AccountRecord> {
  readonly file: string;
  readonly cookie: string;
  hasAny(): boolean;
  list(): string[];
  get(username: string): R | null;
  create(username: string, password: string, extra?: Partial<R>): R;
  setPassword(username: string, password: string): void;
  authenticate(username: string, password: string): Session | null;
  verifySession(token: string | undefined): string | null;
  revokeSession(token: string | undefined): void;
  /** Mutate one record under a read-modify-write. Returns false if absent. */
  update(username: string, fn: (record: R) => void): boolean;
  /** Hard delete. There is no tombstone and no recovery — that is the promise. */
  remove(username: string): boolean;
}

export function createAccountStore<R extends AccountRecord = AccountRecord>(opts: {
  file: string;
  cookie: string;
  sessionHours: number;
}): AccountStore<R> {
  const { file, cookie, sessionHours } = opts;

  function load(): R[] {
    if (!existsSync(file)) return [];
    try {
      const parsed: unknown = JSON.parse(readFileSync(file, 'utf8'));
      return Array.isArray(parsed) ? (parsed as R[]) : [];
    } catch {
      return [];
    }
  }

  function save(records: R[]): void {
    mkdirSync(dirname(file), { recursive: true });
    // Written to a sibling and renamed, so a crash mid-write cannot leave a
    // half-written accounts file that reads as "no users exist".
    const tmp = `${file}.${process.pid}.tmp`;
    writeFileSync(tmp, JSON.stringify(records, null, 2), { mode: 0o600 });
    renameSync(tmp, file);
  }

  return {
    file,
    cookie,

    hasAny: () => load().length > 0,

    list: () => load().map((u) => u.username),

    get(username) {
      const name = normaliseUsername(username);
      return load().find((u) => u.username === name) ?? null;
    },

    create(username, password, extra) {
      const records = load();
      const name = normaliseUsername(username);
      assertUsername(name);
      assertPassword(password);
      if (records.some((u) => u.username === name)) throw new Error(`user "${name}" already exists`);

      const salt = randomBytes(16).toString('hex');
      const record = {
        ...(extra ?? {}),
        username: name,
        salt,
        hash: derive(password, salt),
        created_at: new Date().toISOString(),
        sessions: [],
      } as unknown as R;

      records.push(record);
      save(records);
      return record;
    },

    setPassword(username, password) {
      const records = load();
      const u = records.find((x) => x.username === normaliseUsername(username));
      if (!u) throw new Error(`no such user: ${username}`);
      assertPassword(password);
      u.salt = randomBytes(16).toString('hex');
      u.hash = derive(password, u.salt);
      // Changing a password invalidates every existing session.
      u.sessions = [];
      save(records);
    },

    /**
     * Verify a password and issue a session.
     *
     * Returns null for both "no such user" and "wrong password", and does the
     * scrypt work either way, so the response cannot be used to enumerate which
     * usernames exist.
     */
    authenticate(username, password) {
      const records = load();
      const name = normaliseUsername(username);
      const user = records.find((u) => u.username === name);

      const salt = user?.salt ?? randomBytes(16).toString('hex');
      const candidate = Buffer.from(derive(password, salt), 'hex');
      const expected = Buffer.from(user?.hash ?? candidate.toString('hex'), 'hex');

      const ok =
        user !== undefined && candidate.length === expected.length && timingSafeEqual(candidate, expected);

      if (!ok || !user) return null;

      const token = randomBytes(32).toString('hex');
      const now = new Date().toISOString();
      const expires = new Date(Date.now() + sessionHours * 3600_000).toISOString();

      user.sessions = user.sessions.filter((s) => s.expires_at > now);
      user.sessions.push({ token_hash: sha256(token), issued_at: now, expires_at: expires });
      save(records);

      return { token, username: user.username, expires_at: expires };
    },

    /**
     * Resolve a bearer token to a username, or null.
     *
     * Reads only THIS store's file, which is what keeps a citizen token from
     * ever resolving to a reviewer.
     */
    verifySession(token) {
      if (!token) return null;
      const hash = sha256(token);
      const now = new Date().toISOString();
      for (const u of load()) {
        if (u.sessions.some((s) => s.token_hash === hash && s.expires_at > now)) return u.username;
      }
      return null;
    },

    revokeSession(token) {
      if (!token) return;
      const hash = sha256(token);
      const records = load();
      let changed = false;
      for (const u of records) {
        const before = u.sessions.length;
        u.sessions = u.sessions.filter((s) => s.token_hash !== hash);
        if (u.sessions.length !== before) changed = true;
      }
      if (changed) save(records);
    },

    update(username, fn) {
      const records = load();
      const u = records.find((x) => x.username === normaliseUsername(username));
      if (!u) return false;
      fn(u);
      save(records);
      return true;
    },

    remove(username) {
      const records = load();
      const name = normaliseUsername(username);
      const next = records.filter((u) => u.username !== name);
      if (next.length === records.length) return false;
      save(next);
      return true;
    },
  };
}

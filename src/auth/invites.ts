/**
 * Reviewer invitations.
 *
 * Reviewer signup is open exactly once — while zero reviewers exist — so the
 * first account can be created in a browser rather than a terminal. After that
 * the door closes and a new reviewer needs a code issued by an existing one.
 *
 * The alternative, an open signup page, would mean anyone who finds the URL can
 * approve eligibility clauses. Approving a clause is what decides whether a
 * citizen is told they qualify for money, and every approval is stamped with the
 * approver's name. A signup form that hands out that authority makes the name on
 * the stamp meaningless.
 *
 * Codes are stored as SHA-256 only, exactly like passwords: the file is a record
 * that an invite was issued, not a list of usable invites.
 */

import { randomInt, createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { AUTH_DIR } from '../config/paths';

const INVITES_PATH = process.env.YM_INVITES_FILE ?? join(AUTH_DIR, 'invites.json');

/** No O/0 or I/1/L: a code is read aloud and typed by hand at least once. */
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const GROUPS = 4;
const GROUP_LEN = 4;

const INVITE_DAYS = 7;

export interface InviteRecord {
  code_hash: string;
  issued_by: string;
  issued_at: string;
  expires_at: string;
  redeemed_by?: string;
  redeemed_at?: string;
}

/** Strip formatting so "k7f2-9mqx" and "K7F29MQX" are the same code. */
function canonical(raw: string): string {
  return raw.toUpperCase().replace(/[^A-Z0-9]/g, '');
}

const hashCode = (raw: string) => createHash('sha256').update(canonical(raw)).digest('hex');

function load(): InviteRecord[] {
  // The path is configurable, so Turbopack cannot prove which file this reads and
  // would otherwise trace the entire project into the deployment bundle. The read
  // is server-only and the path is ours, not the client's.
  if (!existsSync(/*turbopackIgnore: true*/ INVITES_PATH)) return [];
  try {
    const parsed: unknown = JSON.parse(readFileSync(/*turbopackIgnore: true*/ INVITES_PATH, 'utf8'));
    return Array.isArray(parsed) ? (parsed as InviteRecord[]) : [];
  } catch {
    return [];
  }
}

function save(records: InviteRecord[]): void {
  mkdirSync(dirname(INVITES_PATH), { recursive: true });
  const tmp = `${INVITES_PATH}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify(records, null, 2), { mode: 0o600 });
  renameSync(tmp, INVITES_PATH);
}

function generateCode(): string {
  const groups: string[] = [];
  for (let g = 0; g < GROUPS; g++) {
    let s = '';
    // randomInt, not Math.random: this value is a credential.
    for (let i = 0; i < GROUP_LEN; i++) s += ALPHABET[randomInt(ALPHABET.length)];
    groups.push(s);
  }
  return groups.join('-');
}

export interface IssuedInvite {
  /** Shown to the issuing reviewer ONCE. Never recoverable from the file. */
  code: string;
  expires_at: string;
}

export function createInvite(issuedBy: string): IssuedInvite {
  const code = generateCode();
  const now = new Date();
  const expires = new Date(now.getTime() + INVITE_DAYS * 24 * 3600_000).toISOString();

  const records = load();
  records.push({
    code_hash: hashCode(code),
    issued_by: issuedBy,
    issued_at: now.toISOString(),
    expires_at: expires,
  });
  save(records);

  return { code, expires_at: expires };
}

export type RedeemResult =
  | { ok: true; issued_by: string }
  | { ok: false; reason: 'unknown' | 'already_used' | 'expired' };

/**
 * Consume an invite. Single use: the record is stamped before the caller creates
 * the account, so the same code cannot be redeemed twice even if account
 * creation then fails. A wasted invite is a nuisance; a reusable one is a hole.
 */
export function redeemInvite(rawCode: string, redeemedBy: string): RedeemResult {
  const records = load();
  const hash = hashCode(rawCode);
  const invite = records.find((i) => i.code_hash === hash);

  if (!invite) return { ok: false, reason: 'unknown' };
  if (invite.redeemed_by) return { ok: false, reason: 'already_used' };
  if (invite.expires_at <= new Date().toISOString()) return { ok: false, reason: 'expired' };

  invite.redeemed_by = redeemedBy;
  invite.redeemed_at = new Date().toISOString();
  save(records);

  return { ok: true, issued_by: invite.issued_by };
}

/** For the reviewer dashboard. Codes are not included — they do not exist here. */
export function listInvites(issuedBy?: string): Omit<InviteRecord, 'code_hash'>[] {
  const now = new Date().toISOString();
  return load()
    .filter((i) => (issuedBy ? i.issued_by === issuedBy : true))
    .filter((i) => i.redeemed_by !== undefined || i.expires_at > now)
    .map(({ code_hash: _ignored, ...rest }) => rest)
    .sort((a, b) => b.issued_at.localeCompare(a.issued_at));
}

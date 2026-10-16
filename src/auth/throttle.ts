/**
 * Failed-login throttling.
 *
 * scrypt already makes each guess expensive, but expensive is not the same as
 * limited — an attacker with patience still gets unlimited attempts. This caps
 * them per (username, client) pair.
 *
 * In-memory and per-process, so it resets when the server restarts. That is an
 * honest limitation, not an oversight: the alternative is another file on the
 * write path of every login, and for a single-process deployment this buys the
 * protection that matters. A multi-process deployment needs a shared store.
 */

const WINDOW_MS = 15 * 60_000;
const MAX_FAILURES = 8;

const failures = new Map<string, { count: number; resetAt: number }>();

/** Cheap opportunistic sweep — the map must not grow without bound. */
function prune(now: number): void {
  if (failures.size < 512) return;
  for (const [k, v] of failures) if (v.resetAt <= now) failures.delete(k);
}

/** Seconds the caller must wait, or 0 if they may try. */
export function retryAfter(key: string): number {
  const now = Date.now();
  const entry = failures.get(key);
  if (!entry || entry.resetAt <= now) return 0;
  if (entry.count < MAX_FAILURES) return 0;
  return Math.ceil((entry.resetAt - now) / 1000);
}

export function recordFailure(key: string): void {
  const now = Date.now();
  prune(now);
  const entry = failures.get(key);
  if (!entry || entry.resetAt <= now) {
    failures.set(key, { count: 1, resetAt: now + WINDOW_MS });
    return;
  }
  entry.count += 1;
}

export function clearFailures(key: string): void {
  failures.delete(key);
}

/**
 * A throttle key. The IP comes from proxy headers and is therefore spoofable, so
 * the username is included — an attacker who rotates IPs is still rate-limited
 * against the account they are attacking.
 */
export function throttleKey(scope: string, username: string, req: Request): string {
  const fwd = req.headers.get('x-forwarded-for') ?? '';
  const ip = fwd.split(',')[0]?.trim() || req.headers.get('x-real-ip') || 'local';
  return `${scope}:${username.trim().toLowerCase()}:${ip}`;
}

/** Only for tests. */
export function __resetThrottle(): void {
  failures.clear();
}

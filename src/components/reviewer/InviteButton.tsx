'use client';

/**
 * Issue an invite code for a new reviewer.
 *
 * The code is shown once and never again — only its hash is stored — so the UI
 * has to make that unmistakable and make copying it easy.
 */

import { useState } from 'react';

export function InviteButton({ locale }: { locale: string }) {
  const [busy, setBusy] = useState(false);
  const [code, setCode] = useState<string | null>(null);
  const [expires, setExpires] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function issue() {
    setBusy(true);
    setError(null);
    setCopied(false);
    try {
      const res = await fetch('/api/auth/invite', { method: 'POST' });
      const data = (await res.json()) as { code?: string; expires_at?: string; error?: string };
      if (!res.ok || !data.code) {
        setError(data.error ?? 'Could not create an invite.');
        return;
      }
      setCode(data.code);
      setExpires(data.expires_at ?? null);
    } catch {
      setError('Could not reach the server.');
    } finally {
      setBusy(false);
    }
  }

  async function copy() {
    if (!code) return;
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
    } catch {
      // Clipboard access can be refused; the code is on screen to read anyway.
    }
  }

  return (
    <div className="card p-4">
      <h2 className="text-base font-semibold text-ink">Invite another reviewer</h2>
      <p className="mt-1 text-sm text-muted">
        Reviewer signup is closed. A new reviewer needs a single-use code from someone who is already one.
      </p>

      {!code && (
        <button
          onClick={issue}
          disabled={busy}
          className="btn btn-sm mt-3 border-brand text-brand hover:bg-brand-50 disabled:opacity-50"
        >
          {busy ? 'Creating…' : 'Create an invite code'}
        </button>
      )}

      {error && (
        <p role="alert" className="mt-3 rounded-xl border border-no-line bg-no-bg p-3 text-sm text-no">
          {error}
        </p>
      )}

      {code && (
        <div className="mt-3 rounded-xl border border-maybe-line bg-maybe-bg p-3">
          <p className="text-sm font-semibold text-maybe">Copy this now — it is not shown again</p>
          <code className="mt-2 block select-all rounded bg-paper px-3 py-2 font-mono text-lg tracking-widest">
            {code}
          </code>
          <div className="mt-2 flex flex-wrap items-center gap-3">
            <button
              onClick={copy}
              className="btn-secondary btn-sm"
            >
              {copied ? '✓ Copied' : 'Copy'}
            </button>
            {expires && (
              <span className="text-xs text-ink/70">
                Single use · expires {new Date(expires).toLocaleDateString()}
              </span>
            )}
          </div>
          <p className="mt-2 text-xs text-ink/70">
            They enter it at <span className="font-mono">/{locale}/signup</span>.
          </p>
        </div>
      )}
    </div>
  );
}

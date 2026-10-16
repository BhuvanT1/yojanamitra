/**
 * Plain-language explanations of verdicts the rule engine has ALREADY produced.
 *
 * This is the one place a language model touches a citizen's results, and it is
 * carefully bounded. Read the guarantees before changing anything here.
 *
 * WHAT THE MODEL CANNOT DO
 *
 *   It cannot add a scheme.      Output is keyed by scheme_id; an id the engine
 *                                did not produce is discarded.
 *   It cannot remove a scheme.   A scheme with no sentence falls back to the
 *                                deterministic one. The list is the engine's.
 *   It cannot change a verdict.  Verdicts are rendered from the engine's own
 *                                field. The model's text is never parsed for one.
 *   It cannot invent a clause.   Clause text shown to the citizen is quoted from
 *                                the corpus by the UI, not from this response.
 *
 * So the worst a compromised, hallucinating or prompt-injected model can do is
 * produce a badly worded sentence beside a correct verdict. It cannot tell
 * someone they are entitled to money they are not.
 *
 * WHAT THE MODEL RECEIVES
 *
 *   Only the structured facts the engine actually used, plus the clause outcomes.
 *   Never the citizen's raw text. Sending the raw sentence to a third-party API
 *   would put "I am a widow with no land" on someone else's server for no gain —
 *   the engine already reduced it to the fields that mattered.
 */

import type { SchemeMatch } from '../rules/evaluate';
import { getProvider, type LlmProvider } from './provider';
import { fieldLabel } from '../i18n/messages';

export interface Explanation {
  scheme_id: string;
  /** One or two sentences. Safe to render as plain text. */
  text: string;
  source: 'model' | 'deterministic';
}

export interface ExplainResult {
  explanations: Explanation[];
  /** Named so the UI can disclose which model wrote the wording, or that none did. */
  provider: string | null;
  model: string | null;
  /** Ids the model returned that the engine never produced. Should be empty. */
  rejected_ids: string[];
  /** Set when the model failed and deterministic text was used instead. */
  fallback_reason?: string;
}

// ---------------------------------------------------------------- deterministic

/**
 * The floor. Built from the engine's own reasons, so it is always available,
 * always correct, and costs nothing. The model is an improvement on this, never
 * a replacement for it.
 */
export function deterministicExplanation(m: SchemeMatch): string {
  const met = m.checks.filter((c) => c.status === 'satisfied');
  const failed = m.checks.find((c) => c.status === 'violated');
  const unknown = m.checks.filter((c) => c.status === 'unknown');

  if (m.verdict === 'ineligible' && failed) {
    return `You do not qualify: ${failed.reason}.`;
  }
  if (m.verdict === 'eligible') {
    // Several clauses often test the same thing ("must be a farmer" three ways),
    // so the same reason repeats. Saying it twice reads like a machine.
    const why = [...new Set(met.map((c) => c.reason))].slice(0, 2).join(', and ');
    return why ? `You qualify because ${why}.` : 'Every condition we could check is met.';
  }
  if (unknown.length > 0) {
    // Labels, not identifiers: a citizen should never be asked for their
    // `special_categories`.
    const fields = [...new Set(unknown.flatMap((c) => c.missing_fields))].map((f) =>
      fieldLabel('en', f).toLowerCase(),
    );
    return fields.length
      ? `Nothing ruled you out, but we still need your ${fields.join(' and ')} to be sure.`
      : 'Nothing ruled you out, but one condition has not been verified by a person yet.';
  }
  return 'Nothing ruled you out, but one condition has not been verified by a person yet.';
}

// ---------------------------------------------------------------- prompt

const SYSTEM = `You write one short, warm sentence explaining an eligibility decision that has ALREADY been made by a deterministic rule engine.

Absolute rules:
- The decision is final. Never contradict, soften, strengthen or re-open it.
- Never say someone qualifies for a scheme not in the input.
- Never invent conditions, amounts, deadlines or documents. Use only the facts given.
- Never promise money, approval or an outcome. This is guidance, not a decision.
- Plain language a person with limited schooling can read. No jargon, no officialese.
- One sentence. Two only if the second says what information is still needed.
- Address the reader as "you".

Return ONLY a JSON object of this shape, with no commentary:
{"explanations":[{"scheme_id":"<exact id from the input>","text":"<your sentence>"}]}`;

interface ModelScheme {
  scheme_id: string;
  scheme_name: string;
  verdict: string;
  conditions_met: string[];
  condition_failed?: string;
  information_missing: string[];
}

function toModelInput(matches: SchemeMatch[]): ModelScheme[] {
  return matches.map((m) => ({
    scheme_id: m.scheme_id,
    scheme_name: m.scheme_name,
    verdict: m.verdict,
    conditions_met: m.checks.filter((c) => c.status === 'satisfied').map((c) => c.reason).slice(0, 4),
    condition_failed: m.checks.find((c) => c.status === 'violated')?.reason,
    information_missing: m.missing_fields,
  }));
}

/** Strip anything that could smuggle markup or a link into the page. */
function sanitise(s: unknown): string | null {
  if (typeof s !== 'string') return null;
  const clean = s
    .replace(/[<>]/g, '')
    .replace(/https?:\/\/\S+/gi, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (clean.length < 4 || clean.length > 400) return null;
  return clean;
}

function parseModelOutput(raw: string): Map<string, string> {
  const out = new Map<string, string>();
  if (!raw) return out;

  // Models sometimes wrap JSON in prose or a code fence despite instructions.
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start < 0 || end <= start) return out;

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw.slice(start, end + 1));
  } catch {
    return out;
  }

  const list = (parsed as { explanations?: unknown }).explanations;
  if (!Array.isArray(list)) return out;

  for (const item of list) {
    const id = (item as { scheme_id?: unknown }).scheme_id;
    const text = sanitise((item as { text?: unknown }).text);
    if (typeof id === 'string' && text) out.set(id, text);
  }
  return out;
}

// ---------------------------------------------------------------- entry point

export async function explainMatches(
  matches: SchemeMatch[],
  opts: { provider?: LlmProvider | null; limit?: number } = {},
): Promise<ExplainResult> {
  const limit = opts.limit ?? 12;
  const subset = matches.slice(0, limit);

  const floor = (reason?: string): ExplainResult => ({
    explanations: subset.map((m) => ({
      scheme_id: m.scheme_id,
      text: deterministicExplanation(m),
      source: 'deterministic' as const,
    })),
    provider: null,
    model: null,
    rejected_ids: [],
    ...(reason ? { fallback_reason: reason } : {}),
  });

  if (subset.length === 0) return floor();

  const provider = opts.provider !== undefined ? opts.provider : getProvider();
  if (!provider) return floor('no model configured — set GEMINI_API_KEY, OPENAI_API_KEY or ANTHROPIC_API_KEY');

  let raw: string;
  try {
    raw = await provider.complete({
      system: SYSTEM,
      user: JSON.stringify({ schemes: toModelInput(subset) }, null, 1),
      maxOutputTokens: 1200,
      temperature: 0.2,
    });
  } catch (err) {
    return floor(`model call failed: ${err instanceof Error ? err.message : String(err)}`);
  }

  const byId = parseModelOutput(raw);
  if (byId.size === 0) return floor('model returned nothing usable');

  const validIds = new Set(subset.map((m) => m.scheme_id));
  const rejected_ids = [...byId.keys()].filter((id) => !validIds.has(id));

  // The list of schemes is the ENGINE's. We only look up wording per id; an id
  // the model invented is dropped, and a scheme it forgot keeps its own sentence.
  const explanations = subset.map((m) => {
    const text = byId.get(m.scheme_id);
    return text
      ? { scheme_id: m.scheme_id, text, source: 'model' as const }
      : { scheme_id: m.scheme_id, text: deterministicExplanation(m), source: 'deterministic' as const };
  });

  return { explanations, provider: provider.name, model: provider.model, rejected_ids };
}

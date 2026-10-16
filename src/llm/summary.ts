/**
 * A plain-language summary of the schemes the ENGINE found someone eligible for.
 *
 * THE BOUNDARY, BECAUSE THIS IS THE FILE WHERE IT WOULD BE EASIEST TO LOSE
 *
 * The model does not decide who is eligible, does not rank, does not advise, and
 * does not choose which schemes appear. It receives a list the rule engine has
 * already produced and writes a short paragraph describing that list. The
 * authoritative list of scheme cards renders underneath from the engine's own
 * output, whatever this paragraph says.
 *
 * So the worst a compromised, hallucinating or prompt-injected model can do here
 * is produce badly worded prose above a correct list. It cannot tell someone they
 * qualify for something they do not.
 *
 * Three guards enforce that, and each has a test:
 *
 *   Unknown schemes.  Any name-shaped phrase in the output ("… Yojana",
 *                     "… Scheme", "… Card") must appear in the list we supplied.
 *                     A model that names a scheme the engine never produced is
 *                     discarded wholesale.
 *
 *   Invented amounts. No amount, deadline or document is ever sent to the model,
 *                     so any currency figure in the output was invented. The
 *                     scheme names themselves contain amounts ("Rs 5 Lakh
 *                     Insurance Cover To Farmers"), so the check strips the
 *                     known names first and only then looks for money.
 *
 *   Markup and links. Stripped, so nothing can smuggle a clickable destination
 *                     onto the page.
 *
 * On any failure the deterministic summary is used instead — built from the
 * engine's own counts, so it is always available, always correct, and costs
 * nothing.
 */

import type { SchemeMatch } from '../rules/evaluate';
import { fieldLabel } from '../i18n/messages';
import { getProvider, type LlmProvider } from './provider';

export interface SchemeSummary {
  text: string;
  source: 'model' | 'deterministic';
  provider: string | null;
  model: string | null;
  /** Set when the model was asked but its answer was not used. */
  fallback_reason?: string;
}

// ---------------------------------------------------------------- deterministic

function joinNames(names: string[]): string {
  if (names.length === 1) return names[0]!;
  if (names.length === 2) return `${names[0]} and ${names[1]}`;
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}

/**
 * The floor. Built entirely from the engine's own output, so it states exactly
 * what was found and nothing else.
 */
export function deterministicSummary(
  eligible: SchemeMatch[],
  likely: SchemeMatch[],
  /**
   * The engine's true counts.
   *
   * The arrays reaching this function are capped — the match endpoint ships at
   * most 20 of each so a phone is not handed the whole corpus — so counting
   * them understates the answer. The summary said "another 20 may apply" while
   * the heading beside it said 39, and a citizen comparing the two has just
   * been given a reason to trust neither. Falls back to the array lengths when
   * the counts are not supplied.
   */
  counts?: { eligible: number; likely_eligible: number },
): string {
  const parts: string[] = [];
  const nEligible = counts?.eligible ?? eligible.length;
  const nLikely = counts?.likely_eligible ?? likely.length;

  if (nEligible > 0) {
    const shown = eligible.slice(0, 3).map((m) => m.scheme_name);
    const rest = nEligible - shown.length;
    parts.push(
      nEligible === 1
        ? `From what you told us, you meet every condition we could check for ${shown[0]}.`
        : `From what you told us, you meet every condition we could check for ${nEligible} schemes: ${joinNames(shown)}${rest > 0 ? `, and ${rest} more` : ''}.`,
    );
  }

  if (nLikely > 0) {
    // Field labels, never field names. `special_categories` is an identifier in
    // this codebase and gibberish to the citizen reading the sentence.
    const missing = [...new Set(likely.flatMap((m) => m.missing_fields))].map((f) => fieldLabel('en', f));
    parts.push(
      missing.length > 0
        ? `Another ${nLikely} may apply to you — nothing ruled you out, but we still need your ${joinNames(missing.slice(0, 3)).toLowerCase()} to be sure.`
        : `Another ${nLikely} may apply to you, but at least one condition has not been verified by a person yet.`,
    );
  }

  if (parts.length === 0) {
    return 'Nothing we could check matched what you told us. Adding your state, work, income or family often changes that.';
  }

  parts.push('Check each one on its official page before you apply.');
  return parts.join(' ');
}

// ---------------------------------------------------------------- guards

/** Phrases that look like the name of an Indian government scheme. */
const NAME_SHAPED =
  /\b(?:[A-Z][\w'-]*\s+){0,6}(?:Yojana|Yojna|Scheme|Abhiyan|Mission|Nidhi|Card|Pension|Awas|Bima)\b/g;

const MONEY = /(?:₹|\bRs\.?\s*\d|\brupees\b|\blakhs?\b|\bcrores?\b|\b\d[\d,]*\s*(?:INR|rupees)\b)/i;

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

/**
 * True when the text names something that is not in the engine's list.
 *
 * Matching is on normalised substrings in both directions: a model writing
 * "PM-KISAN Scheme" for "Pradhan Mantri Kisan Samman Nidhi (PM-KISAN)" should not
 * trip the guard, but "Ayushman Bharat Yojana" when that was never produced must.
 */
export function mentionsUnknownScheme(text: string, allowedNames: string[]): boolean {
  const allowed = allowedNames.map(norm).filter(Boolean);
  const found = text.match(NAME_SHAPED) ?? [];

  return found.some((phrase) => {
    const p = norm(phrase);
    if (p.length < 6) return false; // "Scheme" or "Card" alone is not a name
    return !allowed.some((a) => a.includes(p) || p.includes(a));
  });
}

/**
 * True when the text contains a money figure that did not come from a scheme
 * name. No amount is ever sent to the model, so anything left over is invented.
 */
export function containsInventedAmount(text: string, allowedNames: string[]): boolean {
  let stripped = text;
  for (const name of allowedNames) {
    // Escape the name for use as a literal pattern.
    stripped = stripped.replace(new RegExp(name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi'), ' ');
  }
  return MONEY.test(stripped);
}

/** Remove anything that could carry markup or a destination onto the page. */
export function sanitise(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const clean = raw
    .replace(/[<>]/g, '')
    .replace(/https?:\/\/\S+/gi, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (clean.length < 20 || clean.length > 700) return null;
  return clean;
}

// ---------------------------------------------------------------- prompt

const SYSTEM = `You write a short, warm summary of government schemes a person has ALREADY been found eligible for by a deterministic rule engine.

You are describing a finished result. You are not deciding anything.

Absolute rules:
- Use ONLY the scheme names given to you. Never mention any other scheme.
- Never state an amount of money, a deadline, a document, or an application step. You have not been told any, so anything you write would be invented.
- Never say someone qualifies for something not in the list, and never cast doubt on something that is.
- Two to four sentences. Plain language a person with limited schooling can read.
- Address the reader as "you".
- End by telling them to confirm on the official page before applying.

Return ONLY a JSON object, with no commentary:
{"summary":"<your paragraph>"}`;

function toModelInput(
  eligible: SchemeMatch[],
  likely: SchemeMatch[],
  counts?: { eligible: number; likely_eligible: number },
) {
  return {
    // The totals the engine found, separate from the (capped) name lists, so a
    // model describing them cannot arrive at a number by counting a truncated
    // array and contradicting the heading next to it.
    total_you_qualify_for: counts?.eligible ?? eligible.length,
    total_you_may_qualify_for: counts?.likely_eligible ?? likely.length,
    you_qualify_for: eligible.map((m) => m.scheme_name),
    you_may_qualify_for: likely.map((m) => m.scheme_name),
    information_still_needed: [...new Set(likely.flatMap((m) => m.missing_fields))]
      .slice(0, 6)
      .map((f) => fieldLabel('en', f).toLowerCase()),
  };
}

function parse(raw: string): string | null {
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  try {
    const parsed = JSON.parse(raw.slice(start, end + 1)) as { summary?: unknown };
    return sanitise(parsed.summary);
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------- entry point

export async function summariseEligible(
  eligible: SchemeMatch[],
  likely: SchemeMatch[],
  opts: { provider?: LlmProvider | null; counts?: { eligible: number; likely_eligible: number } } = {},
): Promise<SchemeSummary> {
  const floor = (reason?: string): SchemeSummary => ({
    text: deterministicSummary(eligible, likely, opts.counts),
    source: 'deterministic',
    provider: null,
    model: null,
    ...(reason ? { fallback_reason: reason } : {}),
  });

  if (eligible.length === 0 && likely.length === 0) return floor();

  const provider = opts.provider !== undefined ? opts.provider : getProvider();
  if (!provider) return floor('no model configured');

  let raw: string;
  try {
    raw = await provider.complete({
      system: SYSTEM,
      user: JSON.stringify(toModelInput(eligible, likely, opts.counts), null, 1),
      maxOutputTokens: 400,
      temperature: 0.2,
    });
  } catch (err) {
    return floor(`model call failed: ${err instanceof Error ? err.message : String(err)}`);
  }

  const text = parse(raw);
  if (!text) return floor('model returned nothing usable');

  const names = [...eligible, ...likely].map((m) => m.scheme_name);
  if (mentionsUnknownScheme(text, names)) return floor('model named a scheme the engine did not produce');
  if (containsInventedAmount(text, names)) return floor('model stated an amount it was never given');

  return { text, source: 'model', provider: provider.name, model: provider.model };
}

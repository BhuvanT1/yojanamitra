/**
 * Parsing money and numbers out of Indian scheme prose.
 *
 * The corpus writes the same amount half a dozen ways:
 *
 *   ₹24,000        ₹ 1.2 lakhs      Rs. 1,00,000
 *   ₹5.00 lakhs    ₹ 20,00,000      Rs 2 crore
 *
 * Indian digit grouping (2,00,000 = two lakh) breaks any parser that assumes
 * three-digit groups, so commas are stripped rather than interpreted, and the
 * lakh/crore multiplier is applied separately.
 */

export interface ParsedAmount {
  value: number;
  /** The exact substring this came from, for the review UI to highlight. */
  text: string;
  index: number;
  /** 1, 1e5 (lakh) or 1e7 (crore) — the multiplier actually applied. */
  multiplier: number;
  /**
   * Whether this figure carried its own "lakh"/"crore" word.
   *
   * Ranges share one multiplier across both bounds: "between ₹1.2 and ₹5 lakhs"
   * means 1.2 LAKH to 5 lakh, but only the second figure spells it out. Callers
   * need to know which bound was bare so they can propagate.
   */
  hadMultiplierWord: boolean;
}

const LAKH = 100_000;
const CRORE = 10_000_000;

const AMOUNT_RE = new RegExp(
  [
    '(?:₹|Rs\\.?|INR)\\s*',
    '([0-9][0-9,]*(?:\\.[0-9]+)?)',
    '\\s*',
    '(lakhs?|lacs?|crores?|thousand)?',
  ].join(''),
  'gi',
);

/** "1.2 lakh" with no currency symbol, which the corpus also uses. */
const BARE_MULTIPLIER_RE = /([0-9][0-9,]*(?:\.[0-9]+)?)\s*(lakhs?|lacs?|crores?)/gi;

function multiplierFor(word: string | undefined): number {
  if (!word) return 1;
  const w = word.toLowerCase();
  if (w.startsWith('lakh') || w.startsWith('lac')) return LAKH;
  if (w.startsWith('crore')) return CRORE;
  if (w === 'thousand') return 1_000;
  return 1;
}

export function parseAmounts(text: string): ParsedAmount[] {
  const out: ParsedAmount[] = [];
  const claimed: [number, number][] = [];

  AMOUNT_RE.lastIndex = 0;
  for (let m = AMOUNT_RE.exec(text); m; m = AMOUNT_RE.exec(text)) {
    const digits = m[1]!.replace(/,/g, '');
    const n = Number(digits);
    if (!Number.isFinite(n)) continue;
    const mult = multiplierFor(m[2]);
    out.push({
      value: n * mult,
      text: m[0],
      index: m.index,
      multiplier: mult,
      hadMultiplierWord: Boolean(m[2]),
    });
    claimed.push([m.index, m.index + m[0].length]);
  }

  BARE_MULTIPLIER_RE.lastIndex = 0;
  for (let m = BARE_MULTIPLIER_RE.exec(text); m; m = BARE_MULTIPLIER_RE.exec(text)) {
    const overlaps = claimed.some(([a, b]) => m!.index >= a && m!.index < b);
    if (overlaps) continue;
    const n = Number(m[1]!.replace(/,/g, ''));
    if (!Number.isFinite(n)) continue;
    const mult = multiplierFor(m[2]);
    out.push({
      value: n * mult,
      text: m[0],
      index: m.index,
      multiplier: mult,
      hadMultiplierWord: Boolean(m[2]),
    });
  }

  return out.sort((a, b) => a.index - b.index);
}

/** Plain integers, for ages and counts. Skips anything inside a money match. */
export function parseIntegers(text: string): ParsedAmount[] {
  const money = parseAmounts(text).map((a) => [a.index, a.index + a.text.length] as const);
  const out: ParsedAmount[] = [];
  const re = /\b(\d{1,3})\b/g;
  for (let m = re.exec(text); m; m = re.exec(text)) {
    if (money.some(([a, b]) => m!.index >= a && m!.index < b)) continue;
    out.push({
      value: Number(m[1]),
      text: m[0],
      index: m.index,
      multiplier: 1,
      hadMultiplierWord: false,
    });
  }
  return out;
}

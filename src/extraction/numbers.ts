/**
 * Numbers and units as citizens actually write them.
 *
 * "1.5 lakh", "१.५ लाख", "2 acres", "11th class", "₹1,50,000", "1.5 ఎకరాలు".
 *
 * Everything here returns the ORIGINAL substring alongside the parsed value, so
 * the extractor can attach it as evidence. A parser that returned only a number
 * would make the correction panel impossible to build.
 */

export interface NumberHit {
  value: number;
  /** Verbatim substring of the input. */
  text: string;
  index: number;
}

/** Devanagari and Telugu digits, mapped to ASCII. */
const DIGIT_MAP: Record<string, string> = {
  '०': '0', '१': '1', '२': '2', '३': '3', '४': '4', '५': '5', '६': '6', '७': '7', '८': '8', '९': '9',
  '౦': '0', '౧': '1', '౨': '2', '౩': '3', '౪': '4', '౫': '5', '౬': '6', '౭': '7', '౮': '8', '౯': '9',
};

/**
 * Rewrite Indic digits to ASCII, preserving length so every index still points
 * at the same character of the original string. Length preservation is what lets
 * evidence spans survive normalisation.
 */
export function asciiDigits(text: string): string {
  let out = '';
  for (const ch of text) out += DIGIT_MAP[ch] ?? ch;
  return out;
}

const MULTIPLIERS: { words: string[]; factor: number }[] = [
  { words: ['crore', 'crores', 'karod', 'करोड़', 'కోటి'], factor: 10_000_000 },
  { words: ['lakh', 'lakhs', 'lac', 'lacs', 'lakhs', 'लाख', 'లక్ష', 'లక్షలు'], factor: 100_000 },
  { words: ['thousand', 'hazaar', 'हजार', 'వేల', 'వెయ్యి'], factor: 1_000 },
];

function multiplierAt(text: string, from: number): { factor: number; end: number } | null {
  const tail = text.slice(from, from + 24).toLowerCase();
  for (const m of MULTIPLIERS) {
    for (const w of m.words) {
      const at = tail.indexOf(w);
      if (at >= 0 && at <= 3) return { factor: m.factor, end: from + at + w.length };
    }
  }
  return null;
}

/**
 * Every number in the text, with any lakh/crore multiplier applied.
 * Commas are stripped rather than interpreted, because Indian digit grouping
 * (1,50,000) breaks three-digit-group assumptions.
 */
export function parseNumbers(text: string): NumberHit[] {
  const ascii = asciiDigits(text);
  const out: NumberHit[] = [];
  // A comma is a digit separator only when a digit follows it, so "52," in a
  // comma-separated list yields "52" and not "52,". Without this the trailing
  // comma travels with the value and every downstream shape check fails.
  const re = /\d(?:[\d,]*\d)?(?:\.\d+)?/g;

  for (let m = re.exec(ascii); m; m = re.exec(ascii)) {
    const raw = m[0];
    const n = Number(raw.replace(/,/g, ''));
    if (!Number.isFinite(n)) continue;

    const after = m.index + raw.length;
    const mult = multiplierAt(ascii, after);
    const end = mult ? mult.end : after;

    out.push({
      value: mult ? n * mult.factor : n,
      // Slice the ORIGINAL, not the ascii-folded copy, so evidence is verbatim.
      text: text.slice(m.index, end).trim(),
      index: m.index,
    });
  }
  return out;
}

/**
 * Markers that a nearby number is money.
 *
 * Includes the income words, not just currency symbols: citizens routinely write
 * "income 40000" with no ₹ and no "lakh". Without these the figure is not
 * recognised as money at all — it is then free to be mistaken for an age, which
 * is exactly what happened before this was widened.
 */
const MONEY_NEAR =
  /(?:₹|\brs\.?|\binr\b|\brupees?\b|रुपये|రూపాయ|\bincome\b|\bearn(?:s|ing|ings)?\b|\bsalary\b|\bwage\b|\baamdani\b|\bkamai\b|आय|आमदनी|कमा|సంపాదన|ఆదాయ)/i;

/** Numbers that look like money: a currency or income marker, or a lakh/crore word. */
export function parseMoney(text: string): NumberHit[] {
  const ascii = asciiDigits(text).toLowerCase();
  return parseNumbers(text).filter((h) => {
    // 18 chars is enough for "annual income " or ", income " before the figure.
    const before = ascii.slice(Math.max(0, h.index - 18), h.index);
    const within = h.text.toLowerCase();
    return (
      MONEY_NEAR.test(before) ||
      MONEY_NEAR.test(within) ||
      MULTIPLIERS.some((m) => m.words.some((w) => within.includes(w)))
    );
  });
}

const ACRE_WORDS = ['acre', 'acres', 'एकड़', 'ఎకరం', 'ఎకరాలు', 'ekad'];
const HECTARE_WORDS = ['hectare', 'hectares', 'हेक्टेयर', 'హెక్టార్'];
const ACRES_PER_HECTARE = 2.47105;

/** Land area, normalised to acres. */
export function parseLandAcres(text: string): NumberHit | null {
  const ascii = asciiDigits(text).toLowerCase();
  for (const h of parseNumbers(text)) {
    const window = ascii.slice(h.index, h.index + h.text.length + 16);

    // End the evidence span at the unit word, not at a fixed offset — otherwise
    // "1.5 acres of land in my village" yields "1.5 acres of land i".
    const unitEnd = (words: string[]): number | null => {
      let best: number | null = null;
      for (const w of words) {
        const at = window.indexOf(w);
        if (at >= 0 && (best === null || at < best)) best = at + w.length;
      }
      return best;
    };

    const acreEnd = unitEnd(ACRE_WORDS);
    if (acreEnd !== null) {
      return {
        value: h.value,
        text: text.slice(h.index, h.index + acreEnd).trim(),
        index: h.index,
      };
    }

    const hectareEnd = unitEnd(HECTARE_WORDS);
    if (hectareEnd !== null) {
      return {
        value: Number((h.value * ACRES_PER_HECTARE).toFixed(3)),
        text: text.slice(h.index, h.index + hectareEnd).trim(),
        index: h.index,
      };
    }
  }
  return null;
}

/**
 * A school class number: "11th class", "class 9", "11వ తరగతి", "कक्षा 8".
 *
 * `educationWords` comes from the lexicon so this works in any language the
 * lexicon covers without changing this function.
 */
export function parseSchoolClass(text: string, educationWords: string[]): NumberHit | null {
  const ascii = asciiDigits(text);
  const lower = ascii.toLowerCase();

  for (const word of educationWords) {
    const w = word.toLowerCase();
    let at = lower.indexOf(w);
    while (at >= 0) {
      // Look both sides: English says "class 9", Telugu and Hindi say "9వ తరగతి".
      //
      // Take the number ADJACENT to the keyword, not the first one in the window.
      // "student, 14, odisha, class 9" put the age inside the look-behind, so a
      // first-match scan read 14, rejected it as out of range, and gave up —
      // losing a class number that was sitting right there.
      const after = ascii.slice(at + w.length, at + w.length + 10);
      const afterM = after.match(/^\W{0,3}(\d{1,2})/);
      if (afterM && afterM[1]) {
        const n = Number(afterM[1]);
        if (n >= 1 && n <= 12) {
          const end = Math.min(ascii.length, at + w.length + after.indexOf(afterM[1]) + afterM[1].length);
          return { value: n, text: text.slice(at, end).trim(), index: at };
        }
      }

      const before = ascii.slice(Math.max(0, at - 12), at);
      const beforeM = before.match(/(\d{1,2})\s*(?:st|nd|rd|th|వ|वीं|वी)?\s*$/);
      if (beforeM && beforeM[1]) {
        const n = Number(beforeM[1]);
        if (n >= 1 && n <= 12) {
          const start = Math.max(0, at - 12) + before.lastIndexOf(beforeM[1]);
          return { value: n, text: text.slice(start, at + w.length).trim(), index: start };
        }
      }
      at = lower.indexOf(w, at + 1);
    }
  }
  return null;
}

/**
 * Age. Requires an explicit age cue or a bare small number that is not doing
 * another job — never a guess from an arbitrary figure.
 */
export function parseAge(text: string, exclude: NumberHit[] = []): NumberHit | null {
  const ascii = asciiDigits(text);
  const lower = ascii.toLowerCase();
  const taken = (h: NumberHit) =>
    exclude.some((e) => h.index >= e.index && h.index < e.index + e.text.length);

  /**
   * Word boundaries are load-bearing here, not tidiness.
   *
   * Without `\b`, "age" matches inside "vill-AGE-" — so
   * "farmer, 33, telangana, 1.5 acres, obc, village, income 1.5 lakh" found the
   * cue inside "village", took the next number, and reported the citizen's age
   * as 1. A wrong value is worse than no value: it produces a confident verdict
   * built on a false fact.
   */
  const cued =
    /\b(?:i am|i'm|age|aged|umar|years? old|saal|saal ka|saal ki|varsh)\b|उम्र|वय\b|వయస్సు|साल|సంవత్సరాల|ఏళ్ల|ఏళ్ళ|సంవత్సర/gi;
  for (let m = cued.exec(lower); m; m = cued.exec(lower)) {
    // Hindi and the Indic languages put the number BEFORE the cue —
    // "33 saal ka", "68 साल", "44 ఏళ్ల" — while English puts it after:
    // "I am 33", "aged 33". Look behind first, then ahead.
    const behind = ascii.slice(Math.max(0, m.index - 10), m.index);
    const bMatch = behind.match(/(\d{1,3})\s*$/);
    if (bMatch && bMatch[1]) {
      const n = Number(bMatch[1]);
      const at = m.index - (behind.length - behind.lastIndexOf(bMatch[1]));
      if (n >= 1 && n <= 120 && !taken({ value: n, text: bMatch[1], index: at })) {
        return { value: n, text: text.slice(at, m.index + m[0].length).trim(), index: at };
      }
    }

    const ahead = ascii.slice(m.index, m.index + 28);
    const fMatch = ahead.match(/(\d{1,3})/);
    if (fMatch && fMatch[1]) {
      const n = Number(fMatch[1]);
      const at = ascii.indexOf(fMatch[1], m.index);
      if (n >= 1 && n <= 120 && !taken({ value: n, text: fMatch[1], index: at })) {
        return { value: n, text: text.slice(m.index, at + fMatch[1].length).trim(), index: m.index };
      }
    }
  }

  // "widow, 52, bihar" — a bare two-digit number in a comma list.
  for (const h of parseNumbers(text)) {
    if (taken(h)) continue;
    if (!/^\d{1,3}$/.test(h.text)) continue;
    if (h.value < 10 || h.value > 110) continue;
    const before = text.slice(Math.max(0, h.index - 2), h.index);
    const after = text.slice(h.index + h.text.length, h.index + h.text.length + 2);
    // Start-of-string counts as a left boundary: "34, maharashtra, village, ..."
    // opens with the age and has no preceding comma.
    const leftOk = h.index === 0 || /[,;]\s*$/.test(before);
    if (leftOk && /^\s*[,;]/.test(after)) return h;
  }
  return null;
}

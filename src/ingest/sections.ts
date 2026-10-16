/**
 * Splitting a scheme page's text into its labelled sections.
 *
 * The page uses a fixed vocabulary of section headings and renders them with no
 * surrounding whitespace, e.g.
 *
 *   ...Sign in to apply Details Objective The scheme aims... Benefits Financial
 *   benefit of Rs. 6000... Eligibility All landholding farmers'... Exclusions The
 *   following categories...
 *
 * Each heading also appears once in the nav bar near the top, and the page
 * repeats a condensed copy of itself at the end. So the parser anchors on the
 * content start marker and takes the FIRST run of headings after it.
 *
 * `Exclusions` being its own section is a gift: it maps directly onto the
 * `exclusion` node of the constraint tree, which is exactly the thing that
 * behaves differently under unknowns.
 */

export const SECTION_HEADINGS = [
  'Details',
  'Benefits',
  'Eligibility',
  'Exclusions',
  'Application Process',
  'Documents Required',
  'Frequently Asked Questions',
  'Sources And References',
] as const;

export type SectionName = (typeof SECTION_HEADINGS)[number];

/** Everything after this is page chrome, not content. */
const TAIL_MARKERS = [
  'Was this helpful?',
  'News and Updates',
  'Powered by',
  'Quick Links',
];

/** Content begins after the apply button block. */
const CONTENT_START = ['Sign in to apply', 'Check Eligibility'];

export interface ParsedSections {
  /** Section name → verbatim text, with spans into the source text. */
  sections: Partial<Record<SectionName, { text: string; start: number; end: number }>>;
  level: 'central' | 'state' | 'unknown';
  state: string | null;
  ministry?: string;
  scheme_name?: string;
  tags: string[];
  last_updated?: string;
  /** Headings the nav bar advertised, used to detect a section we failed to find. */
  advertised: SectionName[];
  warnings: string[];
}

function findContentStart(text: string): number {
  for (const marker of CONTENT_START) {
    const i = text.indexOf(marker);
    if (i >= 0) return i + marker.length;
  }
  return 0;
}

function findTail(text: string, from: number): number {
  let end = text.length;
  for (const marker of TAIL_MARKERS) {
    const i = text.indexOf(marker, from);
    if (i >= 0 && i < end) end = i;
  }
  return end;
}

/** All 28 states and 8 union territories, lowercased for matching. */
export const INDIAN_STATES = [
  'andhra pradesh', 'arunachal pradesh', 'assam', 'bihar', 'chhattisgarh', 'goa',
  'gujarat', 'haryana', 'himachal pradesh', 'jharkhand', 'karnataka', 'kerala',
  'madhya pradesh', 'maharashtra', 'manipur', 'meghalaya', 'mizoram', 'nagaland',
  'odisha', 'punjab', 'rajasthan', 'sikkim', 'tamil nadu', 'telangana', 'tripura',
  'uttar pradesh', 'uttarakhand', 'west bengal',
  'andaman and nicobar islands', 'chandigarh',
  'dadra and nagar haveli and daman and diu', 'delhi', 'jammu and kashmir',
  'ladakh', 'lakshadweep', 'puducherry',
] as const;

/** Exact-ish match of a header prefix against the state list. Never a guess. */
export function matchState(prefix: string): string | null {
  const p = prefix.trim().toLowerCase().replace(/\s+/g, ' ');
  if (!p) return null;
  for (const s of INDIAN_STATES) {
    if (p === s) return s;
  }
  // Some headers read "Government Of Kerala" or "Kerala State".
  for (const s of INDIAN_STATES) {
    if (p.startsWith(`government of ${s}`) || p === `${s} state`) return s;
  }
  return null;
}

/**
 * Index of whichever marker appears first at or after `from`, or text.length.
 *
 * `from` must already be past the anchor text: searching from `ceIdx + 1` finds
 * "Eligibility" inside "Check Eligibility" and collapses the header to nothing.
 */
function firstOf(text: string, from: number, markers: readonly string[]): number {
  let best = text.length;
  for (const m of markers) {
    const i = text.indexOf(m, Math.max(from, 0));
    if (i >= 0 && i < best) best = i;
  }
  return best;
}

/**
 * Substring search that ignores where spaces fall.
 *
 * The page title and the header block are different wrapped lines of the same
 * text, so the scheme name can be "Science And TechnologyAccess To..." in one
 * and "Science And Technology Access To..." in the other. Matching literally
 * fails on roughly every scheme whose header crosses a line break.
 */
export function indexOfIgnoringSpaces(haystack: string, needle: string): number {
  const squash = (s: string) => s.replace(/\s+/g, '');
  const target = squash(needle);
  if (!target) return -1;

  // Map each non-space char of haystack back to its original index.
  const map: number[] = [];
  let squashed = '';
  for (let i = 0; i < haystack.length; i++) {
    if (!/\s/.test(haystack[i]!)) {
      squashed += haystack[i];
      map.push(i);
    }
  }
  const at = squashed.indexOf(target);
  return at < 0 ? -1 : map[at]!;
}

/** Original-string index just past a match found by `indexOfIgnoringSpaces`. */
export function endOfMatchIgnoringSpaces(haystack: string, needle: string, from: number): number {
  const target = needle.replace(/\s+/g, '');
  let seen = 0;
  for (let i = from; i < haystack.length; i++) {
    if (!/\s/.test(haystack[i]!)) seen++;
    if (seen === target.length) return i + 1;
  }
  return haystack.length;
}

/**
 * Tags render as adjacent pills, so they arrive concatenated:
 * "Agricultural InputsAgricultureFarmersIncome SupportKisan".
 * A lowercase-to-uppercase transition is the pill boundary.
 */
export function splitConcatenatedTags(blob: string): string[] {
  const s = blob.trim();
  if (!s) return [];
  // Split at every lowercase/)/] -> uppercase boundary, without inserting a
  // sentinel character (a NUL made this file read as binary to grep and git).
  return s
    .split(/(?<=[a-z)\]])(?=[A-Z])/)
    .map((t) => t.trim())
    .filter((t) => t.length > 1 && t.length < 60);
}

/**
 * The nav bar lists exactly the sections this page has. Reading it first tells
 * us what to look for, and — more usefully — tells us when a section we were
 * promised is missing from the body, which is a parse failure worth counting
 * rather than silently producing a scheme with no eligibility text.
 */
function readNavBar(text: string): SectionName[] {
  const backIdx = text.indexOf('Back');
  if (backIdx < 0) return [];
  const window = text.slice(backIdx, backIdx + 400);
  const found: SectionName[] = [];
  let cursor = 0;
  for (const h of SECTION_HEADINGS) {
    const i = window.indexOf(h, cursor);
    if (i >= 0) {
      found.push(h);
      cursor = i + h.length;
    }
  }
  return found;
}

export function parseSections(text: string): ParsedSections {
  const warnings: string[] = [];
  const advertised = readNavBar(text);
  const contentStart = findContentStart(text);
  const contentEnd = findTail(text, contentStart);
  const body = text.slice(contentStart, contentEnd);

  // Locate each heading in the body, in page order.
  const hits: { name: SectionName; at: number }[] = [];
  for (const h of SECTION_HEADINGS) {
    const i = body.indexOf(h);
    if (i >= 0) hits.push({ name: h, at: i });
  }
  hits.sort((a, b) => a.at - b.at);

  const sections: ParsedSections['sections'] = {};
  for (let i = 0; i < hits.length; i++) {
    const hit = hits[i]!;
    const from = hit.at + hit.name.length;
    const to = i + 1 < hits.length ? hits[i + 1]!.at : body.length;
    const raw = body.slice(from, to).trim();
    if (raw.length === 0) continue;
    sections[hit.name] = {
      text: raw,
      start: contentStart + from,
      end: contentStart + to,
    };
  }

  for (const want of advertised) {
    if (!sections[want]) warnings.push(`nav bar advertised "${want}" but no body section was found`);
  }

  // The page title is the first thing in the text layer, before the sign-out modal.
  // It is the cleanest source for the scheme name — the header block concatenates
  // ministry + name + tags with no separators.
  let scheme_name: string | undefined;
  const titleEnd = text.indexOf('Are you sure you want to sign out?');
  if (titleEnd > 0) scheme_name = text.slice(0, titleEnd).trim();

  // Ministry + name + tags sit between "Check Eligibility" and "Sign in to apply",
  // e.g. "Ministry Of Agriculture and Farmers Welfare" + name + "Agricultural
  // InputsAgricultureFarmersIncome SupportKisan".
  let ministry: string | undefined;
  const tags: string[] = [];
  const ceIdx = text.indexOf('Check Eligibility');
  // "Sign in to apply" is absent on many schemes, so the header is bounded by
  // whichever comes first: that marker, or the first body section heading.
  const headerEnd = firstOf(text, ceIdx + 'Check Eligibility'.length, ['Sign in to apply', ...SECTION_HEADINGS]);
  if (ceIdx >= 0 && headerEnd > ceIdx) {
    const header = text.slice(ceIdx + 'Check Eligibility'.length, headerEnd).trim();
    let rest = header;
    if (scheme_name) {
      // Whitespace-insensitive: the title and the header block come from
      // different wrapped lines, so spaces fall in different places.
      const nameAt = indexOfIgnoringSpaces(header, scheme_name);
      if (nameAt >= 0) {
        const before = header.slice(0, nameAt).trim();
        if (/^Ministry Of/i.test(before)) ministry = before;
        rest = header.slice(endOfMatchIgnoringSpaces(header, scheme_name, nameAt));
      }
    }
    tags.push(...splitConcatenatedTags(rest));
  }

  // The slot before the scheme name holds EITHER "Ministry Of ..." (a central
  // scheme) OR a bare state name (a state scheme). That single distinction gives
  // us `level` and `state` without any inference.
  let level: 'central' | 'state' | 'unknown' = 'unknown';
  let state: string | null = null;
  if (ministry) {
    level = 'central';
  } else if (ceIdx >= 0 && scheme_name) {
    const header = text.slice(ceIdx + 'Check Eligibility'.length, headerEnd).trim();
    const nameAt = indexOfIgnoringSpaces(header, scheme_name);
    const before = nameAt > 0 ? header.slice(0, nameAt).trim() : '';
    const matched = matchState(before);
    if (matched) {
      level = 'state';
      state = matched;
    }
  }

  // Per-scheme freshness. myscheme prints this in the footer; it is the only
  // staleness signal the dataset carries, and it varies per scheme.
  const lu = text.match(/Last Updated On\s*:\s*([0-9]{2}\/[0-9]{2}\/[0-9]{4})/);
  const lastUpdated = lu?.[1];

  if (!sections['Eligibility']) {
    warnings.push('no Eligibility section found');
  }

  return {
    sections,
    level,
    state,
    ministry,
    scheme_name,
    tags,
    last_updated: lastUpdated,
    advertised,
    warnings,
  };
}

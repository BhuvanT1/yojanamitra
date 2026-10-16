/**
 * Script and language detection.
 *
 * Deliberately modest: it reports what script the text is written in, and
 * whether it looks romanised or code-mixed. It does not pretend to tell Hindi
 * from Marathi — both are Devanagari, and guessing between them would give the
 * UI a confident wrong label for no benefit, since extraction matches the
 * lexicon across all languages at once anyway.
 *
 * Detection never gates extraction. A citizen writing in a script we cannot name
 * still gets every lexicon term matched against their text.
 */

export type Script = 'native' | 'romanised' | 'mixed';

export interface Detection {
  /** BCP-47 where confident, 'und' where not. Never a guess. */
  language: string;
  confidence: number;
  script: Script;
  /** Unicode blocks seen, for the UI to pick a font stack. */
  blocks: string[];
}

const BLOCKS: { name: string; language: string; re: RegExp }[] = [
  { name: 'devanagari', language: 'hi', re: /[ऀ-ॿ]/ },
  { name: 'telugu', language: 'te', re: /[ఀ-౿]/ },
  { name: 'tamil', language: 'ta', re: /[஀-௿]/ },
  { name: 'bengali', language: 'bn', re: /[ঀ-৿]/ },
  { name: 'kannada', language: 'kn', re: /[ಀ-೿]/ },
  { name: 'gujarati', language: 'gu', re: /[઀-૿]/ },
  { name: 'malayalam', language: 'ml', re: /[ഀ-ൿ]/ },
  { name: 'odia', language: 'or', re: /[଀-୿]/ },
  { name: 'gurmukhi', language: 'pa', re: /[਀-੿]/ },
];

/**
 * Words that mark romanised Indian-language text — someone typing their own
 * language in Latin script. Used only to label the input, never to translate it.
 */
const ROMANISED_MARKERS = [
  'hai', 'hoon', 'hun', 'nahi', 'mera', 'meri', 'mujhe', 'kya', 'aur',
  'kisan', 'ladki', 'beti', 'beta', 'gaon', 'mazdoor', 'mahila', 'raithu',
  'naa', 'naku', 'undi', 'ledu',
];

export function detectScript(text: string): Detection {
  const blocks: string[] = [];
  const languages: string[] = [];

  for (const b of BLOCKS) {
    if (b.re.test(text)) {
      blocks.push(b.name);
      languages.push(b.language);
    }
  }

  const latinChars = (text.match(/[A-Za-z]/g) ?? []).length;
  const indicChars = BLOCKS.reduce(
    (n, b) => n + (text.match(new RegExp(b.re.source, 'g')) ?? []).length,
    0,
  );

  const lower = ` ${text.toLowerCase()} `;
  const romanised = ROMANISED_MARKERS.some((w) => lower.includes(` ${w} `) || lower.includes(` ${w},`));

  let script: Script;
  if (indicChars > 0 && latinChars > 0) script = 'mixed';
  else if (indicChars > 0) script = 'native';
  else script = romanised ? 'romanised' : 'native';

  // One Indic block and nothing competing: we can name the language.
  if (languages.length === 1 && indicChars >= latinChars) {
    return { language: languages[0]!, confidence: 0.9, script, blocks };
  }
  // Several Indic scripts at once — real, but not something to label confidently.
  if (languages.length > 1) {
    return { language: 'und', confidence: 0.3, script: 'mixed', blocks };
  }
  // Latin only.
  if (romanised) {
    return { language: 'und', confidence: 0.4, script: 'romanised', blocks };
  }
  return { language: 'en', confidence: latinChars > 0 ? 0.7 : 0.2, script, blocks };
}

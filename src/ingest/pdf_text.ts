/**
 * PDF → text.
 *
 * Every file in gov_myscheme is a print-to-PDF of a myscheme.gov.in scheme page,
 * so the text layer carries the whole rendered page: nav bar, sign-in modals,
 * footer, and the actual content, with no spaces between adjacent UI elements.
 *
 * Two facts about the text layer that drive this module:
 *
 *   1. It is stored as hard-wrapped lines. Joining items with '' produces
 *      "CentralGovernment" and "underthe scheme"; joining with ' ' produces the
 *      correct prose. Browsers wrap at spaces, so a space is the right joiner.
 *
 *   2. It is UTF-8 that something along the pipeline read as Latin-1, so ₹ comes
 *      through as "â‚¹" and हिंदी as "à¤¹à¤¿à¤‚à¤¦à¥€". Reversible, and reversed here.
 */

import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';

/**
 * Undo UTF-8-read-as-Latin-1, run by run.
 *
 * Repairing the whole string at once fails on these files: they contain at least
 * one truncated sequence (a smart quote that lost its third byte), which yields
 * U+FFFD and forces us to abandon the repair for the entire document — leaving
 * every ₹ and every Devanagari string mangled.
 *
 * So we find maximal runs of mojibake-looking characters and decode each run
 * independently. A run that won't decode stays as it is; the rest are recovered.
 */
const MOJIBAKE_RUN = /[-ÿŒœŠšŸŽžƒˆ˜–—‘-„†-•…‰‹›€™]+/g;

export function fixMojibake(s: string): string {
  if (!MOJIBAKE_RUN.test(s)) {
    MOJIBAKE_RUN.lastIndex = 0;
    return s;
  }
  MOJIBAKE_RUN.lastIndex = 0;

  return s.replace(MOJIBAKE_RUN, (run) => {
    // Runs of one char are usually legitimate text (é in a name), not mojibake.
    if (run.length < 2) return run;
    try {
      const bytes = Buffer.from(
        Array.from(run, (ch) => {
          const cp = ch.codePointAt(0)!;
          return cp <= 0xff ? cp : cp1252Byte(ch);
        }),
      );
      const decoded = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
      return decoded;
    } catch {
      return run;
    }
  });
}

/** Characters Windows-1252 maps into 0x80–0x9F, which arrive as their Unicode forms. */
const CP1252_REVERSE: Record<string, number> = {
  '€': 0x80, '‚': 0x82, 'ƒ': 0x83, '„': 0x84, '…': 0x85,
  '†': 0x86, '‡': 0x87, 'ˆ': 0x88, '‰': 0x89, 'Š': 0x8a,
  '‹': 0x8b, 'Œ': 0x8c, 'Ž': 0x8e, '‘': 0x91, '’': 0x92,
  '“': 0x93, '”': 0x94, '•': 0x95, '–': 0x96, '—': 0x97,
  '˜': 0x98, '™': 0x99, 'š': 0x9a, '›': 0x9b, 'œ': 0x9c,
  'ž': 0x9e, 'Ÿ': 0x9f,
};

function cp1252Byte(ch: string): number {
  const b = CP1252_REVERSE[ch];
  if (b === undefined) throw new Error('not a cp1252 character');
  return b;
}

/**
 * Zero-width and BOM characters. myscheme's markup uses U+FEFF as a paragraph
 * separator inside sections, which is genuinely useful, so it is converted to a
 * real separator rather than dropped.
 */
const PARA_SEP = ''; // kept out of normal prose, used as an internal marker

export function normaliseText(raw: string): string {
  return (
    raw
      .replace(/﻿/g, PARA_SEP)
      .replace(/​|‌|‍/g, '')
      // non-breaking and other exotic spaces → plain space
      .replace(/[   ]/g, ' ')
      .replace(/[ \t]+/g, ' ')
      .trim()
  );
}

export { PARA_SEP };

export interface PdfText {
  text: string;
  pages: number;
  /** Text items before joining — kept for span debugging. */
  lineCount: number;
}

export async function extractPdfText(data: Uint8Array): Promise<PdfText> {
  const doc = await getDocument({
    data,
    useSystemFonts: true,
    isEvalSupported: false,
    // These PDFs are static page prints; no need for fonts or images.
    disableFontFace: true,
  }).promise;

  const lines: string[] = [];
  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p);
    const content = await page.getTextContent();
    for (const item of content.items) {
      if (!('str' in item)) continue;
      const s = item.str;
      if (s.length === 0) continue;
      lines.push(s);
    }
  }
  await doc.destroy();

  // Join wrapped lines with a space, except across an explicit hyphen break.
  let text = '';
  for (const line of lines) {
    if (text.length === 0) {
      text = line;
      continue;
    }
    if (text.endsWith('-')) text = text.slice(0, -1) + line;
    else text += ' ' + line;
  }

  return {
    text: normaliseText(fixMojibake(text)),
    pages: doc.numPages,
    lineCount: lines.length,
  };
}

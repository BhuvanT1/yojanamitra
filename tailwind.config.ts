import type { Config } from 'tailwindcss';

/**
 * The design system.
 *
 * The brief for the look is "a government service a citizen can trust": calm,
 * literal, high-contrast, nothing decorative that could be mistaken for a claim.
 * The constraints that shaped these tokens:
 *
 *   Verdict colour is never the only signal. Every verdict also carries an icon
 *   and a written label, because a colour-blind citizen, a cheap screen in
 *   sunlight, and a black-and-white printout all have to work.
 *
 *   Contrast is checked against the surface the text actually sits on, not
 *   against white. The tinted verdict backgrounds are pale enough that the
 *   matching text colour clears AA on them.
 *
 *   The type stack leads with the system font and falls through the Noto Indic
 *   families, so Devanagari and Telugu render on a low-end Android rather than
 *   collapsing to boxes.
 */
export default {
  content: ['./src/app/**/*.{ts,tsx}', './src/components/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        ink: { DEFAULT: '#12151b', soft: '#3b434f' },
        /** Cards and controls. */
        paper: '#ffffff',
        /** The page behind the cards, so a white card reads as a raised surface. */
        surface: '#f3f6fa',
        muted: '#5b6472',
        line: { DEFAULT: '#dfe3e9', strong: '#c3ccd8' },

        yes: { DEFAULT: '#136c34', bg: '#e8f5ec', line: '#9ed4b3', deep: '#0d4c24' },
        maybe: { DEFAULT: '#8a5a00', bg: '#fff5e3', line: '#e8c88a', deep: '#6b4600' },
        no: { DEFAULT: '#8c2f27', bg: '#fdeceb', line: '#eeb4b0', deep: '#6b231d' },

        /**
         * The tricolour, used only as a 3px accent rule above the masthead —
         * the visual convention Indian public-service sites share. It is never
         * combined with an emblem or an official wordmark, because this is a
         * student project and must not read as a government service.
         */
        saffron: '#ff9933',
        'india-green': '#138808',

        brand: {
          50: '#eef4fb',
          100: '#dae8f6',
          200: '#b5d0ec',
          300: '#83b0dd',
          400: '#4a88c8',
          DEFAULT: '#134e8f',
          600: '#10447e',
          dark: '#0d3968',
          900: '#0a2a4d',
        },
      },
      fontFamily: {
        sans: [
          'system-ui', '-apple-system', 'Segoe UI', 'Roboto',
          // Indic fallbacks so Devanagari/Telugu render on low-end Android.
          'Noto Sans', 'Noto Sans Devanagari', 'Noto Sans Telugu',
          'Noto Sans Tamil', 'Noto Sans Bengali', 'Noto Sans Kannada',
          'sans-serif',
        ],
        /**
         * Reserved for one thing: the clause quoted out of the scheme document.
         *
         * A serif face is the cheapest way to say "this sentence is not ours" —
         * it reads as a document rather than as interface text, which is exactly
         * the distinction the whole product rests on. Used nowhere else, so it
         * never becomes decoration.
         */
        quote: ['Georgia', 'Noto Serif', 'Noto Serif Devanagari', 'Noto Serif Telugu', 'serif'],
      },
      fontSize: {
        // A display size that still fits a 360px screen without hyphenating.
        display: ['clamp(1.85rem, 1.15rem + 2.6vw, 3.1rem)', { lineHeight: '1.1', letterSpacing: '-0.02em' }],
        lede: ['clamp(1rem, 0.94rem + 0.3vw, 1.175rem)', { lineHeight: '1.6' }],
      },
      boxShadow: {
        // Soft and low. A heavy drop shadow reads as a toy.
        card: '0 1px 2px rgba(16,32,56,.05), 0 2px 8px rgba(16,32,56,.05)',
        lift: '0 2px 4px rgba(16,32,56,.06), 0 12px 28px -8px rgba(16,32,56,.14)',
        hero: '0 4px 10px rgba(16,32,56,.06), 0 24px 48px -16px rgba(16,32,56,.20)',
        // A hairline inside the field, so the input reads as a well rather than
        // a flat rectangle. One pixel; anything more looks like a 2009 form.
        inset: 'inset 0 1px 2px rgba(16,32,56,.06)',
      },
      keyframes: {
        'fade-up': { from: { opacity: '0', transform: 'translateY(8px)' }, to: { opacity: '1', transform: 'none' } },
        pulseRing: {
          '0%': { boxShadow: '0 0 0 0 rgba(140,47,39,.45)' },
          '70%': { boxShadow: '0 0 0 12px rgba(140,47,39,0)' },
          '100%': { boxShadow: '0 0 0 0 rgba(140,47,39,0)' },
        },
        // The listening indicator. Scales about the baseline so the bars grow
        // upward from a common floor like a level meter.
        wave: {
          '0%, 100%': { transform: 'scaleY(.28)' },
          '50%': { transform: 'scaleY(1)' },
        },
      },
      animation: {
        'fade-up': 'fade-up .32s cubic-bezier(.2,.7,.3,1) both',
        ring: 'pulseRing 1.6s ease-out infinite',
        wave: 'wave 1s ease-in-out infinite',
      },
    },
  },
  plugins: [],
} satisfies Config;

/**
 * The summary layer's guardrails.
 *
 * This is the one place a language model writes prose about a citizen's
 * entitlements, so each test here simulates a model behaving badly and asserts
 * the citizen is not misled: naming a scheme that was never produced, inventing
 * an amount, contradicting the engine, injecting markup, or simply failing.
 *
 * The list of schemes is always the engine's. These tests exist to make sure the
 * paragraph above that list cannot quietly become a second, wrong list.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  summariseEligible,
  deterministicSummary,
  mentionsUnknownScheme,
  containsInventedAmount,
  sanitise,
} from '../src/llm/summary.js';
import type { LlmProvider } from '../src/llm/provider.js';
import type { SchemeMatch } from '../src/rules/evaluate.js';

function match(id: string, name: string, over: Partial<SchemeMatch> = {}): SchemeMatch {
  return {
    scheme_id: id,
    scheme_name: name,
    verdict: 'eligible',
    checks: [
      {
        clause_id: `${id}-c1`,
        clause_text: 'All landholding farmers with cultivable land are eligible.',
        source_url: `https://www.myscheme.gov.in/schemes/${id}`,
        status: 'satisfied',
        reason: 'your work is farmer, as this scheme requires',
        missing_fields: [],
      },
    ],
    cited_only: [],
    missing_fields: [],
    source_url: `https://www.myscheme.gov.in/schemes/${id}`,
    ...over,
  };
}

const ELIGIBLE = [
  match('pm-kisan', 'Pradhan Mantri Kisan Samman Nidhi'),
  match('kcc', 'Kisan Credit Card'),
];
const LIKELY = [
  match('rkvy', 'Rashtriya Krishi Vikas Yojana', {
    verdict: 'likely_eligible',
    missing_fields: ['category'],
  }),
];

const fake = (raw: string): LlmProvider => ({ name: 'fake', model: 'test', complete: async () => raw });
const say = (summary: string) => JSON.stringify({ summary });

// ---------------------------------------------------------------- the floor

test('with no provider, the summary still describes the engine’s list', async () => {
  const out = await summariseEligible(ELIGIBLE, LIKELY, { provider: null });

  assert.equal(out.source, 'deterministic');
  assert.match(out.text, /Pradhan Mantri Kisan Samman Nidhi/);
  assert.match(out.text, /Kisan Credit Card/);
  assert.match(out.fallback_reason ?? '', /no model configured/);
});

test('the deterministic text names what was found and what is missing', () => {
  const text = deterministicSummary(ELIGIBLE, LIKELY);
  assert.match(text, /2 schemes/);
  assert.match(text, /Another 1 may apply/);
  assert.match(text, /category/, 'it says which fact would settle the maybes');
  assert.match(text, /official page/, 'and always sends them to the source');
});

test('no matches at all is said plainly, not dressed up', () => {
  const text = deterministicSummary([], []);
  assert.match(text, /Nothing we could check matched/);
  assert.ok(!/qualify for/i.test(text));
});

// ---------------------------------------------------------------- the guards

test('a model cannot introduce a scheme the engine never produced', async () => {
  const provider = fake(
    say('You qualify for Pradhan Mantri Kisan Samman Nidhi and also Ayushman Bharat Yojana. Check the official page.'),
  );
  const out = await summariseEligible(ELIGIBLE, LIKELY, { provider });

  assert.equal(out.source, 'deterministic', 'the whole answer is discarded, not patched');
  assert.match(out.fallback_reason ?? '', /named a scheme/);
  assert.ok(!out.text.includes('Ayushman'), 'and the invented name never reaches the page');
});

test('a model cannot invent an amount it was never given', async () => {
  const provider = fake(
    say('You qualify for Kisan Credit Card, which pays ₹6,000 every year. Check the official page before applying.'),
  );
  const out = await summariseEligible(ELIGIBLE, LIKELY, { provider });

  assert.equal(out.source, 'deterministic');
  assert.match(out.fallback_reason ?? '', /amount/);
  assert.ok(!out.text.includes('6,000'));
});

test('an amount inside a scheme’s own name is not mistaken for an invention', async () => {
  // Several real schemes carry a figure in their legal name. Stripping the known
  // names before looking for money is what keeps this from a false positive.
  const withMoneyName = [match('rs5l', 'Rs 5 Lakh Insurance Cover To Farmers')];
  const provider = fake(
    say('You qualify for Rs 5 Lakh Insurance Cover To Farmers. Please confirm on the official page before applying.'),
  );
  const out = await summariseEligible(withMoneyName, [], { provider });

  assert.equal(out.source, 'model', 'a legitimate name containing a figure must survive');
});

test('markup and links are stripped', async () => {
  const provider = fake(
    say('You qualify for Kisan Credit Card <script>alert(1)</script> apply at https://evil.example now, then check the official page.'),
  );
  const out = await summariseEligible(ELIGIBLE, [], { provider });

  assert.ok(!out.text.includes('<'), 'angle brackets removed');
  assert.ok(!/https?:\/\//.test(out.text), 'links removed');
});

test('an empty, truncated or absurd answer falls back rather than rendering', async () => {
  for (const raw of ['', 'not json', '{"summary":""}', '{"summary":"ok"}', `{"summary":"${'x'.repeat(900)}"}`]) {
    const out = await summariseEligible(ELIGIBLE, [], { provider: fake(raw) });
    assert.equal(out.source, 'deterministic', `should have fallen back on: ${raw.slice(0, 24)}`);
  }
});

test('a provider that throws falls back with the reason recorded', async () => {
  const provider: LlmProvider = {
    name: 'broken',
    model: 'test',
    complete: async () => {
      throw new Error('upstream 503');
    },
  };
  const out = await summariseEligible(ELIGIBLE, [], { provider });
  assert.equal(out.source, 'deterministic');
  assert.match(out.fallback_reason ?? '', /503/);
});

test('well-formed wording is used, and attributed', async () => {
  const provider = fake(
    say('Based on what you told us, you qualify for Pradhan Mantri Kisan Samman Nidhi and Kisan Credit Card. One more may apply once we know your category. Please confirm on the official page before you apply.'),
  );
  const out = await summariseEligible(ELIGIBLE, LIKELY, { provider });

  assert.equal(out.source, 'model');
  assert.equal(out.provider, 'fake');
  assert.match(out.text, /Kisan Credit Card/);
});

test('the summary carries no verdict field the UI could read back', async () => {
  const provider = fake(say('You do not qualify for anything at all, sorry. Check the official page.'));
  const out = await summariseEligible(ELIGIBLE, [], { provider });

  // The engine said eligible. Even if the model contradicts it in prose, there is
  // no machine-readable verdict here — the cards render from the engine's output.
  assert.ok(!('verdict' in out));
  assert.ok(!('schemes' in out));
});

// ------------------------------------------------------------ guard internals

test('the unknown-scheme check is neither too loose nor too strict', () => {
  const names = ['Pradhan Mantri Kisan Samman Nidhi', 'Kisan Credit Card'];

  assert.equal(mentionsUnknownScheme('You qualify for Kisan Credit Card.', names), false);
  assert.equal(
    mentionsUnknownScheme('You qualify for the Kisan Credit Card scheme.', names),
    false,
    'a trailing common noun must not trip it',
  );
  assert.equal(mentionsUnknownScheme('Also try Ayushman Bharat Yojana.', names), true);
  assert.equal(
    mentionsUnknownScheme('Two schemes matched you today.', names),
    false,
    '"schemes" on its own is not a name',
  );
});

test('the amount check ignores names and catches inventions', () => {
  const names = ['Rs 5 Lakh Insurance Cover To Farmers'];
  assert.equal(containsInventedAmount('You qualify for Rs 5 Lakh Insurance Cover To Farmers.', names), false);
  assert.equal(containsInventedAmount('It pays ₹6000 a year.', names), true);
  assert.equal(containsInventedAmount('You may receive 2 lakh rupees.', names), true);
  assert.equal(containsInventedAmount('You qualify for two schemes.', names), false);
});

test('sanitise rejects what is too short or too long', () => {
  assert.equal(sanitise('short'), null);
  assert.equal(sanitise('x'.repeat(800)), null);
  assert.equal(sanitise(42), null);
  assert.equal(sanitise('  a perfectly reasonable summary sentence here  '), 'a perfectly reasonable summary sentence here');
});

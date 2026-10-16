/**
 * Explanation-layer invariants.
 *
 * These are the tests that keep the project's central rule true once a language
 * model is in the loop. Each one simulates a model behaving badly — hallucinating
 * schemes, dropping schemes, contradicting the engine, injecting markup — and
 * asserts that what the citizen sees is still the engine's answer.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { explainMatches, deterministicExplanation } from '../src/llm/explain.js';
import type { LlmProvider } from '../src/llm/provider.js';
import type { SchemeMatch } from '../src/rules/evaluate.js';

function match(over: Partial<SchemeMatch> = {}): SchemeMatch {
  return {
    scheme_id: 'pm-kisan',
    scheme_name: 'Pradhan Mantri Kisan Samman Nidhi',
    verdict: 'eligible',
    checks: [
      {
        clause_id: 'c1',
        clause_text: 'All landholding farmers with cultivable land are eligible.',
        source_url: 'https://www.myscheme.gov.in/schemes/pm-kisan',
        status: 'satisfied',
        reason: 'your occupation is farmer, which is includes farmer',
        missing_fields: [],
      },
    ],
    cited_only: [],
    missing_fields: [],
    source_url: 'https://www.myscheme.gov.in/schemes/pm-kisan',
    ...over,
  };
}

/** A model that returns exactly what `raw` says, whatever that is. */
function fakeProvider(raw: string): LlmProvider {
  return { name: 'fake', model: 'test', complete: async () => raw };
}

// ---------------------------------------------------------------- the floor

test('with no provider configured, every scheme still gets an explanation', async () => {
  const out = await explainMatches([match()], { provider: null });
  assert.equal(out.explanations.length, 1);
  assert.equal(out.explanations[0]!.source, 'deterministic');
  assert.equal(out.provider, null);
  assert.match(out.fallback_reason ?? '', /no model configured/);
});

test('deterministic text names the failing condition for an ineligible verdict', () => {
  const m = match({
    verdict: 'ineligible',
    checks: [
      {
        clause_id: 'c1',
        clause_text: 'x',
        source_url: 'u',
        status: 'violated',
        reason: 'your annual_income_inr is 900000, but this requires at most 700000',
        missing_fields: [],
      },
    ],
  });
  assert.match(deterministicExplanation(m), /do not qualify/);
  assert.match(deterministicExplanation(m), /700000/);
});

// ---------------------------------------------------------------- the guards

test('a model cannot add a scheme the engine never produced', async () => {
  const provider = fakeProvider(
    JSON.stringify({
      explanations: [
        { scheme_id: 'pm-kisan', text: 'You qualify because you farm your own land.' },
        { scheme_id: 'a-scheme-that-does-not-exist', text: 'You also qualify for ₹50,000!' },
      ],
    }),
  );
  const out = await explainMatches([match()], { provider });

  assert.equal(out.explanations.length, 1, 'the list of schemes is the engine’s, not the model’s');
  assert.equal(out.explanations[0]!.scheme_id, 'pm-kisan');
  assert.deepEqual(out.rejected_ids, ['a-scheme-that-does-not-exist']);
  assert.ok(!JSON.stringify(out).includes('50,000'));
});

test('a model that forgets a scheme cannot remove it', async () => {
  const provider = fakeProvider(JSON.stringify({ explanations: [] }));
  const out = await explainMatches([match(), match({ scheme_id: 'kcc', scheme_name: 'Kisan Credit Card' })], {
    provider,
  });
  assert.equal(out.explanations.length, 2, 'both schemes survive');
  assert.ok(out.explanations.every((e) => e.source === 'deterministic'));
});

test('a model contradicting the verdict cannot change it', async () => {
  // The model insists the citizen does NOT qualify; the engine said they do.
  const provider = fakeProvider(
    JSON.stringify({ explanations: [{ scheme_id: 'pm-kisan', text: 'You are not eligible for this.' }] }),
  );
  const engineVerdict = match().verdict;
  const out = await explainMatches([match()], { provider });

  // The wording is shown, but the verdict is never read back from the model.
  assert.equal(out.explanations[0]!.source, 'model');
  assert.equal(engineVerdict, 'eligible', 'the verdict comes from the engine and is untouched');
  assert.ok(!('verdict' in out.explanations[0]!), 'an explanation carries no verdict field to confuse the UI');
});

test('markup and links are stripped from model output', async () => {
  const provider = fakeProvider(
    JSON.stringify({
      explanations: [
        {
          scheme_id: 'pm-kisan',
          text: 'You qualify <script>alert(1)</script> see https://evil.example/claim now',
        },
      ],
    }),
  );
  const out = await explainMatches([match()], { provider });
  const text = out.explanations[0]!.text;
  assert.ok(!text.includes('<'), 'angle brackets removed');
  assert.ok(!/https?:\/\//.test(text), 'links removed — the only URL shown is the scheme source');
});

test('malformed or empty model output falls back, it does not crash', async () => {
  for (const raw of ['', 'not json at all', '{"explanations": "wrong type"}', '{']) {
    const out = await explainMatches([match()], { provider: fakeProvider(raw) });
    assert.equal(out.explanations.length, 1);
    assert.equal(out.explanations[0]!.source, 'deterministic');
  }
});

test('a model that throws falls back with the reason recorded', async () => {
  const provider: LlmProvider = {
    name: 'broken',
    model: 'test',
    complete: async () => {
      throw new Error('upstream 503');
    },
  };
  const out = await explainMatches([match()], { provider });
  assert.equal(out.explanations[0]!.source, 'deterministic');
  assert.match(out.fallback_reason ?? '', /503/);
});

test('an absurdly long or empty sentence is rejected', async () => {
  const provider = fakeProvider(
    JSON.stringify({
      explanations: [
        { scheme_id: 'pm-kisan', text: 'x'.repeat(5000) },
        { scheme_id: 'kcc', text: '' },
      ],
    }),
  );
  const out = await explainMatches([match(), match({ scheme_id: 'kcc' })], { provider });
  assert.ok(out.explanations.every((e) => e.source === 'deterministic'));
});

test('model wording is used when it is well-formed', async () => {
  const provider = fakeProvider(
    JSON.stringify({
      explanations: [{ scheme_id: 'pm-kisan', text: 'You qualify because you own and farm 1.5 acres.' }],
    }),
  );
  const out = await explainMatches([match()], { provider });
  assert.equal(out.explanations[0]!.source, 'model');
  assert.equal(out.explanations[0]!.text, 'You qualify because you own and farm 1.5 acres.');
  assert.equal(out.provider, 'fake');
});

test('the citizen’s raw text is never sent to the model', async () => {
  let seen = '';
  const provider: LlmProvider = {
    name: 'spy',
    model: 'test',
    complete: async (req) => {
      seen = `${req.system}\n${req.user}`;
      return JSON.stringify({ explanations: [] });
    },
  };
  await explainMatches([match()], { provider });

  assert.ok(seen.includes('pm-kisan'), 'the scheme id is sent');
  assert.ok(!seen.includes('I am 33'), 'the raw sentence a citizen typed is not');
  assert.ok(!seen.includes('widow'), 'nor any phrase from it');
});

/**
 * The language-model boundary.
 *
 * Everything that talks to a model goes through this one interface, for the same
 * reason the rule engine is a pure function: so the blast radius is obvious.
 * A model can only ever be handed what `LlmRequest` carries and can only ever
 * return text. It has no access to the corpus, the annotation store, or the
 * verdicts — those are computed before this is called and are not changed after.
 *
 * No SDKs. Each provider is a `fetch` call, so adding a model adds no
 * dependencies and no supply chain.
 *
 * With no API key configured, `getProvider()` returns null and every caller
 * falls back to deterministic text. The app must work with no network and no
 * key: a citizen on a slow connection is the normal case, not the exception.
 */

export interface LlmRequest {
  system: string;
  user: string;
  maxOutputTokens: number;
  /** Low for explanation work — we want the same verdict phrased the same way. */
  temperature: number;
}

export interface LlmProvider {
  name: string;
  model: string;
  complete(req: LlmRequest): Promise<string>;
}

const TIMEOUT_MS = Number(process.env.YM_LLM_TIMEOUT_MS ?? 12000);

/**
 * A model that is slow is a model that is not used: the citizen is looking at a
 * spinner over results the rule engine already produced. Every call is bounded
 * and a timeout falls back to deterministic text rather than blocking.
 */
async function fetchJson(url: string, init: RequestInit): Promise<unknown> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, { ...init, signal: controller.signal });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`${res.status} ${res.statusText}${body ? `: ${body.slice(0, 200)}` : ''}`);
    }
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

function geminiProvider(key: string): LlmProvider {
  const model = process.env.YM_LLM_MODEL ?? 'gemini-2.0-flash';
  return {
    name: 'gemini',
    model,
    async complete(req) {
      const data = (await fetchJson(
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'x-goog-api-key': key },
          body: JSON.stringify({
            systemInstruction: { parts: [{ text: req.system }] },
            contents: [{ role: 'user', parts: [{ text: req.user }] }],
            generationConfig: {
              temperature: req.temperature,
              maxOutputTokens: req.maxOutputTokens,
              responseMimeType: 'application/json',
            },
          }),
        },
      )) as { candidates?: { content?: { parts?: { text?: string }[] } }[] };
      return data.candidates?.[0]?.content?.parts?.[0]?.text ?? '';
    },
  };
}

function openaiProvider(key: string): LlmProvider {
  const model = process.env.YM_LLM_MODEL ?? 'gpt-4o-mini';
  return {
    name: 'openai',
    model,
    async complete(req) {
      const data = (await fetchJson('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
        body: JSON.stringify({
          model,
          temperature: req.temperature,
          max_tokens: req.maxOutputTokens,
          response_format: { type: 'json_object' },
          messages: [
            { role: 'system', content: req.system },
            { role: 'user', content: req.user },
          ],
        }),
      })) as { choices?: { message?: { content?: string } }[] };
      return data.choices?.[0]?.message?.content ?? '';
    },
  };
}

/** No default model id: set YM_LLM_MODEL. Without it this provider is skipped. */
function anthropicProvider(key: string): LlmProvider | null {
  const model = process.env.YM_LLM_MODEL;
  if (!model) return null;
  return {
    name: 'anthropic',
    model,
    async complete(req) {
      const data = (await fetchJson('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-api-key': key,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model,
          max_tokens: req.maxOutputTokens,
          temperature: req.temperature,
          system: req.system,
          messages: [{ role: 'user', content: req.user }],
        }),
      })) as { content?: { text?: string }[] };
      return data.content?.[0]?.text ?? '';
    },
  };
}

/**
 * Pick a provider from the environment. Returns null when no key is set, which
 * is the normal state for this repository — the demo must run offline.
 *
 *   YM_LLM_PROVIDER = gemini | openai | anthropic   (optional; inferred from the key)
 *   GEMINI_API_KEY / OPENAI_API_KEY / ANTHROPIC_API_KEY
 *   YM_LLM_MODEL    override the default model (required with ANTHROPIC_API_KEY)
 */
export function getProvider(): LlmProvider | null {
  const explicit = process.env.YM_LLM_PROVIDER?.toLowerCase();

  const gemini = process.env.GEMINI_API_KEY ?? process.env.GOOGLE_API_KEY;
  const openai = process.env.OPENAI_API_KEY;
  const anthropic = process.env.ANTHROPIC_API_KEY;

  if (explicit === 'gemini' && gemini) return geminiProvider(gemini);
  if (explicit === 'openai' && openai) return openaiProvider(openai);
  if (explicit === 'anthropic' && anthropic) return anthropicProvider(anthropic);

  if (gemini) return geminiProvider(gemini);
  if (openai) return openaiProvider(openai);
  if (anthropic) return anthropicProvider(anthropic);

  return null;
}

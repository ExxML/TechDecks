/**
 * Diagnose a Gemini API key against the real endpoint.
 *
 *   npx tsx scripts/check-key.mts <YOUR_KEY>
 *
 * Prints exactly which stage fails, so a key problem is distinguishable from a
 * client bug. The key is read from argv and never written anywhere.
 */

import { normalizeApiKey, stripModelPrefix } from '../src/lib/gemini/keys';

const BASE = 'https://generativelanguage.googleapis.com/v1beta';

const raw = process.argv[2];
if (!raw) {
  console.error('usage: npx tsx scripts/check-key.mts <API_KEY>');
  process.exit(1);
}

const key = normalizeApiKey(raw);

// Never print the key. Shape only — enough to spot a truncated paste.
console.log(`key: ${key.length} chars, prefix "${key.slice(0, 3)}", ${key.length === raw.length ? 'clean' : `stripped ${raw.length - key.length} invisible char(s)`}`);
console.log('');

/** Read status + the machine-readable reason, never `message`. */
async function describe(res: Response): Promise<string> {
  let reason = '';
  try {
    const body = (await res.clone().json()) as {
      error?: { details?: Array<{ reason?: string }>; status?: string };
    };
    reason =
      body.error?.details?.find((d) => typeof d.reason === 'string')?.reason ??
      body.error?.status ??
      '';
  } catch {
    /* non-JSON body */
  }
  return `${res.status}${reason ? ` ${reason}` : ''}`;
}

console.log('[1/2] GET /models');
const listRes = await fetch(`${BASE}/models?pageSize=200`, {
  headers: { 'x-goog-api-key': key },
});
console.log(`      ${await describe(listRes)}`);

if (!listRes.ok) {
  console.log('');
  console.log('      The key was rejected before any generation was attempted.');
  console.log('      401 ACCESS_TOKEN_TYPE_UNSUPPORTED means Google will not accept this');
  console.log('      credential as an API key for generativelanguage.googleapis.com.');
  console.log('      Check that the Generative Language API is enabled on the key\'s');
  console.log('      project, or mint a fresh key at aistudio.google.com.');
  process.exit(1);
}

const body = (await listRes.json()) as { models?: Array<{ name?: string }> };
const names = (body.models ?? []).map((m) => m.name ?? '').filter(Boolean);
console.log(`      ${names.length} models visible`);

// Defaults to the model the app would pick; pass a second argument to check a
// specific one.
const override = process.argv[3];
const target =
  override ??
  [...names]
    .filter((n) => /flash/i.test(n) && !/preview|exp|thinking|lite|image|tts|audio|live/i.test(n))
    .sort((a, b) => versionOf(b) - versionOf(a))[0] ??
  names[0];

function versionOf(name: string): number {
  const m = /gemini-(\d+)(?:\.(\d+))?/.exec(name);
  return m ? Number(m[1]) * 100 + Number(m[2] ?? 0) : 0;
}

console.log(`      using ${target}${override ? ' (from argv)' : ''}`);
console.log('');

// Exercise the same URL construction the app uses, so a double models/ prefix
// would show up here as a 404 rather than silently in production.
console.log('[2/2] POST :generateContent');
const url = `${BASE}/models/${encodeURIComponent(stripModelPrefix(target))}:generateContent`;
console.log(`      ${url.replace(BASE, '')}`);

const genRes = await fetch(url, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
  body: JSON.stringify({
    contents: [{ role: 'user', parts: [{ text: 'Reply with the single word: ok' }] }],
    generationConfig: {
      temperature: 0.4,
      responseMimeType: 'application/json',
      responseSchema: {
        type: 'OBJECT',
        properties: { reply: { type: 'STRING' } },
        required: ['reply'],
      },
    },
  }),
});
console.log(`      ${await describe(genRes)}`);

if (!genRes.ok) {
  console.log('');
  if (genRes.status === 404) {
    console.log('      This model is listed but not callable on your key. Google retires');
    console.log('      models for new users while leaving them in models.list, so an older');
    console.log('      project can keep using one that a new project cannot.');
    console.log('      The key is fine — pick a newer model.');
  } else {
    console.log('      Listing worked but generation did not, so the key is fine and the');
    console.log('      fault is in the request: model id, schema, or URL construction.');
  }
  process.exit(1);
}

const gen = (await genRes.json()) as {
  candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
};
const text = gen.candidates?.[0]?.content?.parts?.map((p) => p.text ?? '').join('') ?? '';
console.log(`      response: ${text.trim() || '(no text part)'}`);
console.log('');
console.log(text ? 'KEY WORKS — structured output returned.' : 'Model returned no text part.');

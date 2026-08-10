/**
 * Unit checks for the Gemini-adjacent logic that needs no API key.
 *
 *   npx tsx scripts/verify-gemini-logic.ts
 *
 * Covers model filtering, error mapping, the response schema shape, prompt
 * conditional slots, and the requested-kinds validator. The live generation
 * path cannot be exercised without a real key and is verified separately.
 */

import { readFileSync } from 'node:fs';
import { filterTextModels, mapUpstreamError } from '../src/lib/gemini/client';
import { isPlausibleApiKey, normalizeApiKey, stripModelPrefix } from '../src/lib/gemini/keys';
import {
  RequestedKindsSchema,
  buildResponseSchema,
  mcqSetSchema,
  PRESET_KINDS,
} from '../src/lib/gemini/schema';
import { buildPrompt, SYSTEM_INSTRUCTION } from '../src/lib/gemini/prompt';

let failures = 0;
function check(name: string, ok: boolean, detail = ''): void {
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${detail && !ok ? ` — ${detail}` : ''}`);
  if (!ok) failures++;
}

console.log('=== model filtering ===');
{
  const raw = [
    { name: 'models/gemini-2.5-flash', displayName: 'Gemini 2.5 Flash', supportedGenerationMethods: ['generateContent'] },
    { name: 'models/gemini-2.5-pro', displayName: 'Gemini 2.5 Pro', supportedGenerationMethods: ['generateContent'] },
    { name: 'models/text-embedding-004', displayName: 'Embedding', supportedGenerationMethods: ['embedContent'] },
    { name: 'models/imagen-3.0', displayName: 'Imagen 3', supportedGenerationMethods: ['generateContent'] },
    { name: 'models/gemini-2.5-flash-tts', displayName: 'Flash TTS', supportedGenerationMethods: ['generateContent'] },
    { name: 'models/veo-2', displayName: 'Veo 2', supportedGenerationMethods: ['generateContent'] },
    { name: 'models/gemini-2.0-flash-native-audio', displayName: 'Native Audio', supportedGenerationMethods: ['generateContent'] },
    { name: 'models/gemini-1.0-pro', displayName: 'Legacy', supportedGenerationMethods: ['generateContent'] },
    { name: 'models/aqa', displayName: 'AQA', supportedGenerationMethods: ['generateContent'] },
  ];
  const kept = filterTextModels(raw).map((m) => m.name);
  check('keeps flash + pro', kept.includes('models/gemini-2.5-flash') && kept.includes('models/gemini-2.5-pro'));
  check('drops embedding (no generateContent)', !kept.includes('models/text-embedding-004'));
  check('drops imagen', !kept.some((n) => n.includes('imagen')));
  check('drops tts', !kept.some((n) => n.includes('tts')));
  check('drops veo/video', !kept.some((n) => n.includes('veo')));
  check('drops native-audio', !kept.some((n) => n.includes('native-audio')));
  check('drops gemini-1.0 legacy', !kept.includes('models/gemini-1.0-pro'));
  check('drops aqa', !kept.includes('models/aqa'));
  check('exactly 2 survive', kept.length === 2, `got ${kept.length}: ${kept.join(', ')}`);
}

console.log('\n=== upstream error mapping (never forwards upstream text) ===');
{
  const cases: Array<[number, string]> = [
    [400, 'Check your API key'],
    [401, 'Check your API key'],
    [403, 'Check your API key'],
    [429, 'Your Gemini quota is exhausted'],
    [503, 'Model overloaded — try another model'],
    [504, 'Generation took too long — try a Flash-tier model'],
    [500, 'Generation failed — try again'],
  ];
  for (const [status, expected] of cases) {
    const e = mapUpstreamError(status);
    check(`${status} -> "${expected}"`, e.userMessage === expected, e.userMessage);
  }

  const tokenType = mapUpstreamError(401, 'ACCESS_TOKEN_TYPE_UNSUPPORTED');
  check(
    'ACCESS_TOKEN_TYPE_UNSUPPORTED gets its own message',
    tokenType.userMessage !== 'Check your API key',
  );
  // AI Studio no longer issues `AIza` keys, so the message must not ask for one.
  check(
    'that message does not tell the user to use an AIza key',
    !/AIza/.test(tokenType.userMessage),
    tokenType.userMessage,
  );
  check(
    'that message does not call the key an OAuth token',
    !/OAuth/i.test(tokenType.userMessage),
    tokenType.userMessage,
  );
}

console.log('\n=== key handling: never validate by prefix ===');
{
  // AI Studio issues `AQ.` authorization keys and `AIza` keys are rejected from
  // September 2026, so a prefix check would block the format users can create.
  const aq = 'AQ.Ab8RN6JzEXAMPLEEXAMPLEEXAMPLEEXAMPLE1234567890';
  const aiza = 'AIzaSyEXAMPLEEXAMPLEEXAMPLEEXAMPLE12345';

  check('accepts an AQ. authorization key', isPlausibleApiKey(normalizeApiKey(aq)));
  check('accepts an AIza standard key', isPlausibleApiKey(normalizeApiKey(aiza)));
  check('accepts an unknown future prefix', isPlausibleApiKey(normalizeApiKey('ZZ.something-new-and-long-enough')));
  check('rejects something too short to be a key', !isPlausibleApiKey('abc'));

  const keysSrc = readFileSync('src/lib/gemini/keys.ts', 'utf8');
  const dialogSrc = readFileSync('src/components/ApiKeyDialog.tsx', 'utf8');
  check('key helpers do not branch on a prefix', !/startsWith\(['"]A/.test(keysSrc));
  check('dialog does not branch on a key prefix', !/startsWith\(['"]A/.test(dialogSrc));

  check('normalizeApiKey strips a zero-width space', normalizeApiKey(`${aiza}​`) === aiza);
  check('normalizeApiKey strips a BOM', normalizeApiKey(`﻿${aiza}`) === aiza);
  check('normalizeApiKey strips surrounding whitespace', normalizeApiKey(`  ${aiza}\n`) === aiza);
  check('normalizeApiKey preserves the dot in an AQ. key', normalizeApiKey(aq) === aq);
}

console.log('\n=== model path: no double models/ prefix ===');
{
  // models.list returns name already prefixed ("models/gemini-2.5-flash"), and
  // the picker submits that value verbatim. Interpolating it after a hardcoded
  // /models/ yields /models/models%2F... and a 404.
  check('strips the models/ prefix', stripModelPrefix('models/gemini-2.5-flash') === 'gemini-2.5-flash');
  check('leaves a bare id alone', stripModelPrefix('gemini-2.5-flash') === 'gemini-2.5-flash');

  const clientSrc = readFileSync('src/lib/gemini/client.ts', 'utf8');
  check('generateContent URL strips the prefix', /stripModelPrefix\(args\.model\)/.test(clientSrc));
}

console.log('\n=== a plain 401 is still a key problem ===');
{
  check('a plain 401 says "Check your API key"', mapUpstreamError(401).userMessage === 'Check your API key');
}

console.log('\n=== a listed-but-retired model 404s ===');
{
  // A model can advertise generateContent in models.list and still 404, so the
  // 404 has to be actionable rather than generic.
  const e = mapUpstreamError(404);
  check('404 has its own message', e.userMessage !== 'Generation failed — try again');
  check('404 tells the user to pick another model', /pick another/i.test(e.userMessage), e.userMessage);

  // Nothing on a models.list entry marks a model retired, so filtering cannot
  // detect it and the picker keeps offering them.
  const listed = [
    { name: 'models/gemini-2.5-flash', displayName: 'Gemini 2.5 Flash', supportedGenerationMethods: ['generateContent'] },
    { name: 'models/gemini-3.6-flash', displayName: 'Gemini 3.6 Flash', supportedGenerationMethods: ['generateContent'] },
  ];
  const kept = filterTextModels(listed).map((m) => m.name);
  check(
    'retired-but-listed models are still offered (only a live call can know)',
    kept.includes('models/gemini-2.5-flash') && kept.includes('models/gemini-3.6-flash'),
    kept.join(','),
  );
}

console.log('\n=== pasted-key normalization ===');
{
  const key = 'AIzaSy' + 'A'.repeat(33);
  check('strips a trailing newline', normalizeApiKey(key + '\n') === key);
  check('strips surrounding spaces', normalizeApiKey('  ' + key + '  ') === key);
  check('strips a zero-width space (survives .trim())', normalizeApiKey(key + '​') === key);
  check('strips a BOM', normalizeApiKey('﻿' + key) === key);
  check('strips a bidi mark', normalizeApiKey(key + '‎') === key);
  check('leaves a clean key untouched', normalizeApiKey(key) === key);
  // The failure this prevents: a >255 code point makes new Headers() throw.
  let threw = false;
  try {
    new Headers({ 'x-goog-api-key': key + '​' });
  } catch {
    threw = true;
  }
  check('an un-normalized key would have thrown in Headers()', threw);
  let ok = true;
  try {
    new Headers({ 'x-goog-api-key': normalizeApiKey(key + '​') });
  } catch {
    ok = false;
  }
  check('the normalized key builds a valid header', ok);
}

console.log('\n=== thinkingConfig must never be sent ===');
{
  // Guard against a future edit reintroducing it: grep the client source.
  const src = readFileSync('src/lib/gemini/client.ts', 'utf8');
  const sends = /thinkingConfig\s*:/.test(src) && !/NOTE|deliberately|Do not add/.test(src);
  check('client.ts does not send thinkingConfig', !sends);
  check('temperature is 0.4', /temperature:\s*0\.4/.test(src));
}

console.log('\n=== responseSchema shape ===');
{
  const s = buildResponseSchema(4) as unknown as {
    properties: { questions: { minItems: number; maxItems: number; items: { propertyOrdering: string[] } } };
  };
  check('minItems/maxItems track kind count', s.properties.questions.minItems === 4 && s.properties.questions.maxItems === 4);
  const order = s.properties.questions.items.propertyOrdering;
  check(
    'explanation precedes correct_index',
    order.indexOf('explanation') < order.indexOf('correct_index'),
    order.join(','),
  );
  const two = buildResponseSchema(2) as unknown as { properties: { questions: { maxItems: number } } };
  check('schema is not hardcoded to 4', two.properties.questions.maxItems === 2);
}

console.log('\n=== RequestedKindsSchema ===');
{
  check('accepts the preset four', RequestedKindsSchema.safeParse([...PRESET_KINDS]).success);
  check('accepts 1 kind', RequestedKindsSchema.safeParse(['bottleneck']).success);
  check('accepts 8 kinds', RequestedKindsSchema.safeParse(['a','b','c','d','e','f','g','h']).success);
  check('rejects 0 kinds', !RequestedKindsSchema.safeParse([]).success);
  check('rejects 9 kinds', !RequestedKindsSchema.safeParse(['a','b','c','d','e','f','g','h','i']).success);
  check('rejects duplicates (case-insensitive)', !RequestedKindsSchema.safeParse(['approach','APPROACH']).success);
  check('rejects a 41-char kind', !RequestedKindsSchema.safeParse(['x'.repeat(41)]).success);
}

console.log('\n=== mcqSetSchema echoes requested kinds ===');
{
  const mk = (kind: string) => ({
    kind,
    question: 'What is the optimal approach here?',
    options: [{ text: 'a' }, { text: 'b' }, { text: 'c' }, { text: 'd' }],
    explanation: 'Because of the invariant.',
    correct_index: 0,
  });

  const four = mcqSetSchema([...PRESET_KINDS]);
  check('accepts matching kinds in order', four.safeParse({ questions: PRESET_KINDS.map(mk) }).success);
  check(
    'rejects reordered kinds',
    !four.safeParse({ questions: ['algorithm','approach','complexity','solution'].map(mk) }).success,
  );
  check('rejects a short set', !four.safeParse({ questions: PRESET_KINDS.slice(0, 3).map(mk) }).success);
  check('rejects a renamed kind', !four.safeParse({ questions: ['approach','algorithm','complexity','answer'].map(mk) }).success);

  const three = mcqSetSchema(['bottleneck', 'tradeoffs', 'failure modes']);
  check(
    'accepts 3 author-defined kinds (nothing hardcodes 4)',
    three.safeParse({ questions: ['bottleneck','tradeoffs','failure modes'].map(mk) }).success,
  );

  const bad = { questions: [{ ...mk('approach'), options: [{ text: 'a' }, { text: 'b' }, { text: 'c' }] }] };
  check('rejects 3 options', !mcqSetSchema(['approach']).safeParse(bad).success);
  const oob = { questions: [{ ...mk('approach'), correct_index: 4 }] };
  check('rejects correct_index out of range', !mcqSetSchema(['approach']).safeParse(oob).success);
}

console.log('\n=== prompt conditional slots ===');
{
  const base = {
    title: 'Two Sum',
    difficulty: 'easy',
    tags: ['array'],
    bodyText: 'Given an array...',
    kinds: [...PRESET_KINDS] as string[],
  };

  const withLang = buildPrompt({ ...base, language: 'Python3', signature: 'class Solution:\n  def twoSum(self)' });
  check('includes language when provided', withLang.includes('Target language') && withLang.includes('Python3'));
  check('pins the signature', withLang.includes('def twoSum'));

  const noLang = buildPrompt({ ...base, language: null, signature: null });
  check('omits the language slot entirely when absent', !noLang.includes('Target language'));
  check(
    'drops code-block assertion and asks for prose instead',
    noLang.includes('precise prose or pseudocode'),
  );

  const noSolution = buildPrompt({ ...base, kinds: ['bottleneck'], language: null });
  check('no prose fallback when solution kind not requested', !noSolution.includes('precise prose or pseudocode'));

  const hinted = buildPrompt({ ...base, hints: ['Use a hash map'], language: null });
  check('includes hints when present (grounding ladder tier 2)', hinted.includes('Use a hash map'));
  check('omits hints section when empty', !buildPrompt({ ...base, hints: [], language: null }).includes('Hints from'));

  check('kind list is numbered in requested order', /1\. kind = "approach"/.test(withLang) && /4\. kind = "solution"/.test(withLang));
  check('system instruction forbids meta-references', SYSTEM_INSTRUCTION.includes('Never mention'));
  check('system instruction requires internal derivation first', SYSTEM_INSTRUCTION.includes('STAGE 1'));
}

console.log('');
if (failures > 0) {
  console.log(`FAILED — ${failures} check(s)`);
  process.exit(1);
}
console.log('ALL CHECKS PASSED');

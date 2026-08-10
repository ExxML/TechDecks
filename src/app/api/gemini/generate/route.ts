import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { fetchItemById } from '@/lib/queries';
import { sanitizeProblemHtml } from '@/lib/sanitize';
import {
  GenerateRequestSchema,
  buildResponseSchema,
  kindsForItem,
  mcqSetSchema,
} from '@/lib/gemini/schema';
import { SYSTEM_INSTRUCTION, buildPrompt, PROMPT_VERSION } from '@/lib/gemini/prompt';
import { GeminiError, generateJson, ATTEMPT_TIMEOUT_MS } from '@/lib/gemini/client';
import { sameOriginOk, rateLimitOk } from '@/lib/gemini/guard';
import { resolveGeminiKey } from '@/lib/gemini/resolveKey';

/**
 * Generates, validates, and returns. This route never writes to the database —
 * persistence is the caller's job, so wanting the service-role key here means
 * the contract has been read backwards.
 */

/** Requires fluid compute on the Vercel project; without it the ceiling
 *  silently drops to 60s. */
export const maxDuration = 300;

const ROUTE_BUDGET_MS = 280_000; // leave headroom under maxDuration

/** Strip tags for the prompt — the model does not need markup, and HTML wastes
 *  tokens. Sanitize first: this is untrusted scraped content. */
function htmlToText(html: string | null): string {
  if (!html) return '';
  const clean = sanitizeProblemHtml(html) ?? '';
  return clean
    .replace(/<\/(p|div|li|pre|tr|h[1-6])>/gi, '\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export async function POST(request: Request) {
  const startedAt = Date.now();

  if (!sameOriginOk(request)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  if (!rateLimitOk(request)) {
    return NextResponse.json(
      { error: 'Too many generations — wait a few minutes' },
      { status: 429 },
    );
  }

  // Signed-in users' keys come from Vault, read server-side; anonymous users
  // send one in a header. Either way the key exists only on the server.
  const apiKey = await resolveGeminiKey(request);
  if (!apiKey) {
    return NextResponse.json({ error: 'Add your Gemini API key in Settings' }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid request' }, { status: 400 });
  }

  // This route is a public surface, so the client-supplied kind list is
  // validated here rather than trusted.
  const parsed = GenerateRequestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid request' }, { status: 400 });
  }
  const { contentItemId, model, language } = parsed.data;

  // Read the problem with the caller's own RLS-scoped session, so this route
  // cannot be used to read a private problem the caller may not see.
  const db = await createClient();
  const item = await fetchItemById(db, contentItemId);
  if (!item) {
    return NextResponse.json({ error: 'Problem not found' }, { status: 404 });
  }

  // Derived from the STORED item, never from the request body: a synced problem
  // always generates the preset four, and "the user does not choose" is not a
  // rule if the client can override it. The request's `kinds` is validated by
  // RequestedKindsSchema and then ignored in favour of this.
  const { kinds } = kindsForItem(item);

  // Authored problems carry no codeSnippets, so `chosen` is undefined and the
  // prompt's signature slot is omitted rather than sent empty.
  const snippets = item.metadata.codeSnippets ?? [];
  const chosen = language ? snippets.find((s) => s.langSlug === language) : undefined;

  const bodyText =
    item.body_format === 'markdown' ? (item.body_html ?? '') : htmlToText(item.body_html);

  const prompt = buildPrompt({
    title: item.title,
    difficulty: item.difficulty,
    tags: item.tags.map((t) => t.name),
    bodyText,
    kinds,
    language: chosen?.lang ?? language,
    signature: chosen?.code ?? null,
    hints: item.metadata.hints ?? [],
    exampleTestcases: item.metadata.exampleTestcases ?? null,
  });

  const responseSchema = buildResponseSchema(kinds.length);
  const validator = mcqSetSchema(kinds);

  try {
    const first = await generateJson({
      apiKey,
      model,
      systemInstruction: SYSTEM_INSTRUCTION,
      prompt,
      responseSchema,
    });

    const firstResult = validate(first, validator);
    if (firstResult.ok) {
      return NextResponse.json({
        questions: firstResult.questions,
        model,
        language,
        prompt_version: PROMPT_VERSION,
      });
    }

    // ONE repair retry, and only if the remaining budget can absorb another
    // full generation — the retry shares this request's wall clock.
    const elapsed = Date.now() - startedAt;
    if (elapsed * 2 > ROUTE_BUDGET_MS) {
      return NextResponse.json(
        { error: 'Generation took too long — try a Flash-tier model' },
        { status: 504 },
      );
    }

    const repaired = await generateJson({
      apiKey,
      model,
      systemInstruction: SYSTEM_INSTRUCTION,
      prompt: `${prompt}\n\n# Correction\n\nYour previous response failed validation:\n${firstResult.error}\n\nReturn the full corrected JSON. Emit exactly these kinds, in order: ${kinds.join(', ')}.`,
      responseSchema,
      timeoutMs: Math.min(ATTEMPT_TIMEOUT_MS, ROUTE_BUDGET_MS - (Date.now() - startedAt)),
    });

    const second = validate(repaired, validator);
    if (!second.ok) {
      return NextResponse.json(
        { error: 'The model returned malformed questions — try again or pick another model' },
        { status: 502 },
      );
    }

    // Only validated JSON is ever returned, so malformed output cannot reach
    // the caller's storage.
    return NextResponse.json({
      questions: second.questions,
      model,
      language,
      prompt_version: PROMPT_VERSION,
    });
  } catch (err) {
    const e = err instanceof GeminiError ? err : new GeminiError('Generation failed — try again', 502);
    // Fixed strings only. Never `err.message` from upstream: Google echoes the
    // API key in some error bodies.
    return NextResponse.json({ error: e.userMessage }, { status: e.status });
  }
}

type ValidateResult =
  | { ok: true; questions: unknown }
  | { ok: false; error: string };

function validate(raw: string, validator: ReturnType<typeof mcqSetSchema>): ValidateResult {
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return { ok: false, error: 'Response was not valid JSON.' };
  }
  const result = validator.safeParse(json);
  if (!result.success) {
    return {
      ok: false,
      error: result.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '),
    };
  }
  return { ok: true, questions: result.data.questions };
}

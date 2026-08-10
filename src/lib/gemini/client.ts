/**
 * Gemini REST client. Server-side only — never import from a client component.
 *
 * The user's API key passes through here and must never be logged, echoed in an
 * error response, or returned in a payload. Google's upstream errors can
 * contain the key, which is why `mapUpstreamError` maps status codes to fixed
 * strings instead of forwarding any upstream text.
 */

import { stripModelPrefix } from './keys';

const BASE = 'https://generativelanguage.googleapis.com/v1beta';

/** Attempt-one ceiling, so it cannot eat the whole 300s route budget. */
export const ATTEMPT_TIMEOUT_MS = 120_000;

export class GeminiError extends Error {
  constructor(
    /** Safe to show a user. Never contains upstream text. */
    readonly userMessage: string,
    readonly status: number,
  ) {
    super(userMessage);
    this.name = 'GeminiError';
  }
}

/**
 * Map upstream status onto a fixed set of user-facing strings.
 *
 * Deliberately ignores the upstream body. Google echoes the API key in some
 * 400 responses, so forwarding that text would leak the key into the browser.
 */
export function mapUpstreamError(status: number, reason?: string): GeminiError {
  // Returned when Google will not accept the credential as an API key at all,
  // which is a different problem from a wrong key. Often a project without the
  // Generative Language API enabled.
  if (reason === 'ACCESS_TOKEN_TYPE_UNSUPPORTED') {
    return new GeminiError(
      'Google rejected this key for the Gemini API. Check that the Generative Language API is enabled for its project, or create a new key at aistudio.google.com.',
      401,
    );
  }
  if (status === 400 || status === 401 || status === 403) {
    return new GeminiError('Check your API key', 400);
  }
  // models.list advertises models the endpoint refuses: Google retires older
  // ones for new users while leaving them listed and callable by projects that
  // already used them. The fix is always to choose a different model.
  if (status === 404) {
    return new GeminiError('That model is not available on your key — pick another', 404);
  }
  if (status === 429) {
    return new GeminiError('Your Gemini quota is exhausted', 429);
  }
  if (status === 503) {
    return new GeminiError('Model overloaded — try another model', 503);
  }
  if (status === 504) {
    return new GeminiError('Generation took too long — try a Flash-tier model', 504);
  }
  return new GeminiError('Generation failed — try again', 502);
}

/**
 * Extract ONLY the machine-readable `reason` enum from an error body.
 *
 * Reads a fixed enum field and nothing else — never `message`, which is the
 * field that can echo the API key back. The value is matched against a
 * known-safe allow-list so an unexpected upstream string can never reach the
 * user or a log.
 */
const KNOWN_REASONS = new Set([
  'API_KEY_INVALID',
  'ACCESS_TOKEN_TYPE_UNSUPPORTED',
  'API_KEY_SERVICE_BLOCKED',
  'API_KEY_HTTP_REFERRER_BLOCKED',
  'API_KEY_IP_ADDRESS_BLOCKED',
  'SERVICE_DISABLED',
  'RATE_LIMIT_EXCEEDED',
]);

async function readErrorReason(res: Response): Promise<string | undefined> {
  const reason = await extractReason(res);
  // Diagnostic breadcrumb: status + the allow-listed reason enum, and nothing
  // else. The key never appears, and `message` — the field that can echo it —
  // is never read. Safe to leave on; it is what makes a failed key debuggable
  // instead of a silent "Check your API key".
  console.warn(`[gemini] upstream ${res.status}${reason ? ` reason=${reason}` : ''}`);
  return reason;
}

async function extractReason(res: Response): Promise<string | undefined> {
  try {
    const body: unknown = await res.clone().json();
    if (typeof body !== 'object' || body === null) return undefined;
    const err = (body as { error?: unknown }).error;
    if (typeof err !== 'object' || err === null) return undefined;
    const details = (err as { details?: unknown }).details;
    if (!Array.isArray(details)) return undefined;
    for (const d of details) {
      if (typeof d === 'object' && d !== null) {
        const reason = (d as { reason?: unknown }).reason;
        if (typeof reason === 'string' && KNOWN_REASONS.has(reason)) return reason;
      }
    }
  } catch {
    // Unparseable body: fall back to status-only mapping.
  }
  return undefined;
}

export type GeminiModel = {
  readonly name: string;
  readonly displayName: string;
};

type RawModel = {
  name?: unknown;
  displayName?: unknown;
  supportedGenerationMethods?: unknown;
};

/**
 * Exclude non-text output modalities.
 *
 * models.list does not reliably expose an output-modality field, so this is a
 * name-pattern heuristic — and it is a heuristic, which is why the generate
 * path also fails safe when a model returns no text part.
 */
const NON_TEXT_PATTERN = /image|imagen|tts|audio|native-audio|veo|video|embedding|aqa/i;
const LEGACY_PATTERN = /gemini-1\.0|text-bison|chat-bison|palm/i;

export function filterTextModels(raw: readonly unknown[]): GeminiModel[] {
  const out: GeminiModel[] = [];
  for (const entry of raw) {
    if (typeof entry !== 'object' || entry === null) continue;
    const m = entry as RawModel;
    const name = typeof m.name === 'string' ? m.name : '';
    const displayName = typeof m.displayName === 'string' ? m.displayName : name;
    if (!name) continue;

    // 1. Must support generateContent — excludes embedding models.
    const methods = Array.isArray(m.supportedGenerationMethods)
      ? m.supportedGenerationMethods.filter((x): x is string => typeof x === 'string')
      : [];
    if (!methods.includes('generateContent')) continue;

    // 2. Exclude non-text output modalities by name pattern.
    if (NON_TEXT_PATTERN.test(name) || NON_TEXT_PATTERN.test(displayName)) continue;

    // 3. Exclude deprecated/legacy families.
    if (LEGACY_PATTERN.test(name)) continue;

    out.push({ name, displayName });
  }
  return out;
}

export async function listModels(apiKey: string): Promise<GeminiModel[]> {
  let res: Response;
  try {
    res = await fetch(`${BASE}/models?pageSize=200`, {
      headers: { 'x-goog-api-key': apiKey },
      signal: AbortSignal.timeout(20_000),
    });
  } catch {
    throw new GeminiError('Could not reach Gemini — check your connection', 502);
  }
  if (!res.ok) throw mapUpstreamError(res.status, await readErrorReason(res));

  const body: unknown = await res.json();
  const models =
    typeof body === 'object' && body !== null && Array.isArray((body as { models?: unknown }).models)
      ? ((body as { models: unknown[] }).models)
      : [];
  return filterTextModels(models);
}

export type GenerateArgs = {
  readonly apiKey: string;
  readonly model: string;
  readonly systemInstruction: string;
  readonly prompt: string;
  readonly responseSchema: unknown;
  readonly timeoutMs?: number;
};

/**
 * One generateContent call returning the raw text part.
 *
 * `thinkingConfig` is deliberately absent — do not add it. `thinkingBudget: 0`
 * hard-fails on Pro-tier models and strips the reasoning that answer accuracy
 * depends on. Omitting it inherits Google's per-model default.
 */
export async function generateJson(args: GenerateArgs): Promise<string> {
  // models.list returns `name` already prefixed and the picker submits it
  // verbatim, so strip it here to avoid a doubled `models/models/` path.
  const url = `${BASE}/models/${encodeURIComponent(stripModelPrefix(args.model))}:generateContent`;

  let res: Response;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': args.apiKey,
      },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: args.systemInstruction }] },
        contents: [{ role: 'user', parts: [{ text: args.prompt }] }],
        generationConfig: {
          temperature: 0.4,
          responseMimeType: 'application/json',
          responseSchema: args.responseSchema,
        },
      }),
      signal: AbortSignal.timeout(args.timeoutMs ?? ATTEMPT_TIMEOUT_MS),
    });
  } catch (err) {
    if (err instanceof Error && err.name === 'TimeoutError') {
      throw new GeminiError('Generation took too long — try a Flash-tier model', 504);
    }
    throw new GeminiError('Could not reach Gemini — check your connection', 502);
  }

  if (!res.ok) throw mapUpstreamError(res.status, await readErrorReason(res));

  const body: unknown = await res.json();
  const text = extractText(body);
  if (text === null) {
    // Fail safe rather than auto-correcting the selection: an image/TTS model
    // that slipped past the name filter lands here.
    throw new GeminiError("That model doesn't support structured text output — pick another", 422);
  }
  return text;
}

/** Pull the first text part out of the candidates envelope. */
function extractText(body: unknown): string | null {
  if (typeof body !== 'object' || body === null) return null;
  const candidates = (body as { candidates?: unknown }).candidates;
  if (!Array.isArray(candidates) || candidates.length === 0) return null;

  const first = candidates[0];
  if (typeof first !== 'object' || first === null) return null;
  const content = (first as { content?: unknown }).content;
  if (typeof content !== 'object' || content === null) return null;
  const parts = (content as { parts?: unknown }).parts;
  if (!Array.isArray(parts)) return null;

  const chunks: string[] = [];
  for (const p of parts) {
    if (typeof p === 'object' && p !== null && typeof (p as { text?: unknown }).text === 'string') {
      chunks.push((p as { text: string }).text);
    }
  }
  return chunks.length > 0 ? chunks.join('') : null;
}

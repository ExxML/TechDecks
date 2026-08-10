import { NextResponse } from 'next/server';
import { GeminiError, listModels } from '@/lib/gemini/client';
import { readApiKey, sameOriginOk, rateLimitOk } from '@/lib/gemini/guard';

/**
 * Proxied because generativelanguage.googleapis.com rejects browser fetches
 * carrying the headers the API needs.
 */
export const maxDuration = 30;

export async function GET(request: Request) {
  if (!sameOriginOk(request)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  // Cheaper than generate, so a looser bucket.
  if (!rateLimitOk(request, 30)) {
    return NextResponse.json({ error: 'Too many requests — wait a moment' }, { status: 429 });
  }

  const apiKey = readApiKey(request);
  if (!apiKey) {
    return NextResponse.json({ error: 'Add your Gemini API key in Settings' }, { status: 401 });
  }

  try {
    const models = await listModels(apiKey);
    return NextResponse.json(
      { models },
      // Private: the response is tied to the caller's key.
      { headers: { 'Cache-Control': 'private, max-age=86400' } },
    );
  } catch (err) {
    // Only ever the mapped message — upstream text can contain the API key.
    const e = err instanceof GeminiError ? err : new GeminiError('Could not load models', 502);
    return NextResponse.json({ error: e.userMessage }, { status: e.status });
  }
}

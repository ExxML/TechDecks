/**
 * Abuse mitigations for the public, unauthenticated /api/gemini/* routes.
 *
 * Callers supply their own key, so the exposure is Vercel invocations rather
 * than tokens. Kept deliberately minimal — a shared rate-limit store would
 * break the free-tier constraint.
 */

import { normalizeApiKey } from './keys';

/** Reject when Origin/Referer is present and is not this deployment's host. */
export function sameOriginOk(request: Request): boolean {
  const origin = request.headers.get('origin');
  const referer = request.headers.get('referer');
  const header = origin ?? referer;
  if (!header) return true; // absent on server-to-server; not our threat model

  const site = process.env.NEXT_PUBLIC_SITE_URL;
  if (!site) return true; // unset in dev; do not lock the developer out

  try {
    return new URL(header).host === new URL(site).host;
  } catch {
    return false;
  }
}

/**
 * In-memory sliding window keyed by x-forwarded-for. Per-instance, so it bounds
 * one serverless instance rather than the whole deployment.
 */
const WINDOW_MS = 10 * 60 * 1000;
const MAX_PER_WINDOW = 10;
const hits = new Map<string, number[]>();

export function rateLimitOk(request: Request, max = MAX_PER_WINDOW): boolean {
  const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown';
  const now = Date.now();
  const recent = (hits.get(ip) ?? []).filter((t) => now - t < WINDOW_MS);

  if (recent.length >= max) {
    hits.set(ip, recent);
    return false;
  }
  recent.push(now);
  hits.set(ip, recent);

  // Bound the map so a long-lived instance cannot grow it without limit.
  if (hits.size > 5000) {
    for (const [k, v] of hits) {
      if (v.every((t) => now - t >= WINDOW_MS)) hits.delete(k);
    }
  }
  return true;
}

/**
 * The user's key, from the header. Never logged, never echoed.
 *
 * Normalized defensively even though the dialog already does it: a key can
 * reach this route from a client that predates that fix, or from curl.
 */
export function readApiKey(request: Request): string | null {
  const raw = request.headers.get('x-gemini-key');
  if (!raw) return null;
  const key = normalizeApiKey(raw);
  return key.length >= 20 ? key : null;
}

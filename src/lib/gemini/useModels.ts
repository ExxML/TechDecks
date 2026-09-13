'use client';

import { useEffect, useState } from 'react';
import { useSettings } from '@/lib/settings';
import { useUser } from '@/lib/auth';
import type { GeminiModel } from './client';

/**
 * Fetches the proxied model list and picks a sensible default.
 *
 * Cached for the session: the route sets a 24h Cache-Control, and this memo
 * avoids re-fetching on every sheet open within one page life.
 *
 * Keyed by credential, because the list belongs to whichever key served it:
 * replacing the key or switching accounts must not show the previous one's
 * models. Bounded to one entry — only the current credential can be fetched
 * again, so keeping the others just holds stale lists alive.
 */
let sessionCache: { key: string; models: GeminiModel[] } | null = null;

/**
 * Identity of the credential a fetch would use, never the credential itself.
 *
 * A pasted key wins because the dialog sets one for this tab even when it also
 * persists to Vault; `vault` covers the reload case, where the key exists but
 * only the server can read it.
 */
function credentialKey(userId: string | null, apiKey: string | null): string {
  return `${userId ?? 'anon'}:${apiKey ? fingerprint(apiKey) : 'vault'}`;
}

/**
 * Short non-reversible digest (FNV-1a), enough to notice that a key changed.
 * The plaintext is a secret and must not sit in a module-level map.
 */
function fingerprint(value: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < value.length; i += 1) {
    h ^= value.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(36);
}

function cachedFor(key: string): GeminiModel[] | null {
  return sessionCache?.key === key ? sessionCache.models : null;
}

/**
 * Newest stable Flash-tier model from the fetched list — generation runs on the
 * user's own key and is called on every problem. No hardcoded fallback: a
 * retired ID would fail every generation with no obvious cause.
 */
function pickDefault(models: readonly GeminiModel[]): string | null {
  const stableFlash = models.filter(
    (m) => /flash/i.test(m.name) && !/preview|exp|experimental|thinking|lite/i.test(m.name),
  );
  const pool = stableFlash.length > 0 ? stableFlash : models.filter((m) => /flash/i.test(m.name));
  if (pool.length === 0) return models[0]?.name ?? null;

  // Highest version number wins: "models/gemini-2.5-flash" > "models/gemini-1.5-flash".
  const versionOf = (name: string): number => {
    const m = /gemini-(\d+)\.(\d+)/.exec(name);
    return m ? Number(m[1]) * 100 + Number(m[2]) : 0;
  };
  return [...pool].sort((a, b) => versionOf(b.name) - versionOf(a.name))[0].name;
}

type FetchState = {
  readonly models: GeminiModel[];
  readonly loading: boolean;
  readonly error: string | null;
};

/**
 * @param enabled whether a key is available at all — a pasted one for this tab
 *        or one stored in Vault. The caller decides, because a Vault key is
 *        invisible here: only the server can read it.
 */
export function useModels(enabled: boolean) {
  const apiKey = useSettings((s) => s.apiKey);
  // `loading` matters: until the session resolves, a signed-in user still looks
  // anonymous, and fetching then would cache the list under the wrong identity.
  const { user, loading: authLoading } = useUser();
  const cacheKey = credentialKey(user?.id ?? null, apiKey);
  // One state object rather than three: the fetch resolves into a single
  // transition, so no intermediate render can show "loaded but empty".
  const [state, setState] = useState<FetchState>(() => ({
    models: cachedFor(cacheKey) ?? [],
    // Seed `loading` from the arguments so the effect never has to call
    // setState synchronously just to flip a spinner on.
    loading: cachedFor(cacheKey) === null,
    error: null,
  }));

  // Derived during render rather than synced by an effect: a changed credential
  // must not leave the previous key's models readable for even one frame.
  const cached = cachedFor(cacheKey);
  const [seenKey, setSeenKey] = useState(cacheKey);
  if (seenKey !== cacheKey) {
    setSeenKey(cacheKey);
    setState({ models: cached ?? [], loading: cached === null, error: null });
  }

  useEffect(() => {
    if (!enabled || authLoading || cachedFor(cacheKey)) return;
    let cancelled = false;

    void (async () => {
      try {
        // Anonymous only. A signed-in user's key is read server-side from
        // Vault, so the browser holds none and there is nothing to send.
        const headers = apiKey ? { 'x-gemini-key': apiKey } : undefined;
        const res = await fetch('/api/gemini/models', { headers });
        const body: unknown = await res.json().catch(() => null);
        if (!res.ok) {
          const message =
            typeof body === 'object' &&
            body !== null &&
            typeof (body as { error?: unknown }).error === 'string'
              ? (body as { error: string }).error
              : 'Could not load models';
          throw new Error(message);
        }
        const list = (body as { models?: GeminiModel[] }).models ?? [];
        sessionCache = { key: cacheKey, models: list };
        if (!cancelled) setState({ models: list, loading: false, error: null });
      } catch (e: unknown) {
        if (!cancelled) {
          setState({
            models: [],
            loading: false,
            error: e instanceof Error ? e.message : 'Could not load models',
          });
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [enabled, apiKey, cacheKey, authLoading]);

  return {
    models: state.models,
    // Nothing is in flight until the caller enables the fetch.
    loading: state.loading && enabled,
    error: state.error,
    defaultModelName: state.models.length > 0 ? pickDefault(state.models) : null,
  };
}

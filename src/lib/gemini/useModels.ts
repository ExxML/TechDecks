'use client';

import { useEffect, useState } from 'react';
import { useSettings } from '@/lib/settings';
import type { GeminiModel } from './client';

/**
 * Fetches the proxied model list and picks a sensible default.
 *
 * Cached for the session: the route sets a 24h Cache-Control, and this memo
 * avoids re-fetching on every sheet open within one page life.
 */
let sessionCache: GeminiModel[] | null = null;

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
  // One state object rather than three: the fetch resolves into a single
  // transition, so no intermediate render can show "loaded but empty".
  const [state, setState] = useState<FetchState>(() => ({
    models: sessionCache ?? [],
    // Seed `loading` from the arguments so the effect never has to call
    // setState synchronously just to flip a spinner on.
    loading: sessionCache === null,
    error: null,
  }));

  useEffect(() => {
    if (!enabled || sessionCache) return;
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
        sessionCache = list;
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
  }, [enabled, apiKey]);

  return {
    models: state.models,
    // Nothing is in flight until the caller enables the fetch.
    loading: state.loading && enabled,
    error: state.error,
    defaultModelName: state.models.length > 0 ? pickDefault(state.models) : null,
  };
}

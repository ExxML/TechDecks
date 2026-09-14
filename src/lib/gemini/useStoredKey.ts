'use client';

import { useEffect, useState } from 'react';
import { useUser } from '@/lib/auth';
import { hasStoredKey } from './keyStorage';

/**
 * Last known answer, per user id. A navigation remounts every consumer, and a
 * fresh `null` on each mount would render "no key" for as long as the round
 * trip takes — so later mounts read the settled value synchronously instead.
 */
const cache = new Map<string, boolean>();

/**
 * Whether the signed-in user has a key saved in Vault, or null while that is
 * still unknown. Callers must treat null as "not yet answered" rather than
 * "no key": the difference is a visible flash on every page open.
 *
 * EXISTENCE ONLY. The plaintext is unreadable from the browser by design — the
 * read wrapper is granted to service_role and nothing else.
 *
 * Signed-out is derived during render rather than written by an effect, so
 * signing out cannot leave a stale `true` for a frame.
 *
 * @param refreshToken change this to force a re-check, e.g. after the key
 *        dialog closes.
 */
export function useStoredKey(refreshToken: unknown = null): boolean | null {
  const { user, loading } = useUser();
  const [found, setFound] = useState<Record<string, boolean>>({});

  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    void hasStoredKey().then((has) => {
      cache.set(user.id, has);
      if (!cancelled) setFound((prev) => ({ ...prev, [user.id]: has }));
    });
    return () => {
      cancelled = true;
    };
  }, [user, refreshToken]);

  // Both reads are keyed by user id, so a result belonging to a previous user
  // can never be read as the current one's.
  if (loading) return null;
  if (!user) return false;
  return found[user.id] ?? cache.get(user.id) ?? null;
}

'use client';

import { useEffect, useState } from 'react';
import { useUser } from '@/lib/auth';
import { hasStoredKey } from './keyStorage';

/**
 * Whether the signed-in user has a key saved in Vault.
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
export function useStoredKey(refreshToken: unknown = null): boolean {
  const { user } = useUser();
  const [found, setFound] = useState<string | null>(null);

  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    void hasStoredKey().then((has) => {
      if (!cancelled) setFound(has ? user.id : '');
    });
    return () => {
      cancelled = true;
    };
  }, [user, refreshToken]);

  // Keyed by user id: a result belonging to a previous user can never be read
  // as the current one's.
  return Boolean(user) && found === user?.id;
}

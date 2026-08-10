'use client';

import { useEffect, useState } from 'react';
import type { User } from '@supabase/supabase-js';
import { createClient } from '@/lib/supabase/client';

/**
 * The current user, kept in sync with auth state changes.
 *
 * `loading` starts true so nothing renders a signed-out state before the
 * session is known — that flash is what makes an authenticated app look broken
 * on every reload.
 */
export function useUser(): { user: User | null; loading: boolean } {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const supabase = createClient();
    let active = true;

    void supabase.auth.getUser().then(({ data }) => {
      if (!active) return;
      setUser(data.user ?? null);
      setLoading(false);
    });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!active) return;
      setUser(session?.user ?? null);
      setLoading(false);
    });

    return () => {
      active = false;
      subscription.unsubscribe();
    };
  }, []);

  return { user, loading };
}

/** Start the Google OAuth flow, returning to `next` afterwards. */
export async function signInWithGoogle(next?: string): Promise<void> {
  const supabase = createClient();
  const redirect = new URL('/auth/callback', window.location.origin);
  if (next) redirect.searchParams.set('next', next);

  await supabase.auth.signInWithOAuth({
    provider: 'google',
    options: { redirectTo: redirect.toString() },
  });
}

export async function signOut(): Promise<void> {
  const supabase = createClient();
  await supabase.auth.signOut();
}

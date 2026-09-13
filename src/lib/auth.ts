'use client';

import { useSyncExternalStore } from 'react';
import type { User } from '@supabase/supabase-js';
import { createClient } from '@/lib/supabase/client';
import { clearSearchCache } from '@/lib/queries';

type AuthState = { readonly user: User | null; readonly loading: boolean };

/**
 * One session shared by every caller, resolved once per page load.
 *
 * Per-component state would restart at `loading: true` on each mount, and a
 * navigation remounts everything — so every page open would block its content
 * on a fresh `/auth/v1/user` round-trip. Hoisting it here means later mounts
 * read an already-settled value synchronously and paint immediately.
 */
let state: AuthState = { user: null, loading: true };
const listeners = new Set<() => void>();

function publish(next: AuthState): void {
  // Same-value writes would still re-render every subscriber.
  if (next.user?.id === state.user?.id && next.loading === state.loading) return;
  // Bookmarks and history are per-user rows, so anything cached for the
  // previous identity is not this one's to show.
  if (next.user?.id !== state.user?.id) clearSearchCache();
  state = next;
  for (const listener of listeners) listener();
}

let started = false;

function start(): void {
  if (started) return;
  started = true;
  const supabase = createClient();

  // Fires INITIAL_SESSION from local storage without a network call, then again
  // on every sign-in, sign-out and token refresh.
  supabase.auth.onAuthStateChange((_event, session) => {
    publish({ user: session?.user ?? null, loading: false });
  });

  // Revalidates that stored token against the server. It runs alongside the
  // listener rather than gating on it: the cached session is what unblocks the
  // first paint, this is what corrects it if the token is no longer good.
  void supabase.auth
    .getUser()
    .then(({ data }) => publish({ user: data.user ?? null, loading: false }))
    .catch(() => publish({ user: null, loading: false }));
}

function subscribe(listener: () => void): () => void {
  start();
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

const SERVER_STATE: AuthState = { user: null, loading: true };

/**
 * The current user, kept in sync with auth state changes.
 *
 * `loading` is true only until the session is first known — on the server and
 * on the very first client mount — so nothing renders a signed-out state
 * before then. That flash is what makes an authenticated app look broken.
 */
export function useUser(): AuthState {
  return useSyncExternalStore(
    subscribe,
    () => state,
    () => SERVER_STATE,
  );
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

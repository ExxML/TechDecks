'use client';

import { createClient } from '@/lib/supabase/client';
import { LocalMcqStore } from './localStore';
import { SupabaseMcqStore } from './supabaseStore';
import type { McqStore } from './store';

/**
 * Chooses the McqStore implementation for the current session.
 *
 * Signed in  -> Supabase, subject to RLS, correctness computed in SQL.
 * Anonymous  -> localStorage, correctness computed locally.
 *
 * Everything downstream depends only on the McqStore interface, so this
 * function is the single place that knows the difference.
 */

const localStore = new LocalMcqStore();

/** Cached per user id, so repeated calls do not build a new client each time. */
let cachedUserId: string | null = null;
let cachedStore: McqStore | null = null;

export function getMcqStore(userId: string | null): McqStore {
  if (!userId) return localStore;
  if (cachedUserId === userId && cachedStore) return cachedStore;
  cachedUserId = userId;
  cachedStore = new SupabaseMcqStore(createClient(), userId);
  return cachedStore;
}

/** Clear on sign-out so a subsequent sign-in cannot reuse the previous user's store. */
export function resetMcqStore(): void {
  cachedUserId = null;
  cachedStore = null;
}

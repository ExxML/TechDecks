'use client';

import { createBrowserClient } from '@supabase/ssr';
import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * Supabase client for Client Components.
 *
 * Anon key only — it ships in the bundle by design, and is safe solely because
 * RLS is enabled on every table (verified by the P0 matrix).
 *
 * Memoized: createBrowserClient is cheap but returning a new instance per call
 * would give each caller its own auth listener.
 */
let cached: SupabaseClient | null = null;

export function createClient(): SupabaseClient {
  cached ??= createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  );
  return cached;
}

'use client';

import { createBrowserClient } from '@supabase/ssr';
import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * Anon key only, which ships in the bundle by design and is safe because RLS is
 * enabled on every table. Memoized so callers share one auth listener.
 */
let cached: SupabaseClient | null = null;

export function createClient(): SupabaseClient {
  cached ??= createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  );
  return cached;
}

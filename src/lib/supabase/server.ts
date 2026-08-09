import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * Supabase client for Server Components and Route Handlers.
 *
 * Uses the ANON key and the caller's own session, so every query is subject to
 * RLS. The service-role key is never imported here — it lives only in the seed
 * script and GitHub Actions.
 *
 * `getAll`/`setAll` ONLY. The deprecated `get`/`set`/`remove` triple breaks
 * token refresh, and @supabase/ssr will not warn about it.
 */
export async function createClient(): Promise<SupabaseClient> {
  const cookieStore = await cookies();

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            for (const { name, value, options } of cookiesToSet) {
              cookieStore.set(name, value, options);
            }
          } catch {
            // Called from a Server Component, where cookies are read-only.
            // Middleware refreshes the session, so this is safe to ignore.
          }
        },
      },
    },
  );
}

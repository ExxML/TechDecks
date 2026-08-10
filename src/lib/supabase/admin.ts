import 'server-only';

import { createClient, type SupabaseClient } from '@supabase/supabase-js';

/**
 * Service-role Supabase client. SERVER ONLY.
 *
 * `import 'server-only'` makes any client-component import a BUILD error rather
 * than a runtime leak — this key bypasses RLS entirely, so an accidental import
 * would hand every row in the database to the browser.
 *
 * The ONLY thing this is used for in the deployed app is calling
 * get_gemini_key_for(), which is granted to service_role and to nothing else.
 * It is never used to read or write application data — those paths go through
 * the caller's own RLS-scoped session.
 *
 * Returns null when the key is absent, which is the NORMAL case on Vercel: the
 * service-role key deliberately does not live there. Callers must handle null
 * by falling back to the anonymous header path rather than failing the request.
 */
export function createAdminClient(): SupabaseClient | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;

  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

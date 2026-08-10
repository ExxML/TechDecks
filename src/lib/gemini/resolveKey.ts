import { createClient as createServerClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { readApiKey } from './guard';

/**
 * Resolve the Gemini key for a request. Server-side only.
 *
 * Order matters:
 *   1. A verified session with a stored key -> read plaintext from Vault.
 *   2. Otherwise the x-gemini-key header (the anonymous path).
 *
 * The Vault read runs with the SERVICE-ROLE client, because
 * get_gemini_key_for() is granted to service_role and nothing else. That grant
 * is the whole security property: if `authenticated` could call it, any XSS on
 * this origin would escalate to key theft — and this app renders untrusted
 * scraped HTML, so that path is real.
 *
 * The user id comes from the verified session, NEVER from client input. The
 * function takes a p_user parameter, and that parameter is only safe because
 * the browser cannot reach the function at all.
 */
export async function resolveGeminiKey(request: Request): Promise<string | null> {
  try {
    const supabase = await createServerClient();
    // getUser() revalidates with Supabase; getSession() would trust the cookie.
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (user) {
      const admin = createAdminClient();
      if (admin) {
        const { data, error } = await admin.rpc('get_gemini_key_for', { p_user: user.id });
        if (!error && typeof data === 'string' && data.length >= 20) return data;
      }
    }
  } catch {
    // Fall through to the header. An auth or Vault failure must not break
    // generation for someone who pasted a key this session.
  }

  return readApiKey(request);
}

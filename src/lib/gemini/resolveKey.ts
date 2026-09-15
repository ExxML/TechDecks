import { createClient as createServerClient } from '@/lib/supabase/server';
import { readApiKey } from './guard';

/**
 * Resolve the Gemini key for a request. Server-side only.
 *
 * Order matters:
 *   1. A verified session with a stored key -> read plaintext from Vault.
 *   2. Otherwise the x-gemini-key header (the anonymous path).
 *
 * The Vault read runs with the caller's OWN session, through get_gemini_key(),
 * which takes no parameter and resolves the row from auth.uid(). A caller can
 * therefore only ever reach their own key — which is what makes the function
 * safe to grant to `authenticated`, and is why a p_user-style parameter must
 * never be exposed there.
 *
 * Using the session rather than the service role is what makes a stored key work
 * on every device: the service-role key does not live in the deployment, so a
 * service-role read would silently resolve to null in production and fall
 * through to the header — leaving the key usable only in the tab that entered it.
 */
export async function resolveGeminiKey(request: Request): Promise<string | null> {
  try {
    const supabase = await createServerClient();
    // No getUser() first: the function derives the row from auth.uid() and
    // raises without a session, so a separate check would only repeat the
    // revalidation the proxy already performed on this request.
    const { data, error } = await supabase.rpc('get_gemini_key');
    if (!error && typeof data === 'string' && data.length >= 20) return data;
  } catch {
    // Fall through to the header. An auth or Vault failure must not break
    // generation for someone who pasted a key this session.
  }

  return readApiKey(request);
}

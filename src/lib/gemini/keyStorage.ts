'use client';

import { createClient } from '@/lib/supabase/client';

/**
 * Vault-backed key storage for signed-in users.
 *
 * Writes and deletes go through security-definer wrappers that derive the user
 * from auth.uid(). There is deliberately NO read function here: the browser
 * cannot retrieve the plaintext at all, only overwrite or delete it. Retrieval
 * happens server-side, in the route handler.
 */

/** True when this user has a key stored. Reveals existence, never the value. */
export async function hasStoredKey(): Promise<boolean> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from('user_settings')
    .select('gemini_key_id')
    .maybeSingle();
  if (error) return false;
  return Boolean((data as { gemini_key_id: string | null } | null)?.gemini_key_id);
}

export async function storeKey(key: string): Promise<void> {
  const supabase = createClient();
  const { error } = await supabase.rpc('set_gemini_key', { p_key: key });
  if (error) throw new Error('Could not save your key. Try again.');
}

/** Drops the vault secret, not merely the column reference. */
export async function clearStoredKey(): Promise<void> {
  const supabase = createClient();
  const { error } = await supabase.rpc('clear_gemini_key');
  if (error) throw new Error('Could not delete your key. Try again.');
}

export type StoredPrefs = {
  readonly model: string | null;
  readonly language: string | null;
};

export async function loadPrefs(): Promise<StoredPrefs | null> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from('user_settings')
    .select('preferred_model, preferred_lang')
    .maybeSingle();
  if (error || !data) return null;
  const row = data as { preferred_model: string | null; preferred_lang: string | null };
  return { model: row.preferred_model, language: row.preferred_lang };
}

export async function savePrefs(userId: string, prefs: StoredPrefs): Promise<void> {
  const supabase = createClient();
  const { error } = await supabase.from('user_settings').upsert(
    {
      user_id: userId,
      preferred_model: prefs.model,
      preferred_lang: prefs.language,
    },
    { onConflict: 'user_id' },
  );
  if (error) throw new Error('Could not save preferences.');
}

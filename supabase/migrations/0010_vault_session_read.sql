-- =========================================================================
-- TechDecks — 0010_vault_session_read.sql
-- Session-scoped read wrapper for a signed-in user's Gemini key.
--
-- IDEMPOTENT. Safe to re-run — `create or replace` throughout.
--
-- Apply AFTER 0002_vault_rpc.sql.
-- =========================================================================
--
-- A stored key must work on every device the account signs in from, so the
-- deployed server has to be able to decrypt it. 0002's get_gemini_key_for() is
-- granted to service_role alone, and the service-role key deliberately does not
-- live in the deployment (SETUP.md §6) — which leaves the Route Handler with no
-- read path at all, and the key usable only from the tab that entered it.
--
-- This wrapper closes that gap using the caller's own session instead.
--
-- It takes NO parameter. That is the whole safety property: the row is chosen by
-- auth.uid(), so the only key any caller can ever reach is their own. The hazard
-- 0002 warns about is a p_id/p_user parameter reaching `authenticated` —
-- security definer bypasses RLS, so such a parameter IS the vulnerability.
-- Removing it, rather than hiding the function, is what makes the grant safe.
--
-- Residual risk, stated plainly: an XSS on this origin can now call this and
-- read that session's own key. Weighed against the alternative — shipping an
-- RLS-bypassing service-role key to Vercel, where the same XSS-adjacent server
-- bug would expose every row in the database — this is the narrower blast
-- radius. It is also why the UI tells users to store a dedicated, revocable key.
-- -------------------------------------------------------------------------
create or replace function public.get_gemini_key()
returns text language plpgsql security definer
set search_path = public, vault as $$
declare v_uid uuid := auth.uid(); v_id uuid; v_secret text;
begin
  if v_uid is null then raise exception 'not authenticated'; end if;

  select gemini_key_id into v_id from user_settings where user_id = v_uid;
  if v_id is null then return null; end if;

  select decrypted_secret into v_secret from vault.decrypted_secrets where id = v_id;
  return v_secret;
end $$;

revoke all on function public.get_gemini_key() from public, anon;
grant execute on function public.get_gemini_key() to authenticated;

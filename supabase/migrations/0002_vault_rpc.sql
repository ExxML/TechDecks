-- =========================================================================
-- TechDecks — 0002_vault_rpc.sql
-- Supabase Vault wrappers for storing a signed-in user's Gemini API key.
--
-- Kept separate from 0001_init.sql on purpose: a Vault problem must not be able
-- to abort creation of the schema.
--
-- IDEMPOTENT. Safe to re-run — `create or replace` throughout, and the trigger
-- is dropped before it is created.
--
-- Apply AFTER 0001_init.sql (these functions read user_settings).
-- =========================================================================
--
-- Three rules that are easy to get wrong, encoded below:
--
-- 1. vault.create_secret() is NOT callable from the browser. The `vault` schema
--    is not exposed through PostgREST and `authenticated` has no execute grant.
--    Wiring it client-side fails with `permission denied for schema vault`.
--    All Vault access goes through these security definer wrappers in `public`.
--
-- 2. The READ wrapper derives nothing from client input except a user id that
--    only the server can supply. A function like get_gemini_key(p_id uuid)
--    callable by `authenticated` would let anyone pass someone else's
--    gemini_key_id and receive plaintext — security definer bypasses RLS, so
--    the parameter IS the vulnerability.
--
-- 3. The READ wrapper is granted to service_role ONLY, never to authenticated.
--    If the browser can call it, any XSS on this origin escalates directly to
--    Gemini key theft — and this app renders untrusted scraped HTML, so that
--    path is real. Server-only retrieval is what makes "the key never touches
--    the browser's network layer" actually true.
--
-- Security tradeoff, stated plainly: Vault encrypts at rest with a project root
-- key Supabase manages. This protects a stolen DB dump or leaked backup. It does
-- NOT protect against whoever holds the service-role key or dashboard access.
-- Persistence is therefore opt-in, disclosed in the UI, and users are told to
-- create a dedicated, revocable key.
-- =========================================================================


-- -------------------------------------------------------------------------
-- WRITE — called by the authenticated user when saving their key.
-- -------------------------------------------------------------------------
create or replace function public.set_gemini_key(p_key text)
returns void language plpgsql security definer
set search_path = public, vault as $$
declare v_uid uuid := auth.uid(); v_old uuid; v_new uuid;
begin
  if v_uid is null then raise exception 'not authenticated'; end if;
  if p_key is null or length(p_key) < 20 then raise exception 'invalid key'; end if;

  select gemini_key_id into v_old from user_settings where user_id = v_uid;

  v_new := vault.create_secret(p_key,
             'gemini:' || v_uid::text || ':' || gen_random_uuid()::text,
             'TechDecks Gemini key');

  insert into user_settings (user_id, gemini_key_id) values (v_uid, v_new)
    on conflict (user_id) do update
      set gemini_key_id = excluded.gemini_key_id, updated_at = now();

  -- Rotation: create-new, repoint, then drop old. Without this final delete
  -- every key change leaves a decryptable orphan in the vault forever.
  if v_old is not null then delete from vault.secrets where id = v_old; end if;
end $$;

revoke all on function public.set_gemini_key(text) from public, anon;
grant execute on function public.set_gemini_key(text) to authenticated;


-- -------------------------------------------------------------------------
-- READ — service_role only. Never granted to authenticated.
--
-- The p_user parameter is safe ONLY because this function is unreachable by
-- `authenticated`. The Route Handler derives the user from the verified
-- session, never from client input.
-- -------------------------------------------------------------------------
create or replace function public.get_gemini_key_for(p_user uuid)
returns text language plpgsql security definer
set search_path = public, vault as $$
declare v_id uuid; v_secret text;
begin
  select gemini_key_id into v_id from user_settings where user_id = p_user;
  if v_id is null then return null; end if;
  select decrypted_secret into v_secret from vault.decrypted_secrets where id = v_id;
  return v_secret;
end $$;

revoke all on function public.get_gemini_key_for(uuid) from public, anon, authenticated;
grant execute on function public.get_gemini_key_for(uuid) to service_role;


-- -------------------------------------------------------------------------
-- DELETE — "delete my stored key" must drop the secret, not just null the
-- column. Nulling alone leaves a decryptable plaintext key in the vault.
-- -------------------------------------------------------------------------
create or replace function public.clear_gemini_key()
returns void language plpgsql security definer
set search_path = public, vault as $$
declare v_uid uuid := auth.uid(); v_id uuid;
begin
  if v_uid is null then raise exception 'not authenticated'; end if;
  select gemini_key_id into v_id from user_settings where user_id = v_uid;
  update user_settings set gemini_key_id = null, updated_at = now() where user_id = v_uid;
  if v_id is not null then delete from vault.secrets where id = v_id; end if;
end $$;

revoke all on function public.clear_gemini_key() from public, anon;
grant execute on function public.clear_gemini_key() to authenticated;


-- -------------------------------------------------------------------------
-- Account deletion cascades user_settings away; without this the vault secret
-- survives as an ownerless, still-decryptable plaintext key.
-- -------------------------------------------------------------------------
create or replace function public.drop_user_secret() returns trigger
language plpgsql security definer set search_path = public, vault as $$
begin
  if old.gemini_key_id is not null then
    delete from vault.secrets where id = old.gemini_key_id;
  end if;
  return old;
end $$;

drop trigger if exists trg_us_drop_secret on user_settings;
create trigger trg_us_drop_secret before delete on user_settings
  for each row execute function drop_user_secret();

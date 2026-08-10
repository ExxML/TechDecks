-- =========================================================================
-- 0004_audit_vault.sql
-- Read-only audit helper: does a given vault secret still exist?
--
-- The `vault` schema is deliberately not exposed through PostgREST, which is
-- correct — but it also means a verification script cannot check for orphaned
-- secrets after a key rotation or account deletion. Those are exactly the
-- silent failures worth testing: a rotation that leaves the old secret behind
-- keeps a decryptable plaintext key in the database forever.
--
-- Returns a COUNT and nothing else. It never returns secret material, so it
-- cannot become a key-exfiltration path even if its grant were widened by
-- mistake. Granted to service_role only.
--
-- IDEMPOTENT. Safe to re-run.
-- =========================================================================

create or replace function public.audit_vault_secret_exists(p_id uuid)
returns integer
language sql
security definer
set search_path = vault, public
stable
as $$
  select count(*)::int from vault.secrets where id = p_id;
$$;

revoke all on function public.audit_vault_secret_exists(uuid) from public, anon, authenticated;
grant execute on function public.audit_vault_secret_exists(uuid) to service_role;

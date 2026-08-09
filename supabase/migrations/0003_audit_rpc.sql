-- =========================================================================
-- TechDeck — 0003_audit_rpc.sql
-- Read-only audit helper for the P0 RLS verification.
--
-- PostgREST cannot select from pg_tables, so scripts/rls-audit.ts has no way to
-- assert "rowsecurity is true on every table" from outside the SQL editor.
-- This exposes exactly that one fact, to service_role only.
--
-- Deliberately narrow: it returns two columns for tables in `public` and
-- nothing else. It is not granted to anon or authenticated, so it adds no
-- client-reachable surface.
--
-- IDEMPOTENT. Safe to re-run. Apply after 0001 and 0002.
-- =========================================================================

create or replace function public.audit_rls_status()
returns table (tablename text, rowsecurity boolean)
language sql
security definer
set search_path = pg_catalog, public
stable
as $$
  select t.tablename::text, t.rowsecurity
  from pg_tables t
  where t.schemaname = 'public'
  order by t.tablename;
$$;

revoke all on function public.audit_rls_status() from public, anon, authenticated;
grant execute on function public.audit_rls_status() to service_role;

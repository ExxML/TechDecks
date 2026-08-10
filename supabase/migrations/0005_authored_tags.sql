-- =========================================================================
-- TechDecks — 0005_authored_tags.sql
-- Lets an author tag their OWN problem, without reopening content_item_tags.
--
-- IDEMPOTENT. Safe to re-run — `create or replace` throughout.
--
-- Apply AFTER 0001_init.sql.
-- =========================================================================
--
-- 0001 revokes insert/update/delete on content_item_tags from anon and
-- authenticated, so an accidental `disable row level security` cannot make the
-- tag graph world-writable. Authored problems still need tags, and widening
-- that grant would undo the hardening for the whole table to permit writes to a
-- handful of rows. The grant therefore stays revoked and this function is the
-- only exception, narrow in the ways that matter:
--
--   * It verifies the caller OWNS the item and that it is source_id = 'user',
--     so public LeetCode rows are unreachable through it.
--   * It attaches only tags that already exist, so it cannot fill `tags` with
--     junk.
--   * It rewrites the join rows of one item and touches nothing else.
--
-- `security definer` is required to act with rights the caller lacks, so
-- `search_path` is pinned and the ownership check stands in for RLS. Without
-- that check `p_item` would BE the vulnerability, as it would on the Vault
-- read wrapper.

create or replace function public.set_content_item_tags(p_item uuid, p_tag_slugs text[])
returns void language plpgsql security definer
set search_path = public as $$
declare v_uid uuid := auth.uid();
begin
  if v_uid is null then raise exception 'not authenticated'; end if;

  -- Ownership + source check. `not found` rather than a descriptive error:
  -- a caller probing ids should not learn which ones exist.
  if not exists (
    select 1 from content_items
     where id = p_item
       and owner_id = v_uid
       and source_id = 'user'
  ) then
    raise exception 'not found';
  end if;

  delete from content_item_tags where content_item_id = p_item;

  -- Only pre-existing tags. Unknown slugs are silently skipped, which matches
  -- the client: the tag vocabulary is seeded, not author-extensible.
  if p_tag_slugs is not null and array_length(p_tag_slugs, 1) > 0 then
    insert into content_item_tags (content_item_id, tag_id)
    select p_item, t.id
      from tags t
     where t.slug = any(p_tag_slugs)
    on conflict do nothing;
  end if;
end $$;

revoke all on function public.set_content_item_tags(uuid, text[]) from public, anon;
grant execute on function public.set_content_item_tags(uuid, text[]) to authenticated;

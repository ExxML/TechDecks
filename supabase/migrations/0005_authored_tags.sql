-- =========================================================================
-- TechDecks — 0005_authored_tags.sql
-- Lets an author tag their OWN problem, without reopening content_item_tags.
--
-- IDEMPOTENT. Safe to re-run — `create or replace` throughout.
--
-- Apply AFTER 0001_init.sql.
-- =========================================================================
--
-- WHY THIS EXISTS
--
-- 0001 revokes insert/update/delete on content_item_tags from anon and
-- authenticated as defense in depth: that table is the tag graph, and a future
-- accidental `disable row level security` must not immediately make it
-- world-writable. Authored problems need tags, so those two requirements
-- collide. Widening the grant would undo the hardening for every row in the
-- table just to permit writes to a handful.
--
-- So the grant stays revoked and this function is the only hole — narrow, and
-- narrow in the ways that matter:
--
--   * It verifies the caller OWNS the target item and that the item is
--     source_id = 'user'. Public LeetCode rows are unreachable through it, so
--     the synced tag graph cannot be edited by anyone holding the anon key.
--   * It attaches only tags that ALREADY EXIST. It never creates a tag, so it
--     cannot be used to fill the tags table with junk.
--   * It is not `for all`: it rewrites the join rows of one item and touches
--     nothing else.
--
-- `security definer` is required — the point is to act with rights the caller
-- does not have — so `search_path` is pinned, and the ownership check is the
-- thing standing in for RLS. Without that check the parameter would BE the
-- vulnerability, exactly as it would be on the Vault read wrapper.

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

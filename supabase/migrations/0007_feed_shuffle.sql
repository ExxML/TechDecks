-- =========================================================================
-- TechDecks — 0007_feed_shuffle.sql
-- Feed order: a per-load shuffle instead of the catalog's numeric order.
--
-- IDEMPOTENT. Safe to re-run — `create or replace` throughout.
--
-- Apply AFTER 0001_init.sql.
-- =========================================================================
--
-- The feed is a deck, and a deck that deals the same hand every session is a
-- list. So each page load picks a seed and the whole feed is ordered by
-- hashtext(id || seed) — a permutation that is random ACROSS loads and fixed
-- WITHIN one.
--
-- Fixed within a load is the load-bearing half. `order by random()` re-rolls on
-- every query, so page two would overlap page one and drop rows entirely; the
-- reader would see the same problem twice and never see others. Hashing a
-- stable key against a per-load seed keeps keyset pagination exact, on
-- (shuffle_key, id) exactly as the numeric feed keys on (sort_key, id).
--
-- SECURITY INVOKER, like search: RLS on content_items decides the rows, so an
-- anonymous caller gets the public catalog and nothing else. `body_html is not
-- null` mirrors the feed's partial index and drops paid-only blanks, which
-- would otherwise render as empty full-screen cards.

create or replace function public.feed_page(
  p_seed       text,
  p_after_key  bigint default null,
  p_after_id   uuid   default null,
  p_limit      int    default 10
)
returns table (
  id            uuid,
  source_id     text,
  external_id   text,
  slug          text,
  title         text,
  body_html     text,
  body_format   text,
  difficulty    difficulty_level,
  metadata      jsonb,
  owner_id      uuid,
  visibility    text,
  sort_key      int,
  shuffle_key   bigint,
  tags          jsonb
)
language sql
security invoker            -- never definer: RLS is the visibility model.
set search_path = public
as $$
  with ordered as (
    select c.*,
           -- bigint, not int: the cursor travels through JSON and JS numbers
           -- lose integer precision above 2^53, which hashtext's int32 range
           -- stays comfortably inside.
           hashtext(c.id::text || p_seed)::bigint as k
      from content_items c
     where c.visibility = 'public'
       and c.body_html is not null
  )
  select o.id, o.source_id, o.external_id, o.slug, o.title, o.body_html,
         o.body_format, o.difficulty, o.metadata, o.owner_id, o.visibility,
         o.sort_key, o.k,
         coalesce(
           (select jsonb_agg(jsonb_build_object('slug', t.slug, 'name', t.name)
                             order by t.name)
              from content_item_tags cit
              join tags t on t.id = cit.tag_id
             where cit.content_item_id = o.id),
           '[]'::jsonb)
    from ordered o
   -- Keyset on the composite key: strictly past the cursor's hash, or equal
   -- hash with a greater id. Hash collisions are expected at catalog size and
   -- the id tiebreak is what keeps the order total in spite of them.
   where p_after_key is null
      or o.k > p_after_key
      or (o.k = p_after_key and o.id > p_after_id)
   order by o.k asc, o.id asc
   limit least(greatest(coalesce(p_limit, 10), 1), 50);
$$;

revoke all on function public.feed_page(text, bigint, uuid, int) from public;
grant execute on function public.feed_page(text, bigint, uuid, int) to anon, authenticated;

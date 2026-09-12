-- =========================================================================
-- TechDecks — 0009_history.sql
-- Visit history: which problems a user has opened, and when they first did.
--
-- IDEMPOTENT. Safe to re-run — `create table if not exists` / `create or
-- replace` throughout.
--
-- Apply AFTER 0006_search_rpc.sql.
-- =========================================================================

-- First visit, not last: the row is written once and never updated, so the
-- timestamp answers "when did I first open this" rather than "when did I last
-- glance at it". The `on conflict do nothing` in record_visit() is what pins it.
create table if not exists problem_visits (
  user_id          uuid not null references auth.users(id) on delete cascade,
  content_item_id  uuid not null references content_items(id) on delete cascade,
  first_visited_at timestamptz not null default now(),
  primary key (user_id, content_item_id)
);

-- History is ordered by visit time, so the index carries it.
create index if not exists idx_pv_user_time
  on problem_visits (user_id, first_visited_at desc);

alter table problem_visits enable row level security;

drop policy if exists pv_all on problem_visits;
create policy pv_all on problem_visits for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));


-- Writes are fire-and-forget from the feed, one per card dwelt on. Going
-- through an RPC rather than a plain insert keeps the client from sending a
-- user id it would then have to be trusted on, and makes "first visit wins" a
-- property of the database rather than of the caller.
create or replace function public.record_visit(p_item uuid)
returns void language plpgsql security definer set search_path = public as $fn$
begin
  if auth.uid() is null then return; end if;
  insert into problem_visits (user_id, content_item_id)
  values (auth.uid(), p_item)
  on conflict (user_id, content_item_id) do nothing;
end $fn$;

revoke all on function record_visit(uuid) from public, anon;
grant execute on function record_visit(uuid) to authenticated;


-- =========================================================================
-- search_content_items — adds the visited filter and list ordering.
--
-- History and Bookmarks are the same ranked search as /search over a narrower
-- row set, so they run through this function rather than through list queries
-- of their own: one definition of what a filter means, one trigram fallback,
-- one paging contract.
--
-- `p_visited` is the History counterpart of `p_bookmarked`. `p_order` exists
-- because those two lists have an order of their own that rank cannot express;
-- under a text query relevance still wins, exactly as it does on /search.
--
-- Everything else is unchanged from 0006, restated because a body must be
-- replaced whole.
-- =========================================================================

create or replace function public.search_content_items(
  p_query        text    default null,
  p_difficulties text[]  default null,
  p_tag_slugs    text[]  default null,
  p_ac_min       numeric default null,
  p_ac_max       numeric default null,
  p_bookmarked   boolean default false,
  p_limit        int     default 30,
  p_offset       int     default 0,
  p_visited      boolean default false,
  p_order        text    default null      -- 'visited' | 'bookmarked' | null
)
returns table (
  id          uuid,
  slug        text,
  title       text,
  difficulty  difficulty_level,
  metadata    jsonb,
  sort_key    int,
  source_id   text,
  visibility  text,
  owner_id    uuid,
  body_format text,
  rank        real,
  total_count bigint,
  listed_at   timestamptz      -- the visit/bookmark time; null on /search
)
language plpgsql
security invoker            -- see 0006's header. Never change this to definer.
set search_path = public, extensions
as $fn$
declare
  v_q      text := nullif(btrim(coalesce(p_query, '')), '');
  v_uid    uuid := auth.uid();
  v_ts     tsquery;
  v_hits   bigint;
  -- Clamp rather than trust: this is reachable from the browser, and an
  -- unbounded limit is a denial-of-service knob.
  v_limit  int := least(greatest(coalesce(p_limit, 30), 1), 100);
  v_offset int := greatest(coalesce(p_offset, 0), 0);
begin
  -- websearch_to_tsquery handles quoted phrases and OR without throwing on
  -- punctuation the way to_tsquery does. A user typing `c++` must not error.
  if v_q is not null then
    v_ts := websearch_to_tsquery('english', v_q);
    -- A query of only stopwords ("the a of") yields an empty tsquery, which
    -- matches nothing. Treat it as no text query rather than as zero results.
    if v_ts::text = '' then v_ts := null; end if;
  end if;

  -- ---- shared filter set, applied identically on both paths ----
  return query
  with filtered as (
    select c.*,
           case p_order
             when 'visited'    then (select pv.first_visited_at from problem_visits pv
                                      where pv.content_item_id = c.id and pv.user_id = v_uid)
             when 'bookmarked' then (select b.created_at from bookmarks b
                                      where b.content_item_id = c.id and b.user_id = v_uid)
           end as m_listed_at
      from content_items c
     where c.body_html is not null              -- excludes paid-only blanks
       and (p_difficulties is null
            or array_length(p_difficulties, 1) is null
            or c.difficulty::text = any(p_difficulties))
       and (p_ac_min is null
            or coalesce((c.metadata->>'acRate')::numeric, -1) >= p_ac_min)
       and (p_ac_max is null
            or coalesce((c.metadata->>'acRate')::numeric, 1e9) <= p_ac_max)
       and (p_tag_slugs is null
            or array_length(p_tag_slugs, 1) is null
            -- Every requested tag must be present (AND, not OR): combining
            -- "array" and "dynamic-programming" should narrow, not widen.
            or (select count(distinct t.slug)
                  from content_item_tags cit
                  join tags t on t.id = cit.tag_id
                 where cit.content_item_id = c.id
                   and t.slug = any(p_tag_slugs)) = array_length(p_tag_slugs, 1))
       and (not coalesce(p_bookmarked, false)
            or (v_uid is not null
                and exists (select 1 from bookmarks b
                             where b.content_item_id = c.id
                               and b.user_id = v_uid)))
       and (not coalesce(p_visited, false)
            or (v_uid is not null
                and exists (select 1 from problem_visits pv
                             where pv.content_item_id = c.id
                               and pv.user_id = v_uid)))
  ),
  matched as (
    select f.*,
           case
             when v_ts is null then 0::real
             else ts_rank(f.search_vector, v_ts)
           end as m_rank,
           -- Exact title, then prefix, then containment, then body/topics only.
           case
             when v_q is null then 0
             when lower(f.title) = lower(v_q) then 3
             when lower(f.title) like lower(v_q) || '%' then 2
             when lower(f.title) like '%' || lower(v_q) || '%' then 1
             else 0
           end as m_title_tier,
           -- Breaks ties within a tier: "Two Sum" over "Two Sum IV - Input is
           -- a BST".
           length(f.title) as m_title_len
      from filtered f
     where v_ts is null or f.search_vector @@ v_ts
  ),
  counted as (
    select m.*, count(*) over () as m_total from matched m
  )
  select c.id, c.slug, c.title, c.difficulty, c.metadata, c.sort_key,
         c.source_id, c.visibility, c.owner_id, c.body_format,
         c.m_rank, c.m_total, c.m_listed_at
    from counted c
   order by
     -- Relevance first, and only when there is a query to be relevant to: the
     -- title tiers are constant without one, but m_title_len is not, and left
     -- ungated it would sort a plain browse by length of title.
     c.m_title_tier desc,
     case when v_ts is null then 0 else c.m_title_len end asc,
     c.m_rank desc,
     -- Then the list's own order, where it has one, and feed order otherwise.
     c.m_listed_at desc nulls last,
     c.sort_key asc nulls last,
     c.id asc
   limit v_limit offset v_offset;

  get diagnostics v_hits = row_count;

  -- ---- trigram fallback ----
  -- Only when a text query was given and full-text found nothing. This is the
  -- "two sim" -> "Two Sum" path.
  if v_hits = 0 and v_q is not null then
    return query
    with filtered as (
      select c.*,
             case p_order
               when 'visited'    then (select pv.first_visited_at from problem_visits pv
                                        where pv.content_item_id = c.id and pv.user_id = v_uid)
               when 'bookmarked' then (select b.created_at from bookmarks b
                                        where b.content_item_id = c.id and b.user_id = v_uid)
             end as m_listed_at
        from content_items c
       where c.body_html is not null
         and (p_difficulties is null
              or array_length(p_difficulties, 1) is null
              or c.difficulty::text = any(p_difficulties))
         and (p_ac_min is null
              or coalesce((c.metadata->>'acRate')::numeric, -1) >= p_ac_min)
         and (p_ac_max is null
              or coalesce((c.metadata->>'acRate')::numeric, 1e9) <= p_ac_max)
         and (p_tag_slugs is null
              or array_length(p_tag_slugs, 1) is null
              or (select count(distinct t.slug)
                    from content_item_tags cit
                    join tags t on t.id = cit.tag_id
                   where cit.content_item_id = c.id
                     and t.slug = any(p_tag_slugs)) = array_length(p_tag_slugs, 1))
         and (not coalesce(p_bookmarked, false)
              or (v_uid is not null
                  and exists (select 1 from bookmarks b
                               where b.content_item_id = c.id
                                 and b.user_id = v_uid)))
         and (not coalesce(p_visited, false)
              or (v_uid is not null
                  and exists (select 1 from problem_visits pv
                               where pv.content_item_id = c.id
                                 and pv.user_id = v_uid)))
    ),
    fuzzy as (
      select f.*, similarity(f.title, v_q) as m_rank
        from filtered f
       -- 0.25 is deliberately loose: a one-word typo against a short title
       -- scores low, and this branch only runs when the precise path already
       -- returned nothing, so a permissive threshold costs nothing.
       where similarity(f.title, v_q) > 0.25
    ),
    counted as (
      select f.*, count(*) over () as m_total from fuzzy f
    )
    select c.id, c.slug, c.title, c.difficulty, c.metadata, c.sort_key,
           c.source_id, c.visibility, c.owner_id, c.body_format,
           c.m_rank::real, c.m_total, c.m_listed_at
      from counted c
     order by c.m_rank desc, c.m_listed_at desc nulls last,
              c.sort_key asc nulls last, c.id asc
     limit v_limit offset v_offset;
  end if;
end $fn$;

-- 0006's eight-argument signature is a distinct function to Postgres, not an
-- overload to keep: left in place, an eight-argument call would resolve to a
-- definition that knows nothing about visits.
drop function if exists public.search_content_items(text, text[], text[], numeric, numeric, boolean, int, int);

-- Readable by anyone, exactly like the feed: RLS decides which rows come back,
-- so an anonymous caller simply sees the public catalog.
revoke all on function public.search_content_items(text, text[], text[], numeric, numeric, boolean, int, int, boolean, text)
  from public;
grant execute on function public.search_content_items(text, text[], text[], numeric, numeric, boolean, int, int, boolean, text)
  to anon, authenticated;

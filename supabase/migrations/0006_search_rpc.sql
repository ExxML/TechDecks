-- =========================================================================
-- TechDecks — 0006_search_rpc.sql
-- Search: ranked full-text with a trigram fallback for typos, plus filters.
--
-- IDEMPOTENT. Safe to re-run — `create or replace` throughout.
--
-- Apply AFTER 0001_init.sql.
-- =========================================================================
--
-- SECURITY INVOKER is the security model here, and is stated explicitly so a
-- future edit cannot flip it by accident. RLS on content_items runs as the
-- CALLER, so `ci_read` restricts results to public rows plus the caller's own.
-- A `security definer` search would bypass RLS and hand every user's authored
-- problems to anyone who could type a query. RLS therefore covers visibility;
-- auth.uid() appears only in the bookmarked-only filter, where the caller's
-- identity IS the filter.
--
-- Two search paths, because they answer different questions. `search_vector` is
-- stemmed, weighted (title A, topics B, body C) and ranked, but cannot match
-- "two sim" — `sim` is not a lexeme of `sum`, and full-text simply misses a
-- typo. Trigram similarity on `title` covers that. It is a fallback, not a
-- peer: unioning both on every query would let a body-text trigram coincidence
-- outrank a real title hit. So full-text runs first, trigram only if it returns
-- nothing. `similarity()` uses idx_ci_trgm.
--
-- Ranking is tiered, with ts_rank as the tiebreak rather than the primary
-- signal. For `two sum`, ts_rank puts the exact match FOURTH (0.991077) behind
-- two-sum-ii (0.992716), sum-of-two-integers (0.992606) and two-sum-iv
-- (0.992202): all four carry both lexemes at weight A, so the scores collapse
-- into a 0.002 band. Searching a problem by its own name has to return it
-- first, so an explicit title tier orders ahead of rank.
--
-- Paid-only rows are excluded (`body_html is not null`), matching the feed's
-- partial index — without it ~19% of results open to a blank card.

create or replace function public.search_content_items(
  p_query        text    default null,
  p_difficulties text[]  default null,
  p_tag_slugs    text[]  default null,
  p_ac_min       numeric default null,
  p_ac_max       numeric default null,
  p_bookmarked   boolean default false,
  p_limit        int     default 30,
  p_offset       int     default 0
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
  total_count bigint
)
language plpgsql
security invoker            -- see the header. Never change this to definer.
set search_path = public, extensions
as $$
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
  -- Written once as a CTE so the full-text and trigram branches cannot drift
  -- apart in what they consider a candidate row.
  return query
  with filtered as (
    select c.*
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
         c.m_rank, c.m_total
    from counted c
   order by
     -- With no text query this is a plain filtered browse, so fall back to feed
     -- order rather than an arbitrary rank tie.
     case when v_ts is null then 0 else 1 end desc,
     c.m_title_tier desc,
     c.m_title_len asc,
     c.m_rank desc,
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
      select c.*
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
           c.m_rank::real, c.m_total
      from counted c
     order by c.m_rank desc, c.sort_key asc nulls last, c.id asc
     limit v_limit offset v_offset;
  end if;
end $$;

-- Readable by anyone, exactly like the feed: RLS decides which rows come back,
-- so an anonymous caller simply sees the public catalog.
revoke all on function public.search_content_items(text, text[], text[], numeric, numeric, boolean, int, int)
  from public;
grant execute on function public.search_content_items(text, text[], text[], numeric, numeric, boolean, int, int)
  to anon, authenticated;

-- ---------------------------------------------------------------------------
-- Tag list for the filter sheet, with counts.
--
-- Also security invoker, so the counts reflect only rows the caller may see.
-- Counting public rows only would be a small lie on a signed-in user's own
-- tagged problems; counting through RLS costs nothing here.
-- ---------------------------------------------------------------------------
create or replace function public.list_tags_with_counts()
returns table (slug text, name text, item_count bigint)
language sql
security invoker
set search_path = public
as $$
  select t.slug, t.name, count(cit.content_item_id) as item_count
    from tags t
    join content_item_tags cit on cit.tag_id = t.id
    join content_items c on c.id = cit.content_item_id
   where c.body_html is not null
   group by t.slug, t.name
  having count(cit.content_item_id) > 0
   order by count(cit.content_item_id) desc, t.name asc;
$$;

revoke all on function public.list_tags_with_counts() from public;
grant execute on function public.list_tags_with_counts() to anon, authenticated;

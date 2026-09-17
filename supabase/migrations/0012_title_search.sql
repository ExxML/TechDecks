-- =========================================================================
-- TechDecks — 0012_title_search.sql
-- Search matches the title, and only the title.
--
-- IDEMPOTENT. Safe to re-run — the drop is guarded, `create or replace`
-- throughout.
--
-- Apply AFTER 0011_history_recency.sql.
-- =========================================================================
--
-- SECURITY INVOKER is the security model here, and is stated explicitly so a
-- future edit cannot flip it by accident. RLS on content_items runs as the
-- CALLER, so `ci_read` restricts results to public rows plus the caller's own.
-- A `security definer` search would bypass RLS and hand every user's authored
-- problems to anyone who could type a query. RLS therefore covers visibility;
-- auth.uid() appears only in the bookmarked/visited filters, where the caller's
-- identity IS the filter.
--
-- The search box sits above a list of problem titles, so it searches titles.
-- Matching is per-word substring: every whitespace-separated word of the query
-- must appear somewhere in the title, in any order. Substring rather than
-- word-boundary because a title is a short label being recalled rather than
-- prose being searched — "min part" has to find "Minimum Partition Score", and
-- a lexeme match cannot, since `min` is not a stem of `minimum`.
--
-- Trigram similarity on `title` backs it up for typos, where no word of the
-- query is in the title at all: "two sim" -> "Two Sum". It is a fallback, not a
-- peer — running both on every query would let a loose similarity score outrank
-- an exact substring hit — so it runs only when the substring pass returns
-- nothing. `similarity()` uses idx_ci_trgm.
--
-- Ranking is by how the title matches: exact, then prefix, then anywhere, with
-- the shortest title first inside a tier. Searching a problem by its own name
-- has to return it first.
--
-- Paid-only rows are excluded (`body_html is not null`), matching the feed's
-- partial index — without it ~19% of results open to a blank card.

-- The result columns changed — `rank` is gone with the text-search score it
-- carried — and `create or replace` cannot change a function's output columns,
-- so the previous definition is dropped rather than replaced in place.
drop function if exists public.search_content_items(text, text[], text[], numeric, numeric, boolean, int, int, boolean, text);

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
  total_count bigint,
  listed_at   timestamptz      -- the visit/bookmark time; null on /search
)
language plpgsql
security invoker            -- see the header. Never change this to definer.
set search_path = public, extensions
as $fn$
declare
  v_q      text := nullif(btrim(coalesce(p_query, '')), '');
  v_uid    uuid := auth.uid();
  -- The lowercased query with `like` metacharacters escaped, and that same
  -- string split into one pattern per word. A word array so the match is a
  -- single `like all (...)` rather than a predicate assembled per word.
  v_esc    text;
  v_words  text[];
  v_hits   bigint;
  -- Clamp rather than trust: this is reachable from the browser, and an
  -- unbounded limit is a denial-of-service knob.
  v_limit  int := least(greatest(coalesce(p_limit, 30), 1), 100);
  v_offset int := greatest(coalesce(p_offset, 0), 0);
begin
  if v_q is not null then
    -- `like` metacharacters are escaped once, here: someone typing `100%` wants
    -- titles containing "100%", not every title that starts with "100".
    v_esc := replace(replace(replace(lower(v_q), '\', '\\'), '%', '\%'), '_', '\_');
    v_words := array(
      select '%' || w || '%'
        from regexp_split_to_table(v_esc, '\s+') as w
       where w <> ''
    );
  end if;

  -- ---- shared filter set, applied identically on both paths ----
  -- Written once per branch so the substring and trigram paths cannot drift
  -- apart in what they consider a candidate row.
  return query
  with filtered as (
    select c.*,
           case p_order
             when 'visited'    then (select pv.last_visited_at from problem_visits pv
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
           -- Exact title, then prefix, then the words matching in any order.
           case
             when v_q is null then 0
             when lower(f.title) = lower(v_q) then 2
             when lower(f.title) like v_esc || '%' then 1
             else 0
           end as m_title_tier,
           -- Breaks ties within a tier: "Two Sum" over "Two Sum IV - Input is
           -- a BST".
           length(f.title) as m_title_len
      from filtered f
     where v_words is null
        or lower(f.title) like all (v_words)
  ),
  counted as (
    select m.*, count(*) over () as m_total from matched m
  )
  select c.id, c.slug, c.title, c.difficulty, c.metadata, c.sort_key,
         c.source_id, c.visibility, c.owner_id, c.body_format,
         c.m_total, c.m_listed_at
    from counted c
   order by
     -- Relevance first, and only when there is a query to be relevant to: the
     -- title tiers are constant without one, but m_title_len is not, and left
     -- ungated it would sort a plain browse by length of title.
     c.m_title_tier desc,
     case when v_q is null then 0 else c.m_title_len end asc,
     -- Then the list's own order, where it has one, and feed order otherwise.
     c.m_listed_at desc nulls last,
     c.sort_key asc nulls last,
     c.id asc
   limit v_limit offset v_offset;

  get diagnostics v_hits = row_count;

  -- ---- trigram fallback ----
  -- Only when a text query was given and the substring pass found nothing.
  -- This is the "two sim" -> "Two Sum" path.
  if v_hits = 0 and v_q is not null then
    return query
    with filtered as (
      select c.*,
             case p_order
               when 'visited'    then (select pv.last_visited_at from problem_visits pv
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
      select f.*, similarity(f.title, v_q) as m_similarity
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
           c.m_total, c.m_listed_at
      from counted c
     order by c.m_similarity desc, c.m_listed_at desc nulls last,
              c.sort_key asc nulls last, c.id asc
     limit v_limit offset v_offset;
  end if;
end $fn$;

-- Readable by anyone, exactly like the feed: RLS decides which rows come back,
-- so an anonymous caller simply sees the public catalog. Restated because the
-- drop above took the previous grants with it.
revoke all on function public.search_content_items(text, text[], text[], numeric, numeric, boolean, int, int, boolean, text)
  from public;
grant execute on function public.search_content_items(text, text[], text[], numeric, numeric, boolean, int, int, boolean, text)
  to anon, authenticated;


-- =========================================================================
-- search_vector — dropped with the text search that was its only reader.
--
-- The generated column indexed title (A), metadata.topic_text (B) and the body
-- (C) for ranked full-text. Nothing reads it now: titles are matched directly,
-- and topics are filtered through content_item_tags, which is the authoritative
-- side of that pair. Keeping it would mean re-tokenizing the body of every row
-- on write to populate an index no query touches.
--
-- metadata.topic_text stays. It is the denormalized tag list the sync writes
-- alongside content_item_tags, and verify-seed reads it to catch the two
-- drifting apart.
-- =========================================================================

drop index if exists idx_ci_search;
alter table content_items drop column if exists search_vector;

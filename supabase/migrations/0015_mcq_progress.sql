-- =========================================================================
-- TechDecks — 0015_mcq_progress.sql
-- The MCQ filter narrows by progress on the latest set: in progress or
-- completed.
--
-- IDEMPOTENT. Safe to re-run — the drop is guarded, `create or replace`
-- throughout.
--
-- Apply AFTER 0014_mcq_filter.sql.
-- =========================================================================
--
-- `p_mcq_progress` replaces 0014's `p_has_mcqs`: 'in-progress' or 'completed',
-- null for no filter. Either value requires a set, so a problem with none
-- matches neither.
--
-- Completed means attempted, not correct: record_answer() stamps answered_at
-- once every question holds an answer, and reset_answer()/reset_answers()
-- clear it, so answered_at alone is the test.
--
-- The latest set only, as that is the set the panel opens on. Generating a new
-- set moves a completed problem back to in progress. The subquery is a probe of
-- idx_mcq_user_item, whose (user_id, content_item_id, created_at desc) order is
-- the one it reads; `id desc` breaks ties the same way the MCQ store does.
--
-- The signature changes, so the previous definition is dropped rather than
-- replaced in place.

drop function if exists public.search_content_items(text, text[], text[], numeric, numeric, boolean, int, int, boolean, text, boolean);

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
  p_order        text    default null,     -- 'visited' | 'bookmarked' | null
  p_mcq_progress text    default null      -- 'in-progress' | 'completed' | null
)
returns table (
  id          uuid,
  slug        text,
  title       text,
  difficulty  difficulty_level,
  ac_rate     numeric,
  sort_key    int,
  source_id   text,
  visibility  text,
  owner_id    uuid,
  body_format text,
  total_count bigint,
  listed_at   timestamptz      -- the visit/bookmark time; null on /search
)
language plpgsql
security invoker            -- see 0012's header. Never change this to definer.
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
       and (p_mcq_progress is null
            or (v_uid is not null
                and (select (m.answered_at is not null) = (p_mcq_progress = 'completed')
                       from mcq_sets m
                      where m.content_item_id = c.id
                        and m.user_id = v_uid
                      order by m.created_at desc, m.id desc
                      limit 1)))
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
  select c.id, c.slug, c.title, c.difficulty,
         (c.metadata->>'acRate')::numeric, c.sort_key,
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
         and (p_mcq_progress is null
              or (v_uid is not null
                  and (select (m.answered_at is not null) = (p_mcq_progress = 'completed')
                         from mcq_sets m
                        where m.content_item_id = c.id
                          and m.user_id = v_uid
                        order by m.created_at desc, m.id desc
                        limit 1)))
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
    select c.id, c.slug, c.title, c.difficulty,
           (c.metadata->>'acRate')::numeric, c.sort_key,
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
revoke all on function public.search_content_items(text, text[], text[], numeric, numeric, boolean, int, int, boolean, text, text)
  from public;
grant execute on function public.search_content_items(text, text[], text[], numeric, numeric, boolean, int, int, boolean, text, text)
  to anon, authenticated;

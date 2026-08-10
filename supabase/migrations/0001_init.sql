-- =========================================================================
-- TechDeck — 0001_init.sql
-- Schema, indexes, RLS on all nine tables, triggers, answer RPCs.
--
-- IDEMPOTENT. Safe to re-run. Every statement is guarded:
--   - `create table if not exists`, `create index if not exists`
--   - enum creation wrapped in a duplicate_object handler
--   - `create or replace` for functions
--   - `drop ... if exists` before every trigger and policy
--     (Postgres has no `create policy if not exists`)
--   - `on conflict do nothing` for seed rows
--
-- Apply this file BEFORE 0002_vault_rpc.sql.
-- =========================================================================

-- Supabase installs extensions into the `extensions` schema, not `public`.
create extension if not exists pg_trgm  with schema extensions;
create extension if not exists unaccent with schema extensions;
-- `unaccent` is here for a future search RPC only. It is STABLE, not IMMUTABLE,
-- so it can never appear in the generated search_vector column below.


-- =========================================================================
-- Types
-- =========================================================================

do $$ begin
  create type difficulty_level as enum ('easy','medium','hard');
exception when duplicate_object then null; end $$;


-- =========================================================================
-- Tables
-- =========================================================================

create table if not exists sources (
  id         text primary key,        -- 'leetcode', 'system-design', 'user'
  name       text not null,
  base_url   text,
  created_at timestamptz not null default now()
);

-- 'user' is the source for authored problems and must exist before any user
-- can save one — content_items.source_id has a FK onto this table.
insert into sources (id, name, base_url) values
  ('leetcode', 'LeetCode', 'https://leetcode.com'),
  ('user',     'My Problems', null)
on conflict (id) do nothing;


create table if not exists content_items (
  id            uuid primary key default gen_random_uuid(),
  source_id     text not null references sources(id),
  external_id   text,                 -- LeetCode frontendQuestionId; null for user content
  slug          text not null,
  title         text not null,
  body_html     text,                 -- sanitized at ingest
  body_format   text not null default 'html' check (body_format in ('html','markdown')),
  difficulty    difficulty_level,
  metadata      jsonb not null default '{}'::jsonb,
  owner_id      uuid references auth.users(id) on delete cascade,  -- null = public
  visibility    text not null default 'public' check (visibility in ('public','private')),
  content_hash  text,                 -- hash of sanitized body_html; write suppression
  sort_key      int,                  -- feed order; LeetCode frontendId
  synced_at     timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  search_vector tsvector generated always as (
    setweight(to_tsvector('english'::regconfig, coalesce(title,'')), 'A') ||
    setweight(to_tsvector('english'::regconfig, coalesce(metadata->>'topic_text','')), 'B') ||
    setweight(to_tsvector('english'::regconfig, left(coalesce(body_html,''), 100000)), 'C')
  ) stored,
  constraint uniq_source_external unique (source_id, external_id),
  constraint owner_matches_visibility check (
    (visibility = 'private' and owner_id is not null) or
    (visibility = 'public'  and owner_id is null)
  ),
  constraint leetcode_needs_external_id check (
    source_id <> 'leetcode' or external_id is not null
  ),
  constraint metadata_is_object check (jsonb_typeof(metadata) = 'object')
);

-- Slug uniqueness. /problems/[slug] looks rows up BY SLUG, so slug must be
-- unambiguous or the route returns two rows and picks arbitrarily.
-- Both indexes are required: per-owner uniqueness alone would let a user author
-- "Two Sum" and collide with the public LeetCode row, and both rows are visible
-- to that user under ci_read.
create unique index if not exists uniq_ci_public_slug
  on content_items (slug) where visibility = 'public';
create unique index if not exists uniq_ci_owner_slug
  on content_items (owner_id, slug) where owner_id is not null;


create table if not exists tags (
  id       uuid primary key default gen_random_uuid(),
  slug     text not null unique,
  name     text not null,
  category text not null default 'topic'   -- 'topic' | 'company' | 'pattern'
);

create table if not exists content_item_tags (
  content_item_id uuid not null references content_items(id) on delete cascade,
  tag_id          uuid not null references tags(id) on delete cascade,
  primary key (content_item_id, tag_id)
);


-- Optional grounding material. Empty for now (Gemini self-generates solutions),
-- but present so a solutions dataset can be added later with zero migration.
create table if not exists content_references (
  id              uuid primary key default gen_random_uuid(),
  content_item_id uuid not null references content_items(id) on delete cascade,
  kind            text not null,   -- 'community_solution' | 'editorial' | 'user_note'
  language        text,
  body            text not null,
  score           int default 0,
  author          text,
  url             text,
  created_at      timestamptz not null default now()
);
create index if not exists idx_cr_item_kind_score
  on content_references (content_item_id, kind, score desc);


create table if not exists mcq_sets (
  id              uuid primary key default gen_random_uuid(),
  content_item_id uuid not null references content_items(id) on delete cascade,
  user_id         uuid not null references auth.users(id) on delete cascade,
  model           text not null,
  language        text not null default 'python3',
  prompt_version  int  not null default 1,   -- bump when src/lib/gemini/prompt.ts changes
  questions       jsonb not null,      -- validated array, 1..8 entries
  answers         jsonb not null default '[]'::jsonb,  -- selections + correctness
  answered_at     timestamptz,
  created_at      timestamptz not null default now(),
  -- Real constraints, not comments. The client reaches this table directly
  -- through PostgREST, so the DB is the last line of defense.
  -- `questions[].kind` is free text: synced problems use the four preset kinds,
  -- authored problems use whatever their author names. Zod validates per-source.
  constraint questions_is_array check (
    jsonb_typeof(questions) = 'array'
    and jsonb_array_length(questions) between 1 and 8),
  constraint answers_is_array check (jsonb_typeof(answers) = 'array'),
  constraint answers_not_longer check (
    jsonb_array_length(answers) <= jsonb_array_length(questions))
);
create index if not exists idx_mcq_user_item
  on mcq_sets (user_id, content_item_id, created_at desc);


create table if not exists bookmarks (
  user_id         uuid not null references auth.users(id) on delete cascade,
  content_item_id uuid not null references content_items(id) on delete cascade,
  created_at      timestamptz not null default now(),
  primary key (user_id, content_item_id)
);


create table if not exists user_settings (
  user_id         uuid primary key references auth.users(id) on delete cascade,
  preferred_model text,
  preferred_lang  text default 'python3',
  gemini_key_id   uuid,       -- FK into vault.secrets. NEVER the raw key.
  updated_at      timestamptz not null default now()
);


create table if not exists sync_runs (
  id         uuid primary key default gen_random_uuid(),
  source_id  text not null references sources(id),
  status     text not null default 'running',   -- running|completed|failed|heartbeat
  cursor     int  not null default 0,           -- slugs fully committed in this run
  processed  int  not null default 0,
  failed     int  not null default 0,
  error      text,
  started_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
-- Resume scans the newest status='running' row per source. The weekly keep-alive
-- writes status='heartbeat' so it is never mistaken for an interrupted sync.
create index if not exists idx_sync_runs_resume
  on sync_runs (source_id, started_at desc) where status = 'running';


-- =========================================================================
-- Indexes on content_items
-- =========================================================================

create index if not exists idx_ci_search   on content_items using gin (search_vector);
create index if not exists idx_ci_trgm     on content_items using gin (title extensions.gin_trgm_ops);
create index if not exists idx_ci_metadata on content_items using gin (metadata jsonb_path_ops);
create index if not exists idx_ci_owner    on content_items (owner_id) where owner_id is not null;

-- Feed order. Keyset-paginated on (sort_key, id): ordering by a random UUID puts
-- Two Sum nowhere near the front. The partial predicate also excludes paid-only
-- rows, whose body_html is null and which would render as blank full-screen cards.
--

create index if not exists idx_ci_feed on content_items (sort_key, id)
  where visibility = 'public' and body_html is not null;


-- =========================================================================
-- updated_at triggers
-- A column default only fires on insert; without these, updated_at reports
-- creation time forever.
-- =========================================================================

create or replace function touch_updated_at() returns trigger
language plpgsql as $$ begin new.updated_at = now(); return new; end $$;

drop trigger if exists trg_ci_touch on content_items;
create trigger trg_ci_touch before update on content_items
  for each row execute function touch_updated_at();

drop trigger if exists trg_us_touch on user_settings;
create trigger trg_us_touch before update on user_settings
  for each row execute function touch_updated_at();

drop trigger if exists trg_sr_touch on sync_runs;
create trigger trg_sr_touch before update on sync_runs
  for each row execute function touch_updated_at();


-- =========================================================================
-- 5-set cap trigger
-- =========================================================================

create or replace function trim_mcq_sets() returns trigger
language plpgsql set search_path = public as $$
begin
  delete from mcq_sets where id in (
    select id from mcq_sets
    where user_id = new.user_id and content_item_id = new.content_item_id
    order by created_at desc, id desc offset 5   -- `id desc` tiebreak is load-bearing
  );
  return null;
end $$;
-- Why the id desc tiebreak matters: created_at defaults to now(), which is
-- TRANSACTION time, so a multi-row insert gives every row an identical timestamp.
-- The sign-in migration inserts a user's whole localStorage history at once;
-- without a tiebreak, `offset 5` sorts arbitrarily and deletes an unpredictable
-- subset, possibly including the row just inserted.
--
-- `security definer` is deliberately ABSENT. It would run the trigger as the
-- owner and bypass RLS, turning this into a cross-user delete primitive the
-- moment mcq_insert's `with check` is ever relaxed. It buys nothing — the
-- insert is already scoped to auth.uid().
--
-- Returning null from an `after` trigger is correct; the value is ignored.

drop trigger if exists trg_trim_mcq on mcq_sets;
create trigger trg_trim_mcq after insert on mcq_sets
  for each row execute function trim_mcq_sets();


-- =========================================================================
-- Row Level Security — enable on EVERY table, without exception
--
-- Supabase grants anon and authenticated full CRUD on every table in `public`
-- by default, and the anon key ships in the browser bundle. RLS is the only
-- thing between that key and the data. A table with RLS off is world-writable:
-- anyone could DELETE every row in `tags`, cascading through content_item_tags
-- and destroying the tag graph, recoverable only by re-running the 50-min seed.
-- =========================================================================

alter table content_items      enable row level security;
alter table mcq_sets           enable row level security;
alter table bookmarks          enable row level security;
alter table user_settings      enable row level security;
alter table content_references enable row level security;
-- These four are reference/infrastructure tables, not user-owned, which is
-- exactly why they are easy to forget.
alter table sources            enable row level security;
alter table tags               enable row level security;
alter table content_item_tags  enable row level security;
alter table sync_runs          enable row level security;

-- Reference tables: read-only to everyone.
drop policy if exists sources_read on sources;
create policy sources_read on sources           for select using (true);

drop policy if exists tags_read on tags;
create policy tags_read    on tags              for select using (true);

drop policy if exists cit_read on content_item_tags;
create policy cit_read     on content_item_tags for select using (true);

-- sync_runs: intentionally NO policy. RLS on + zero policies = deny all except
-- service role. It holds scraper errors and should never be public.

-- Defense in depth: revoke the grants themselves, so a future accidental
-- `disable row level security` does not immediately reopen the hole.
revoke all on sync_runs from anon, authenticated;
revoke insert, update, delete on sources, tags, content_item_tags from anon, authenticated;

-- Use (select auth.uid()), not bare auth.uid() — Postgres caches the former as
-- an InitPlan instead of re-evaluating per row. Measurable on the feed query.

drop policy if exists ci_read on content_items;
create policy ci_read on content_items for select
  using (visibility = 'public' or owner_id = (select auth.uid()));

drop policy if exists ci_insert on content_items;
create policy ci_insert on content_items for insert to authenticated
  with check (owner_id = (select auth.uid())
              and visibility = 'private'
              and source_id = 'user');

-- `with check` must pin visibility and source_id, not just owner_id. Pinning
-- owner_id alone lets a user PATCH their authored row to source_id='leetcode'
-- and pollute the synced namespace.
drop policy if exists ci_update on content_items;
create policy ci_update on content_items for update to authenticated
  using (owner_id = (select auth.uid()))
  with check (owner_id = (select auth.uid())
              and visibility = 'private'
              and source_id = 'user');

drop policy if exists ci_delete on content_items;
create policy ci_delete on content_items for delete to authenticated
  using (owner_id = (select auth.uid()));

drop policy if exists refs_read on content_references;
create policy refs_read on content_references for select
  using (exists (select 1 from content_items c
                 where c.id = content_references.content_item_id
                 and (c.visibility = 'public' or c.owner_id = (select auth.uid()))));

-- mcq_sets: deliberately NOT `for all`. A blanket policy would let the browser
-- PATCH `answers` — or rewrite `correct_index` inside `questions` — directly
-- through PostgREST, bypassing the route handler entirely. Reads and deletes
-- are safe to grant; answer writes go through record_answer() only.
drop policy if exists mcq_read on mcq_sets;
create policy mcq_read   on mcq_sets for select to authenticated
  using (user_id = (select auth.uid()));

drop policy if exists mcq_insert on mcq_sets;
create policy mcq_insert on mcq_sets for insert to authenticated
  with check (user_id = (select auth.uid()));

drop policy if exists mcq_delete on mcq_sets;
create policy mcq_delete on mcq_sets for delete to authenticated
  using (user_id = (select auth.uid()));
-- No UPDATE policy: answer writes are only possible via record_answer().

drop policy if exists bm_all on bookmarks;
create policy bm_all  on bookmarks     for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

drop policy if exists us_all on user_settings;
create policy us_all  on user_settings for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

-- Sync writes use the service-role key, which bypasses RLS — so no public-write
-- policy is needed on content_items. That key lives only in the local .env and
-- in GitHub Actions secrets, never in Vercel's client bundle.


-- =========================================================================
-- Answer writes — record_answer() / reset_answers()
--
-- Correctness is computed IN SQL, so the guarantee holds even against a direct
-- curl call. The `and user_id = auth.uid()` filter is mandatory: security
-- definer bypasses RLS, so without it any authenticated user could answer
-- anyone's set.
-- =========================================================================

create or replace function record_answer(p_set_id uuid, p_index int, p_selected int)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_correct boolean; v_answers jsonb; v_qcount int;
begin
  select (questions->p_index->>'correct_index')::int = p_selected,
         answers, jsonb_array_length(questions)
    into v_correct, v_answers, v_qcount
  from mcq_sets where id = p_set_id and user_id = auth.uid();

  if not found then raise exception 'not found'; end if;
  if p_index < 0 or p_index >= v_qcount then raise exception 'bad index'; end if;
  if p_selected < 0 or p_selected > 3 then raise exception 'bad selection'; end if;

  -- Pad with nulls so out-of-order answering cannot leave holes.
  while jsonb_array_length(v_answers) <= p_index loop
    v_answers := v_answers || jsonb_build_array(null);
  end loop;

  v_answers := jsonb_set(v_answers, array[p_index::text],
    jsonb_build_object('selected_index', p_selected, 'correct', v_correct), true);

  update mcq_sets
     set answers = v_answers,
         answered_at = case
           when not (v_answers @> '[null]'::jsonb)
                and jsonb_array_length(v_answers) >= v_qcount
           then coalesce(answered_at, now()) else answered_at end
   where id = p_set_id and user_id = auth.uid();
  return jsonb_build_object('correct', v_correct, 'answers', v_answers);
end $$;

revoke all on function record_answer(uuid,int,int) from public, anon;
grant execute on function record_answer(uuid,int,int) to authenticated;


-- Retry clears in place rather than creating a new set — a new set would
-- consume one of the five retained slots for identical questions.
create or replace function reset_answers(p_set_id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  update mcq_sets set answers = '[]'::jsonb, answered_at = null
   where id = p_set_id and user_id = auth.uid();
end $$;

revoke all on function reset_answers(uuid) from public, anon;
grant execute on function reset_answers(uuid) to authenticated;

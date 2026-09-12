-- =========================================================================
-- TechDecks — 0008_reset_answer.sql
-- Per-question retry: clear one answer without discarding the rest.
--
-- IDEMPOTENT. Safe to re-run — `create or replace`.
--
-- Apply AFTER 0001_init.sql.
-- =========================================================================
--
-- reset_answers() clears a whole set; this clears one slot. Same security
-- shape as the rest of the answer RPCs: `security definer` so mcq_sets needs no
-- UPDATE policy, with `and user_id = auth.uid()` mandatory precisely because
-- definer bypasses RLS — without it any authenticated user could edit anyone's
-- set.

create or replace function reset_answer(p_set_id uuid, p_index int)
returns void language plpgsql security definer set search_path = public as $$
declare v_answers jsonb; v_qcount int;
begin
  select answers, jsonb_array_length(questions)
    into v_answers, v_qcount
  from mcq_sets where id = p_set_id and user_id = auth.uid();

  if not found then raise exception 'not found'; end if;
  if p_index < 0 or p_index >= v_qcount then raise exception 'bad index'; end if;

  -- Set to null rather than removed: answers are positional against questions,
  -- and deleting an element would re-target every answer after this one.
  if p_index < jsonb_array_length(v_answers) then
    v_answers := jsonb_set(v_answers, array[p_index::text], 'null'::jsonb, false);
  end if;

  -- Clearing one answer un-completes the set, so the completion timestamp goes
  -- with it.
  update mcq_sets set answers = v_answers, answered_at = null
   where id = p_set_id and user_id = auth.uid();
end $$;

revoke all on function reset_answer(uuid, int) from public, anon;
grant execute on function reset_answer(uuid, int) to authenticated;

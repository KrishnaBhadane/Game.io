begin;

-- Step 10-12: Answer submission RPC, result RPC, leaderboard RPC, and grants.

-- 1. Grant INSERT on submissions to authenticated (players need to submit via RPC, but RPC is security definer).
--    Grant SELECT so players can read their own submission for result display.
grant select, insert on public.submissions to authenticated;

-- Players can only read their own submissions.
drop policy if exists player_reads_own_submissions on public.submissions;
create policy player_reads_own_submissions on public.submissions for select to authenticated
  using (
    exists (
      select 1 from public.game_players gp
      where gp.id = player_id
        and gp.user_id = (select auth.uid())
    )
    or exists (
      select 1 from public.games g
      where g.id = game_id and g.host_id = (select auth.uid())
    )
  );

-- Players must NOT directly insert submissions (the RPC does it as security definer).
-- No insert policy needed for authenticated on submissions.

-- 2. Ensure players cannot directly update game_players balance or score.
--    Grant already exists (select, insert from Step 6). No update grant for players.
--    Hosts already have update via host_updates_games (their own table).
--    game_players update is not granted to authenticated at all — scoring happens via security definer RPC.

-- 3. Enable realtime for submissions so player count updates for admin.
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and tablename = 'submissions'
  ) then
    alter publication supabase_realtime add table public.submissions;
  end if;
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and tablename = 'game_players'
  ) then
    alter publication supabase_realtime add table public.game_players;
  end if;
end;
$$;

-- 4. SECURE ANSWER SUBMISSION RPC
-- Frontend sends: question_id, selected_option, risk_label ('No Risk'|'2x'|'3x'|'5x')
-- Function resolves everything server-side and returns the result.
create or replace function public.submit_answer(
  p_question_id uuid,
  p_selected_option text,
  p_risk_label text  -- 'No Risk', '2x', '3x', '5x'
)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id      uuid := (select auth.uid());
  v_player       game_players;
  v_game         games;
  v_question     questions;
  v_multiplier   numeric;
  v_base_reward  numeric;
  v_balance_change numeric;
  v_new_balance  numeric;
  v_is_correct   boolean;
  v_submission   submissions;
begin
  -- Validate option
  if p_selected_option not in ('A','B','C','D') then
    raise exception 'Invalid option: %', p_selected_option;
  end if;

  -- Resolve multiplier from label
  v_multiplier := case p_risk_label
    when 'No Risk' then 1
    when '2x'      then 2
    when '3x'      then 3
    when '5x'      then 5
    else null
  end;
  if v_multiplier is null then
    raise exception 'Invalid risk: %', p_risk_label;
  end if;

  -- Fetch question
  select * into v_question from public.questions where id = p_question_id;
  if not found then
    raise exception 'Question not found.';
  end if;

  -- Fetch game
  select * into v_game from public.games where id = v_question.game_id;
  if not found or v_game.status <> 'active' then
    raise exception 'Game is not active.';
  end if;

  -- Verify this is the currently published question
  if v_game.current_question_id <> p_question_id then
    raise exception 'This question is not currently live.';
  end if;

  -- Verify risk is allowed
  if not (v_game.allowed_multipliers @> to_jsonb(p_risk_label)) then
    raise exception 'Risk % is not allowed in this game.', p_risk_label;
  end if;

  -- Fetch player row (must have joined this game)
  select * into v_player
  from public.game_players
  where game_id = v_game.id and user_id = v_user_id;
  if not found then
    raise exception 'You have not joined this game.';
  end if;

  -- Check for duplicate submission
  if exists (
    select 1 from public.submissions
    where question_id = p_question_id and player_id = v_player.id
  ) then
    raise exception 'Already submitted for this question.';
  end if;

  -- Scoring
  v_base_reward := v_game.starting_balance * 0.10;
  v_is_correct  := (p_selected_option = v_question.correct_option);

  if v_is_correct then
    v_balance_change := v_base_reward * v_multiplier;
  elsif v_multiplier = 1 then
    -- No Risk: wrong = 0 change
    v_balance_change := 0;
  else
    v_balance_change := -(v_base_reward * v_multiplier);
  end if;

  v_new_balance := greatest(0, v_player.balance + v_balance_change);

  -- Insert submission
  insert into public.submissions (
    game_id, question_id, player_id,
    selected_option, risk_multiplier,
    is_correct, balance_change
  ) values (
    v_game.id, p_question_id, v_player.id,
    p_selected_option, v_multiplier,
    v_is_correct, v_balance_change
  )
  returning * into v_submission;

  -- Update player balance and score atomically
  update public.game_players
  set
    balance = v_new_balance,
    score   = score + (case when v_is_correct then 1 else 0 end)
  where id = v_player.id;

  -- Return result (never includes correct_option raw, but we reveal after submission)
  return json_build_object(
    'is_correct',      v_is_correct,
    'correct_option',  v_question.correct_option,
    'selected_option', p_selected_option,
    'risk_label',      p_risk_label,
    'balance_change',  v_balance_change,
    'new_balance',     v_new_balance
  );
end;
$$;

revoke all on function public.submit_answer(uuid, text, text) from public;
grant execute on function public.submit_answer(uuid, text, text) to authenticated;

-- 5. GET MY SUBMISSION RPC (for refresh — player fetches their own result for current question)
create or replace function public.get_my_submission(p_question_id uuid)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id  uuid := (select auth.uid());
  v_player   game_players;
  v_question questions;
  v_sub      submissions;
begin
  select * into v_question from public.questions where id = p_question_id;
  if not found then return null; end if;

  select * into v_player
  from public.game_players
  where game_id = v_question.game_id and user_id = v_user_id;
  if not found then return null; end if;

  select * into v_sub
  from public.submissions
  where question_id = p_question_id and player_id = v_player.id;
  if not found then return null; end if;

  return json_build_object(
    'is_correct',      v_sub.is_correct,
    'correct_option',  v_question.correct_option,
    'selected_option', v_sub.selected_option,
    'risk_multiplier', v_sub.risk_multiplier,
    'balance_change',  v_sub.balance_change
  );
end;
$$;

revoke all on function public.get_my_submission(uuid) from public;
grant execute on function public.get_my_submission(uuid) to authenticated;

-- 6. LEADERBOARD RPC — returns nickname, balance, score only. No user_id.
create or replace function public.get_leaderboard(p_game_id uuid)
returns table (
  nickname text,
  balance  numeric,
  score    integer,
  rank     bigint
)
language sql
security definer
set search_path = public
as $$
  select
    gp.nickname,
    gp.balance,
    gp.score,
    rank() over (order by gp.balance desc, gp.score desc, gp.joined_at asc) as rank
  from public.game_players gp
  where gp.game_id = p_game_id
    -- caller must be host or a joined player
    and (
      exists (select 1 from public.games g where g.id = p_game_id and g.host_id = (select auth.uid()))
      or exists (select 1 from public.game_players me where me.game_id = p_game_id and me.user_id = (select auth.uid()))
    )
  order by rank, gp.joined_at;
$$;

revoke all on function public.get_leaderboard(uuid) from public;
grant execute on function public.get_leaderboard(uuid) to authenticated;

-- 7. Submission count for admin: count for current question visible via existing host policy.
--    No extra RPC needed — admin can query submissions filtered by question_id via host RLS.

commit;

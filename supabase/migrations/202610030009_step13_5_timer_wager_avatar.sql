begin;

-- Step 13.5: Per-question timer, wager amount, and player avatars.

-- 1. Add time_limit_seconds to questions (positive integer)
alter table public.questions
  add column if not exists time_limit_seconds integer not null default 30 check (time_limit_seconds > 0);

-- 2. Add avatar to game_players
alter table public.game_players
  add column if not exists avatar text not null default 'straw-hat';

-- 3. Add wager to submissions
alter table public.submissions
  add column if not exists wager numeric(14,2) not null default 0 check (wager >= 0);

-- 4. Update get_live_question RPC to include time_limit_seconds
drop function if exists public.get_live_question(text);

create or replace function public.get_live_question(p_game_code text)
returns table (
  id uuid,
  question_text text,
  option_a text,
  option_b text,
  option_c text,
  option_d text,
  order_number integer,
  time_limit_seconds integer,
  question_started_at timestamptz
)
language sql
security definer
set search_path = public
as $$
  select
    q.id,
    q.question_text,
    q.option_a,
    q.option_b,
    q.option_c,
    q.option_d,
    q.order_number,
    q.time_limit_seconds,
    g.question_started_at
  from public.games g
  join public.questions q on q.id = g.current_question_id
  where upper(g.game_code) = upper(trim(p_game_code))
    and g.current_question_id is not null
    -- player must have joined this game
    and exists (
      select 1 from public.game_players gp
      where gp.game_id = g.id
        and gp.user_id = (select auth.uid())
    )
  limit 1;
$$;

revoke all on function public.get_live_question(text) from public;
grant execute on function public.get_live_question(text) to authenticated;

-- 5. Update submit_answer RPC with timer check and wager-based scoring
drop function if exists public.submit_answer(uuid, text, text);
drop function if exists public.submit_answer(uuid, text, text, numeric);

create or replace function public.submit_answer(
  p_question_id uuid,
  p_selected_option text,
  p_risk_label text,  -- 'No Risk', '2x', '3x', '5x'
  p_wager numeric default 10
)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id        uuid := (select auth.uid());
  v_player         game_players;
  v_game           games;
  v_question       questions;
  v_multiplier     numeric;
  v_balance_change numeric;
  v_new_balance    numeric;
  v_is_correct     boolean;
  v_submission     submissions;
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

  -- Check timer expiration (server protection)
  if v_game.question_started_at is not null and v_question.time_limit_seconds is not null then
    if now() > v_game.question_started_at + (v_question.time_limit_seconds * interval '1 second') then
      raise exception 'Time has expired for this question.';
    end if;
  end if;

  -- Verify risk is allowed
  if not (v_game.allowed_multipliers @> to_jsonb(p_risk_label)) then
    raise exception 'Risk % is not allowed in this game.', p_risk_label;
  end if;

  -- Fetch player row
  select * into v_player
  from public.game_players
  where game_id = v_game.id and user_id = v_user_id;
  if not found then
    raise exception 'You have not joined this game.';
  end if;

  -- Validate wager
  if p_wager is null or p_wager <= 0 then
    raise exception 'Wager must be greater than zero.';
  end if;
  if p_wager > v_player.balance then
    raise exception 'Wager exceeds your current balance.';
  end if;

  -- Check duplicate submission
  if exists (
    select 1 from public.submissions
    where question_id = p_question_id and player_id = v_player.id
  ) then
    raise exception 'Already submitted for this question.';
  end if;

  -- Scoring based on player wager
  v_is_correct := (p_selected_option = v_question.correct_option);

  if v_is_correct then
    v_balance_change := p_wager * v_multiplier;
  elsif v_multiplier = 1 then
    -- No Risk: wrong = 0 change
    v_balance_change := 0;
  else
    v_balance_change := -(p_wager * v_multiplier);
  end if;

  v_new_balance := greatest(0, v_player.balance + v_balance_change);

  -- Insert submission
  insert into public.submissions (
    game_id, question_id, player_id,
    selected_option, risk_multiplier,
    wager, is_correct, balance_change
  ) values (
    v_game.id, p_question_id, v_player.id,
    p_selected_option, v_multiplier,
    p_wager, v_is_correct, v_balance_change
  )
  returning * into v_submission;

  -- Update player balance and score atomically
  update public.game_players
  set
    balance = v_new_balance,
    score   = score + (case when v_is_correct then 1 else 0 end)
  where id = v_player.id;

  -- Return result
  return json_build_object(
    'is_correct',      v_is_correct,
    'correct_option',  v_question.correct_option,
    'selected_option', p_selected_option,
    'risk_label',      p_risk_label,
    'wager',           p_wager,
    'balance_change',  v_balance_change,
    'new_balance',     v_new_balance
  );
end;
$$;

revoke all on function public.submit_answer(uuid, text, text, numeric) from public;
grant execute on function public.submit_answer(uuid, text, text, numeric) to authenticated;

-- 6. Update get_leaderboard RPC to include avatar
drop function if exists public.get_leaderboard(uuid);

create or replace function public.get_leaderboard(p_game_id uuid)
returns table (
  nickname text,
  avatar   text,
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
    coalesce(gp.avatar, 'straw-hat') as avatar,
    gp.balance,
    gp.score,
    rank() over (order by gp.balance desc, gp.score desc) as rank
  from public.game_players gp
  where gp.game_id = p_game_id
    and (
      exists (select 1 from public.games g where g.id = p_game_id and g.host_id = (select auth.uid()))
      or exists (select 1 from public.game_players me where me.game_id = p_game_id and me.user_id = (select auth.uid()))
    )
  order by rank, gp.joined_at;
$$;

revoke all on function public.get_leaderboard(uuid) from public;
grant execute on function public.get_leaderboard(uuid) to authenticated;

commit;

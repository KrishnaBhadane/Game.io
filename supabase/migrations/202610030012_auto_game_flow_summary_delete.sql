begin;

-- Server-authoritative game start: host starts on the first ordered question.
create or replace function public.start_game(p_game_id uuid)
returns table (
  id uuid,
  status text,
  current_question_id uuid,
  question_started_at timestamptz,
  ended_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_game public.games%rowtype;
  v_first_question_id uuid;
begin
  if auth.uid() is null then raise exception 'Not authenticated.'; end if;

  select * into v_game from public.games where games.id = p_game_id for update;
  if not found then raise exception 'Game not found.'; end if;
  if v_game.host_id <> auth.uid() then raise exception 'Not authorised to start this game.'; end if;
  if v_game.status <> 'waiting' then raise exception 'Game has already started.'; end if;

  select q.id into v_first_question_id
  from public.questions q
  where q.game_id = p_game_id
  order by q.order_number asc
  limit 1;
  if v_first_question_id is null then raise exception 'Add a question before starting.'; end if;

  update public.games
  set status = 'active', current_question_id = v_first_question_id,
      question_started_at = clock_timestamp(), ended_at = null
  where games.id = p_game_id
  returning games.id, games.status, games.current_question_id,
    games.question_started_at, games.ended_at
  into id, status, current_question_id, question_started_at, ended_at;
  return next;
end;
$$;

-- Safe for the host or a joined player to call. The row lock makes it idempotent.
create or replace function public.advance_game_if_due(p_game_id uuid)
returns table (
  status text,
  current_question_id uuid,
  question_started_at timestamptz,
  ended_at timestamptz,
  advanced boolean,
  remaining_ms numeric
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_game public.games%rowtype;
  v_current public.questions%rowtype;
  v_next_question_id uuid;
begin
  if auth.uid() is null then raise exception 'Not authenticated.'; end if;

  select * into v_game from public.games where games.id = p_game_id for update;
  if not found then raise exception 'Game not found.'; end if;
  if v_game.host_id <> auth.uid() and not exists (
    select 1 from public.game_players gp
    where gp.game_id = p_game_id and gp.user_id = auth.uid()
  ) then raise exception 'Not authorised for this game.'; end if;

  if v_game.status <> 'active' or v_game.current_question_id is null then
    status := v_game.status;
    current_question_id := v_game.current_question_id;
    question_started_at := v_game.question_started_at;
    ended_at := v_game.ended_at;
    advanced := false;
    return next;
    return;
  end if;

  select * into v_current from public.questions where id = v_game.current_question_id;
  if not found then raise exception 'Current question not found.'; end if;
  if v_game.question_started_at is null then raise exception 'Current question timer missing.'; end if;
  if clock_timestamp() < v_game.question_started_at + (v_current.time_limit_seconds * interval '1 second') then
    status := v_game.status;
    current_question_id := v_game.current_question_id;
    question_started_at := v_game.question_started_at;
    ended_at := v_game.ended_at;
    advanced := false;
    remaining_ms := greatest(0, extract(epoch from (v_game.question_started_at + v_current.time_limit_seconds * interval '1 second' - clock_timestamp())) * 1000);
    return next;
    return;
  end if;

  select q.id into v_next_question_id
  from public.questions q
  where q.game_id = p_game_id and q.order_number > v_current.order_number
  order by q.order_number asc
  limit 1;

  if v_next_question_id is null then
    update public.games
    set status = 'ended', ended_at = clock_timestamp()
    where games.id = p_game_id
    returning games.status, games.current_question_id, games.question_started_at, games.ended_at
    into status, current_question_id, question_started_at, ended_at;
  else
    update public.games
    set current_question_id = v_next_question_id, question_started_at = clock_timestamp()
    where games.id = p_game_id
    returning games.status, games.current_question_id, games.question_started_at, games.ended_at
    into status, current_question_id, question_started_at, ended_at;
  end if;
  if status = 'active' then
    select q.time_limit_seconds * 1000 into remaining_ms from public.questions q where q.id = v_next_question_id;
  end if;
  advanced := true;
  return next;
end;
$$;

-- Final, caller-owned history only. Answer keys are never returned.
create or replace function public.get_my_game_summary(p_game_id uuid)
returns table (
  question_number integer,
  question_text text,
  selected_option text,
  selected_answer text,
  result text,
  wager numeric,
  risk_multiplier numeric,
  gained numeric,
  deducted numeric,
  balance_change numeric
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_player_id uuid;
  v_status text;
begin
  if auth.uid() is null then raise exception 'Not authenticated.'; end if;
  select g.status, gp.id into v_status, v_player_id
  from public.games g
  join public.game_players gp on gp.game_id = g.id
  where g.id = p_game_id and gp.user_id = auth.uid();
  if v_player_id is null then raise exception 'You have not joined this game.'; end if;
  if v_status <> 'ended' then raise exception 'Results are not ready.'; end if;

  return query
  with recursive history as (
    select s.*, row_number() over (order by s.submitted_at, s.id) as n
    from public.submissions s where s.player_id = v_player_id
  ), money(n, balance, actual_change) as (
    select 0::bigint, g.starting_balance::numeric, 0::numeric
    from public.games g where g.id = p_game_id
    union all
    select h.n, greatest(0, m.balance + h.balance_change),
      greatest(0, m.balance + h.balance_change) - m.balance
    from money m join history h on h.n = m.n + 1
  ), own_submissions as (
    select h.*, m.actual_change from history h join money m on m.n = h.n
  )
  select q.order_number, q.question_text, s.selected_option,
    case s.selected_option when 'A' then q.option_a when 'B' then q.option_b
      when 'C' then q.option_c when 'D' then q.option_d end,
    case when s.id is null then 'unanswered' when s.is_correct then 'correct' else 'wrong' end,
    coalesce(s.wager, 0), s.risk_multiplier,
    greatest(coalesce(s.actual_change, 0), 0),
    greatest(-coalesce(s.actual_change, 0), 0), coalesce(s.actual_change, 0)
  from public.questions q
  left join own_submissions s on s.question_id = q.id and s.player_id = v_player_id
  where q.game_id = p_game_id
  order by q.order_number asc;
end;
$$;

-- Hosts may remove only games that are not live. Foreign-key cascades remove game data.
create or replace function public.delete_game(p_game_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_game public.games%rowtype;
begin
  if auth.uid() is null then raise exception 'Not authenticated.'; end if;
  select * into v_game from public.games where games.id = p_game_id for update;
  if not found then raise exception 'Game not found.'; end if;
  if v_game.host_id <> auth.uid() then raise exception 'Not authorised to delete this game.'; end if;
  if v_game.status = 'active' then raise exception 'End the game before deleting it.'; end if;
  delete from public.games where games.id = p_game_id;
end;
$$;

-- Serialize manual changes with automatic advancement and answer submission.
create or replace function public.publish_question(p_game_id uuid, p_question_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_game public.games%rowtype;
begin
  select * into v_game from public.games where id = p_game_id for update;
  if auth.uid() is null or not found or v_game.host_id <> auth.uid() or v_game.status <> 'active' then
    raise exception 'Cannot publish: game is not active or you are not the host.';
  end if;
  if not exists (select 1 from public.questions where id = p_question_id and game_id = p_game_id) then
    raise exception 'Question not found.';
  end if;
  update public.games set current_question_id = p_question_id, question_started_at = clock_timestamp() where id = p_game_id;
end;
$$;

-- A shared game lock lets answers run concurrently, while end/advance waits for them.
create or replace function public.submit_answer(p_question_id uuid, p_selected_option text, p_risk_label text, p_wager numeric default 10)
returns json language plpgsql security definer set search_path = public as $$
declare
  v_game public.games%rowtype;
  v_question public.questions%rowtype;
  v_player public.game_players%rowtype;
  v_multiplier numeric;
  v_change numeric;
  v_balance numeric;
  v_correct boolean;
begin
  if auth.uid() is null then raise exception 'Not authenticated.'; end if;
  select * into v_question from public.questions where id = p_question_id;
  if not found then raise exception 'Question not found.'; end if;
  select * into v_game from public.games where id = v_question.game_id for share;
  if not found or v_game.status <> 'active' then raise exception 'Game is not active.'; end if;
  if v_game.current_question_id is distinct from p_question_id then raise exception 'This question is not currently live.'; end if;
  if v_game.question_started_at is null or clock_timestamp() >= v_game.question_started_at + v_question.time_limit_seconds * interval '1 second' then
    raise exception 'Time has expired for this question.';
  end if;
  if p_selected_option is null or p_selected_option not in ('A', 'B', 'C', 'D') then raise exception 'Invalid answer.'; end if;
  v_multiplier := case p_risk_label when 'No Risk' then 1 when '2x' then 2 when '3x' then 3 when '5x' then 5 end;
  if v_multiplier is null or not (v_game.allowed_multipliers @> to_jsonb(p_risk_label)) then raise exception 'Invalid risk.'; end if;
  select * into v_player from public.game_players where game_id = v_game.id and user_id = auth.uid() for update;
  if not found then raise exception 'You have not joined this game.'; end if;
  if p_wager is null or p_wager <= 0 or p_wager > v_player.balance or p_wager <> round(p_wager, 2) then raise exception 'Invalid wager.'; end if;
  if exists (select 1 from public.submissions where question_id = p_question_id and player_id = v_player.id) then raise exception 'Already submitted.'; end if;
  v_correct := p_selected_option = v_question.correct_option;
  v_change := case when v_correct then p_wager * v_multiplier when v_multiplier = 1 then 0 else -p_wager * v_multiplier end;
  v_balance := greatest(0, v_player.balance + v_change);
  -- Store the actual change after the existing zero-balance floor.
  v_change := v_balance - v_player.balance;
  insert into public.submissions (game_id, question_id, player_id, selected_option, risk_multiplier, wager, is_correct, balance_change)
  values (v_game.id, p_question_id, v_player.id, p_selected_option, v_multiplier, p_wager, v_correct, v_change);
  update public.game_players set balance = v_balance, score = score + case when v_correct then 1 else 0 end where id = v_player.id;
  return json_build_object('is_correct', v_correct, 'correct_option', v_question.correct_option, 'selected_option', p_selected_option,
    'risk_label', p_risk_label, 'wager', p_wager, 'balance_change', v_change, 'new_balance', v_balance);
end;
$$;

-- Restore the saved wager too, rather than showing the current slider on refresh.
create or replace function public.get_my_submission(p_question_id uuid)
returns json language sql security definer set search_path = public as $$
  select json_build_object('is_correct', s.is_correct, 'correct_option', q.correct_option,
    'selected_option', s.selected_option, 'risk_multiplier', s.risk_multiplier,
    'wager', s.wager, 'balance_change', s.balance_change, 'new_balance', gp.balance)
  from public.submissions s join public.questions q on q.id = s.question_id
  join public.game_players gp on gp.id = s.player_id
  where s.question_id = p_question_id and gp.user_id = auth.uid();
$$;

-- Keep shared ranks and identify the caller without returning auth IDs.
drop function public.get_leaderboard(uuid);
create function public.get_leaderboard(p_game_id uuid)
returns table(nickname text, avatar text, balance numeric, score integer, rank bigint, is_me boolean)
language sql security definer set search_path = public as $$
  select gp.nickname, gp.avatar, gp.balance, gp.score,
    rank() over (order by gp.balance desc, gp.score desc), gp.user_id = auth.uid()
  from public.game_players gp where gp.game_id = p_game_id and (
    exists (select 1 from public.games g where g.id = p_game_id and g.host_id = auth.uid()) or
    exists (select 1 from public.game_players me where me.game_id = p_game_id and me.user_id = auth.uid())
  ) order by gp.balance desc, gp.score desc, gp.joined_at;
$$;
revoke all on function public.get_leaderboard(uuid) from public;
grant execute on function public.get_leaderboard(uuid) to authenticated;

-- Preserve the joined-player rule without games <-> game_players RLS recursion.
create or replace function public.is_game_member(p_game_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.game_players where game_id = p_game_id and user_id = auth.uid());
$$;
revoke all on function public.is_game_member(uuid) from public;
grant execute on function public.is_game_member(uuid) to authenticated;
drop policy if exists player_reads_joined_game on public.games;
create policy player_reads_joined_game on public.games for select to authenticated
  using (public.is_game_member(id));

-- Fix the existing join's ambiguous output-column name and serialize it with start.
create or replace function public.join_game_player(p_game_code text, p_nickname text, p_avatar text)
returns table(player_id uuid, game_id uuid, game_code text, game_name text, nickname text, avatar text, balance numeric, score integer, status text)
language plpgsql security definer set search_path = public as $$
declare
  v_game public.games%rowtype;
  v_player public.game_players%rowtype;
begin
  if auth.uid() is null then raise exception 'Not authenticated.'; end if;
  select g.* into v_game from public.games g where g.game_code = upper(trim(p_game_code)) for update;
  if not found then raise exception 'Game not found.'; end if;
  select gp.* into v_player from public.game_players gp where gp.game_id = v_game.id and gp.user_id = auth.uid();
  if not found then
    if v_game.status <> 'waiting' then raise exception 'This game has already started or ended.'; end if;
    if p_nickname is null or char_length(trim(p_nickname)) not between 2 and 20 then raise exception 'Nickname must be 2–20 characters.'; end if;
    if p_avatar is null or p_avatar not in ('straw-hat','swordsman','navigator','cook','doctor','captain','pirate-flag','sniper','shipwright','musician') then raise exception 'Invalid avatar.'; end if;
    insert into public.game_players(game_id,user_id,nickname,avatar,balance,score)
    values(v_game.id,auth.uid(),trim(p_nickname),p_avatar,v_game.starting_balance,0)
    returning * into v_player;
  end if;
  return query select v_player.id,v_game.id,v_game.game_code,v_game.name,v_player.nickname,v_player.avatar,v_player.balance,v_player.score,v_game.status;
end;
$$;

-- State changes must go through the RPC guards, including host clients.
revoke update on public.games from authenticated;

revoke all on function public.start_game(uuid) from public;
revoke all on function public.advance_game_if_due(uuid) from public;
revoke all on function public.get_my_game_summary(uuid) from public;
revoke all on function public.delete_game(uuid) from public;
grant execute on function public.start_game(uuid), public.advance_game_if_due(uuid),
  public.get_my_game_summary(uuid), public.delete_game(uuid) to authenticated;

commit;

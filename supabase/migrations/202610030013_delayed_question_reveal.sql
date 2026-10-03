begin;

-- Apply between games: older clients scored immediately.
do $$ begin
  if exists (select 1 from public.games where status = 'active') then
    raise exception 'End active games before applying the delayed-reveal migration.';
  end if;
end $$;

alter table public.games add column if not exists question_revealed_at timestamptz;

-- Internal settlement: one locked transaction scores all answers after the deadline.
-- No client can call this helper directly.
create or replace function public.settle_due_question(p_game_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  g public.games%rowtype;
  q public.questions%rowtype;
  s public.submissions%rowtype;
  old_balance numeric;
  new_balance numeric;
  correct boolean;
begin
  select * into g from public.games where id = p_game_id for update;
  if not found or g.status <> 'active' or g.question_revealed_at is not null then return; end if;
  select * into q from public.questions where id = g.current_question_id;
  if not found or g.question_started_at is null or
    clock_timestamp() < g.question_started_at + q.time_limit_seconds * interval '1 second' then return; end if;
  for s in select * from public.submissions where question_id = q.id and is_correct is null order by player_id loop
    select balance into old_balance from public.game_players where id = s.player_id for update;
    correct := s.selected_option = q.correct_option;
    new_balance := greatest(0, old_balance + case
      when correct then s.wager * s.risk_multiplier
      when s.risk_multiplier = 1 then 0 else -s.wager * s.risk_multiplier end);
    update public.submissions set is_correct = correct, balance_change = new_balance - old_balance where id = s.id;
    update public.game_players set balance = new_balance, score = score + case when correct then 1 else 0 end where id = s.player_id;
  end loop;
  update public.games set question_revealed_at = clock_timestamp() where id = p_game_id;
end;
$$;
revoke all on function public.settle_due_question(uuid) from public, anon, authenticated;

create or replace function public.submit_answer(p_question_id uuid, p_selected_option text, p_risk_label text, p_wager numeric default 10)
returns json language plpgsql security definer set search_path = public as $$
declare
  v_game public.games%rowtype;
  v_question public.questions%rowtype;
  v_player public.game_players%rowtype;
  v_multiplier numeric;
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
  insert into public.submissions (game_id, question_id, player_id, selected_option, risk_multiplier, wager)
  values (v_game.id, p_question_id, v_player.id, p_selected_option, v_multiplier, p_wager);
  return json_build_object('status', 'pending', 'selected_option', p_selected_option,
    'risk_multiplier', v_multiplier, 'wager', p_wager);
end;
$$;

-- Pending responses contain only the player's own selection, wager and risk.
create or replace function public.get_my_submission(p_question_id uuid)
returns json language plpgsql security definer set search_path = public as $$
declare
  g public.games%rowtype;
  q public.questions%rowtype;
  p public.game_players%rowtype;
  s public.submissions%rowtype;
  reveal boolean;
begin
  select * into q from public.questions where id = p_question_id;
  if not found then return null; end if;
  select * into p from public.game_players where game_id = q.game_id and user_id = auth.uid();
  if not found then raise exception 'You have not joined this game.'; end if;
  perform public.settle_due_question(q.game_id);
  select * into g from public.games where id = q.game_id;
  select * into s from public.submissions where question_id = q.id and player_id = p.id;
  if g.current_question_id = q.id then
    reveal := g.question_revealed_at is not null and
      clock_timestamp() >= g.question_started_at + q.time_limit_seconds * interval '1 second';
  else
    reveal := s.is_correct is not null;
  end if;
  if not coalesce(reveal, false) then
    if s.id is null then return null; end if;
    return json_build_object('status', 'pending', 'selected_option', s.selected_option,
      'wager', s.wager, 'risk_multiplier', s.risk_multiplier);
  end if;
  select * into p from public.game_players where id = p.id;
  return json_build_object('status', 'revealed', 'selected_option', s.selected_option,
    'correct_option', q.correct_option, 'is_correct', s.is_correct,
    'wager', coalesce(s.wager, 0), 'risk_multiplier', s.risk_multiplier,
    'balance_change', coalesce(s.balance_change, 0), 'new_balance', p.balance);
end;
$$;

-- Existing deadline watchers now wake once for reveal and once for advancement.
drop function public.advance_game_if_due(uuid);
create function public.advance_game_if_due(p_game_id uuid)
returns table(status text, current_question_id uuid, question_started_at timestamptz,
  ended_at timestamptz, advanced boolean, remaining_ms numeric, question_revealed_at timestamptz)
language plpgsql security definer set search_path = public as $$
declare
  g public.games%rowtype;
  q public.questions%rowtype;
  next_id uuid;
begin
  if auth.uid() is null then raise exception 'Not authenticated.'; end if;
  select * into g from public.games where id = p_game_id for update;
  if not found then raise exception 'Game not found.'; end if;
  if g.host_id <> auth.uid() and not public.is_game_member(p_game_id) then raise exception 'Not authorised for this game.'; end if;
  advanced := false;
  if g.status = 'active' and g.current_question_id is not null then
    perform public.settle_due_question(p_game_id);
    select * into g from public.games where id = p_game_id;
    if g.question_revealed_at is not null and clock_timestamp() >= g.question_revealed_at + interval '5 seconds' then
      select * into q from public.questions where id = g.current_question_id;
      select x.id into next_id from public.questions x where x.game_id = p_game_id and x.order_number > q.order_number order by x.order_number limit 1;
      if next_id is null then
        update public.games set status = 'ended', ended_at = clock_timestamp() where id = p_game_id;
      else
        update public.games set current_question_id = next_id, question_started_at = clock_timestamp(), question_revealed_at = null where id = p_game_id;
      end if;
      advanced := true;
      select * into g from public.games where id = p_game_id;
    end if;
    if g.status = 'active' then
      select * into q from public.questions where id = g.current_question_id;
      remaining_ms := greatest(0, extract(epoch from (
        coalesce(g.question_revealed_at + interval '5 seconds', g.question_started_at + q.time_limit_seconds * interval '1 second') - clock_timestamp()
      )) * 1000);
    end if;
  end if;
  status := g.status; current_question_id := g.current_question_id;
  question_started_at := g.question_started_at; ended_at := g.ended_at;
  question_revealed_at := g.question_revealed_at;
  return next;
end;
$$;
revoke all on function public.advance_game_if_due(uuid) from public;
grant execute on function public.advance_game_if_due(uuid) to authenticated;

-- Manual overrides cannot skip the answer/reveal period.
create or replace function public.publish_question(p_game_id uuid, p_question_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare g public.games%rowtype;
begin
  select * into g from public.games where id = p_game_id for update;
  if auth.uid() is null or not found or g.host_id <> auth.uid() or g.status <> 'active' then
    raise exception 'Cannot publish: game is not active or you are not the host.';
  end if;
  perform public.settle_due_question(p_game_id);
  select * into g from public.games where id = p_game_id;
  if g.current_question_id is not null and (g.question_revealed_at is null or clock_timestamp() < g.question_revealed_at + interval '5 seconds') then
    raise exception 'Wait for the question reveal to finish.';
  end if;
  if not exists (select 1 from public.questions where id = p_question_id and game_id = p_game_id) then raise exception 'Question not found.'; end if;
  update public.games set current_question_id = p_question_id, question_started_at = clock_timestamp(), question_revealed_at = null where id = p_game_id;
end;
$$;

create or replace function public.end_game(p_game_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare g public.games%rowtype;
begin
  select * into g from public.games where id = p_game_id for update;
  if auth.uid() is null or not found or g.host_id <> auth.uid() then raise exception 'Not authorised to end this game.'; end if;
  -- Only expired questions settle; an early host stop leaves pending answers unscored.
  perform public.settle_due_question(p_game_id);
  update public.games set status = 'ended', ended_at = coalesce(g.ended_at, clock_timestamp()) where id = p_game_id;
end;
$$;

-- Raw submissions are host-only. Players use the gated result/summary RPCs.
drop policy if exists player_or_host_reads_submissions on public.submissions;
drop policy if exists player_reads_own_submissions on public.submissions;
create policy host_reads_submissions on public.submissions for select to authenticated
  using (exists (select 1 from public.games g where g.id = game_id and g.host_id = auth.uid()));

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
    case when s.is_correct is null then 'unanswered' when s.is_correct then 'correct' else 'wrong' end,
    case when s.is_correct is null then 0 else s.wager end, s.risk_multiplier,
    greatest(coalesce(s.actual_change, 0), 0),
    greatest(-coalesce(s.actual_change, 0), 0), coalesce(s.actual_change, 0)
  from public.questions q
  left join own_submissions s on s.question_id = q.id and s.player_id = v_player_id
  where q.game_id = p_game_id
  order by q.order_number asc;
end;
$$;

commit;

begin;

-- Step 13: End game support — ended_at column, end_game RPC, server-side guards, and tie-aware leaderboard.

-- 1. Add ended_at to games
alter table public.games
  add column if not exists ended_at timestamptz;

-- 2. Secure RPC: host ends their own game
create or replace function public.end_game(p_game_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Only the host may end the game
  if not exists (
    select 1 from public.games
    where id = p_game_id and host_id = (select auth.uid())
  ) then
    raise exception 'Not authorised to end this game.';
  end if;

  update public.games
  set status = 'ended', ended_at = now()
  where id = p_game_id;
end;
$$;

revoke all on function public.end_game(uuid) from public;
grant execute on function public.end_game(uuid) to authenticated;

-- 3. Secure RPC: publish_question with server-side check that game is active and caller is host
create or replace function public.publish_question(p_game_id uuid, p_question_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Host only, game must be active
  if not exists (
    select 1 from public.games
    where id = p_game_id and host_id = (select auth.uid()) and status = 'active'
  ) then
    raise exception 'Cannot publish: game is not active or you are not the host.';
  end if;

  -- Question must belong to this game
  if not exists (
    select 1 from public.questions where id = p_question_id and game_id = p_game_id
  ) then
    raise exception 'Question does not belong to this game.';
  end if;

  update public.games
  set current_question_id = p_question_id,
      question_started_at = now()
  where id = p_game_id;
end;
$$;

revoke all on function public.publish_question(uuid, uuid) from public;
grant execute on function public.publish_question(uuid, uuid) to authenticated;

-- 4. Server-side protection: reject new player joins if game is not 'waiting'
drop policy if exists player_inserts_self on public.game_players;
create policy player_inserts_self on public.game_players for insert to authenticated
  with check (
    user_id = (select auth.uid())
    and exists (
      select 1 from public.games g
      where g.id = game_id and g.status = 'waiting'
    )
  );

-- 5. Tie-aware leaderboard RPC: rank() partitioned without joined_at tie-breaker
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
    rank() over (order by gp.balance desc, gp.score desc) as rank
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

commit;

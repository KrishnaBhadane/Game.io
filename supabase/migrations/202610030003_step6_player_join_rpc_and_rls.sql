begin;

-- Step 6: Secure RPC for player game lookup and RLS policies for player joins.

-- 1. Secure RPC to find a game by game_code without exposing other host games.
create or replace function public.get_game_for_join(p_game_code text)
returns table (
  id uuid,
  game_code text,
  name text,
  status text,
  starting_balance numeric
)
language sql
security definer
set search_path = public
as $$
  select id, game_code, name, status, starting_balance
  from public.games
  where upper(game_code) = upper(trim(p_game_code))
  limit 1;
$$;

revoke all on function public.get_game_for_join(text) from public;
grant execute on function public.get_game_for_join(text) to anon, authenticated;

-- 2. Grants for game_players table
grant select, insert on public.game_players to authenticated;

-- 3. Policy: Authenticated users (including anonymous users) can insert only their own player row.
drop policy if exists player_inserts_self on public.game_players;
create policy player_inserts_self on public.game_players for insert to authenticated
  with check (user_id = (select auth.uid()));

-- 4. Policy: Players can read their own player row; hosts can read all players in their hosted games.
drop policy if exists player_or_host_reads_players on public.game_players;
create policy player_or_host_reads_players on public.game_players for select to authenticated
  using (
    user_id = (select auth.uid())
    or exists (select 1 from public.games g where g.id = game_id and g.host_id = (select auth.uid()))
  );

-- 5. Policy: Players can read game metadata for games they have joined.
drop policy if exists player_reads_joined_game on public.games;
create policy player_reads_joined_game on public.games for select to authenticated
  using (
    exists (
      select 1 from public.game_players gp
      where gp.game_id = public.games.id
        and gp.user_id = (select auth.uid())
    )
  );

commit;

begin;

-- Step 8: Realtime publication + host start-game support.

-- Enable realtime for game_players so player joins appear live.
-- Enable realtime for games so status changes propagate to lobby.
-- These are idempotent: add only if not already present.
do $$
begin
  -- game_players
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and tablename = 'game_players'
  ) then
    alter publication supabase_realtime add table public.game_players;
  end if;

  -- games
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and tablename = 'games'
  ) then
    alter publication supabase_realtime add table public.games;
  end if;
end;
$$;

-- The host_updates_games policy already permits any column update.
-- No additional policy is needed; this comment records that update is covered.

commit;

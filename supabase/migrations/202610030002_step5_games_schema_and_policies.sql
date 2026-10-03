begin;

-- Step 5: Add missing game configuration columns and host RLS write policies.

alter table public.games
  add column if not exists allowed_multipliers jsonb not null default '["No Risk", "2x", "3x", "5x"]'::jsonb;

alter table public.games
  add column if not exists question_timer integer check (question_timer is null or question_timer > 0);

-- Grant write access to authenticated users (admin hosts)
grant insert, update on public.games to authenticated;

-- Ensure select policy exists for host
drop policy if exists host_reads_games on public.games;
create policy host_reads_games on public.games for select to authenticated
  using (host_id = (select auth.uid()));

-- Host can insert a game only when host_id matches their authenticated user ID
drop policy if exists host_inserts_games on public.games;
create policy host_inserts_games on public.games for insert to authenticated
  with check (host_id = (select auth.uid()));

-- Host can update only their own games
drop policy if exists host_updates_games on public.games;
create policy host_updates_games on public.games for update to authenticated
  using (host_id = (select auth.uid()))
  with check (host_id = (select auth.uid()));

commit;

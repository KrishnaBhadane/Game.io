begin;

-- Step 9: Game state fields for live question publishing + secure player question RPC.

-- 1. Add current_question_id and question_started_at to games.
alter table public.games
  add column if not exists current_question_id uuid references public.questions(id) on delete set null,
  add column if not exists question_started_at timestamptz;

-- 2. Re-apply question CRUD grants (idempotent) in case Step 7 was not fully applied remotely.
grant select, insert, update, delete on public.questions to authenticated;

drop policy if exists host_reads_questions on public.questions;
create policy host_reads_questions on public.questions for select to authenticated
  using (exists (
    select 1 from public.games g
    where g.id = game_id and g.host_id = (select auth.uid())
  ));

drop policy if exists host_inserts_questions on public.questions;
create policy host_inserts_questions on public.questions for insert to authenticated
  with check (exists (
    select 1 from public.games g
    where g.id = game_id and g.host_id = (select auth.uid())
  ));

drop policy if exists host_updates_questions on public.questions;
create policy host_updates_questions on public.questions for update to authenticated
  using (exists (
    select 1 from public.games g
    where g.id = game_id and g.host_id = (select auth.uid())
  ))
  with check (exists (
    select 1 from public.games g
    where g.id = game_id and g.host_id = (select auth.uid())
  ));

drop policy if exists host_deletes_questions on public.questions;
create policy host_deletes_questions on public.questions for delete to authenticated
  using (exists (
    select 1 from public.games g
    where g.id = game_id and g.host_id = (select auth.uid())
  ));

-- 3. Ensure host can update current_question_id and question_started_at.
--    host_updates_games already exists from Step 5 and covers all columns.

-- 4. Secure RPC: returns live question WITHOUT correct_option.
--    Callable by any authenticated user (including anonymous players).
--    Only returns a row if the player has joined the game.
create or replace function public.get_live_question(p_game_code text)
returns table (
  id uuid,
  question_text text,
  option_a text,
  option_b text,
  option_c text,
  option_d text,
  order_number integer,
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

-- 5. Enable realtime for games if not already done (idempotent guard from Step 8).
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and tablename = 'games'
  ) then
    alter publication supabase_realtime add table public.games;
  end if;
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and tablename = 'game_players'
  ) then
    alter publication supabase_realtime add table public.game_players;
  end if;
end;
$$;

commit;

begin;

-- Step 7: Grants and RLS policies for host question CRUD on public.questions

grant select, insert, update, delete on public.questions to authenticated;

-- Host can select questions for their own games
drop policy if exists host_reads_questions on public.questions;
create policy host_reads_questions on public.questions for select to authenticated
  using (exists (select 1 from public.games g where g.id = game_id and g.host_id = (select auth.uid())));

-- Host can insert questions for their own games
drop policy if exists host_inserts_questions on public.questions;
create policy host_inserts_questions on public.questions for insert to authenticated
  with check (exists (select 1 from public.games g where g.id = game_id and g.host_id = (select auth.uid())));

-- Host can update questions for their own games
drop policy if exists host_updates_questions on public.questions;
create policy host_updates_questions on public.questions for update to authenticated
  using (exists (select 1 from public.games g where g.id = game_id and g.host_id = (select auth.uid())))
  with check (exists (select 1 from public.games g where g.id = game_id and g.host_id = (select auth.uid())));

-- Host can delete questions for their own games
drop policy if exists host_deletes_questions on public.questions;
create policy host_deletes_questions on public.questions for delete to authenticated
  using (exists (select 1 from public.games g where g.id = game_id and g.host_id = (select auth.uid())));

commit;

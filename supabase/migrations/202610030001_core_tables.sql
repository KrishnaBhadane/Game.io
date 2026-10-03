begin;

create table public.games (
  id uuid primary key default gen_random_uuid(),
  host_id uuid not null references auth.users(id),
  name text not null check (char_length(trim(name)) between 1 and 80),
  game_code text not null unique check (game_code ~ '^[A-Z0-9]{1,12}$'),
  starting_balance numeric(14,2) not null default 1000 check (starting_balance >= 0),
  status text not null default 'waiting' check (status in ('waiting', 'active', 'ended')),
  created_at timestamptz not null default now()
);

create table public.game_players (
  id uuid primary key default gen_random_uuid(),
  game_id uuid not null references public.games(id) on delete cascade,
  user_id uuid not null references auth.users(id),
  nickname text not null check (char_length(trim(nickname)) between 2 and 20),
  balance numeric(14,2) not null check (balance >= 0),
  score integer not null default 0,
  joined_at timestamptz not null default now(),
  unique (game_id, user_id),
  unique (game_id, id)
);

create table public.questions (
  id uuid primary key default gen_random_uuid(),
  game_id uuid not null references public.games(id) on delete cascade,
  question_text text not null check (char_length(trim(question_text)) > 0),
  option_a text not null check (char_length(trim(option_a)) > 0),
  option_b text not null check (char_length(trim(option_b)) > 0),
  option_c text not null check (char_length(trim(option_c)) > 0),
  option_d text not null check (char_length(trim(option_d)) > 0),
  correct_option text not null check (correct_option in ('A', 'B', 'C', 'D')),
  order_number integer not null check (order_number > 0),
  created_at timestamptz not null default now(),
  unique (game_id, order_number),
  unique (game_id, id)
);

create table public.submissions (
  id uuid primary key default gen_random_uuid(),
  game_id uuid not null references public.games(id) on delete cascade,
  question_id uuid not null,
  player_id uuid not null,
  selected_option text not null check (selected_option in ('A', 'B', 'C', 'D')),
  risk_multiplier numeric(6,2) not null check (risk_multiplier >= 1),
  is_correct boolean,
  balance_change numeric(14,2) not null default 0,
  submitted_at timestamptz not null default now(),
  unique (question_id, player_id),
  -- A submission's player and question must belong to the same game.
  foreign key (game_id, question_id) references public.questions(game_id, id) on delete cascade,
  foreign key (game_id, player_id) references public.game_players(game_id, id) on delete cascade
);

-- Unique constraints already index game_code, game_players.game_id,
-- questions.game_id, and submissions.question_id as leading columns.
create index games_host_id_idx on public.games(host_id);
create index game_players_user_id_idx on public.game_players(user_id);
create index submissions_game_player_idx on public.submissions(game_id, player_id);
create index submissions_game_question_idx on public.submissions(game_id, question_id);

alter table public.games enable row level security;
alter table public.game_players enable row level security;
alter table public.questions enable row level security;
alter table public.submissions enable row level security;

revoke all on public.games, public.game_players, public.questions, public.submissions from anon, authenticated;
grant select on public.games to anon, authenticated;
grant select on public.game_players, public.questions, public.submissions to authenticated;

-- Read-only foundation. No client writes until authorized commands are built.
-- Anonymous game probes return zero rows; there is no anon read policy.
create policy host_reads_games on public.games for select to authenticated
  using (host_id = (select auth.uid()));

create policy player_or_host_reads_players on public.game_players for select to authenticated
  using (
    user_id = (select auth.uid())
    or exists (select 1 from public.games g where g.id = game_id and g.host_id = (select auth.uid()))
  );

-- Questions contain the answer key: only the host can read raw question rows.
create policy host_reads_questions on public.questions for select to authenticated
  using (exists (select 1 from public.games g where g.id = game_id and g.host_id = (select auth.uid())));

create policy player_or_host_reads_submissions on public.submissions for select to authenticated
  using (
    exists (select 1 from public.games g where g.id = game_id and g.host_id = (select auth.uid()))
    or exists (select 1 from public.game_players p where p.id = player_id and p.user_id = (select auth.uid()))
  );

commit;

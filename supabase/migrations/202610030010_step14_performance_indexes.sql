begin;

-- Step 14: Performance indexes for hot gameplay paths.
-- The core migration already indexes:
--   games(game_code)           via unique constraint
--   game_players(game_id,*)    via unique constraint
--   questions(game_id,*)       via unique constraint
--   submissions(question_id,player_id) via unique constraint
--
-- These additional indexes target the realtime and RPC query patterns
-- observed at ~200 concurrent players.

-- Fast lookup of the live question for a game (get_live_question RPC joins on this).
create index if not exists games_current_question_idx
  on public.games(current_question_id)
  where current_question_id is not null;

-- Fast lookup of games by status (used in player join validation).
create index if not exists games_status_idx
  on public.games(status)
  where status = 'waiting';

-- Fast leaderboard scan: game_players ordered by balance desc for get_leaderboard RPC.
create index if not exists game_players_game_balance_idx
  on public.game_players(game_id, balance desc, score desc, joined_at asc);

-- Fast submission existence check in submit_answer RPC (duplicate guard).
-- The unique(question_id, player_id) constraint already creates this index.
-- No duplicate needed.

-- Fast submission count per question per game (admin submission count widget).
create index if not exists submissions_game_question_idx2
  on public.submissions(game_id, question_id);

commit;

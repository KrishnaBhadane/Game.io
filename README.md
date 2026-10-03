# Game.io

A live multiplayer quiz game for approximately 200 concurrent players. Admins host and control the game; players join with a code, nickname, and avatar. All currency is virtual.

## Stack

- **Frontend**: React 19, React Router 8, Vite 8, Tailwind CSS v4
- **Backend**: Supabase (PostgreSQL + Realtime + Auth)
- **Language**: JavaScript (ES modules)

## Features

- Admin authentication (email/password, no signup UI)
- Game creation with configurable starting balance and allowed risk multipliers
- Player join with avatar selection and anonymous Supabase Auth (no login screen)
- Real-time lobby with live player list
- Per-question countdown timer (set per question by admin)
- Player wager slider + risk multiplier before submit
- Server-side scoring via SECURITY DEFINER RPCs (wager × multiplier)
- Real-time leaderboard during play
- Host-controlled game end → final leaderboard with winner determination
- Reconnect safety: all pages redirect to the correct stage based on live game status

## Setup

### 1. Clone and install

```sh
git clone https://github.com/KrishnaBhadane/Game.io.git
cd Game.io
npm ci
```

### 2. Configure environment

```sh
cp .env.example .env
```

Edit `.env`:

```
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=your-public-anon-key
```

> Use only the **public anon/publishable key**. Never put a service-role key or database password here.

### 3. Run Supabase migrations

Apply all migrations in order in the Supabase SQL editor or via Supabase CLI:

| # | File | Description |
|---|------|-------------|
| 1 | `202610030001_core_tables.sql` | Core schema, RLS, indexes |
| 2 | `202610030002_step5_games_schema_and_policies.sql` | Game config columns + host write policies |
| 3 | `202610030003_step6_player_join_rpc_and_rls.sql` | Player join RPC + RLS |
| 4 | `202610030004_step7_questions_crud_rls.sql` | Question CRUD + host policies |
| 5 | `202610030005_step8_realtime_and_start_game.sql` | Realtime publication, start game |
| 6 | `202610030006_step9_live_question.sql` | Live question RPC |
| 7 | `202610030007_step10_12_submission_scoring_leaderboard.sql` | submit_answer, get_my_submission, get_leaderboard RPCs |
| 8 | `202610030008_step13_end_game.sql` | end_game, publish_question RPCs, game-end guards |
| 9 | `202610030009_step13_5_timer_wager_avatar.sql` | Per-question timer, wager scoring, avatar column |
| 10 | `202610030010_step14_performance_indexes.sql` | Composite indexes for hot gameplay paths |

### 4. Create an admin user

In Supabase Dashboard → Authentication → Users → Add user (email + password, confirm email). Disable public signups in Auth settings.

### 5. Run locally

```sh
npm run dev
```

### 6. Production build

```sh
npm run build
```

Output goes to `dist/`. Serve with any static host. For SPA routing (Vercel/Netlify), configure a fallback to `index.html`.

## Game flow

**Admin:**
Login → Create Game → Add questions (with timers) → Start Game → Publish questions → Watch submissions → End Game

**Player:**
Enter game code → Choose nickname + avatar → Lobby → Question live → Set wager + risk → Submit → See result → Leaderboard → Next question → Final results

## Routes

| Route | Page |
|-------|------|
| `/` | Home |
| `/join` | Join Game |
| `/lobby/:gameCode` | Player Lobby |
| `/game/:gameCode` | Player Game |
| `/results/:gameCode` | Final Results |
| `/admin/login` | Admin Login |
| `/admin` | Admin Dashboard |
| `/admin/create` | Create Game |
| `/admin/game/:gameCode` | Game Control |

## Security

All scoring, balance changes, and game state transitions happen via SECURITY DEFINER RPCs — the browser never writes balance or score directly. Correct answers are never exposed to players. Players cannot submit twice, submit after timer expiry, or join active/ended games.

## Project structure

```
src/
  components/common/      Button, Input, Card, Badge
  components/game/        AnswerOption, RiskSelector, BalanceDisplay, QuestionBank
  components/leaderboard/ Leaderboard, LeaderboardRow
  context/AdminAuth.jsx   Admin auth listener + useAuth hook
  data/avatars.js         Avatar list and emoji lookup
  data/constants.js       Shared constants (RISK_OPTIONS)
  hooks/useAuth.js        Auth context hook
  lib/supabase.js         Supabase client factory
  pages/                  Home, JoinGame, Lobby, PlayerGame, Results, NotFound
  pages/admin/            AdminLogin, AdminDashboard, CreateGame, GameControl
  services/               gameService, questionService, submissionService
  styles/index.css        Design tokens and shared styles
supabase/migrations/      All SQL migrations (apply in order)
```

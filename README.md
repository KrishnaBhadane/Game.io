# Game.io

A live multiplayer quiz for a target of approximately 200 concurrent players. Admins host and control the game; players join with a code, nickname, and avatar. All currency is virtual.

## Current scope: Step 13.5 complete

All features are implemented and connected to Supabase. The game is fully playable end-to-end:

- Admin authentication (email/password)
- Game creation with configurable starting balance and allowed risk multipliers
- Player join with avatar selection and anonymous Supabase Auth
- Real-time lobby, live question delivery, per-question countdown timer
- Player wager (slider) + risk multiplier selection before submit
- Server-side scoring and balance updates (SECURITY DEFINER RPCs)
- Real-time leaderboard during play
- Host-controlled game end → final leaderboard with winner determination
- Reconnect safety: pages redirect based on live game status on load

## Run locally

Use Node 24 LTS (`nvm use` if you use nvm).

```sh
npm ci
npm run dev
```

Open the local URL printed by Vite. Supabase credentials are required for full functionality.

```sh
npm run build
npm run preview
```

The build produces minified assets in `dist/`. Preview serves that production build locally.

## Environment and Supabase

1. Copy `.env.example` to `.env`.
2. Set `VITE_SUPABASE_URL` to the project's URL.
3. Set `VITE_SUPABASE_PUBLISHABLE_KEY` to its public publishable key.
4. Restart Vite after environment changes.

Every `VITE_` variable is exposed to the browser. Never put a Supabase secret or service-role key there. Database access is enforced with RLS and SECURITY DEFINER RPCs.

## Project structure

```text
src/
  components/
    common/             Button, Input, Card, Badge
    game/               AnswerOption, RiskSelector, BalanceDisplay, QuestionBank
    leaderboard/        Leaderboard, LeaderboardRow
  context/              AdminAuth (auth listener, useAuth hook)
  data/
    avatars.js          Avatar list and emoji lookup
    constants.js        Shared constants (RISK_OPTIONS)
  hooks/useAuth.js      Auth context hook
  lib/supabase.js       Supabase client factory
  pages/                Home, JoinGame, Lobby, PlayerGame, Results, NotFound
    admin/              AdminLogin, AdminDashboard, CreateGame, GameControl
  styles/index.css      Design tokens, shared styles, responsive layouts
  App.jsx               Shared shell, routes, lazy admin imports
  main.jsx              React entry and browser router
supabase/
  migrations/           All SQL migrations (core tables through Step 13.5)
```

## Routes

| Route | Page |
| --- | --- |
| `/` | Home |
| `/join` | Join Game |
| `/lobby/:gameCode` | Player Lobby |
| `/game/:gameCode` | Player Game |
| `/results/:gameCode` | Final Results |
| `/admin/login` | Admin Login |
| `/admin` | Admin Dashboard |
| `/admin/create` | Create Game |
| `/admin/game/:gameCode` | Game Control |
| `*` | 404 |

Admin routes require a non-anonymous email session. All server-side RPCs independently verify host ownership.

## Game architecture

Pages compose UI; components render props and emit user actions. Services own all Supabase calls.

- **Admins** authenticate with email/password. Anonymous sessions must never be treated as admin.
- **Players** receive an anonymous Supabase Auth session on join (no sign-up screen).
- **Scoring** is entirely server-side via `submit_answer` RPC (SECURITY DEFINER). The browser submits intent (answer, risk, wager); the server verifies membership, active question, timer expiry, allowed risk, and duplicate submissions before updating balance.
- **Winner** = highest balance → if tied, higher score → shared rank if still tied.

### Realtime contract

- One channel per active game per connected client, named `game:<game_id>` (players) or `admin:<game_id>` (host).
- Fetch an authorized initial snapshot; use realtime updates afterward.
- On game end (`status = 'ended'`), all players and the lobby are pushed to `/results/:gameCode`.
- Subscribe once; remove the channel on unmount.

### Security

- All write operations use SECURITY DEFINER RPCs with server-side validation.
- `submit_answer` enforces: active game, current question, timer expiry, allowed risk, wager within balance, no duplicate.
- `publish_question` enforces host ownership and active game status.
- `end_game` enforces host ownership.
- `join_game_player` enforces waiting status and validates nickname/avatar.
- Correct answers are never exposed to players (no `correct_option` in player-facing queries).

## Setup references

- [Vite guide](https://vite.dev/guide/)
- [Tailwind Vite integration](https://tailwindcss.com/docs/installation/using-vite)
- [React Router declarative setup](https://reactrouter.com/start/declarative/installation)
- [Supabase client initialization](https://supabase.com/docs/reference/javascript/initializing)

## Hero artwork

The homepage uses a burgundy stage, cream typography, and a transparent Luffy cutout. `public/favicon.svg` is the custom pirate mark. `src/assets/luffy-hero.webp` is the optimized 900px transparent hero (~170 KB).

## Build sequence

1. Architecture and base setup — ✅
2. Global design system, expanded routing, reusable UI — ✅
3. Supabase environment and core SQL — ✅
4. Admin authentication — ✅
5. Admin dashboard and game creation — ✅
6. Game code and anonymous player joining — ✅
7. Realtime lobby and player management — ✅
8. Admin question controls — ✅
9. Realtime question delivery — ✅
10. Answer and risk submission — ✅
11. Secure scoring and balance calculations — ✅
12. Results and realtime leaderboard — ✅
13. Game ending, final results, reconnect/error handling — ✅
13.5. Per-question timer, player wager, avatar selection — ✅
14. Performance, security/RLS review, 200-player load tests, deployment — pending

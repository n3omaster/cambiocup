# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

CambioCUP is a real-time Cuban currency exchange rate tracker displaying live rates for CUP, MLC, CLASICA, ETECSA, TROPICAL (BANDECPREPAGO), and CASH (CUPCASH, CUP en efectivo) against USD, plus GAS (gasoline price per litre, fixed at 3.50 USD). Market rates are sourced from the QvaPay P2P API (`api.qvapay.com`), stored in Supabase, and rendered with dynamic color indicators showing price trends. Production URL: `https://www.cambiocup.com`

## Commands

```bash
npm run dev      # Development server (Turbopack is default in Next.js 16)
npm run build    # Production build
npm run start    # Start production server
npm run lint     # ESLint flat config (v9) with nextVitals — pinned to v9 because eslint-config-next (checked up to 16.3) ships APIs incompatible with v10 (`scopeManager.addGlobals is not a function`)
```

There are no tests in this project.

## Architecture

**Tech Stack**: Next.js 16.2 (App Router), React 19.2, Tailwind CSS 4.3 (via `@tailwindcss/postcss`), Supabase JS v2, NumberFlow (animated numbers), Liveline (live chart), OneSignal (push notifications)

**Data Flow**:
1. **Ingest**: `/api/cron` → Fetches rates from QvaPay API (6 coins in parallel) → Calculates `(avg_buy + avg_sell) / 2` → Saves to Supabase `exchange` table (plus fixed GAS price). Coins with no market data that tick (QvaPay answers a bare `0` — CUPCASH until cash trades exist) are skipped, not saved. Triggered every 10 minutes by a Vercel cron defined in `vercel.ts`
2. **Serve**: `/api` → Returns last 6 entries per coin from database
3. **Display**: Frontend polls `/api` every 4s → `averageData()` splits first value vs rest average → `randomize()` adds micro-fluctuation → color set by current vs average comparison
4. **Offers**: `/api/webhook` receives buy/sell offers → `/api/offers` serves recent ones → `FloatingOffers` renders animated bubbles. The same feed also drives live difficulty events in the game
5. **Charts**: `/api/history` returns N-day data → `BackgroundLiveLine` renders a full-screen `liveline` chart behind the main content, fed the live randomized value between history refreshes
6. **Live game dynamics**: every offer that reaches `/api/webhook` becomes an in-game event during a CUP Runner run, and **the coin decides which one** (see Live dynamics below)

### Directory Structure

```
app/
├── page.js                    # Main client component (COIN_CONFIG map, coin selector, price display, color logic, Liquid Glass lens filter)
├── layout.js                  # Root layout (Barlow font, SEO metadata, OG image)
├── globals.css                # Tailwind theme (@theme), custom colors, float-up animation, .liquid-glass utilities
├── loading.js                 # Loading state
├── not-found.js               # 404 page
├── privacy/page.js            # Privacy policy page
├── play/
│   ├── page.js                # Server component (metadata, OG card) for the game route
│   ├── Game.js                # "CUP Runner" canvas game (client): rendering, audio, input, trace recording, score submission
│   └── top-scores/page.js     # Full leaderboard page (server component, best score per player, top 50, revalidate 30s)
├── components/
│   ├── FloatingOffers.js      # Animated buy/sell offer bubbles (polls /api/offers every 3s)
│   └── BackgroundLiveLine.js  # Full-screen Liveline chart background (polls /api/history every 30s, 15 days)
├── utils/
│   ├── helpers.js             # randomize(num, deep), averageData(arr)
│   ├── gameSim.js             # Pure deterministic CUP Runner engine — shared by client AND server replay verifier
│   └── gameCodec.js           # XOR-scramble codec for game-score payloads (obfuscation, not crypto)
└── api/
    ├── route.js               # GET → last 6 entries per coin
    ├── cron/route.js           # GET → fetch from QvaPay API, save to Supabase
    ├── offers/route.js         # GET → recent offers (last 2 minutes)
    ├── history/route.js        # GET ?coin=CUP&days=7 → chart data
    ├── game-history/route.js   # GET ?coin=CUP → bucketed full history + `rev` snapshot id. Edge-cached 1h
    ├── game-score/route.js     # GET → leaderboard / POST → verify replay + save run, returns global rank
    ├── game-token/route.js     # GET → signed HMAC run token (issued when a run starts)
    ├── og/route.js             # GET ?coin=CUP → dynamic OG image (1200×630)
    ├── og/play/route.js        # GET → OG card for /play (real CUP terrain from last 60 days). Edge-cached 1h
    └── webhook/route.js        # POST → save new offer (type, status, value, coin)
lib/
├── supabase.js                # Supabase client + all DB operations
├── gameDay.js                 # Daily map freeze: Havana-midnight cutoff + `mapDay` id (handles Cuba's DST, where local midnight doesn't exist one night a year)
├── gameToken.js               # Server-only HMAC run tokens for the game (issue/verify)
└── gameHistory.js             # getBucketedHistory(coinId, asOf): parallel pagination past the 1000-row cap, buckets to ~2000 points
scripts/
├── harden-game-rls.sql        # Paste-into-Supabase script: drops all game_scores RLS policies (service_role-only access)
├── fix-score-caps.sql         # Paste-into-Supabase: raises the score_cap/day_cap CHECKs and adds flag_reason. REQUIRED — without it any run over 500k points 500s and is lost
└── add-daily-map-ghosts.sql   # Paste-into-Supabase: map_day + trace columns, presence table. Needed for the daily board, ghosts and the live player count
colors.js                      # Color palettes (malachite, crimson, delft_blue, ghost_white, yale_blue)
vercel.ts                      # Vercel config (@vercel/config): cron for /api/cron every 10 min
```

### API Endpoints

| Endpoint | Method | Params | Description |
|---|---|---|---|
| `/api` | GET | — | Returns `{cupHistory, mlcHistory, clasicaHistory, etecsaHistory, bandecprepagoHistory, gasHistory}` (6 entries each) |
| `/api/cron` | GET | — | Fetches 6 coins from QvaPay, saves averages + fixed GAS price to DB (coins answering no data are skipped) |
| `/api/offers` | GET | — | Returns offers created in last 2 minutes |
| `/api/history` | GET | `coin`, `days` | Returns `{data: [{time, value}], coin}` — `time` is a unix timestamp in seconds |
| `/api/game-history` | GET | `coin` | Full history for `/play` via `lib/gameHistory.js`, **frozen at Havana midnight**. Returns `{data, coin, rev, mapDay}`. Edge-cached until the next daily cutoff |
| `/api/game-ghost` | GET | `self`, `exclude` | Best verified run on today's frozen map, with its input trace and resolved offers — the rival you race against |
| `/api/presence` | GET / POST | POST: `{id, day, score}` | Live player count (`{live, recent}`). Clients beat every 20s while running |
| `/api/game-score` | GET / POST | POST: `{t, d}` (token + scrambled payload) | Game leaderboard. GET returns `{top: [best score per player, max 10], runs}` (flagged rows excluded); POST re-simulates the submitted input trace and saves the run (see Anti-cheat below). Sanity caps are `MAX_SCORE` 15M / `MAX_DAY` 20000 — they only exist to avoid re-simulating absurd claims, since the replay checks the score exactly. **They must stay in sync with the `score_cap`/`day_cap` CHECKs on the table** |
| `/api/game-token` | GET | — | Issues a signed run token (`base64url({t,n}).hmac`) when a run starts; its age proves the run's real duration at submit time. Max age 30 min |
| `/api/og` | GET | `coin` | Generates dynamic Open Graph image with current rate and trend |
| `/api/og/play` | GET | — | OG card for the game: real CUP terrain (last 60 days), spike, current rate. Edge-cached 1h |
| `/api/webhook` | POST | `{type, status, value, coin}` | Validates and saves a new offer |

### The daily frozen map (and why it matters)

`buildCourse()` classifies spikes and holes while consuming a **shared PRNG stream**, so a single reclassification desynchronises every later `rand()` call and re-rolls the whole map. Since the cron appends a row every 10 minutes, the course used to change constantly — measured: only **17 of 62 spikes** survived from one hour to the next, and 7 of 62 across a week.

That broke two things: "learning the CUP's history" (the stated skill of the game) was pointless because the map moved on its own, and the leaderboard compared runs played on different courses.

`lib/gameDay.js` fixes it by cutting the history at **Havana midnight**: `/api/game-history` always snapshots the same instant for a whole game day, so everyone playing today races the identical track. This is also what makes ghosts and the daily board possible at all. Gotchas:
- Havana DST means local midnight **doesn't exist** one night a year (00:00 jumps to 01:00) — `havanaMidnightMs()` nudges forward to the first real instant of the day.
- At the end of a game day the snapshot is ~24h old (25h on the DST night), so `REV_MAX_AGE_MS` is 36h. Don't lower it back.

### Ghosts

A verified run's input trace is **~700 bytes gzipped even for a full 6-minute winning run**, and the server already receives it on every submit. Stored in `game_scores.trace`, re-simulating it on the frozen map reproduces that player's run exactly — that's the ghost you race. `makeGhost()` in `Game.js` steps a second sim in lockstep with yours; its `py` is in *its* screen scale, so the renderer normalises by `py / h * H`. Its live-offer obstacles are drawn translucent so its jumps make sense.

### CUP Runner live dynamics (one per coin)

The P2P feed is the game's difficulty generator. `applyOffers()` in `gameSim.js` maps each offer to an event **by coin**; a `status: 'completed'` offer lasts 1.5× longer than an `'attempt'`. All of it is deterministic state (timers are integer step counts, never seconds), so the server verifier reproduces it exactly.

| Coin | Event | Effect |
|---|---|---|
| CUP | Dólar del cielo / Cráter | `value >= nominal` drops a lethal falling dollar; `< nominal` opens a double-jump crater (the original rule) |
| MLC | Imán | Coin pickup radius +`MAGNET_RADIUS` for 8 s — coins visibly fly to the player |
| CLASICA | Escudo | Absorbs one **impact** death (spike, dollar, wall) and rebounds you into the air with `INVULN_STEPS` of invulnerability. Does **not** save you from falling into the void. Stacks to `MAX_SHIELDS` |
| ETECSA | Apagón | 6 s: vignette closes in, glitch band sweeps — but every coin is worth ×2 |
| TROPICAL | Turbo | 7 s: speed ×`TURBO_MULT` and score ×2 |
| GAS | Gravedad baja | 6 s: gravity ×`LOWGRAV_MULT`, floaty jumps |
| CASH | Lluvia de efectivo | Spawns `CASH_COINS` bonus coins in a parabolic arc (fixed `CASH_GAIN` each, no combo) |

The multipliers stack (ETECSA + TROPICAL = ×4), which is why the score ceiling is ~4× the base course total of ~2.6M.

**Adding a dynamic**: add the coin to `FX_BY_COIN` in `gameSim.js`, handle it in `applyOffers`, add its state field to `createSim` + its timer decrement in `stepPhysics`, then add its look to `FX_LOOK`, its sound to `audio.event()`, its HUD chip, and a line in `LIVE_FX_LEGEND` (all in `Game.js`). Add the coin to `validCoins` in `api/webhook/route.js` too.

### CUP Runner Anti-cheat (replay verification)

The game's score submission is verified by **deterministic re-simulation**, not trust:

1. `app/utils/gameSim.js` is a pure physics engine (fixed 120 Hz step, IEEE-754-exact arithmetic only — no `Math.sin`, time, or randomness in the collision path) shared verbatim by the client game and the server verifier. A run ends by dying **or** by crossing the finish flag at the last data point (`course.finishX`, "today") — both endings are deterministic sim states (`state.dead` / `state.won`) that the verifier reproduces
2. The client records a **trace** of the run — jumps, live offers, and resizes, indexed by physics step — plus the map snapshot id `rev` from `/api/game-history`. A live offer is recorded as **`[step, id]` only**: the verifier reads `value`/`coin`/`status` back from the `offers` table, so a client can't forge which dynamic fired (no turning a CUP crater into a CLASICA shield)
3. On submit, the client sends `{t: runToken, d: payload}` where the payload (name, score, day, rev, trace) is XOR-scrambled with a keystream derived from the token (`gameCodec.js` — obfuscation so the body isn't editable JSON in the network tab; the real defense is server-side)
4. `/api/game-score` verifies: token HMAC signature + age window (3 s–60 min, single-use nonce), score/day plausibility vs elapsed time, live offers in the trace exist in the `offers` table with timestamps inside the run window, then **re-runs the full simulation** on the same map (`getBucketedHistory(1, rev)` rebuilds the exact snapshot — `exchange` is append-only so filtering `updated_at <= rev` reproduces what the client saw) and requires the resulting score/day/steps to match exactly
5. **Honeypot**: anything that fails — plain `{name, score, day}` bodies, valid tokens with non-reproducing traces, fabricated offers — is saved with `flagged=true`, answered with a believable `{rank}`, and never shown anywhere. Malformed traces that crash the sim also go to the honeypot, not to a 400
6. **`flag_reason`** records *why* a run was flagged (`token-expired`, `score-mismatch:N`, `offer-missing`, `rev-window`, `sim-crash`…). Without it there is no way to tell a cheater from a broken verification — ~40% of runs were being honeypotted and nobody could tell which were real players

**Timing gotcha**: `elapsed` is measured from when the server signed the token, so any latency between the run starting and the token arriving is silently charged against the run. The client now **pre-fetches the next run's token** (`spareTokenRef`) so the token's clock starts before the run does, and `SIM_SLACK_S` is 20 s. Don't move the token fetch back into the run's start.

**Gotcha**: any change to `gameSim.js` physics or to `buildCourse()` changes what the server reproduces — client and server must always run the same version, and in-flight runs straddling a deploy will fail verification (land in the honeypot). Same applies to the bucketing logic in `lib/gameHistory.js`.

### Database Schema (Supabase)

**`exchange` table** — Historical exchange rates (append-only, `updated_at` monotonic):
- `id`, `coin_id` (int), `value` (float), `updated_at`, `created_at`
- Coin IDs: 1=CUP, 2=MLC, 3=CLASICA, 4=ETECSA, 5=BANDECPREPAGO(TROPICAL), 6=GAS (fixed 3.50 USD/litre, not fetched from QvaPay — constant `GAS_PRICE` in `api/cron/route.js`), 7=CASH (QvaPay `CUPCASH`, CUP en efectivo — the coin exists on QvaPay with P2P enabled but has no completed pairs yet, so its history stays empty until cash trades happen; the frontend shows a "Sin datos de mercado todavía" chip)

**`offers` table** — Buy/sell transaction records:
- `id`, `type` ('buy'|'sell'), `status` ('attempt'|'completed'), `value` (float), `coin` (string), `created_at`

**`game_scores` table** — CUP Runner leaderboard (one row per finished run):
- `id`, `name` (Telegram handle, normalized `@lowercase`), `score` (int), `day` (int), `flagged` (bool, honeypot rows — excluded from all reads), `flag_reason` (text, why it was flagged — null when clean), `nonce` (text, run-token nonce; partial unique index makes tokens single-use), `map_day` (date, which frozen map it was played on), `trace` (jsonb, input trace — verified runs only, powers ghosts), `created_at`
- `saveGameScore` retries without the newer columns on PGRST204/42703, so a deploy that lands before its migration loses the extras but never the run

**`presence` table** — who is running right now:
- `id` (client-generated session id), `last_seen`, `day`, `score`. Alive = seen in the last 45s; rows older than 10 min are swept on read
- **CHECK constraints `score_cap` / `day_cap` mirror `MAX_SCORE`/`MAX_DAY` in `api/game-score/route.js` and must be changed together.** They used to be 500000/10000 — below the game's real ceiling — so every run past ~day 483 was thrown away (the API 400'd before the row was ever attempted). `scripts/fix-score-caps.sql` raises them; if you see error `23514` on insert, that script hasn't been run
- Index on `score desc`. `scripts/harden-game-rls.sql` drops all RLS policies so only `service_role` (which bypasses RLS) can touch the table — all access goes through `/api/game-score`. The Telegram @ is used to contact weekly winners
- Inspect cheaters with `select name, score, day, flag_reason, created_at from game_scores where flagged order by created_at desc`, and triage verification failures with `select flag_reason, count(*) from game_scores where flagged group by 1 order by 2 desc`

Supabase queries have an implicit 1000-row cap — `getHistoricalData` orders newest-first so the cap keeps recent data, then reverses back to chronological order for charts. `lib/gameHistory.js` pages past the cap in parallel (10 concurrent pages) when the game needs the full series.

### Polling Intervals

| Component | Endpoint | Interval |
|---|---|---|
| Home page (`page.js`) | `/api` | 4 seconds |
| Game presence heartbeat | `/api/presence` (POST) | 20 seconds (while running) |
| Presence counter | `/api/presence` (GET) | 15 seconds |
| FloatingOffers | `/api/offers` | 3 seconds |
| BackgroundLiveLine | `/api/history` | 30 seconds |
| Game (during a run) | `/api/offers` | 3 seconds (live difficulty events) |

## Code Patterns

- **JavaScript only** — no TypeScript in this project (except `vercel.ts`, required by `@vercel/config`)
- **Path alias**: `@/*` maps to project root (jsconfig.json)
- **Client components**: All interactive files use `"use client"` directive
- **Per-coin config**: `COIN_CONFIG` in `page.js` maps each coin to `{historyKey, decimals, deep}` — decimals: CUP/CASH/ETECSA/TROPICAL/GAS = 2, MLC/CLASICA = 3; randomize span (`deep`): CUP/CASH/ETECSA/TROPICAL/GAS = 0.5, MLC = 0.009, CLASICA = 0.005. GAS is stored as a fixed 3.50 but gets the same `deep` jitter as the rest so it reads like live data; it also sets `unit: 'USD por litro'` (rendered as a chip under the price)
- **Color logic**: `current < average` → green (malachite/bg-malachite) = price is low; `current > average` → red (crimson/bg-crimson) = price is high; exact tie → neutral (bg-delft_blue). Same three-way logic in `/api/og`. Transition is 0.5s ease on `<main>`
- **Tailwind v4 theme**: Custom colors defined in `globals.css` under `@theme` block (not tailwind.config.js). `--color-*: initial` wipes Tailwind's default palette, so any default token the app uses must be re-declared there
- **Liquid Glass UI**: `.liquid-glass` (+ `--dark/--emerald/--red` variants) in `globals.css`, driven by an SVG displacement-map `backdrop-filter` defined in `page.js` (`GlassLensFilter`); edges sample inward to avoid Chrome edge-clamp streaks
- **Font**: Barlow (weights: 500, 800, 900) loaded via `next/font/google`
- **Number animation**: `@number-flow/react` with 500ms duration, ease-out easing
- **URL param**: `?nocode=true` hides the iframe embed button (used when page is embedded)
- **OneSignal**: Push notifications initialized on mount (AppID: `04dffeef-fbcd-4c21-95fc-eb358400eff2`)
- **OG images**: Dynamic generation with `next/og` ImageResponse — `/api/og` is `force-dynamic` + no-cache; `/api/og/play` is edge-cached 1h

## External APIs

- **QvaPay P2P**: `https://api.qvapay.com/p2p/completed_pairs_average?coin={COIN}` — Returns `{average_buy, average_sell}` for coins: `BANK_CUP`, `BANK_MLC`, `CLASICA`, `ETECSA`, `BANDECPREPAGO`

## Environment Variables

Required in `.env`:
```
SUPABASE_URL=<supabase-project-url>
SUPABASE_KEY=<supabase-key>   # service_role if the RLS hardening script has been run (all DB access is server-side)
```

Optional: `GAME_SCORE_SECRET` — HMAC secret for game run tokens (falls back to `SUPABASE_KEY`)

## Common Tasks

- **Add a new coin**: Add QvaPay coin name in `api/cron/route.js` (`QVAPAY_COINS`) → Add coin_id in `lib/supabase.js` (COIN_IDS, getCoinData, saveCoinData) → Add entry to `COIN_CONFIG` in `page.js` → Add coin to `validCoins` in `api/webhook/route.js` → Add entry to `COINS` in `api/og/route.js`
- **Change game physics/course**: Edit `app/utils/gameSim.js` — but remember client and server verifier share it (see Anti-cheat gotcha). Keep the collision path free of `Math.sin`/time/randomness
- **Add a live dynamic**: see *CUP Runner live dynamics* above
- **Raise the score ceiling**: change `MAX_SCORE`/`MAX_DAY` in `api/game-score/route.js` **and** the matching CHECKs in the DB (`scripts/fix-score-caps.sql`). Changing only one side silently loses runs
- **Render-only game code**: everything inside the `frame()` loop in `Game.js` is outside the sim, so `Math.random`/`Math.sin` are fine there — but never let a render value feed back into sim state
- **Change polling frequency**: Modify `setInterval` in the respective component (page.js=4s, FloatingOffers=3s, BackgroundLiveLine=30s)
- **Change cron schedule**: Edit `crons` in `vercel.ts` (currently `*/10 * * * *`)
- **Modify colors**: Edit `@theme` block in `globals.css` — custom Tailwind colors are defined there, not in a config file
- **Edit SEO/metadata**: Update `metadata` export in `app/layout.js` (site-wide) or `app/play/page.js` / `app/play/top-scores/page.js` (game pages)

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

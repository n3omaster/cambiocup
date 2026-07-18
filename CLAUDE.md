# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

CambioCUP is a real-time Cuban currency exchange rate tracker displaying live rates for CUP, MLC, CLASICA, ETECSA, and TROPICAL (BANDECPREPAGO) against USD, plus GAS (gasoline price per litre, fixed at 3.50 USD). Market rates are sourced from the QvaPay P2P API (`api.qvapay.com`), stored in Supabase, and rendered with dynamic color indicators showing price trends. Production URL: `https://www.cambiocup.com`

## Commands

```bash
npm run dev      # Development server (Turbopack is default in Next.js 16)
npm run build    # Production build
npm run start    # Start production server
npm run lint     # ESLint flat config (v9) with nextVitals — pinned to v9 because eslint-config-next@16.2 ships APIs incompatible with v10
```

There are no tests in this project.

## Architecture

**Tech Stack**: Next.js 16.2 (App Router), React 19.2, Tailwind CSS 4.3 (via `@tailwindcss/postcss`), Supabase JS v2, NumberFlow (animated numbers), Liveline (live chart), OneSignal (push notifications)

**Data Flow**:
1. **Ingest**: `/api/cron` → Fetches rates from QvaPay API (5 coins in parallel) → Calculates `(avg_buy + avg_sell) / 2` → Saves to Supabase `exchange` table. Triggered every 10 minutes by a Vercel cron defined in `vercel.ts`
2. **Serve**: `/api` → Returns last 6 entries per coin from database
3. **Display**: Frontend polls `/api` every 4s → `averageData()` splits first value vs rest average → `randomize()` adds micro-fluctuation → color set by current vs average comparison
4. **Offers**: `/api/webhook` receives buy/sell offers → `/api/offers` serves recent ones → `FloatingOffers` renders animated bubbles
5. **Charts**: `/api/history` returns N-day data → `BackgroundLiveLine` renders a full-screen `liveline` chart behind the main content, fed the live randomized value between history refreshes

### Directory Structure

```
app/
├── page.js                    # Main client component (COIN_CONFIG map, coin selector, price display, color logic)
├── layout.js                  # Root layout (Barlow font, SEO metadata, OG image)
├── globals.css                # Tailwind theme (@theme), custom colors, float-up animation
├── loading.js                 # Loading state
├── privacy/page.js            # Privacy policy page
├── components/
│   ├── FloatingOffers.js      # Animated buy/sell offer bubbles (polls /api/offers every 3s)
│   └── BackgroundLiveLine.js  # Full-screen Liveline chart background (polls /api/history every 30s, 15 days)
├── utils/
│   └── helpers.js             # randomize(num, deep), averageData(arr)
└── api/
    ├── route.js               # GET → last 6 entries per coin
    ├── cron/route.js           # GET → fetch from QvaPay API, save to Supabase
    ├── offers/route.js         # GET → recent offers (last 2 minutes)
    ├── history/route.js        # GET ?coin=CUP&days=7 → chart data
    ├── og/route.js             # GET ?coin=CUP → dynamic OG image (1200×630)
    └── webhook/route.js        # POST → save new offer (type, status, value, coin)
lib/
└── supabase.js                # Supabase client + all DB operations
colors.js                      # Color palettes (malachite, crimson, delft_blue, ghost_white, yale_blue)
vercel.ts                      # Vercel config (@vercel/config): cron for /api/cron every 10 min
```

### API Endpoints

| Endpoint | Method | Params | Description |
|---|---|---|---|
| `/api` | GET | — | Returns `{cupHistory, mlcHistory, clasicaHistory, etecsaHistory, bandecprepagoHistory}` (6 entries each) |
| `/api/cron` | GET | — | Fetches 5 coins from QvaPay, saves averages to DB |
| `/api/offers` | GET | — | Returns offers created in last 2 minutes |
| `/api/history` | GET | `coin`, `days` | Returns `{data: [{time, value}], coin}` — `time` is a unix timestamp in seconds |
| `/api/og` | GET | `coin` | Generates dynamic Open Graph image with current rate and trend |
| `/api/webhook` | POST | `{type, status, value, coin}` | Validates and saves a new offer |

### Database Schema (Supabase)

**`exchange` table** — Historical exchange rates:
- `id`, `coin_id` (int), `value` (float), `updated_at`, `created_at`
- Coin IDs: 1=CUP, 2=MLC, 3=CLASICA, 4=ETECSA, 5=BANDECPREPAGO(TROPICAL), 6=GAS (fixed 3.50 USD/litre, not fetched from QvaPay — constant `GAS_PRICE` in `api/cron/route.js`)

**`offers` table** — Buy/sell transaction records:
- `id`, `type` ('buy'|'sell'), `status` ('attempt'|'completed'), `value` (float), `coin` (string), `created_at`

Supabase queries have an implicit 1000-row cap — `getHistoricalData` orders newest-first so the cap keeps recent data, then reverses back to chronological order for charts.

### Polling Intervals

| Component | Endpoint | Interval |
|---|---|---|
| Home page (`page.js`) | `/api` | 4 seconds |
| FloatingOffers | `/api/offers` | 3 seconds |
| BackgroundLiveLine | `/api/history` | 30 seconds |

## Code Patterns

- **JavaScript only** — no TypeScript in this project (except `vercel.ts`, required by `@vercel/config`)
- **Path alias**: `@/*` maps to project root (jsconfig.json)
- **Client components**: All interactive files use `"use client"` directive
- **Per-coin config**: `COIN_CONFIG` in `page.js` maps each coin to `{historyKey, decimals, deep}` — decimals: CUP/ETECSA/TROPICAL/GAS = 2, MLC/CLASICA = 3; randomize span (`deep`): CUP/ETECSA/TROPICAL/GAS = 0.5, MLC = 0.009, CLASICA = 0.005. GAS is stored as a fixed 3.50 but gets the same `deep` jitter as the rest so it reads like live data; it also sets `unit: 'USD por litro'` (rendered as a chip under the price)
- **Color logic**: `current < average` → green (malachite/bg-malachite) = price is low; `current > average` → red (crimson/bg-crimson) = price is high; exact tie → neutral (bg-delft_blue). Same three-way logic in `/api/og`. Transition is 0.5s ease on `<main>`
- **Tailwind v4 theme**: Custom colors defined in `globals.css` under `@theme` block (not tailwind.config.js)
- **Font**: Barlow (weights: 500, 800, 900) loaded via `next/font/google`
- **Number animation**: `@number-flow/react` with 500ms duration, ease-out easing
- **URL param**: `?nocode=true` hides the iframe embed button (used when page is embedded)
- **OneSignal**: Push notifications initialized on mount (AppID: `04dffeef-fbcd-4c21-95fc-eb358400eff2`)
- **OG images**: Dynamic generation with `next/og` ImageResponse, `force-dynamic` + no-cache headers

## External APIs

- **QvaPay P2P**: `https://api.qvapay.com/p2p/completed_pairs_average?coin={COIN}` — Returns `{average_buy, average_sell}` for coins: `BANK_CUP`, `BANK_MLC`, `CLASICA`, `ETECSA`, `BANDECPREPAGO`

## Environment Variables

Required in `.env`:
```
SUPABASE_URL=<supabase-project-url>
SUPABASE_KEY=<supabase-anon-key>
```

## Common Tasks

- **Add a new coin**: Add QvaPay coin name in `api/cron/route.js` (`QVAPAY_COINS`) → Add coin_id in `lib/supabase.js` (COIN_IDS, getCoinData, saveCoinData) → Add entry to `COIN_CONFIG` in `page.js` → Add coin to `validCoins` in `api/webhook/route.js` → Add entry to `COINS` in `api/og/route.js`
- **Change polling frequency**: Modify `setInterval` in the respective component (page.js=4s, FloatingOffers=3s, BackgroundLiveLine=30s)
- **Change cron schedule**: Edit `crons` in `vercel.ts` (currently `*/10 * * * *`)
- **Modify colors**: Edit `@theme` block in `globals.css` — custom Tailwind colors are defined there, not in a config file
- **Edit SEO/metadata**: Update `metadata` export in `app/layout.js`

# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

CambioCUP is a real-time Cuban currency exchange rate tracker displaying live rates for CUP, MLC, CLASICA, ETECSA, and TROPICAL (BANDECPREPAGO) against USD. Rates are fetched from QvaPay API, stored in Supabase, and displayed with dynamic color indicators showing price trends.

## Commands

```bash
npm run dev      # Development server (Turbopack is default in Next.js 16)
npm run build    # Production build
npm run start    # Start production server
npm run lint     # ESLint code quality check
```

## Architecture

**Tech Stack**: Next.js 16 (App Router), React 19, Tailwind CSS 4, Supabase

**Data Flow**:
1. `/api/cron` → Fetches rates from QvaPay API → Saves to Supabase `exchange` table
2. `/api` → Returns last 6 entries for each coin from database
3. Frontend polls `/api` every 4 seconds, calculates averages, applies visual color feedback

**Key Files**:
- `app/page.js` - Main client component with coin selection, data fetching, color logic
- `app/utils/helpers.js` - `randomize()` for price variation display, `averageData()` for trend calculation
- `lib/supabase.js` - Database operations (`getCoinData`, `saveCoinData`)
- `app/api/route.js` - GET endpoint returning historical coin data
- `app/api/cron/route.js` - Cron endpoint fetching from external QvaPay API
- `colors.js` - Color palette definitions (malachite=green/lower, crimson=red/higher)

**Coin IDs in Database**:
- 1=CUP, 2=MLC, 3=CLASICA, 4=ETECSA, 5=BANDECPREPAGO(TROPICAL)

## Code Patterns

- Uses JavaScript (no TypeScript)
- Path alias: `@/*` maps to project root
- Client components use `"use client"` directive
- Background color transitions based on current price vs historical average (green=below, red=above)
- OneSignal integration for push notifications

## Environment Variables

Required in `.env`:
```
SUPABASE_URL=<supabase-project-url>
SUPABASE_ANON_KEY=<supabase-anon-key>
```

# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

A single-page web app for tracking sleep data (HRV, sleep score, bedtime, disturbances, lifestyle factors) and generating AI-powered coaching insights. No build system — the entire app lives in `index.html`.

## Running Locally

```bash
python3 -m http.server 8000
# Visit http://localhost:8000
```

No npm, no build step, no dependencies to install. The app is served directly from the browser.

## Architecture

Everything is in a single file: `index.html` (~1,737 lines) containing all HTML, CSS, and JavaScript.

**Backend:** Supabase (PostgreSQL + Auth + Edge Functions). Config is hardcoded near the top of the `<script>` block:
- `SUPABASE_URL`, `SUPABASE_KEY` (public anon key — intentional)
- `COACH_ENDPOINT` — Supabase Edge Function for streaming AI responses

**Auth flow:** `checkSession()` (IIFE on load) → `tryAuth()` → `hideLandingPage()` → `initApp()` → `loadEntries()` → `renderHistory()`

**Data model (entries table):** `hrv`, `sleep_score`, `bedtime`, `wake_time`, `night_wake` (disturbance level), `positive_tags[]`, `negative_tags[]`, `notes`

**Views:**
- **Logging** — HRV gauge, sleep score, tags, notes
- **History** — stats summary, sleep/HRV charts, weekly breakdown, entry log
- **Insights** — trend cards, factor heatmaps (HRV + sleep score), scatter plot, AI briefing + interactive chat

## Key Functions

| Function | Purpose |
|---|---|
| `loadEntries()` | Fetch all user entries from Supabase REST |
| `saveEntry()` | POST new entry; refreshes views after save |
| `renderHistory()` | Re-renders stats, charts, and log table |
| `calc7DayTrend()` | Shared trend logic — compares last 7 scored days vs previous 7 |
| `renderInsights()` | Drives all insight cards, heatmaps, scatter plot |
| `generateBriefing()` | Streams AI daily briefing via SSE |
| `sendChat()` | Multi-turn AI coach chat; passes full entry history as context |
| `streamCoachResponse()` | SSE streaming from the Edge Function |

## Deployment

Pushing to `main` auto-deploys via Netlify to [30daysleepcoach.com](https://30daysleepcoach.com), typically within 30 seconds.

## Product Context

**Stage:** MVP — validating a consumer product with real users.

**Target audience:** Quantified-self / biohacker community and busy professionals who already use wearables.

**Positioning:** A behavioral coaching layer on top of wearable data — not competing on biometric tracking itself.

**Pricing:** $9.99/month

**Explicitly out of scope for MVP:**
- Gamification and leaderboards
- Wearable API integrations (Oura, Whoop, etc.)
- B2B / HR dashboards
- Kajabi course content

## Common Changes

- **New data field:** Add to HTML form → include in `saveEntry()` entry object → display in `renderLog()`
- **New insight card:** Add a card block inside `renderInsightCards()`
- **Trend logic:** Modify `calc7DayTrend()` — used by both History and Insights views
- **Styling:** Use existing CSS custom properties (`--accent`, `--green`, `--yellow`, `--red`, `--bg`, `--card`, etc.)
- **AI context:** Edit `generateBriefing()` or `sendChat()` to change what data is sent to the edge function

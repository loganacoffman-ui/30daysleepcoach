# 30 Day Sleep Coach Roadmap
Living document tracking what's being built, what's next, and what's done. Check this file at the start of each session.

## In Progress

- **Sprint 2 — AI caching infrastructure**
  - ✅ `ai_cache` table created in Supabase with RLS
  - ⬜ Edge function updated to check cache before generating
  - ⬜ Frontend updated to bust cache on new entry save
  - ⬜ Manual refresh button on briefing card

## Next Up

- **Sprint 1 — Card row redesign**
  - Trend card (already built — no change)
  - Avg sleep score with "up from X last week" narrative
  - Distance to target (keep as-is, flag for onboarding rework)
  - Top positive factor (dynamic from heatmap data)
  - Top negative factor (dynamic from heatmap data)
  - Gamified next step card ("Log breathwork 2 more times to unlock insight")

- **Sprint 3 — Hero card "This week's biggest finding"**
  - AI-generated short-form finding, placed above card row
  - Uses caching infrastructure from Sprint 2
  - Sits above the existing AI briefing (briefing stays as longer-form explanation)

## Backlog

- Onboarding flow — user-set sleep score goal (replaces hardcoded 90 in Distance to Target card)
- Mobile layout polish — hero padding, header overflow on narrow screens, inline two-column grids in Log view, seven-column History table needs scroll wrapper, heatmap label widths
- HRV scatterplot — decide whether to cut, add trendline, or replace with text insight
- System prompt refinement for AI coach chat — core IP lever, deserves dedicated session
- Low-sample-size flagging: consider requiring n≥5 before displaying delta at all (current threshold is n≥2 with asterisk)
- Wearable API integrations (Oura, Whoop) — not MVP, but eventually
- B2B/HR dashboard — not MVP
- Gamification and leaderboards — not MVP
- Kajabi course content integration — not MVP

## Done

- Full Supabase Auth migration (JWT sessions, RLS on entries table)
- Landing page rework (removed public mode, new hero copy, product preview placeholder)
- Major visual redesign (Geist, four-color palette, dot grid animation)
- Netlify Forms integration for waitlist
- GitHub + Netlify continuous deployment setup
- Cursor workflow established with CLAUDE.md project context
- Fixed 7-day trend logic (last 7 days vs prior 7 days)
- Reframed 3am wake impact card as "Surprising resilience"
- Sorted factor correlation heatmaps by impact magnitude
- Added low-sample-size flagging (<5 nights) with dimmed rows and footer note
- Split heatmap footer into two lines with proper capitalization

## Notes and Principles

- **Defensible moat:** behavioral + longitudinal data, not biometric. Wearable integrations are features, not core value.
- **MVP discipline:** validate core loop with real users before adding complexity.
- **Pricing:** $9.99/month consumer.
- **Next session entry point:** Check "In Progress" section. Continue where the last session left off.

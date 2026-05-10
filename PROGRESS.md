# Chronicle Worlds — Progress Log

This document is the **single source of truth** for development progress. Each milestone includes what was done, key decisions, and exactly what to do next — with direct references to prior work so development can resume from this file alone.

---

## Project Overview

**Chronicle Worlds** is a turn-based, multiplayer, procedural world simulation hosted entirely on Supabase, GitHub, and GitHub Pages. Players control characters on a shared 3D grid, issuing one of five actions per turn simultaneously, with time as the core resource.

**Stack:** Supabase (PostgreSQL + Edge Functions + Auth + Realtime) · GitHub (migrations, versioning, CI/CD) · GitHub Pages (Vite + JS frontend)

**Supabase Project:** andredavisme's Project (`hhyhulqngdkwsxhymmcd`, region: `us-west-2`)

**Inspired by:** [andredavisme/the-world](https://github.com/andredavisme/the-world)

---

## Milestone Log

---

### ✅ Milestone 1 — Database Schema: Core Tables
**Date:** 2026-05-10
**Status:** Complete
**Migration:** `001_core_schema` (applied via Supabase MCP)

**Tables created:**
- `settings`, `grid_cells`, `characters`, `physical_environments`, `events`, `materials`, `entity_positions`, `chronicle`, `attribute_modifiers`, `relationship_effects`

**Key decisions:**
- `events.setting_id` is NOT NULL — genesis `settings` row must exist before any turn
- All PKs are integers; `chronicle` is the central join table

---

### ✅ Milestone 2 — Database Schema: Multiplayer Extensions
**Date:** 2026-05-10
**Status:** Complete
**Migration:** `002_multiplayer_extensions`

**What was done:** Player identity, turn mechanics, time-travel branching, RLS, race-resolution.
- Tables: `players`, `branches`, `player_chronicle_access`
- RLS on `chronicle`: `FOR SELECT USING (player_id = auth.uid())`
- Trigger: `advance_turn()` — auto-increments `turn_number` per player on chronicle insert
- View: `turn_queue` — ranks pending events by `submit_timestamp`
- `branch_id = 0` = root timeline; max 3 forks enforced in Edge Function

---

### ✅ Milestone 3 — Backend: Edge Function `resolve-turn`
**Date:** 2026-05-10
**Status:** Complete
**Function ID:** `a68468fa-a326-4f75-9d51-72a73fa8e9c2` (v2, ACTIVE)

**Logic:** validate → queue check → branch check → insert event → apply modifiers → insert chronicle → resolve → broadcast → return.

**Modifier map:** Exchange Info=`inspiration+3` · Resolve Conflict=`health+3` · Introduce Conflict=`health-3` · Exchange Material=`wealth+3` · Travel=duration only

**Key fix (v1→v2):** `event.eventid` → `event.event_id`

---

### ✅ Milestone 3a — Smoke Test: Full Turn Pipeline
**Date:** 2026-05-10 · **Status:** Complete

All 5 pipeline steps verified in SQL: turn_queue empty → event insert → modifier insert → chronicle insert (trigger fires) → event resolved.

---

### ✅ Milestone 4 — Frontend: GitHub Pages Scaffold
**Date:** 2026-05-10
**Status:** Complete
**Commit:** `712566b`

Full Vite + JS frontend in `/frontend/`. Five modules: `supabase-client.js`, `turn-manager.js`, `grid-renderer.js`, `chronicle-reader.js`, `app.js`. GitHub Actions deploy workflow added.

---

### ✅ Milestone 5 — Realtime: Turn Subscription
**Status:** Complete (inside Milestone 4)

---

### ✅ Milestone 6 — Chronicle Panel: Player-Filtered Display
**Status:** Complete (inside Milestone 4)

---

### ✅ Milestone 7 — Testing: Multiplayer & Edge Cases
**Date:** 2026-05-10
**Status:** Complete — all DB-side tests verified live
**Migrations:** `004_milestone7_tests` (ROLLBACK/reference) · `005_persist_test_fixtures` (COMMIT)

**Live DB results:** ✅ Genesis setting · ✅ advance_turn trigger · ✅ Queue clear · ✅ Branch limit (3) · ✅ Travel formula · ✅ RLS isolation data

**Persisted fixture reference:**
| Fixture | Value |
|---|---|
| Player A | `b6879b2f-801c-4459-aae1-6a8022e8e1a7` (`dev@chronicle.local`) |
| Player B | `00000000-0000-0000-0000-000000000002` (stub) |
| Genesis setting | `setting_id=1`, origin `(0,0,0)` |
| Player A branches | 3 forks from root (at cap) |

**Remaining client-side checks (manual browser):**
- [ ] Sign in as Player A → submit action → confirm chronicle + cooldown via Realtime
- [ ] Incognito as different user → confirm Player A rows hidden (RLS)
- [ ] Attempt 4th branch fork → confirm `409` from Edge Function
- [ ] Submit without `setting_id` → confirm `500`

---

### 🔄 Milestone 8 — Polish, Docs & Deploy Pipeline
**Date:** 2026-05-10
**Status:** In progress

**Completed this session:**
- ✅ `README.md` — full rewrite: overview, gameplay, actions table, time/branching rules, tech stack, local dev, deploy instructions, project structure, key design decisions (commit `0deb5c0`)
- ✅ Live site unblocked — `docs/index.html` created as single-file CDN frontend (no Vite build needed); GitHub Pages now serves the game at [andredavisme.github.io/chronicle-worlds](https://andredavisme.github.io/chronicle-worlds/)
- ✅ CI workflow fixed — `deploy.yml` no longer triggers on `docs/**` pushes; prevents Vite from overwriting hand-built file (commit `3b69d56`)
- ✅ CDN / name clash fixed — swapped jsDelivr → unpkg (Tracking Prevention); renamed `supabase` → `sb` to fix UMD global `SyntaxError` (commit `d098380`)
- ✅ Auth storage fixed — `sessionStorage` instead of `localStorage`; silences all Tracking Prevention warnings (commit `e5d2a19`)
- ✅ Favicon added — inline SVG data URI; eliminates `favicon.ico` 404 (commit `e5d2a19`)
- ✅ Login confirmed working in browser ✅

**Remaining:**
- [ ] Mobile responsiveness for canvas grid
- [ ] Client-side Milestone 7 browser tests (4 checks above)
- [ ] Supabase Pro / scale path notes

---

## Quick Reference

| Item | Value |
|---|---|
| GitHub Repo | [andredavisme/chronicle-worlds](https://github.com/andredavisme/chronicle-worlds) |
| Supabase Project | `hhyhulqngdkwsxhymmcd` (us-west-2) |
| Live URL | [andredavisme.github.io/chronicle-worlds](https://andredavisme.github.io/chronicle-worlds/) |
| Migration 001 | `001_core_schema` — 10 base tables; `events.setting_id` NOT NULL |
| Migration 002 | `002_multiplayer_extensions` — players, branches, RLS, trigger, view |
| Migration 003 | `003_developer_proposals` |
| Migration 004 | `004_milestone7_tests` (ROLLBACK; reference only) |
| Migration 005 | `005_persist_test_fixtures` (COMMIT, 2026-05-10) |
| Edge Function | `resolve-turn` (ID: `a68468fa`, v2, ACTIVE) |
| Publishable Key | `sb_publishable_haKvwV0M7KMj4Qz69M6WGg_KmIfU-aI` |
| Genesis seed | `settings` row `id=1` required before any event insert |
| Player A (dev) | `b6879b2f-801c-4459-aae1-6a8022e8e1a7` — `dev@chronicle.local` |
| Player B (stub) | `00000000-0000-0000-0000-000000000002` |
| Root timeline | `branch_id = 0` |
| Max branches/lineage | 3 (enforced in Edge Function) |
| Action durations | Exchange Info=10u · Resolve Conflict=7u · Introduce Conflict=5u · Exchange Material=3u · Travel=calculated |
| Client cooldown | 1 real minute (UX only) |
| Default setting_id | `1` (hardcoded in `turn-manager.js` + `docs/index.html`) |
| Auth storage | `sessionStorage` (survives refresh, not tab close) |
| CDN | `unpkg.com/@supabase/supabase-js@2` (jsDelivr blocked by Tracking Prevention) |
| Inspired by | [andredavisme/the-world](https://github.com/andredavisme/the-world) |

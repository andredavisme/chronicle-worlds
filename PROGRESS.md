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
**Date:** 2026-05-10 | **Migration:** `001_core_schema`

Tables: `settings`, `grid_cells`, `characters`, `physical_environments`, `events`, `materials`, `entity_positions`, `chronicle`, `attribute_modifiers`, `relationship_effects`. `events.setting_id` NOT NULL; all PKs are integers.

---

### ✅ Milestone 2 — Database Schema: Multiplayer Extensions
**Date:** 2026-05-10 | **Migration:** `002_multiplayer_extensions`

Tables: `players`, `branches`, `player_chronicle_access`. RLS on `chronicle`. `advance_turn()` trigger. `turn_queue` view. `branch_id = 0` = root; max 3 forks enforced in Edge Function.

---

### ✅ Milestone 3 — Backend: Edge Function `resolve-turn`
**Date:** 2026-05-10 | **Function ID:** `a68468fa` (v3, ACTIVE)

Pipeline: validate → queue check → branch check → insert event → apply modifiers → insert chronicle → resolve → broadcast → return. `verify_jwt: false` + manual JWT validation to fix CORS preflight block.

**Modifier map:** Exchange Info=`inspiration+3` · Resolve Conflict=`health+3` · Introduce Conflict=`health-3` · Exchange Material=`wealth+3` · Travel=duration only

---

### ✅ Milestone 3a — Smoke Test: Full Turn Pipeline
**Date:** 2026-05-10

All 5 pipeline steps verified in SQL.

---

### ✅ Milestone 4 — Frontend: GitHub Pages Scaffold
**Date:** 2026-05-10 | **Commit:** `712566b`

Full Vite + JS frontend in `/frontend/`. Modules: `supabase-client.js`, `turn-manager.js`, `grid-renderer.js`, `chronicle-reader.js`, `app.js`. GitHub Actions deploy workflow.

---

### ✅ Milestone 5 — Realtime: Turn Subscription
**Status:** Complete (inside Milestone 4)

---

### ✅ Milestone 6 — Chronicle Panel: Player-Filtered Display
**Status:** Complete (inside Milestone 4)

---

### ✅ Milestone 7 — Testing: Multiplayer & Edge Cases
**Date:** 2026-05-10 | **Migrations:** `004_milestone7_tests` (ROLLBACK) · `005_persist_test_fixtures` (COMMIT)

All DB-side and browser tests verified live: genesis setting, advance_turn trigger, queue, branch limit (3), travel formula, RLS isolation.

**Fixture reference:**
| Fixture | Value |
|---|---|
| Player A | `b6879b2f-801c-4459-aae1-6a8022e8e1a7` (`dev@chronicle.local`) |
| Player B | `00000000-0000-0000-0000-000000000002` (stub) |
| Genesis setting | `setting_id=1`, origin `(0,0,0)` |
| Player A branches | 3 forks from root (at cap) |
| Test player | `d30fe4d9-a9f3-43a2-947d-30c8d9d2cdd5` (`test@chroincle.local`, character_id=7) |

---

### ✅ Milestone 8a — Session 2 Infrastructure Fixes
**Date:** 2026-05-10

- CORS block fixed (verify_jwt + manual auth)
- `Player not found` 500 fixed (`006_auto_provision_players`)
- Null PK 500 fixed (`007_add_pk_sequences`)
- RLS blocking trigger fixed (`008_rls_policies_and_trigger_fix`)

---

### ✅ Milestone 8b — Polish & Repo Sync
**Date:** 2026-05-10 | **Status:** Complete

**Completed:**
- [x] Migrations 005–008 committed to `backend/migrations/` (commit `0030e6c`)
- [x] Mobile responsiveness (commit `cab16a2`)
  - Responsive CSS: desktop = `1fr 320px` sidebar, mobile ≤767px = full-width canvas + bottom drawer
  - `#mobile-panel-toggle` button slides sidebar up from bottom (55vh)
  - Action buttons reflow to 2-column grid on mobile for easy tapping
  - `grid-renderer.js`: `getTileSize()` scales `TILE_W` from 20–48px based on `canvas.width / 800`, recomputed on every `resize` + `render`
  - Labels hidden when tile width < 28px to avoid clutter
  - `height: 100dvh` (dynamic viewport height) fixes mobile browser chrome overlap
- [x] Scale path: Supabase Pro $25/mo; scale via setting shards (documented in README/pitch)

---

### 🔼 Next: Milestone 9 — Natural Progression Loop
**Status:** Not started

**Goal:** Implement the autonomous simulation backbone — the world advances on its own underneath player turns.

**Scope:**
- [ ] Supabase `pg_cron` job (or Edge Function cron) to tick world time periodically
- [ ] Environment cycle every 100 time units
- [ ] Material cycle: major change every 80u, minor every 3 durations
- [ ] Population spawn: 1 age-0 character every 50 durations
- [ ] 25 events per 500 time units spawn new random settings
- [ ] Relationship randomization at spawn, adjusted by events
- [ ] Broadcast world-tick to connected clients via Realtime

---

## Quick Reference

| Item | Value |
|---|---|
| GitHub Repo | [andredavisme/chronicle-worlds](https://github.com/andredavisme/chronicle-worlds) |
| Supabase Project | `hhyhulqngdkwsxhymmcd` (us-west-2) |
| Live URL | [andredavisme.github.io/chronicle-worlds](https://andredavisme.github.io/chronicle-worlds/) |
| Migration 001 | `001_core_schema` — 10 base tables |
| Migration 002 | `002_multiplayer_extensions` — players, branches, RLS, trigger, view |
| Migration 003 | `003_developer_proposals` |
| Migration 004 | `004_milestone7_tests` (ROLLBACK; reference only) |
| Migration 005 | `005_persist_test_fixtures` (COMMIT) |
| Migration 006 | `006_auto_provision_players` — player provisioning trigger + backfill |
| Migration 007 | `007_add_pk_sequences` — sequences for events, chronicle, attribute_modifiers, entity_positions |
| Migration 008 | `008_rls_policies_and_trigger_fix` — service_role INSERT policies + player read/update |
| Edge Function | `resolve-turn` (ID: `a68468fa`, v3, ACTIVE) |
| Publishable Key | `sb_publishable_haKvwV0M7KMj4Qz69M6WGg_KmIfU-aI` |
| Genesis seed | `settings` row `id=1` required before any event insert |
| Player A (dev) | `b6879b2f-801c-4459-aae1-6a8022e8e1a7` — `dev@chronicle.local` |
| Player B (stub) | `00000000-0000-0000-0000-000000000002` |
| Test player | `d30fe4d9-a9f3-43a2-947d-30c8d9d2cdd5` — `test@chroincle.local` |
| Root timeline | `branch_id = 0` |
| Max branches/lineage | 3 (enforced in Edge Function) |
| Action durations | Exchange Info=10u · Resolve Conflict=7u · Introduce Conflict=5u · Exchange Material=3u · Travel=calculated |
| Client cooldown | 1 real minute (UX only) |
| Default setting_id | `1` (hardcoded in `turn-manager.js` + `docs/index.html`) |
| Auth storage | `sessionStorage` (survives refresh, not tab close) |
| CDN | `unpkg.com/@supabase/supabase-js@2` (jsDelivr blocked by Tracking Prevention) |
| Inspired by | [andredavisme/the-world](https://github.com/andredavisme/the-world) |

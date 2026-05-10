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

### ✅ Milestones 1–8b — (see prior entries)
All prior milestones complete. Schema, Edge Function, frontend scaffold, Realtime, testing, infra fixes, mobile responsiveness, migration repo sync. See commit history for details.

---

### ✅ Milestone 9 — Natural Progression Loop
**Date:** 2026-05-10 | **Status:** Complete
**Migration:** `009_natural_progression_loop` | **Commit:** `3c4a1da`

See prior PROGRESS.md entry for full details. Summary:
- `world_tick_state` singleton, `proc_words` vocabulary table
- `world_tick()` function: per-tick aging, material decay, char spawn (du%50), material change (du%80), env cycle (tu%100), setting spawn (tu%500)
- `pg_cron` job `world-tick` — `* * * * *` — ACTIVE
- Frontend: `world-tick` Realtime channel on `world_tick_state`

---

### ✅ Milestone 10 — World Seeding + Grid Bootstrap
**Date:** 2026-05-10 | **Status:** Complete
**Migration:** `010_world_seeding` | **Commit:** `5190083`

**What was built:**

#### DB (migration 010)
- Added `DEFAULT nextval(...)` sequence to `grid_cells.grid_cell_id`
- Added `DEFAULT extract(epoch FROM now())` to `entity_positions.timestamp_start` (was NOT NULL, no default — caused first apply attempt to fail)
- Seeded **7×7×1** `grid_cells` for genesis setting (x: -3→3, y: -3→3, z=0), all capacity=10, expansion_state='stable'
- `entity_positions` seeded:
  - character 1 @ (0,0,0) — genesis character, size 3
  - character 7 @ (1,1,0) — test character, size 2
  - material 101 @ (-1,0,0) — carved stone, size 2
  - setting 1 @ (0,0,0) — setting node, size 7
- `physical_environments` row for setting 1: temp=18, density=60, hydration=70, pop=2
- `seed_setting_grid(setting_id, radius=3)` helper — called by `world_tick()` on new setting spawns
- `world_tick()` patched to use `seed_setting_grid` + supply `timestamp_start` on all `entity_positions` inserts
- `REPLICA IDENTITY FULL` on `entity_positions` (enables Realtime change streaming)

#### Smoke test results
- `grid_cells` count: 49 (7×7) ✅
- Active entity_positions: char1@(0,0,0), char7@(1,1,0), material101@(-1,0,0), setting1@(0,0,0) ✅
- `world_tick_state.duration_unit`: 8 (pg_cron running live) ✅

#### Frontend
- `grid-renderer.js`: `loadEntityPositions()` now fetches joined `grid_cells(x,y,z,setting_id)`; derives per-setting bounding boxes and draws isometric diamond outline per setting (dashed, labelled `S1`)
- `index.html`: added `#world-time` span in footer
- `app.js`: `loadWorldTime()` queries `world_tick_state` + `settings` on load; updates `#world-time` as `tu: N · du: N`; new `entity-positions` Realtime channel (postgres_changes `*`) triggers `loadEntityPositions()` live

**Key decisions:**
- Action buttons moved outside `showGame()` scope (fixed a bug where they'd only work after sign-in event, not on page reload with existing session)
- Setting boundary derived client-side from entity_positions join data — no extra RPC needed
- `entity_positions` Realtime channel now fires on any insert/update/delete, so character spawns from `world_tick()` redraw the canvas automatically

---

### 🔼 Next: Milestone 11 — Travel Action + Grid Movement
**Status:** Not started

**Goal:** Make the Travel action actually move a character between `grid_cells`. Right now `resolve-turn` handles Travel but doesn't update `entity_positions`.

**Scope:**
- [ ] Edge Function `resolve-turn`: on `travel` action, close current `entity_positions` row (`timestamp_end = now()`), insert new row at target cell
- [ ] Determine target cell: adjacent cell in direction encoded in action payload, or explicit `target_cell_id`
- [ ] Frontend: Travel button opens a direction picker (N/S/E/W or click-on-grid) before submitting
- [ ] Validate: target cell must exist, have capacity, be in same setting (cross-setting travel = future milestone)
- [ ] `entity_positions` change fires Realtime → grid redraws automatically (already wired in M10)

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
| Migration 009 | `009_natural_progression_loop` — world_tick_state, proc_words, world_tick(), pg_cron |
| Migration 010 | `010_world_seeding` — 7x7 grid_cells, entity_positions seed, seed_setting_grid(), REPLICA IDENTITY |
| Edge Function | `resolve-turn` (ID: `a68468fa`, v3, ACTIVE) |
| pg_cron job | `world-tick` — `* * * * *` — `SELECT public.world_tick();` — ACTIVE |
| Publishable Key | `sb_publishable_haKvwV0M7KMj4Qz69M6WGg_KmIfU-aI` |
| Genesis seed | `settings` row `id=1`, `origin=(0,0,0)`, `grid_cells` 7x7 seeded |
| Player A (dev) | `b6879b2f-801c-4459-aae1-6a8022e8e1a7` — `dev@chronicle.local` |
| Player B (stub) | `00000000-0000-0000-0000-000000000002` |
| Test player | `d30fe4d9-a9f3-43a2-947d-30c8d9d2cdd5` — `test@chroincle.local` |
| Root timeline | `branch_id = 0` |
| Max branches/lineage | 3 (enforced in Edge Function) |
| Action durations | Exchange Info=10u · Resolve Conflict=7u · Introduce Conflict=5u · Exchange Material=3u · Travel=calculated |
| du vs tu | du = real-time ticks (global), tu = story-time per setting |
| Client cooldown | 1 real minute (UX only) |
| Default setting_id | `1` (hardcoded in `turn-manager.js`) |
| Auth storage | `sessionStorage` |
| CDN | `unpkg.com/@supabase/supabase-js@2` |
| Inspired by | [andredavisme/the-world](https://github.com/andredavisme/the-world) |

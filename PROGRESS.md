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

**What was built:**

#### DB (migration 009)
- `world_tick_state` singleton table — tracks `duration_unit` (total ticks) + `last_tick_at`; `REPLICA IDENTITY FULL` for Realtime
- `proc_words` table — vocabulary for procedural generation (source: stone/wood/bone/metal/clay/silk/ice/glass; impl: carved/woven/cast/forged/grown/etched; rel_type: ally/rival/kin/trade/debt/myth)
- Sequences added for `characters`, `settings`, `physical_environments`, `materials`, `relationship_effects`
- `world_tick()` PL/pgSQL function (SECURITY DEFINER):

| du modulus | Action |
|---|---|
| every tick | `settings.time_unit +1`, `characters.age +1` (active, positioned) |
| du % 3 | minor material tick: `materials.durability -1`, `age +1` |
| du % 50 | spawn age-0 character at setting origin + random relationship |
| du % 80 | major material change: random source + implementation from `proc_words` |
| tu % 100 | environment cycle: randomise temperature/density/hydration |
| tu % 500 | spawn new random setting (offset from parent) + seed physical_environment |
| always | `pg_notify('world_tick', json)` broadcast |

- `pg_cron` job `'world-tick'` — schedule `'* * * * *'` — active ✅

#### Smoke test (manual `SELECT public.world_tick()`)
- `world_tick_state.duration_unit` 0 → 1 ✅
- `settings.time_unit` 0 → 1 ✅

#### Frontend (`app.js`)
- Added `supabase.channel('world-tick')` subscribing to `postgres_changes` on `world_tick_state` UPDATE
- On each tick: updates status bar (`du: N`), calls `updateGrid()` to reload entity positions (new spawned chars, moved entities)

**Key decisions:**
- `world_tick_state` UPDATE is the Realtime trigger — avoids needing `pg_net` for HTTP callbacks; Supabase Realtime picks up the row change automatically
- `proc_words` is a stable seed table, not hardcoded in the function, so vocabulary can be extended via future migrations without changing the function
- du (duration units, real-time ticks) vs tu (time_unit, story-time per setting) are tracked separately — du drives spawn/material schedules, tu drives environment/world-expansion schedules
- Characters spawn only if a matching `grid_cells` row exists at the setting origin; silent no-op otherwise (safe until grid seeding is complete)

---

### 🔼 Next: Milestone 10 — World Seeding UI + Grid Cell Bootstrap
**Status:** Not started

**Goal:** Let the game actually show the world. Right now the grid canvas is mostly empty because `grid_cells` has no rows and characters have no positions seeded beyond fixtures. Milestone 10 wires it all together.

**Scope:**
- [ ] Seed `grid_cells` for genesis setting (e.g. 5×5×1 grid around origin)
- [ ] Place genesis seed character (character_id=1) at origin grid cell
- [ ] Add a `seed-world` Edge Function or SQL migration that bootstraps a fresh world on demand
- [ ] Frontend: show setting name + `time_unit` / `duration_unit` in footer
- [ ] Frontend: grid renderer draws setting boundary outline (isometric bounding box)

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
| Edge Function | `resolve-turn` (ID: `a68468fa`, v3, ACTIVE) |
| pg_cron job | `world-tick` — `* * * * *` — `SELECT public.world_tick();` — ACTIVE |
| Publishable Key | `sb_publishable_haKvwV0M7KMj4Qz69M6WGg_KmIfU-aI` |
| Genesis seed | `settings` row `id=1` required before any event insert |
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

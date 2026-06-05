# Chronicle Worlds — Progress Log

This document is the **single source of truth** for development progress. Each milestone includes what was done, key decisions, and exactly what to do next — with direct references to prior work so development can resume from this file alone.

---

## Project Overview

**Chronicle Worlds** is a turn-based, multiplayer, procedural world simulation hosted entirely on Supabase, GitHub, and GitHub Pages. Players control characters on a shared 3D grid, issuing one of five actions per turn simultaneously, with time as the core resource.

**Stack:** Supabase (PostgreSQL + Edge Functions + Auth + Realtime) · GitHub (migrations, versioning, CI/CD) · GitHub Pages (Vite + JS frontend)

**Supabase Project:** andredavisme's Project (`hhyhulqngdkwsxhymmcd`, region: `us-west-2`)

**Inspired by:** [andredavisme/the-world](https://github.com/andredavisme/the-world)

---

## Architecture — Truth / Reality Model

Established 2026-05-10. This is the canonical design contract for the simulation layer.

### Truth Schema (canonical layer)
The existing DB tables (`characters`, `settings`, `materials`, `physical_environments`, `events`) are the **truth schema**. Entities exist here as the authoritative record — their attributes define what makes each entity ontologically distinct. No names, no descriptions, no narrative. Adding a new entity to truth automatically makes it available to all realities.

### Realities (interpretive world instances)
A **reality** is a named world instance that interprets the truth schema. When a reality encounters a truth entity, it spawns an **entity copy** seeded with the truth attribute values. The copy then gains reality-exclusive attributes: `name`, `description`, and a `local_attributes` JSONB delta that diverges independently from truth.

- Realities are the **world-instance axis** — parallel to, not a superset of, branches
- Branches remain the **time axis** (chronicle forks within a reality)
- The same truth entity can exist as multiple copies across multiple realities, each with a unique identity derived from `copy_id` + `proc_words` + reality context

```
Truth Schema
  └─ Reality A  (branch_id=0 → branch_id=1 → branch_id=2)
  └─ Reality B  (branch_id=0 → ...)
  └─ Reality C  (branch_id=0 → ...)
```

### Naming Convention
Names are **never stored in truth**. They are computed in the reality layer from:
1. `proc_words` vocabulary (already exists)
2. The copy's `copy_id` as a deterministic seed
3. The reality's own context (`inspiration`, future `setting_type`)

Same truth entity → different `copy_id` seed → different name per reality. Stable within a reality; unique across realities.

---

## Milestone Log

---

### ✅ Milestones 1–19 — (see prior entries)
All prior milestones complete. Schema, Edge Functions, frontend scaffold, Realtime, testing, infra fixes, mobile responsiveness, migration repo sync, Truth/Reality layer, grid colour-coding, target action UI, stat delta feedback, age-bracket modifiers, attribute pool on destruction, text command mode.

---

### ✅ Milestone 20 — Vertical z-Axis: z_properties + z-Scaffold Gate
**Date:** 2026-05-22 | **Status:** Complete
**Migration:** `017_z_properties` | **Edge Function:** `discover-cell` (v6, ACTIVE) | **Commits:** `737ab96`, `ad13672`, `267beaf`

- `z_properties` table seeded z=-3 to z=3 with `layer_name`, `requires_flight`, `requires_breath`, `health_decay`, `durability_decay_multiplier`
- `discover-cell` v6: vertical scaffold enforcement (air requires z-1 present; deep water requires z+1)
- `app.js`: passes `vertical: dz !== 0` on every `discover-cell` call
- `look` command queries `z_properties` for layer name

---

### ✅ Milestone 21 — z-Axis UI Gates
**Date:** 2026-05-22 | **Status:** Complete
**Files:** `frontend/index.html`, `frontend/src/app.js` | **Commit:** `233f30c`

- Travel modal: `fly ▲` / `dive ▼` labels with movement requirement tooltips
- Sidebar: `#z-layer-display` shows current z-layer continuously
- `openTravelModal()` gates Up button for non-flight characters
- Text command `fly` / `go up` returns gating error for non-flight characters

---

### ✅ Milestone 22 — Option G: z-Axis Physical Mechanics (data-driven)
**Date:** 2026-06-05 | **Status:** Complete
**Migration:** `018_z_conflict_modifier` | **Edge Function:** `resolve-turn` (v7, ACTIVE) | **Commit:** `8e9893e`

- Migration `018`: `conflict_modifier NUMERIC` added to `z_properties`, seeded per layer (−1.5 to +1.5)
- `resolve-turn` v7: height-advantage bonus = `floor(actorMod − targetMod)`, min 0 — replaces hardcoded +2
- `getConflictModifier()` helper added; defaults to 0 on missing row

---

### ✅ Milestone 23 — Option I: rest as a real action
**Date:** 2026-06-05 | **Status:** Complete
**Edge Function:** `resolve-turn` (v8, ACTIVE) | **Files:** `functions/resolve-turn/index.ts`, `frontend/src/app.js` | **Commit:** this commit

**What was done:**

**`resolve-turn` v8:**
- Added `rest` to `DURATION_MAP` with duration 15u (longest of all actions — rest takes time)
- `handleRest()` function: calls `applyOneStat()` twice — `+5 health` and `+2 inspiration` to the actor
- `applyOneStat()` helper extracted from `applyModifier` for reuse on multi-stat actions
- `rest` now appears in the event log with `event_type = 'rest'` and returns `stat_deltas` like all other actions
- Action branch order: rest → exchange_material → travel → social actions

**`app.js` bug fix — z_properties query:**
- `updatePositionDisplay()` was querying `.eq('z', zVal)` — **column does not exist** (correct column: `z_layer`)
- Was selecting `label` — **field does not exist** (correct field: `layer_name`)
- Fixed: `.select('layer_name, requires_flight').eq('z_layer', zVal)` — z-layer badge now renders correctly

**Frontend rest path (was already wired, now functional):**
- Button mode: `data-action="rest"` button → `executeAction('rest')` → `submitAction('rest')` → server
- Text mode: `rest` / `wait` / `idle` → `local: rest` → `executeAction('rest')` → server
- Both modes show stat deltas (+5 health, +2 inspiration) and start cooldown bar on success

**Action duration table (complete):**
| Action | Duration units |
|---|---|
| exchange_information | 10u |
| resolve_conflict | 7u |
| introduce_conflict | 5u |
| exchange_material | 3u |
| travel | calculated |
| rest | 15u |

**Key decisions:**
- `rest` is the longest fixed-duration action (15u) — makes it a real cost, not a free heal
- Two separate `attribute_modifiers` rows are inserted (one per stat) with the same `source_entity_id = eventId`
- Health cap not enforced at DB level yet — future work (could add a CHECK constraint or clamp in `applyOneStat`)
- `requires_flight` fetched alongside `layer_name` in the badge query — available for future tooltip use

---

## 🔼 Next Milestone Candidates

### Option H — `seed_setting_grid()` z_layers param
`seed_setting_grid(setting_id, width, height, z_layers)` — spawn multi-storey settings with full z columns. Required before large-scale vertical world generation.

### Option J — z-Layer Display Polish
Front-end: show `conflict_modifier` in the z-layer badge tooltip. Show fall damage warning when entering air without flight. Show health decay countdown for breath layers.

### Option K — Health Cap
Add a `max_health` column to `characters` (or derive it from attributes). `applyOneStat` clamps health to `[0, max_health]`. Prevents rest spam from inflating health indefinitely.

---

## Developer Notes — Future Ideas

---

### 💡 Idea 3 — Vertical z-Axis Physical Mechanics ✅ COMPLETE (Milestone 22)

---

## Quick Reference

| Item | Value |
|---|---|
| GitHub Repo | [andredavisme/chronicle-worlds](https://github.com/andredavisme/chronicle-worlds) |
| Supabase Project | `hhyhulqngdkwsxhymmcd` (us-west-2) |
| Live URL | [andredavisme.github.io/chronicle-worlds](https://andredavisme.github.io/chronicle-worlds/) |
| Pages source | `gh-pages` branch, `/ (root)` |
| Deploy trigger | any push to `frontend/**` on `main` |
| Frontend source | `frontend/src/` + `frontend/index.html` — never edit `docs/` directly |
| Migration 001 | `001_core_schema` — 10 base tables |
| Migration 002 | `002_multiplayer_extensions` — players, branches, RLS, trigger, view |
| Migration 003 | `003_developer_proposals` |
| Migration 004 | `004_milestone7_tests` (ROLLBACK; reference only — **never apply to production**) |
| Migration 005 | `005_persist_test_fixtures` (COMMIT) |
| Migration 006 | `006_auto_provision_players` — player provisioning trigger + backfill |
| Migration 007 | `007_add_pk_sequences` — sequences for events, chronicle, attribute_modifiers, entity_positions |
| Migration 008 | `008_rls_policies_and_trigger_fix` — service_role INSERT policies + player read/update |
| Migration 009 | `009_natural_progression_loop` — world_tick_state, proc_words, world_tick(), pg_cron |
| Migration 010 | `010_world_seeding` — 7x7 grid_cells, entity_positions seed, seed_setting_grid(), REPLICA IDENTITY |
| Migration 011 | `011_public_read_world_state` — SELECT policies on world_tick_state + settings |
| Migration 012 | `012_public_read_game_tables` — SELECT policies on entity_positions + grid_cells + players |
| Migration 013 | `013_add_setting_discovery_fields` — max_cells + cycle_order on settings |
| Migration 014 | `014_realities_and_entity_copies` — realities, entity_copies, root reality seed, RLS |
| Migration 015 | `015_age_bracket_modifiers` — age_brackets table, apply_age_bracket_modifiers(), world_tick() patch, backfill |
| Migration 016 | `016_attribute_pool_on_destruction` — attribute_pool table, harvest/draw helpers, destruction triggers, world_tick() patch |
| Migration 017 | `017_z_properties` — z_properties table, 7 seed rows (z=-3 to z=3), RLS |
| Migration 018 | `018_z_conflict_modifier` — conflict_modifier NUMERIC column on z_properties, seeded per layer |
| Edge Function | `resolve-turn` (ID: `a68468fa`, v8, ACTIVE) |
| Edge Function | `discover-cell` (ID: `da7a0ccb`, v6, ACTIVE) |
| pg_cron job | `world-tick` — `* * * * *` — `SELECT public.world_tick();` — ACTIVE |
| Publishable Key | `sb_publishable_haKvwV0M7KMj4Qz69M6WGg_KmIfU-aI` |
| Root Reality | `reality_id=1`, `name='Root'`, `parent_reality_id=NULL` |
| Genesis seed | `settings` row `id=1`, `origin=(0,0,0)`, `grid_cells` 7x7 seeded |
| Player A (dev) | `b6879b2f-801c-4459-aae1-6a8022e8e1a7` — `dev@chronicle.local` |
| Player B (stub) | `00000000-0000-0000-0000-000000000002` |
| Test player | `d30fe4d9-a9f3-43a2-947d-30c8d9d2cdd5` — `test@chroincle.local` |
| Admin player | `7e02b48f-c839-4966-bc71-230e9c5b248c` — `admin@207analytix.com` — char4 |
| Root timeline | `branch_id = 0` |
| Max branches/lineage | 3 (enforced in Edge Function) |
| Action durations | Exchange Info=10u · Resolve Conflict=7u · Introduce Conflict=5u · Exchange Material=3u · Travel=calculated · Rest=15u |
| du vs tu | du = real-time ticks (global), tu = story-time per setting |
| Client cooldown | 1 real minute (UX only) |
| Default setting_id | `1` (hardcoded in turn-manager.js) |
| Auth storage | `sessionStorage` |
| CDN | `unpkg.com/@supabase/supabase-js@2` |
| Inspired by | [andredavisme/the-world](https://github.com/andredavisme/the-world) |

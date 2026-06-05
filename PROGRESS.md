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
**Migration:** `018_z_conflict_modifier` | **Edge Function:** `resolve-turn` (v7, ACTIVE) | **Commit:** this commit

**Context:** Prior to this milestone, `world_tick()` already had gravity (fall 1z/tick, -5 fall damage from z≥2) and breath-decay wired. `resolve-turn` v6 already blocked travel by flight/breath. The remaining gap was that height-advantage conflict damage was hardcoded as `+2` instead of being data-driven from `z_properties`.

**What was done:**

**Migration `018_z_conflict_modifier`:**
- Added `conflict_modifier NUMERIC NOT NULL DEFAULT 0` to `z_properties`
- Seeded per layer:
  - `z=-3` (abyss): −1.5 (severe submerged disadvantage)
  - `z=-2` (deep water): −1.0
  - `z=-1` (shallow water): −0.5
  - `z=0` (ground): 0.0 (neutral)
  - `z=1` (air): +0.5
  - `z=2` (high air): +1.0
  - `z=3` (void): +1.5

**Edge Function `resolve-turn` v7:**
- Added `getConflictModifier(supabase, z)` — queries `z_properties.conflict_modifier` for a given z layer
- `introduce_conflict` height bonus now computed as: `damageBonus = Math.max(0, Math.floor(actorMod - targetMod))`
  - Example: actor at z=2 (+1.0) attacks target at z=0 (0.0) → bonus = floor(1.0) = +1 extra damage
  - Example: actor at z=1 (+0.5) attacks target at z=0 (0.0) → bonus = floor(0.5) = 0 (no bonus until full integer)
  - Example: actor at z=3 (+1.5) attacks target at z=-1 (−0.5) → bonus = floor(2.0) = +2
  - Submerged attackers get 0 bonus (min 0 clamp)
- Old hardcoded `damageBonus = 2` removed

**`z_properties` full state after this migration:**
| z | layer_name | requires_flight | requires_breath | health_decay | durability_decay_multiplier | conflict_modifier |
|---|---|---|---|---|---|---|
| -3 | abyss | false | true | 3 | 4 | -1.5 |
| -2 | deep water | false | true | 1 | 3 | -1.0 |
| -1 | shallow water | false | false | 0 | 2 | -0.5 |
| 0 | ground | false | false | 0 | 1 | 0.0 |
| 1 | air | true | false | 0 | 1 | +0.5 |
| 2 | high air | true | false | 0 | 1 | +1.0 |
| 3 | void | true | false | 1 | 1 | +1.5 |

**`world_tick()` z-physics already active (pre-existing):**
- Fall: character at z≥1 without `flight=1` drops 1z per tick
- Fall damage: −5 health when falling from z≥2
- Breath decay: character at z≤-2 without `breath=1` loses `health_decay` HP per tick
- Material decay: multiplied by `durability_decay_multiplier` at the material's z layer

**Key decisions:**
- `conflict_modifier` is NUMERIC (not INT) — allows half-step tuning (e.g. 0.5) without schema change
- `Math.floor()` means a bonus only triggers at whole integers — air (0.5) vs ground (0.0) gap is 0.5, not enough for a bonus alone; void (1.5) vs shallow water (−0.5) gap is 2.0 → +2 bonus
- Negative modifiers for submerged attackers are clamped to 0 — they receive no bonus, but aren't penalised beyond being in a dangerous layer
- `getConflictModifier` defaults to 0 on missing z row — safe for future z layers outside the seeded range

---

## 🔼 Next Milestone Candidates

### Option H — `seed_setting_grid()` z_layers param
`seed_setting_grid(setting_id, width, height, z_layers)` — spawn multi-storey settings with full z columns. Required before large-scale vertical world generation.

### Option I — Rest as a Real Action
`rest` submits a no-op turn that still triggers cooldown. Could grant small inspiration or health regen via `applyModifier`. Already wired in command parser as flavour-only.

### Option J — z-Layer Display Polish
Front-end: show `conflict_modifier` in the z-layer badge tooltip. Show fall damage warning when entering air without flight. Show health decay countdown for breath layers.

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
| Edge Function | `resolve-turn` (ID: `a68468fa`, v7, ACTIVE) |
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
| Action durations | Exchange Info=10u · Resolve Conflict=7u · Introduce Conflict=5u · Exchange Material=3u · Travel=calculated |
| du vs tu | du = real-time ticks (global), tu = story-time per setting |
| Client cooldown | 1 real minute (UX only) |
| Default setting_id | `1` (hardcoded in turn-manager.js) |
| Auth storage | `sessionStorage` |
| CDN | `unpkg.com/@supabase/supabase-js@2` |
| Inspired by | [andredavisme/the-world](https://github.com/andredavisme/the-world) |

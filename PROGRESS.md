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

## Design Canon

### Character Creation — Equal Footing
Established 2026-06-05. All characters start with **identical stats** at creation — no archetype bonuses, no stat allocation, no class advantages. `max_health = 100` for all. Differentiation comes exclusively from:
- Player decisions (actions taken, paths chosen)
- Encounter outcomes (conflict results, exchanges, z-layer effects)
- Accumulated modifiers over play time

`max_health` itself can become a divergence point through future in-world events (e.g., an encounter that raises the cap as a reward), but it is never set unequally at creation.

### Stat Visibility — Opacity by Default
Established 2026-06-05. Players do not see an entity's underlying stats (including `max_health`) through casual interaction. Stat information can only be revealed through:
- Applied abilities that explicitly check or reveal stats
- Interaction with the entity (conversation, exchange) where they consciously or subconsciously disclose information

This makes the world feel real: you can infer someone's condition through behaviour, not a health bar.

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

### ✅ Milestone 23 — Options H, I, J, K: rest, z-layer polish, health cap, multi-storey seeding
**Date:** 2026-06-05 | **Status:** Complete
**Migrations:** `019_add_max_health_to_characters`, `020_seed_setting_grid_z_layers`
**Edge Function:** `resolve-turn` (v9, ACTIVE)
**Files:** `functions/resolve-turn/index.ts`, `frontend/src/app.js`, `backend/migrations/020_seed_setting_grid_z_layers.sql`
**Commits:** `210b21a` (J), `65552db` (K/v9), `69f4cb1` (H)

#### Option I — rest as a real action (resolve-turn v8)
- `rest` added to `DURATION_MAP` at 15u — the longest fixed action, making it a real cost
- `handleRest()` calls `applyOneStat()` twice: `+5 health`, `+2 inspiration` to actor
- `applyOneStat()` helper extracted from `applyModifier` — reusable for any single-stat write
- Two `attribute_modifiers` rows inserted per rest, both tied to the same `event_id`
- `app.js` bug fix: `updatePositionDisplay()` was querying `z_properties` with `.eq('z', zVal)` (column is `z_layer`) and selecting `label` (field is `layer_name`) — fixed; z-layer badge now renders

#### Option J — z-layer badge tooltip
- `updatePositionDisplay()` now selects all 6 `z_properties` columns: `layer_name`, `requires_flight`, `requires_breath`, `conflict_modifier`, `health_decay`, `durability_decay_multiplier`
- `zLayerBadgeEl.title` set as multiline tooltip:
  ```
  z-layer: Canopy
  Conflict modifier: +1.5
  ⚠ health decay: -2/tick · requires flight
  ```
- `data-decay="true"` attribute set on badge when decay is active — CSS hook for visual styling
- `look` command (text mode) now prints tooltip lines below the position line

#### Option K — max_health cap (resolve-turn v9)
- Migration `019`: `max_health INTEGER NOT NULL DEFAULT 100` added to `characters`; existing rows set to 100
- `applyOneStat()` now reads `max_health` alongside current stat value
- Health writes clamped: `newValue = Math.min(current + delta, max_health)` for `+` ops on `health`
- `actualDelta` returned — stat_deltas reflects the real write (e.g. `+2` not `+5` when near cap)
- Non-health stats and `-` operators are unaffected

#### Option H — seed_setting_grid() z_layers param (migration 020)
- Migration `020`: `seed_setting_grid(p_setting_id, p_radius, p_z_layers DEFAULT 1)` — fully backward compatible
- Loops `origin_z` through `origin_z + p_z_layers - 1`, seeding a full `(2r+1)² × z_layers` grid
- Setting entity marker still placed at ground-floor origin only
- `world_tick()` updated to call `seed_setting_grid(v_new_set, 3, 1)` explicitly
- Usage: `SELECT seed_setting_grid(5, 3, 3)` seeds a 3-storey 7×7 building

**Action duration table (complete):**
| Action | Duration |
|---|---|
| rest | 15u (longest) |
| exchange_information | 10u |
| resolve_conflict | 7u |
| introduce_conflict | 5u |
| exchange_material | 3u |
| travel | calculated |

**Key design decisions:**
- `max_health` is invisible to players — revealed only through abilities or deliberate interaction
- All characters start at identical stats (`max_health = 100`); divergence is play-driven only
- `max_health` cap can itself become a divergence point through future in-world events

---

## 🔼 Next Milestone Candidates

### Option M — Reveal Stat ability
A new interaction path: a character can consciously or subconsciously reveal their stats through a special `exchange_information` variant or applied ability. Stat snapshot returned to requester. Gated by consent or conflict roll.

### Option N — z-layer decay tick
Apply `health_decay` and `durability_decay_multiplier` from `z_properties` on each `world_tick()` for entities present in hazardous layers. Hooks into existing `applyOneStat()` and the `z_decay_last_tick` column already on `characters`.

### Option O — Multi-storey setting seed via world admin UI
Frontend: allow a developer/admin to call `seed_setting_grid(id, radius, z_layers)` from a simple form panel. Surfaces Option H to non-SQL users.

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
| Migration 017 | `017_vertical_z_axis_physics` — z_properties table, 7 seed rows (z=-3 to z=3), RLS |
| Migration 018 | `018_z_conflict_modifier` — conflict_modifier NUMERIC column on z_properties, seeded per layer |
| Migration 019 | `019_add_max_health_to_characters` — max_health INTEGER NOT NULL DEFAULT 100 |
| Migration 020 | `020_seed_setting_grid_z_layers` — p_z_layers param on seed_setting_grid(), world_tick() patch |
| Edge Function | `resolve-turn` (v9, ACTIVE) |
| Edge Function | `discover-cell` (v6, ACTIVE) |
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
| Action durations | Rest=15u · Exchange Info=10u · Resolve Conflict=7u · Introduce Conflict=5u · Exchange Material=3u · Travel=calculated |
| du vs tu | du = real-time ticks (global), tu = story-time per setting |
| Client cooldown | 1 real minute (UX only) |
| Default setting_id | `1` (hardcoded in turn-manager.js) |
| Auth storage | `sessionStorage` |
| CDN | `unpkg.com/@supabase/supabase-js@2` |
| Inspired by | [andredavisme/the-world](https://github.com/andredavisme/the-world) |

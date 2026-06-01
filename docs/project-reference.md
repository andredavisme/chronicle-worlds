# Chronicle Worlds — Project Reference

This is the **static quick-reference** for the Chronicle Worlds project. Update this file whenever a migration is applied, an Edge Function version changes, or a credential rotates.

Last updated: **2026-06-01 (Session 1)**

---

## Live URLs

| Surface | URL |
|---|---|
| GitHub Repo | https://github.com/andredavisme/chronicle-worlds |
| Live Game | https://andredavisme.github.io/chronicle-worlds/ |
| Supabase Dashboard | https://supabase.com/dashboard/project/hhyhulqngdkwsxhymmcd |
| Inspired by | https://github.com/andredavisme/the-world |

---

## Infrastructure

| Item | Value |
|---|---|
| Supabase Project ID | `hhyhulqngdkwsxhymmcd` |
| Supabase Region | `us-west-2` |
| Pages Source Branch | `gh-pages`, folder `/ (root)` |
| Deploy Trigger | any push to `frontend/**` on `main` |
| Frontend Source | `frontend/src/` + `frontend/index.html` — **never edit `docs/` directly** |
| CDN | `unpkg.com/@supabase/supabase-js@2` |
| Auth Storage | `sessionStorage` |

---

## Credentials & Keys

| Item | Value |
|---|---|
| Publishable Key | `sb_publishable_haKvwV0M7KMj4Qz69M6WGg_KmIfU-aI` |
| Player A (dev) | `b6879b2f-801c-4459-aae1-6a8022e8e1a7` — `dev@chronicle.local` |
| Player B (stub) | `00000000-0000-0000-0000-000000000002` |
| Test Player | `d30fe4d9-a9f3-43a2-947d-30c8d9d2cdd5` — `test@chroincle.local` |
| Admin Player | `7e02b48f-c839-4966-bc71-230e9c5b248c` — `admin@207analytix.com` — char4 |

---

## Migrations

> Migration 004 (`004_milestone7_tests.sql`) is a ROLLBACK test script — **never apply to production.**

| # | File | Summary |
|---|---|---|
| 001 | `001_core_schema` | 10 base tables |
| 002 | `002_multiplayer_extensions` | players, branches, RLS, trigger, view |
| 003 | `003_developer_proposals` | — |
| 004 | `004_milestone7_tests` | **ROLLBACK only — reference use, never apply** |
| 005 | `005_persist_test_fixtures` | COMMIT |
| 006 | `006_auto_provision_players` | Player provisioning trigger + backfill |
| 007 | `007_add_pk_sequences` | Sequences for events, chronicle, attribute_modifiers, entity_positions |
| 008 | `008_rls_policies_and_trigger_fix` | service_role INSERT policies + player read/update |
| 009 | `009_natural_progression_loop` | world_tick_state, proc_words, world_tick(), pg_cron |
| 010 | `010_world_seeding` | 7×7 grid_cells, entity_positions seed, seed_setting_grid(), REPLICA IDENTITY |
| 011 | `011_public_read_world_state` | SELECT policies on world_tick_state + settings |
| 012 | `012_public_read_game_tables` | SELECT policies on entity_positions + grid_cells + players |
| 013 | `013_add_setting_discovery_fields` | max_cells + cycle_order on settings |
| 014 | `014_realities_and_entity_copies` | realities, entity_copies, root reality seed, RLS |
| 015 | `015_age_bracket_modifiers` | age_brackets table, apply_age_bracket_modifiers(), world_tick() patch, backfill |
| 016 | `016_attribute_pool_on_destruction` | attribute_pool table, harvest/draw helpers, destruction triggers, world_tick() patch |
| 017 | `017_z_properties` | z_properties table, 5 seed rows (z=-2 to z=2), RLS |

---

## Edge Functions

| Function | ID | Active Version | Notes |
|---|---|---|---|
| `resolve-turn` | `a68468fa` | v4 | Handles all turn actions; returns `stat_deltas[]` |
| `discover-cell` | `da7a0ccb` | v6 | On-demand cell spawn; z-scaffold enforcement; vertical flag |

---

## pg_cron Jobs

| Job | Schedule | Query | Status |
|---|---|---|---|
| `world-tick` | `* * * * *` | `SELECT public.world_tick();` | ACTIVE |

---

## World Seed State

| Item | Value |
|---|---|
| Root Reality | `reality_id=1`, `name='Root'`, `parent_reality_id=NULL` |
| Genesis Setting | `settings` row `id=1`, `origin=(0,0,0)`, 7×7 grid_cells seeded |
| Root Timeline | `branch_id = 0` |
| Max Branches / Lineage | 3 (enforced in Edge Function) |

---

## Game Constants

| Item | Value |
|---|---|
| Action Durations | Exchange Info=10u · Resolve Conflict=7u · Introduce Conflict=5u · Exchange Material=3u · Travel=calculated |
| du vs tu | `du` = real-time ticks (global) · `tu` = story-time per setting |
| Client Cooldown | 1 real minute (UX only) |
| Default setting_id | `1` (hardcoded in `turn-manager.js` — known tech debt) |

---

## Architecture Summary

### Truth / Reality Model

- **Truth schema** (`characters`, `settings`, `materials`, `physical_environments`, `events`) — authoritative entity records; no names, no narrative
- **Realities** — named world instances that interpret the truth schema; each spawns `entity_copies` per encountered truth entity
- **Branches** — time axis (chronicle forks within a reality); realities are the world-instance axis
- Names derived deterministically from `proc_words` + `copy_id` seed; stable within a reality, unique across realities

### z-Axis Config (`z_properties`)

| z | layer_name | Movement Requirement |
|---|---|---|
| -2 | deep_water | breath |
| -1 | shallow_water | — |
| 0 | ground | — |
| 1 | air_1 | flight |
| 2 | air_2 | flight |

**Scaffold rules:**
- `z=0`, `z=-1`: always enterable
- `z≥1` (air): requires cell at `z-1` in same `(x,y)` column + setting
- `z≤-2` (deep water): requires cell at `z+1` in same `(x,y)` column + setting

---

## Next Milestone Candidates

| Option | Name | Description |
|---|---|---|
| **G** ⭐ | z-Axis Physical Mechanics | Wire `z_properties` into `resolve-turn`/`world_tick()` — gravity, breath damage, height advantage `conflict_modifier` |
| **H** | `seed_setting_grid()` z_layers | Add `z_layers` param to spawn multi-storey settings with full z columns |
| **I** | Rest as a Real Action | Wire `rest` through `submitAction()` pipeline with cooldown + optional regen |

---

## Key Architectural Decisions (Permanent Record)

| Decision | Choice | Rationale |
|---|---|---|
| Truth schema is name-free | Names live in `entity_copies` only | Stable entity identity decoupled from narrative interpretation |
| Realities vs. branches | Realities = world-instance axis; branches = time axis | Clear separation prevents conflation |
| z scaffold gate location | `discover-cell` Edge Function | Prevents invalid topology at creation time, not just traversal time |
| Flight gate location | UI layer (Milestone 21); physics deferred | Unblocks vertical UI without requiring full physics sim |
| FIFO attribute pool | `created_at ASC` draw order | Oldest ecological history consumed first — ecological realism |
| Age bracket modifiers replace | DELETE prior bracket row, INSERT new | Brackets don't stack — youth inspiration doesn't persist into prime |

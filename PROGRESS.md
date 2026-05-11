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

See prior entry for full details. Summary:
- `world_tick_state` singleton, `proc_words` vocabulary table
- `world_tick()`: per-tick aging, material decay, char spawn (du%50), material change (du%80), env cycle (tu%100), setting spawn (tu%500)
- `pg_cron` job `world-tick` — `* * * * *` — ACTIVE
- Frontend: `world-tick` Realtime channel on `world_tick_state`

---

### ✅ Milestone 10 — World Seeding + Grid Bootstrap
**Date:** 2026-05-10 | **Status:** Complete
**Migration:** `010_world_seeding` | **Commit:** `5190083`

See prior entry for full details. Summary:
- 7×7×1 `grid_cells` seeded for genesis setting
- entity_positions: char1@(0,0,0), char7@(1,1,0), material101@(-1,0,0), setting1@(0,0,0)
- `seed_setting_grid()` helper; `world_tick()` patched; `REPLICA IDENTITY FULL` on entity_positions
- Frontend: isometric boundary box per setting, `#world-time` footer (tu/du), entity_positions Realtime channel

---

### ✅ CI/CD Fix — GitHub Pages Deploy Pipeline
**Date:** 2026-05-10 | **Status:** Complete
**Commits:** `de6b193` (workflow fix) → `69a09d4` (permissions) → `fb997a3` (trigger) — **Deploy #29 ✅ green**

**Problem:** `peaceiris/actions-gh-pages@v4` was configured with `publish_branch: main`, which GitHub prohibits (can't deploy from main to main). Re-running old runs always used the old workflow snapshot — didn't pick up fixes.

**Fix sequence:**
1. Changed `publish_branch: main` → `publish_branch: gh-pages` in `deploy.yml`
2. Created `gh-pages` branch (required to exist before first deploy)
3. Added `permissions: pages: write / id-token: write` to workflow (required by GitHub for Pages deployments)
4. Updated Pages source in repo Settings → Pages → branch: `gh-pages`, folder: `/ (root)` *(manual step by user)*
5. Pushed a `frontend/` touch commit to trigger a fresh run (re-runs always use old workflow snapshot)

**Result:** Deploy #29 green ✅. Site live at [andredavisme.github.io/chronicle-worlds](https://andredavisme.github.io/chronicle-worlds/)

**Key lesson:** Never re-run a failed workflow to test a `deploy.yml` fix — re-runs snapshot the workflow at the original commit. Always push a new commit to `frontend/**` to trigger a fresh run.

**Key lesson:** `docs/index.html` is the Vite **build output** — it is overwritten on every deploy. All frontend source changes must go into `frontend/src/` and `frontend/index.html`. Direct edits to `docs/` are ephemeral.

---

### ✅ Milestone 11 — Travel Action + Grid Movement
**Date:** 2026-05-10 | **Status:** Complete
**Commits:** `fb75a46` (Vite source), `7f04134` (docs guard, superseded), `a7f889b` (initial, superseded)

**What was done:**
- `frontend/index.html`: direction picker modal markup + styles (N/S/E/W/Up/Down, 3×3 compass grid layout)
- `frontend/src/app.js`: `getAdjacentCellId(direction, characterId)` — reads actor's open `entity_positions` row, applies `DIR_DELTA` offset, looks up target `grid_cells` row; returns `grid_cell_id` or user-facing error
- Travel button opens modal instead of submitting immediately; on direction chosen calls `submitAction('travel', { destination_grid_cell_id })`
- `gameInitialised` flag guards channel subscriptions against double-fire from `onAuthStateChange` (fires for both `INITIAL_SESSION` and `SIGNED_IN` on page load)
- Validated live: char1 moved N from `(0,0,0)` → `(0,-1,0)`, grid redraws via Realtime

**Bugfixes applied post-deploy:**
- Migration `011_public_read_world_state`: added SELECT policies on `world_tick_state` and `settings` (were 406ing)
- Migration `012_public_read_game_tables`: added SELECT policies on `entity_positions` and `grid_cells`; broadened `players` SELECT from own-only to all rows

**Key decisions:**
- Up/Down return `No cell exists to the up/down` — correct boundary behaviour; z≠0 cells only exist when structures/terrain warrant them
- Cross-setting travel deferred to a future milestone
- `destination_grid_cell_id` is the canonical travel payload — no server-side direction encoding needed

---

### ✅ Milestone 12 — World Discovery System
**Date:** 2026-05-10 | **Status:** Complete
**Migration:** `add_setting_discovery_fields` | **Edge Function:** `discover-cell` (v2, ACTIVE) | **Commit:** `ce3a49f`

**What was done:**
- Added `max_cells` (integer, random ceiling 7–20 per setting) and `cycle_order` (unique integer) to `settings` table
- Deployed `discover-cell` Edge Function — called by the client on every movement attempt instead of querying `grid_cells` directly
- `app.js` `getAdjacentCellId()` rewritten to invoke `discover-cell` with `{ x, y, z, from_cell_id }`
- `prevalidateDirections()` simplified — all 6 directions always enabled; undiscovered cells spawn on demand
- Status bar shows `"discovering new cell to the [dir]…"` on first entry to an unvisited cell (`spawned: true` in response)
- CORS headers added to Edge Function (v2) to unblock calls from `andredavisme.github.io`

**Discovery logic (in Edge Function):**
| Scenario | Cell assigned to |
|---|---|
| Cell already exists | Returned immediately, no insert |
| Travel, previous setting has room | Same setting as origin cell |
| Travel, previous setting full (`count >= max_cells`) | Next setting in `cycle_order` |
| No next setting exists | New setting spawned dynamically (cycle_order+1, random max_cells 7–20) |
| Entity spawn, no travel context | Random existing setting (or new one if none) |

**Key decisions:**
- `from_cell_id` is the travel context signal — omitting it triggers random-setting assignment
- Settings are spawned dynamically with `time_unit: 0` as placeholder; world content seeded later via `world_tick()` or future milestone
- `UNIQUE INDEX` on `cycle_order` enforces deterministic cycle progression

---

### 🔼 Next: Milestone 13 — Setting Identity + World Content
**Status:** Not started

**Goal:** Newly discovered settings should have meaningful identity — names, time units, and visual distinction in the grid renderer. Currently spawned settings have `time_unit: 0` and no name.

**Scope:**
- [ ] Assign procedural names to spawned settings using `proc_words` vocabulary
- [ ] Assign a non-zero `time_unit` to spawned settings (random range or biome-based)
- [ ] Grid renderer: colour-code cells by `setting_id` so setting boundaries are visually apparent
- [ ] Sidebar: display current setting name when character enters a new cell (`charSettingEl` already wired)
- [ ] Consider: `setting_type` enum (forest / ocean / desert / city / void) as a scaffold for future biome rules

---

## Developer Notes — Future Ideas

Unscheduled design ideas to revisit when relevant milestones are reached. Not committed to any implementation timeline.

---

### 💡 Idea 1 — Attribute Pool on Entity Destruction

**Concept:** When an entity (character or material) is destroyed — i.e., its `health` or `durability` reaches `0` — all of its current `attribute_modifiers` rows are not deleted but instead moved into a shared global pool. Newly created entities (spawned via natural progression or player action) draw from this pool to seed their initial attributes, creating a form of ecological inheritance across the world's history.

**Design considerations:**
- New table (e.g., `attribute_pool`) or a flag column on `attribute_modifiers` (`pooled BOOLEAN`) to mark released attributes
- `world_tick()` spawn logic would query the pool and apply a random or weighted subset to new entities
- Pool could be scoped per `setting_id` (local inheritance) or global (world-wide inheritance) — local is more thematically interesting
- Destruction trigger: extend `world_tick()` or add a DB trigger on `characters.health` and `materials.durability` to fire on reaching `0`
- Chronicle entry should record destruction events so the lineage of attributes is traceable

---

### 💡 Idea 2 — Age-Based Attribute Modification

**Concept:** Entities with an `age` attribute (currently characters) have their attributes automatically modified as age increases. Aging is already tracked per tick in `world_tick()` — this extends that loop to apply lifecycle modifiers at defined age thresholds.

**Design considerations:**
- Define age bracket thresholds (e.g., youth / prime / elder) as constants or a config table (e.g., `age_brackets`)
- On each tick, check if a character's age crosses a bracket boundary; if so, insert/update rows in `attribute_modifiers` for that entity
- Modifier values can be seeded procedurally (using `proc_words` logic or a numeric range) to keep each character's aging curve unique
- Could interact with Idea 1: entities that die young vs. old contribute differently weighted attribute pools
- Consider whether age modifiers are permanent (accumulating) or replaced per bracket (simpler, less drift)

---

### 💡 Idea 3 — Vertical z-Axis Physical Mechanics

**Concept:** The `z` coordinate is currently flat (genesis grid is z=0 only). As the world gains structures and terrain, `z` becomes the axis for physical rules: gravity, buoyancy, flight, and elevation advantage.

**Design considerations:**
- **Structures** — buildings are stacked z-layers; `seed_setting_grid()` gains a `z_layers` parameter; cells only exist where structure/terrain warrants them (sparse, not a full 3D volume)
- **Gravity** — characters without a supporting entity or surface at `z-1` fall each tick unless they have a `flight` or `buoyancy` attribute modifier; falling could deal damage via a conflict event
- **Air travel** — `z=2+` cells accessible only to entities with `flight` attribute; used for birds, flying characters, projectiles, weather events
- **Water** — `z=-1` and below as sub-surface cells; movement requires `buoyancy` or `breath` attributes; material decay accelerated; `world_tick()` could model flooding/drainage
- **Height advantage in conflict** — occupying a higher z than a target entity applies an attribute modifier bonus to `introduce_conflict` / `resolve_conflict` actions
- **Implementation path** — no schema changes needed (grid_cells already has z); z>0 cells seeded on structure spawn in `world_tick()`; Edge Function travel validation already respects cell existence; client direction picker Up/Down already wired and returns correct boundary error when no z cell exists

---

### 💡 Idea 4 — Text-Based Command Mode

**Concept:** A toggle switch in the UI lets players switch between the current button-driven interface and a text command input. Both modes submit the same underlying actions — text mode is an alternate input layer, not a separate system.

**Design considerations:**
- Toggle switch persists preference to `localStorage` so it survives page refresh
- When text mode is active, the action buttons and travel modal are hidden; a single `<input>` + submit button appear instead
- Parser is client-side only — no backend changes needed
- Commands map directly to existing `submitAction()` calls

**Command Dictionary (draft):**

| Command | Aliases | Action | Notes |
|---|---|---|---|
| `go north` | `go n`, `move north`, `n` | `travel` → N | Also: `s`, `e`, `w`, `up`, `down` |
| `go south` | `go s`, `s` | `travel` → S | |
| `go east` | `go e`, `e` | `travel` → E | |
| `go west` | `go w`, `w` | `travel` → W | |
| `go up` | `up`, `u`, `ascend` | `travel` → Up | |
| `go down` | `down`, `d`, `descend` | `travel` → Down | |
| `rest` | `wait`, `idle` | `rest` | |
| `talk` | `exchange info`, `speak` | `exchange_info` | Future: optional target |
| `fight` | `attack`, `conflict` | `introduce_conflict` | Future: optional target |
| `resolve` | `resolve conflict` | `resolve_conflict` | |
| `trade` | `exchange material`, `give` | `exchange_material` | Future: optional item |
| `look` | `l`, `examine` | (no action) | Prints current cell info to status bar |
| `help` | `?`, `commands` | (no action) | Prints command list to status bar |

**Implementation path:**
1. Add toggle switch to `frontend/index.html` sidebar
2. Toggle handler in `app.js` shows/hides button panel vs. text input
3. `parseCommand(input)` function — trims, lowercases, matches against alias table, calls `submitAction()` or `openTravelModal()` appropriately
4. Travel commands bypass the modal entirely — `parseCommand('go north')` calls `getAdjacentCellId('north', characterId)` and submits directly
5. `look` and `help` are local-only: write to `statusEl` without a server round-trip
6. Unknown input: `statusEl.textContent = 'unknown command — type "help" for a list'`

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
| Migration 004 | `004_milestone7_tests` (ROLLBACK; reference only) |
| Migration 005 | `005_persist_test_fixtures` (COMMIT) |
| Migration 006 | `006_auto_provision_players` — player provisioning trigger + backfill |
| Migration 007 | `007_add_pk_sequences` — sequences for events, chronicle, attribute_modifiers, entity_positions |
| Migration 008 | `008_rls_policies_and_trigger_fix` — service_role INSERT policies + player read/update |
| Migration 009 | `009_natural_progression_loop` — world_tick_state, proc_words, world_tick(), pg_cron |
| Migration 010 | `010_world_seeding` — 7x7 grid_cells, entity_positions seed, seed_setting_grid(), REPLICA IDENTITY |
| Migration 011 | `011_public_read_world_state` — SELECT policies on world_tick_state + settings |
| Migration 012 | `012_public_read_game_tables` — SELECT policies on entity_positions + grid_cells + players |
| Migration 013 | `add_setting_discovery_fields` — max_cells + cycle_order on settings |
| Edge Function | `resolve-turn` (ID: `a68468fa`, v3, ACTIVE) |
| Edge Function | `discover-cell` (ID: `da7a0ccb`, v2, ACTIVE) |
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
| Default setting_id | `1` (hardcoded in turn-manager.js) |
| Auth storage | `sessionStorage` |
| CDN | `unpkg.com/@supabase/supabase-js@2` |
| Inspired by | [andredavisme/the-world](https://github.com/andredavisme/the-world) |

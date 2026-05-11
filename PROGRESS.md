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

**Fix sequence:**
1. Changed `publish_branch: main` → `publish_branch: gh-pages` in `deploy.yml`
2. Created `gh-pages` branch
3. Added `permissions: pages: write / id-token: write`
4. Updated Pages source in repo Settings → Pages → branch: `gh-pages`, folder: `/ (root)` *(manual)*
5. Pushed a `frontend/` touch commit to trigger a fresh run

**Result:** Site live at [andredavisme.github.io/chronicle-worlds](https://andredavisme.github.io/chronicle-worlds/)

**Key lesson:** Never re-run a failed workflow to test a `deploy.yml` fix — always push a new commit to `frontend/**`.

**Key lesson:** `docs/index.html` is the Vite **build output** — overwritten on every deploy. All frontend source changes must go into `frontend/src/` and `frontend/index.html`.

---

### ✅ Milestone 11 — Travel Action + Grid Movement
**Date:** 2026-05-10 | **Status:** Complete
**Commits:** `fb75a46` (Vite source), `7f04134` (docs guard, superseded), `a7f889b` (initial, superseded)

- `frontend/index.html`: direction picker modal (N/S/E/W/Up/Down, 3×3 compass grid)
- `app.js`: `getAdjacentCellId(direction, characterId)` — reads actor's entity_positions, applies DIR_DELTA, looks up target grid_cells row
- Travel button opens modal; on direction chosen calls `submitAction('travel', { destination_grid_cell_id })`
- `gameInitialised` flag guards channel subscriptions against double-fire
- Validated live: char1 moved N from `(0,0,0)` → `(0,-1,0)`

**Bugfixes:**
- Migration `011_public_read_world_state`: SELECT policies on world_tick_state + settings
- Migration `012_public_read_game_tables`: SELECT policies on entity_positions + grid_cells + players

**Key decisions:**
- Up/Down boundary: correct — z≠0 cells only exist when structures/terrain warrant them
- Cross-setting travel deferred
- `destination_grid_cell_id` is the canonical travel payload

---

### ✅ Milestone 12 — World Discovery System
**Date:** 2026-05-10 | **Status:** Complete
**Migration:** `add_setting_discovery_fields` | **Edge Function:** `discover-cell` (v2, ACTIVE) | **Commit:** `ce3a49f`

- Added `max_cells` and `cycle_order` to `settings` table
- `discover-cell` Edge Function — called on every movement attempt
- `getAdjacentCellId()` rewritten to invoke `discover-cell` with `{ x, y, z, from_cell_id }`
- Undiscovered cells spawn on demand; status bar shows `"discovering new cell to the [dir]…"`

**Discovery logic:**
| Scenario | Cell assigned to |
|---|---|
| Cell already exists | Returned immediately |
| Travel, previous setting has room | Same setting as origin |
| Travel, previous setting full | Next setting in `cycle_order` |
| No next setting exists | New setting spawned dynamically |
| Entity spawn, no travel context | Random existing setting |

**Key decisions:**
- `from_cell_id` is the travel context signal
- Settings spawned with `time_unit: 0` as placeholder — identity deferred to reality layer (Milestone 13)

---

### ✅ Milestone 13a — Truth / Reality Schema Foundation
**Date:** 2026-05-10 | **Status:** Complete
**Migration:** `014_realities_and_entity_copies`

**What was done:**
- Established the **Truth / Reality architecture** as the canonical simulation contract (see Architecture section above)
- Created `realities` table — world instances parallel to (not subsuming) branches
- Created `entity_copies` table — truth entity interpretations per reality, carrying `name`, `description`, `local_attributes` (JSONB delta)
- Seeded root reality `id=1`, `name='Root'`, `parent_reality_id=NULL`
- RLS: public SELECT on both tables; service role INSERT/UPDATE for Edge Function writes
- Indexes: `reality_id`, `(truth_entity_type, truth_entity_id)`, `(reality_id, truth_entity_type)`

**Key decisions:**
- Truth schema is **inert and complete** — no names, no descriptions, no narrative; never modified by this layer
- Realities are the **world-instance axis**; branches remain the **time axis**
- Copies start with truth attribute values (`local_attributes: {}`); diverge independently per reality
- Names derived deterministically from `copy_id` + `proc_words` + reality context — stable within a reality, unique across realities
- `truth_entity_type` CHECK constraint: `character | material | setting | physical_environment | event`
- `UNIQUE(reality_id, truth_entity_type, truth_entity_id)` — one copy per truth entity per reality

---

### ✅ Housekeeping — Migration Audit + 004 Skip Decision
**Date:** 2026-05-11 | **Status:** Complete

**What was done:**
- Reviewed all 10 repo migrations against Supabase migration history
- Confirmed migrations 001–003 and 005–014 are applied to production
- Confirmed migrations 011–014 (`011_public_read_world_state`, `012_public_read_game_tables`, `add_setting_discovery_fields`, `014_realities_and_entity_copies`) exist in Supabase but were not yet committed to the repo — sync gap later resolved during repo sync

**`004_milestone7_tests.sql` — Decision: SKIP (permanent)**
- File is a QA/test script wrapped in `BEGIN` / `ROLLBACK` — it intentionally undoes all its inserts
- Requires manual `PLAYER_A_UUID` substitution before running; would throw an exception as-is
- Uses `CREATE TEMP TABLE` (session-scoped, not persistent)
- Tests validated: `setting_id NOT NULL`, `advance_turn` trigger, `turn_queue` race ordering, branch limit (3), natural progression schedule, travel duration formula, RLS chronicle isolation
- **Will never be applied to production.** Run manually in SQL Editor for schema validation only.

**Repo sync result — migrations 011–014:**
- These 4 migrations were committed back into `backend/migrations/` and the repo is now in sync with production schema
- New contributor bootstrap no longer depends on manual schema diffing

---

### ✅ Milestone 13b — Setting Identity via Reality Layer
**Date:** 2026-05-11 | **Status:** Complete
**Edge Function:** `discover-cell` (v3, ACTIVE) | **Commits:** `f70b2a8`, `e9f63ae`

**What was done:**
- Upgraded `discover-cell` to v3 so setting discovery now ensures a Root reality `entity_copy` exists for every discovered setting
- Procedural setting names now derive from `proc_words` categories `impl` + `source` using deterministic logic keyed by `setting_id`
- `discover-cell` response payload now returns `copy_name` and `copy_description`
- Backfilled existing `settings` rows into `entity_copies` for Root reality
- `frontend/src/app.js` now resolves current setting identity from `entity_copies` instead of `settings(name)`
- Sidebar now shows the setting's procedural name and short description in `char-position-panel`
- Travel status messages now include the procedural setting name when entering or discovering a cell

**Backfill results:**
- `setting_id=1` → `cast bone`
- `setting_id=2` → `etched bone`

**Key decisions:**
- Identity currently uses deterministic `setting_id` seeding instead of `copy_id`; stable now, can migrate later if multi-reality divergence needs stronger decoupling
- Root reality remains the active display context (`reality_id=1`)
- Truth `settings` rows remain nameless; all player-facing naming lives in `entity_copies`
- `local_attributes` reserved for future biome metadata (for example `setting_type`)

---

### ✅ Milestone 13c — Grid Colour-Coding by Setting
**Date:** 2026-05-11 | **Status:** Complete
**Commit:** `939a6b03`

**What was done:**
- Added `SETTING_PALETTE`: 10 evenly-spaced HSL hues, stable per `setting_id mod 10`
- `settingColour(id)` helper returns `{ fill, stroke, label }` HSLA variants at low opacity
- `loadEntityPositions()` now queries **all** `grid_cells` rows (not just those with entities) into a new `gridCells[]` state array
- `drawGridTile()`: renders each cell as an isometric diamond — `fill` at 0.18 opacity, `stroke` at 0.45 opacity
- `render()` layer order: tiles → boundary outlines → entities
- `drawSettingBoundary()` now uses the per-setting stroke colour instead of the hardcoded `rgba(80,80,160)`
- Setting label (`S1`, `S2`…) tinted to match its boundary colour
- Empty-world fallback message now only shown when both `entities` and `gridCells` are empty

**Key decisions:**
- Tile fill opacity kept at 0.18 — legible tint without obscuring entity markers or boundary lines
- Boundary `lineWidth` bumped from 1 → 1.5 to stay readable over the tile fill
- Palette cycles every 10 settings; neighbouring settings will rarely share a hue in practice given natural spawn spacing
- `settingBounds` now derived from `gridCells[]` instead of entity_positions join, so empty settings still render a boundary

---

### ✅ Milestone 14 — Target Action UI (exchange_information, introduce_conflict, resolve_conflict, exchange_material)
**Date:** 2026-05-11 | **Status:** Complete
**Commits:** `d362196` (turn-manager onDisabled), `c233e40` (app.js wire-up), `0521e1d` (travel cooldown guard), `dc6449e` (disabled button CSS)

**What was done:**
- Added target-picker modal (`#target-modal`) to `index.html` — lists co-located characters with hp/wealth/inspiration stats
- `exchange_material` flow includes an amount input field (`#target-amount`) in the modal
- `getColocatedCharacters(actorCharacterId)` — queries `entity_positions` for other characters sharing the same `grid_cell_id`, then fetches their `characters` stats
- `openTargetModal(action, actorCharacterId, colocated)` — returns a Promise resolving to `{ target_character_id, wealth_amount? }` or `null` on cancel
- All four targeted actions now fully wired in `app.js` action button handler
- `exchange_information` submits directly (self-action, no target needed)

**Cooldown UX fixes (same session):**
- `turn-manager.js`: added `onDisabledChange` callback — `startCooldown()` now fires `onDisabledChange(true)` immediately and `onDisabledChange(false)` when timer expires
- `app.js`: wired `onDisabled: (disabled) => setActionsDisabled(disabled)` into `initTurnManager`
- `app.js`: travel handler now checks `getCooldownRemaining() > 0` before opening modal (belt-and-suspenders alongside `btn.disabled`)
- `index.html`: `.action-btn:disabled` strengthened — added `color: #444`, `border-color: #1e1e1e`, `pointer-events: none` so the greyed state is visually distinct on the dark `#111` background

**Known outstanding issue:**
- The travel `finally { setActionsDisabled(false) }` block races with `onDisabled(true)` from `startCooldown()` — `finally` fires after `submitAction` resolves but before the cooldown disable propagates, potentially re-enabling buttons momentarily. Fix: remove `setActionsDisabled(false)` from the travel direction button `finally` and let the cooldown callback own re-enabling exclusively.

**Validated live:**
- char1 navigated from `(1,0,0)` → `(0,0,0)` during this session
- Target modal renders co-located character list with stats
- All four targeted actions submit successfully

---

## 🔼 Next Milestone Candidates

Choose one to tackle next:

### Option A — Fix Travel `finally` Race (Quick)
Remove `setActionsDisabled(false)` from the travel direction button `finally` block so the cooldown `onDisabled` callback is the sole authority on re-enabling. One-line fix in `app.js`.

### Option B — Text Command Mode (Idea 4)
Toggle between button UI and text input. `parseCommand(input)` maps aliases (`go n`, `fight`, `trade`…) to `submitAction()`. `look` and `help` are local only. See Developer Notes below for full command dictionary.

### Option C — Age-Based Attribute Modification (Idea 2)
Insert/update `attribute_modifiers` when a character's age crosses youth/prime/elder brackets in `world_tick()`. Bracket thresholds as constants. Permanent accumulating modifiers.

### Option D — Attribute Pool on Entity Destruction (Idea 1)
Destruction trigger on `characters.health = 0` / `materials.durability = 0`. Moves `attribute_modifiers` rows into a `pooled = TRUE` flag or `attribute_pool` table. `world_tick()` spawn logic seeds new entities from the pool.

### Option E — Remaining Action Mechanics
The four targeted actions are now UI-complete but their Edge Function effects are minimal. Define richer outcomes: conflict changes health, exchange_material transfers wealth, exchange_information transfers inspiration.

---

## Developer Notes — Future Ideas

---

### 💡 Idea 1 — Attribute Pool on Entity Destruction

**Concept:** When an entity's `health` or `durability` reaches `0`, its `attribute_modifiers` rows move into a shared pool. Newly spawned entities draw from this pool to seed initial attributes — ecological inheritance across world history.

**Design considerations:**
- New table `attribute_pool` or `pooled BOOLEAN` flag on `attribute_modifiers`
- `world_tick()` spawn logic queries pool for new entity seeding
- Pool scoped per `setting_id` (local inheritance) or global
- Destruction trigger on `characters.health` and `materials.durability`
- Chronicle entry records destruction events for lineage tracing

---

### 💡 Idea 2 — Age-Based Attribute Modification

**Concept:** Characters' attributes automatically modified at age bracket thresholds (youth/prime/elder). Aging already tracked in `world_tick()`.

**Design considerations:**
- Age bracket thresholds as constants or `age_brackets` config table
- On tick, check if age crosses bracket; insert/update `attribute_modifiers`
- Modifier values seeded procedurally for unique aging curves
- Could interact with Idea 1: young vs. old death contributes differently weighted attribute pools
- Permanent (accumulating) vs. per-bracket (replaced) modifiers

---

### 💡 Idea 3 — Vertical z-Axis Physical Mechanics

**Concept:** `z` coordinate as axis for gravity, buoyancy, flight, elevation advantage.

**Design considerations:**
- Structures as stacked z-layers; `seed_setting_grid()` gains `z_layers` param
- Gravity: characters without support at `z-1` fall per tick unless `flight`/`buoyancy` attribute
- Air travel: `z=2+` accessible only to `flight` entities
- Water: `z=-1` and below; requires `buoyancy`/`breath`; accelerated material decay
- Height advantage: higher z → attribute modifier bonus on conflict actions
- No schema changes needed; z>0 cells seeded on structure spawn; Up/Down already wired

---

### 💡 Idea 4 — Text-Based Command Mode

**Concept:** Toggle between button UI and text command input. Same underlying `submitAction()` calls — text mode is an alternate input layer only.

**Command Dictionary (draft):**

| Command | Aliases | Action |
|---|---|---|
| `go north` | `go n`, `n` | `travel` → N |
| `go south` | `go s`, `s` | `travel` → S |
| `go east` | `go e`, `e` | `travel` → E |
| `go west` | `go w`, `w` | `travel` → W |
| `go up` | `up`, `u`, `ascend` | `travel` → Up |
| `go down` | `down`, `d`, `descend` | `travel` → Down |
| `rest` | `wait`, `idle` | `rest` |
| `talk` | `exchange info`, `speak` | `exchange_info` |
| `fight` | `attack`, `conflict` | `introduce_conflict` |
| `resolve` | `resolve conflict` | `resolve_conflict` |
| `trade` | `exchange material`, `give` | `exchange_material` |
| `look` | `l`, `examine` | (local) print cell info |
| `help` | `?`, `commands` | (local) print command list |

**Implementation path:**
1. Toggle switch in `frontend/index.html` sidebar
2. Toggle handler shows/hides button panel vs. text input
3. `parseCommand(input)` — trims, lowercases, matches alias table, calls `submitAction()` or `openTravelModal()`
4. Travel commands bypass modal entirely
5. `look` and `help` write to `statusEl` without server round-trip
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
| Edge Function | `resolve-turn` (ID: `a68468fa`, v3, ACTIVE) |
| Edge Function | `discover-cell` (ID: `da7a0ccb`, v3, ACTIVE) |
| pg_cron job | `world-tick` — `* * * * *` — `SELECT public.world_tick();` — ACTIVE |
| Publishable Key | `sb_publishable_haKvwV0M7KMj4Qz69M6WGg_KmIfU-aI` |
| Root Reality | `reality_id=1`, `name='Root'`, `parent_reality_id=NULL` |
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

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
**Migration:** `add_setting_discovery_fields` | **Edge Function:** `discover-cell` (v2, superseded) | **Commit:** `ce3a49f`

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
**Edge Function:** `discover-cell` (v3, superseded) | **Commits:** `f70b2a8`, `e9f63ae`

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

**Known outstanding issue (fixed in Milestone 15):**
- The travel `finally { setActionsDisabled(false) }` block races with `onDisabled(true)` from `startCooldown()` — `finally` fires after `submitAction` resolves but before the cooldown disable propagates, potentially re-enabling buttons momentarily.

**Validated live:**
- char1 navigated from `(1,0,0)` → `(0,0,0)` during this session
- Target modal renders co-located character list with stats
- All four targeted actions submit successfully

---

### ✅ Milestone 15 — Fix Travel `finally` Race (Option A)
**Date:** 2026-05-11 | **Status:** Complete
**Commit:** `7f2d7a8`

**What was done:**
- Removed `setActionsDisabled(false)` from the success path of the travel direction button `click` handler in `app.js`
- Removed `setActionsDisabled(false)` from the success path of the text-mode `executeAction('travel')` branch
- Both paths now call `setActionsDisabled(false)` **only on error** (when cooldown was never started)
- The cooldown `onDisabled(false)` callback fired by `turn-manager.js` at timer expiry is now the sole authority on re-enabling actions after a successful travel

**Root cause:** `try/finally` guaranteed `setActionsDisabled(false)` ran immediately after `submitAction` resolved, racing against `startCooldown()` → `onDisabledChange(true)` which fired synchronously in the same microtask queue. On fast machines the race was consistent.

**Key decisions:**
- Error path still calls `setActionsDisabled(false)` directly — cooldown only starts on a resolved turn, so manual re-enable is correct on error
- No change to `turn-manager.js` — the fix is purely in how `app.js` consumes the result

---

### ✅ Milestone 16 — Richer Action Mechanics + Stat Delta Feedback (Option E)
**Date:** 2026-05-11 | **Status:** Complete
**Edge Function:** `resolve-turn` (v4, ACTIVE) | **Commit:** `7f2d7a8`

**What was done:**

**Edge Function (`resolve-turn` v4):**
- Added `StatDelta` interface: `{ attribute: string, delta: number, target_character_id: number }`
- `applyModifier()` now returns `StatDelta | null` instead of `void`
- `handleExchangeMaterial()` now returns `StatDelta[]` covering both sides of the transfer:
  - Actor: `{ attribute: 'wealth', delta: -amount, target_character_id: actorId }`
  - Target: `{ attribute: 'wealth', delta: +amount, target_character_id: targetId }`
- All deltas accumulated into `statDeltas[]` and included in:
  - HTTP `200` response body: `{ status, event_id, duration_units, stat_deltas }`
  - `turn_resolved` Realtime broadcast payload: `{ ..., stat_deltas }`

**Frontend (`app.js`):**
- New `formatStatDeltas(statDeltas)` helper — formats array into human string, e.g. `inspiration +3` or `health -3 (char #7)`
- Status bar updated after each action: e.g. `inspiration +3 — dev@chronicle.local`
- Text command mode logs the delta inline: e.g. `exchange information — resolved [inspiration +3]`

**Action → stat effects (unchanged from schema design, now surfaced to UI):**
| Action | Attribute | Delta | Target |
|---|---|---|---|
| `exchange_information` | inspiration | +3 | actor |
| `resolve_conflict` | health | +3 | actor |
| `introduce_conflict` | health | -3 | opponent |
| `exchange_material` | wealth | −amount (actor) · +amount (target) | both |

**Key decisions:**
- `exchange_material` stat delta bypasses `applyModifier()` (which adds a fixed +3 to actor wealth) — the transfer deltas from `handleExchangeMaterial()` are the authoritative feedback
- `stat_deltas` is an array to allow multi-target actions (e.g. exchange_material affects two characters) without a schema change
- Display is best-effort: if `stat_deltas` is absent (queued response, old function version), UI falls back to `connected as [email]` silently

---

### ✅ Milestone 17 — Age-Based Attribute Modification (Option C)
**Date:** 2026-05-11 | **Status:** Complete
**Migration:** `015_age_bracket_modifiers` (applied `2026-05-11 23:39`)

**What was done:**
- Created `age_brackets` config table — one row per bracket×attribute pair:
  - Youth  (age ≥  1): inspiration +2, health +5
  - Prime  (age ≥ 20): health +10, attack +5, defense +5, inspiration −2
  - Elder  (age ≥ 60): health −15, attack −3, defense +8, inspiration +5
- `apply_age_bracket_modifiers(character_id, new_age)` helper — fires on exact threshold crossing; deletes prior bracket modifier for same char+attribute, then inserts replacement (brackets replace, not stack)
- `world_tick()` patched — calls `apply_age_bracket_modifiers()` after aging each character each tick
- New characters spawned at du%50 get youth bracket applied immediately (bootstrap at age 1)
- Backfill DO block applies the highest-crossed bracket for each existing character based on current age
- RLS: public SELECT on `age_brackets`

**Key decisions:**
- Modifiers use `source_entity_type = 'age_bracket'`, `priority = 10` (higher than action modifiers at 0)
- `end_timestamp = NULL` — permanent (accumulating bracket approach)
- Brackets replace each other per attribute — a character entering prime loses youth's inspiration +2 and gains prime's inspiration −2
- `age_threshold = p_new_age` exact match means modifier fires exactly once per bracket per character; no retroactive stacking on old characters (backfill handles that separately)

---

### ✅ Milestone 18 — Attribute Pool on Entity Destruction (Option D)
**Date:** 2026-05-11 | **Status:** Complete
**Migration:** `016_attribute_pool_on_destruction` (applied `2026-05-11 23:53`)

**What was done:**
- Created `attribute_pool` table — holds harvested modifiers keyed by `setting_id` + `target_entity_type`; indexes on both
- `harvest_attribute_modifiers(entity_type, entity_id)` — on destruction: finds entity's setting, moves all non-age-bracket active modifiers into the pool, deletes entity's `attribute_modifiers` rows, ends `entity_positions` record
- `trg_character_destruction()` trigger — fires on `characters.health` UPDATE when `NEW.health <= 0 AND OLD.health > 0`
- `trg_material_destruction()` trigger — fires on `materials.durability` UPDATE when `NEW.durability <= 0 AND OLD.durability > 0`
- `draw_from_attribute_pool(setting_id, entity_type, entity_id, max_draws=2)` — FIFO draw from pool; inserts into `attribute_modifiers` with `source_entity_type = 'attribute_pool'`; deletes drawn rows; returns count drawn
- `world_tick()` patched — calls `draw_from_attribute_pool()` for each newly spawned character (after youth bracket, before relationship seeding)
- RLS: public SELECT on `attribute_pool`

**Key decisions:**
- Age bracket modifiers (`source_entity_type = 'age_bracket'`) are **excluded** from harvest — they are structural, not ecological history
- Pool is **setting-scoped** — inheritance is local; modifiers from `cast bone` don't bleed into `etched bone`
- FIFO draw order (`created_at ASC`) — oldest ecological history is consumed first
- `max_draws = 2` keeps spawn overhead bounded; tunable per-call
- Destruction triggers only fire on health/durability transition from >0 → ≤0 (not on repeated 0 updates)

---

### ✅ Milestone 19 — Text Command Mode (Option B)
**Date:** 2026-05-11 | **Status:** Complete
**Files:** `frontend/index.html`, `frontend/src/app.js`

**What was done:**

**`frontend/index.html`:**
- Added `#mode-toggle-row` with two `.mode-btn` buttons: `BUTTONS` (default active) and `TEXT`
- Added `#cmd-panel` (hidden by default, shown with `.visible` class) containing:
  - `#cmd-history`: scrollable output pane, min 100px / max 180px, seeded with `type "help" for commands`
  - `#cmd-input-row`: text input + submit button (`↵`)
- Full CSS for mode toggle row, cmd panel, cmd history, `.cmd-line` variants (`echo`, `err`, `info`), cmd input, and submit button
- Both modes share the same sidebar section under the `ACTIONS` header

**`frontend/src/app.js`:**
- `currentMode` state (`'buttons'` | `'text'`), toggled by `setMode(mode)`
- `setMode('text')`: hides `#action-panel`, shows `#cmd-panel`, focuses `#cmd-input`
- `setMode('buttons')`: shows `#action-panel`, hides `#cmd-panel`
- `cmdLog(text, type)`: appends a `.cmd-line` div to `#cmd-history`, auto-scrolls to bottom
- `HELP_TEXT`: static array of command hints printed by `help`
- `TRAVEL_ALIASES`: flat alias map (e.g. `'go n'`, `'n'`, `'north'` all resolve to `'north'`)
- `parseCommand(raw)`: trims/lowercases, returns `{ type, direction? }` / `{ type, action, amount? }` / `{ type, local }` / `null`
- `handleCommand(raw)`: echoes input, calls `parseCommand`, routes to travel / action / local / null
- `cmdSubmit` click and `cmdInput` Enter both call `handleCommand`
- `setActionsDisabled` extended to also disable `#cmd-submit` during cooldown
- `executeAction('travel', ..., { direction })` path: resolves cell via `getAdjacentCellId`, submits directly, returns `{ ok, copyName }` for inline log
- `trade [amount]` regex: `^(?:trade|exchange material|give)(?:\\s+(\\d+))?$` — parses optional inline amount, pre-fills target modal

**Key decisions:**
- Text mode is a **pure input layer** — all calls route through the same `submitAction()` / `executeAction()` pipeline as button mode; no parallel code paths
- Travel commands bypass the compass modal — direction is resolved programmatically via `getAdjacentCellId`
- Targeted actions (`fight`, `resolve`, `trade`) still open the target picker modal in text mode — no inline target syntax (deferred)
- `look` and `help` are **local only** — no server round-trip, no cooldown interaction
- `rest` is flavour-only at this stage — no action submitted (rest as a real action deferred)

---

### ✅ Milestone 20 — Vertical z-Axis: z_properties + z-Scaffold Gate
**Date:** 2026-05-22 | **Status:** Complete
**Migration:** `017_z_properties` | **Edge Function:** `discover-cell` (v5, ACTIVE) | **Commits:** `737ab96`

**What was done:**

**Migration `017_z_properties`:**
- Created `z_properties` table — one config row per `z_layer` integer:
  - `layer_name` (text) — canonical label, e.g. `"ground"`, `"air_1"`, `"shallow_water"`
  - `movement_requirements` (JSONB) — e.g. `{"flight": 1}` for air layers, `{"breath": 1}` for deep water
  - `material_decay_modifier` (numeric, default 1.0) — multiplier for `world_tick()` material decay at this z
  - `conflict_modifier` (numeric, default 0.0) — height-advantage delta added to conflict resolution at this z
- Seeded initial z_properties rows: `z=-2` (deep_water), `z=-1` (shallow_water), `z=0` (ground), `z=1` (air_1), `z=2` (air_2)
- RLS: public SELECT on `z_properties`
- `look` command in text mode now queries `z_properties` and appends layer name to output

**Edge Function `discover-cell` v5:**
- New `checkZScaffold(x, y, z, setting_id)` function — enforces vertical cell creation rules:
  - `z = 0` or `z = -1` → always permitted (ground / shallow water)
  - `z ≥ 1` (air) → requires a cell at `z-1` in the same `x,y` column of that setting
  - `z ≤ -2` (deep water) → requires a cell at `z+1` in the same `x,y` column of that setting
  - Returns `{ blocked: true, reason: "no scaffold at z=0 — cannot enter air (z=1)" }` if check fails
- Setting resolution (step 2) now happens **before** the scaffold check (step 3), so the correct setting's cells are always used
- All responses now include `blocked: false` on the happy path for uniform client-side checking
- Existing behaviour (cell lookup, setting assignment, `ensureSettingCopy`, procedural name generation) unchanged from v4

**Key decisions:**
- Scaffold rule is **per-column per-setting** — you can have `z=1` at `(3,4)` only if `z=0` at `(3,4)` in the same setting exists
- `z=0` and `z=-1` are always enterable — the ground floor and shallow water are unconditional starting points
- Physics enforcement (flight required for `z≥1`, breath for `z≤-2`) is a **UI-layer gate** (Milestone 21) not a DB constraint — the scaffold gate alone prevents floating cells
- `discover-cell` returns HTTP 200 with `{ blocked: true, reason }` on scaffold failure (not 4xx) — client decides how to surface it
- `conflict_modifier` and `material_decay_modifier` on `z_properties` are seeded but not yet wired into game logic — reserved for a future milestone

---

### 🔄 Milestone 21 — z-Axis UI Gates (In Progress)
**Date:** 2026-05-22 | **Status:** In Progress
**Files:** `frontend/index.html`, `frontend/src/app.js`

**What needs to be done:**

**`frontend/index.html` changes:**
- Travel modal Up/Down buttons: update labels to `fly ↑` / `dive ↓` with `title` tooltip text explaining movement requirements
- Add `data-requires-flight="true"` to the Up button so `app.js` can disable it when `flight = 0`
- Add `#z-layer-display` line to `#char-position-panel` sidebar panel so current z-layer name is always visible (not just on `look`)

**`frontend/src/app.js` changes:**
- `openTravelModal(characterId)`: after opening, fetch character's `flight` attribute; if `flight = 0`, disable the Up (fly) button with `.no-cell` class + tooltip
- `getAdjacentCellId()`: handle `data.blocked === true` from `discover-cell` v5 — return `{ blocked: true, error: data.reason }`
- Dir-btn click handler: if `result.blocked`, surface reason in `#travel-error` instead of generic error
- `executeAction('travel')` text path: same `blocked` check, output reason via `cmdLog`
- `loadCharPosition(characterId)`: also query `z_properties` for the character's current `z` and populate `#z-layer-display`

**Next step after this milestone:** Test the full z-axis flow end-to-end — attempt travel Up from z=0 (should succeed and spawn z=1 cell), attempt travel Up again from z=1 with no scaffold at z=1 in new position (should block), attempt as flight=0 character (should be blocked at UI layer).

---

## 🔼 Next Milestone Candidates

### Option G — z-Axis Physical Mechanics (gravity, flight, buoyancy) ⭐ (recommended after M21)
Wire `z_properties.movement_requirements` into `resolve-turn` and/or `world_tick()`. Characters without `flight` at `z≥1` fall one layer per tick. Characters without `breath` at `z≤-2` take decay damage. Height advantage: `conflict_modifier` from `z_properties` added to `introduce_conflict` / `resolve_conflict` stat delta.

### Option H — `seed_setting_grid()` z_layers param
`seed_setting_grid(setting_id, width, height, z_layers)` — spawn multi-storey settings with full z columns. Required before large-scale vertical world generation.

### Option I — Rest as a Real Action
`rest` submits a no-op turn that still triggers cooldown. Could grant small inspiration or health regen via `applyModifier`. Already wired in command parser as flavour-only.

---

## Developer Notes — Future Ideas

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
| Migration 017 | `017_z_properties` — z_properties table, 5 seed rows (z=-2 to z=2), RLS |
| Edge Function | `resolve-turn` (ID: `a68468fa`, v4, ACTIVE) |
| Edge Function | `discover-cell` (ID: `da7a0ccb`, v5, ACTIVE) |
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

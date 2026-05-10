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
**Date:** 2026-05-10
**Status:** Complete
**Migration:** `001_core_schema` (applied via Supabase MCP)

**What was done:**
All 10 base tables were created in the Supabase project. These form the world simulation layer — no multiplayer or auth logic yet, just the raw game entities and their relationships.

**Tables created:**
- `settings` — world settings with 3D origin coordinates and time tracking
- `grid_cells` — individual 3D grid positions linked to settings
- `characters` — player-controlled entities with stat attributes (health, attack, defense, wealth, inspiration, size)
- `physical_environments` — environment state per setting (temperature, density, hydration, population)
- `events` — game actions logged with timestamps, type, duration, and `resolution_state` (default: `'pending'`)
- `materials` — in-world items with durability, source, and implementation
- `entity_positions` — tracks where any entity is on the grid over time
- `chronicle` — master event log; the central join table referencing all entity types, timestamped and sequenced
- `attribute_modifiers` — dynamic stat modifiers applied by events to any entity
- `relationship_effects` — relational outcomes between entities driven by events

**Key decisions:**
- All PKs are integers; `chronicle` is the central join table
- `events.resolution_state` defaults to `'pending'` and is the primary game-loop state driver
- `events.setting_id` is NOT NULL in the live DB — every event must belong to a setting; a genesis `settings` row must be seeded before any turn can be submitted
- No auth or player identity in this migration — that comes in Milestone 2

---

### ✅ Milestone 2 — Database Schema: Multiplayer Extensions
**Date:** 2026-05-10
**Status:** Complete
**Migration:** `002_multiplayer_extensions` (applied via Supabase MCP)
**Builds on:** Milestone 1 tables (`chronicle`, `events`, `characters`)

**What was done:**
Extended the core schema with player identity, turn mechanics, time-travel branching, RLS visibility, and race-resolution infrastructure.

**Tables created:**
- `players` — UUID-identified players (`gen_random_uuid()`), each linked to a `controlled_character_id` → `characters`
- `branches` — tracks time-travel forks; each row has a `parent_branch_id` (default `0` = root); max 3 forks per lineage enforced at query level via `SELECT COUNT(*) FROM branches WHERE parent_branch_id = X`
- `player_chronicle_access` — maps which chronicle entries a player can see, with an `access_level` (default: `'view'`)

**Columns added:**
- `chronicle`: `player_id` (→ `players`), `branch_id` (default `0`), `turn_number`, `submit_timestamp`, `resolution_order`
- `events`: `turn_number`, `submit_timestamp`

**Security:**
- RLS enabled on `chronicle`
- Policy `"Player chronicle view"`: `FOR SELECT USING (player_id = auth.uid())` — players see only their own rows

**Trigger:**
- `advance_turn()` — `BEFORE INSERT` on `chronicle`; auto-increments `turn_number` per `player_id` using `MAX(turn_number)` from existing rows

**View:**
- `turn_queue` — joins `chronicle → events` on `event_id`, filters `events.resolution_state = 'pending'`, ranks by `submit_timestamp ASC` within each `turn_number` → `queue_pos`
- ⚠️ Note: `resolution_state` lives on `events`, not `chronicle` — the view join is intentional

**Key decisions:**
- `branch_id = 0` is the root/main timeline
- Branch fork limit is enforced at the application layer (Edge Function), not a DB constraint
- RLS is the sole visibility gate — no separate API-layer filtering needed

---

### ✅ Milestone 3 — Backend: Edge Function `resolve-turn`
**Date:** 2026-05-10
**Status:** Complete
**Deployed via:** Supabase MCP (`deploy_edge_function`)
**Function ID:** `a68468fa-a326-4f75-9d51-72a73fa8e9c2`
**Current version:** v2 (bug fix: `event.eventid` → `event.event_id`)
**Builds on:** Milestones 1 & 2 (all tables, `turn_queue` view, `players`, `branches`, `chronicle`)

**What was done:**
Deployed the `resolve-turn` Supabase Edge Function at `functions/resolve-turn/index.ts`. This is the core server-side turn engine — all client actions route through it.

**Logic implemented (in order):**
1. Validate `action` and `player_id` from request body
2. Check `turn_queue` view — if `queue_pos > 1`, return `202 { status: 'queued' }`
3. Resolve the player's `controlled_character_id` from the `players` table
4. Compute `duration_units` from `DURATION_MAP` (or `computeTravelDuration()` for `travel` action)
5. Check branch fork limit — if `details.branch_fork` is set, count `branches WHERE parent_branch_id = X`; reject with `409` if ≥ 3; otherwise insert new branch row
6. Insert into `events` with `resolution_state = 'pending'`; **`setting_id` is required** — client must pass `details.setting_id`
7. Call `applyModifiers()` — inserts one `attribute_modifiers` row per action type
8. Insert into `chronicle` (links `event_id`, `character_id`, `player_id`, `branch_id`, timestamps)
9. Update `events.resolution_state = 'resolved'`
10. Broadcast `turn_resolved` to Supabase Realtime channel `'turns'`
11. Return `200 { status: 'resolved', event }`

**Modifier map (per action):**
- `exchange_information` → `inspiration +3`
- `resolve_conflict` → `health +3`
- `introduce_conflict` → `health -3`
- `exchange_material` → `wealth +3`
- `travel` → no modifier (duration only)

**Travel duration formula:**
```
base = (density + hydration) / 2
charPenalty = size / max(health, 0.1)
matBonus = durability * implementation
inspBonus = 0.9 if inspiration > 0 else 1
duration = max(1, round(base * charPenalty / matBonus * inspBonus))
```

**Key decisions:**
- Uses `SUPABASE_SERVICE_ROLE_KEY` to bypass RLS for server-side writes; RLS still governs all client reads
- JWT verification enabled (`verify_jwt: true`) — client must pass a valid Supabase Auth token
- `event.event_id` is the correct PK field returned from the insert `.select('event_id, turn_number')` — v1 had a bug using `event.eventid` which silently broke modifier inserts and resolution updates
- Chronicle insert triggers `advance_turn()` automatically (Milestone 2 trigger)
- Branch fork insert happens before event insert so `branch_id` is available

**Fixes applied:**
- v1 → v2: `event.eventid` → `event.event_id` (all three references: modifier insert, chronicle insert, resolution update)
- Migrations 001 and 002 were applied via MCP but never committed; retroactively added to `backend/migrations/` and verified against live schema
- `events.setting_id` NOT NULL discovered during smoke test — corrected in `001_core_schema.sql` and documented here

---

### ✅ Milestone 3a — Smoke Test: Full Turn Pipeline
**Date:** 2026-05-10
**Status:** Complete
**Depends on:** Milestone 3

**What was tested:**
Full end-to-end turn pipeline simulated directly in SQL (pg_net not available on this project, so HTTP invoke was not used; JWT auth gate also prevents direct curl without a real auth user).

**Test data:**
- `settings` row: `setting_id=1`, genesis at `(0,0,0)`
- `characters` row: `character_id=1`, `health=10`, all other stats at 0
- `players` row: `player_id=00000000-0000-0000-0000-000000000001`, `controlled_character_id=1`

**Steps verified:**
1. ✅ `turn_queue` — empty for test player (no pending turns blocking queue)
2. ✅ `events` insert — `exchange_information`, `duration_units=10`, `resolution_state='pending'`
3. ✅ `attribute_modifiers` insert — `inspiration +3` applied to `character_id=1`
4. ✅ `chronicle` insert — `turn_number=1` auto-set by `advance_turn()` trigger, `branch_id=0`
5. ✅ `events` update — `resolution_state` changed to `'resolved'`

**Schema finding recorded:**
- `events.setting_id` is NOT NULL in the live DB — design spec had it as nullable. Every event requires a setting context. The genesis `settings` row (id=1) must exist before any turn is submitted. Updated `001_core_schema.sql` to reflect this.

**What to do next:**
- Milestone 4: Build the frontend scaffold
- When a real Supabase Auth user exists, the full HTTP invoke can be tested via `supabase.functions.invoke('resolve-turn', ...)` from the client
- The test data rows (`setting_id=1`, `character_id=1`, `player_id=00000000...0001`) remain in the DB as seed fixtures

---

## Up Next

---

### 🔲 Milestone 4 — Frontend: GitHub Pages Scaffold
**Status:** Not started
**Depends on:** Milestone 3 (Edge Function endpoint live ✅), Milestone 3a (smoke test passed ✅)

**What to build:**
Initialize a Vite + JS project in `/frontend/` and deploy via GitHub Pages.

**Files to create:**
```
frontend/
  index.html
  package.json          # Vite config
  src/
    supabase-client.js  # Auth init + Realtime setup
    turn-manager.js     # Cooldown timer (1 real min), submitAction(), queue polling
    grid-renderer.js    # Canvas 3D grid + entity_positions rendering
    chronicle-reader.js # Player-filtered chronicle display
.github/workflows/deploy.yml  # Auto-deploy to GH Pages on push to main
```

**Key patterns:**
- `submitAction()` captures `submit_timestamp = Date.now() / 1000` before calling `supabase.functions.invoke('resolve-turn', ...)`
- `details.setting_id` **must be included** in every action payload — `events.setting_id` is NOT NULL
- Cooldown is client-enforced (1 real minute); it is a UX mechanism, not a server lock
- Auth via Supabase Auth (`auth.uid()` must match `player_id` for RLS to pass)

**Reference:**
- Client patterns: Developer Handoff → Frontend → Key Client Patterns
- Supabase project URL: `https://hhyhulqngdkwsxhymmcd.supabase.co`
- Anon key: see Supabase dashboard (publishable key preferred)

---

### 🔲 Milestone 5 — Realtime: Turn Subscription
**Status:** Not started
**Depends on:** Milestones 3 & 4 (Edge Function broadcasting + frontend scaffold)

**What to build:**
Wire up the Supabase Realtime broadcast channel in `supabase-client.js` and connect it to the grid renderer and cooldown timer.

**Logic:**
```js
supabase.channel('turns')
  .on('broadcast', { event: 'turn_resolved' }, ({ payload }) => {
    updateGrid(payload);   // re-render entity positions
    resetCooldown();       // restart 1-min client timer
  }).subscribe()
```

**Reference:**
- Broadcast trigger: Milestone 3, step 10 (`resolve-turn` Edge Function)
- Grid renderer: Milestone 4 (`grid-renderer.js`)

---

### 🔲 Milestone 6 — Chronicle Panel: Player-Filtered Display
**Status:** Not started
**Depends on:** Milestone 2 (RLS policy), Milestone 4 (frontend scaffold)

**What to build:**
Implement `chronicle-reader.js` to query and display the player's accessible chronicle slice.

**Logic:**
- Query `chronicle` table — RLS automatically filters to `player_id = auth.uid()`
- Display events in chronological order by `timestamp` + `sequence_index`
- Show `branch_id` to distinguish forked timelines
- Cross-reference `player_chronicle_access` for any shared/spectator access entries

**Reference:**
- RLS policy: Milestone 2 (`"Player chronicle view"`)
- `player_chronicle_access` table: Milestone 2

---

### 🔲 Milestone 7 — Testing: Multiplayer & Edge Cases
**Status:** Not started
**Depends on:** Milestones 3–6 fully functional

**What to test:**
- [ ] Race resolution: simultaneous submits from 10+ players — verify `queue_pos` ordering in `turn_queue`
- [ ] Branch limit: attempt 4th fork on a lineage — verify rejection via `COUNT(*)` check
- [ ] Backward time travel: verify chronicle slice duplication and attribute replacement
- [ ] RLS isolation: confirm player A cannot read player B's chronicle rows
- [ ] Cooldown bypass: attempt client-side cooldown skip — verify server `submit_timestamp` race logic still resolves correctly
- [ ] Natural progression: verify environment cycles (every 100u), material changes (80u major / 3 durations minor), population spawns (every 50 durations)
- [ ] `setting_id` required: verify Edge Function returns 500 if client omits `details.setting_id`

---

### 🔲 Milestone 8 — Polish, Docs & Deploy Pipeline
**Status:** Not started
**Depends on:** Milestone 7 passing

**What to build:**
- [ ] `README.md` — project overview, local dev setup, deploy instructions
- [ ] Mobile responsiveness for canvas grid
- [ ] `.github/workflows/deploy.yml` — auto-deploy frontend to GitHub Pages on push to `main`
- [ ] Supabase Pro upgrade for production (`$25/mo`) if load tests require it
- [ ] Setting shards documented as scale path

---

## Quick Reference

| Item | Value |
|---|---|
| GitHub Repo | [andredavisme/chronicle-worlds](https://github.com/andredavisme/chronicle-worlds) |
| Supabase Project | andredavisme's Project (`hhyhulqngdkwsxhymmcd`) |
| Region | `us-west-2` |
| Project URL | `https://hhyhulqngdkwsxhymmcd.supabase.co` |
| Migration 001 | `001_core_schema` — 10 base tables; `events.setting_id` NOT NULL |
| Migration 002 | `002_multiplayer_extensions` — players, branches, RLS, trigger, view |
| Migration 003 | `003_developer_proposals` — proposal intake tables (separate from game logic) |
| Edge Function | `resolve-turn` (ID: `a68468fa`, v2, ACTIVE) |
| Genesis seed | `settings` row `id=1` required before any event insert |
| Test fixtures | `character_id=1`, `player_id=00000000-0000-0000-0000-000000000001` (dev only) |
| Root timeline | `branch_id = 0` |
| Max branches/lineage | 3 |
| Action durations | Exchange Info=10u, Resolve Conflict=7u, Introduce Conflict=5u, Exchange Material=3u, Travel=calculated |
| Client cooldown | 1 real minute (UX only, not server-enforced) |
| Inspired by | [andredavisme/the-world](https://github.com/andredavisme/the-world) |

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

---

### ✅ Milestone 4 — Frontend: GitHub Pages Scaffold
**Date:** 2026-05-10
**Status:** Complete
**Commit:** `712566b91153feba5ad843cffbb905bbd3a45368`
**Builds on:** Milestones 3 & 3a (Edge Function live, smoke test passed)

**What was done:**
Full Vite + JS frontend scaffolded in `/frontend/` and GitHub Actions deploy workflow added. All five game modules are wired together. The frontend is ready to serve from GitHub Pages once the Pages source is configured.

**Files created:**
- `frontend/index.html` — full game UI: auth panel, isometric canvas, action buttons, chronicle sidebar, footer with player/turn/branch state
- `frontend/package.json` — Vite `^5.4` + `@supabase/supabase-js ^2.49.4`
- `frontend/vite.config.js` — `base: '/chronicle-worlds/'`, `outDir: '../docs'` (GitHub Pages from `/docs` on `main`)
- `frontend/src/supabase-client.js` — Auth helpers (`signIn`, `signUp`, `signOut`, `onAuthChange`); uses publishable key `sb_publishable_haKvwV0M7KMj4Qz69M6WGg_KmIfU-aI`
- `frontend/src/turn-manager.js` — `submitAction()` with race `submit_timestamp`, 1-min client cooldown, `resetCooldown()`; always passes `details.setting_id = 1`
- `frontend/src/grid-renderer.js` — isometric canvas renderer; loads `entity_positions` (active only via `timestamp_end IS NULL`); `updateGrid()` called by Realtime
- `frontend/src/chronicle-reader.js` — queries `chronicle` (RLS auto-filters to `auth.uid()`); renders entries with branch color coding (branch 1/2/3 = purple/red/teal)
- `frontend/src/app.js` — auth state machine; wires all modules; subscribes to Realtime `'turns'` channel `turn_resolved` broadcast
- `.github/workflows/deploy.yml` — triggers on push to `main` when `frontend/**` or `docs/**` changes; builds with Vite; deploys `/docs` via `peaceiris/actions-gh-pages@v4`

**Key decisions:**
- Publishable key (not legacy anon key) used in client — better security, independent rotation
- `details.setting_id = 1` hardcoded in `turn-manager.js` as `DEFAULT_SETTING_ID` — update when world has multiple settings
- `sequence_index` is a random integer tiebreaker per submit; server race logic uses `submit_timestamp` first
- Action buttons are disabled during in-flight requests; re-enabled on resolve or error
- Chronicle renders last 40 entries descending; Realtime optimistically prepends new entries without refetch

**One manual step required:**
Go to **GitHub repo → Settings → Pages → Source: Deploy from branch `main`, folder `/docs`**. The workflow handles all subsequent deploys automatically.

---

### ✅ Milestone 5 — Realtime: Turn Subscription
**Status:** Complete (implemented inside Milestone 4)
**Implemented in:** `frontend/src/app.js`

Realtime subscription to the `'turns'` channel is live. On `turn_resolved` broadcast: `updateGrid()` re-renders entity positions, `resetCooldown()` restarts the 1-min timer, `loadChronicle()` refreshes the chronicle panel, and `branch-info` footer updates to show the current branch.

---

### ✅ Milestone 6 — Chronicle Panel: Player-Filtered Display
**Status:** Complete (implemented inside Milestone 4)
**Implemented in:** `frontend/src/chronicle-reader.js`

`loadChronicle()` queries `chronicle` ordered by `timestamp DESC` + `sequence_index DESC`, limit 40. RLS automatically scopes results to `player_id = auth.uid()`. Branch color coding: branch 0 = no indicator, branch 1 = purple, branch 2 = red, branch 3 = teal.

---

### ✅ Milestone 7 — Testing: Multiplayer & Edge Cases
**Date:** 2026-05-10
**Status:** Complete — all DB-side tests verified live; client-side manual tests documented below
**Migrations:**
- `004_milestone7_tests` — full edge-case test suite (in repo; originally ran with ROLLBACK)
- `005_persist_test_fixtures` — re-runs fixtures with COMMIT; **permanently applied 2026-05-10**

**Live DB test results (service-role, 2026-05-10 via Supabase MCP):**
- ✅ **Test 1** — Genesis setting exists: `settings` row `id=1` confirmed present
- ✅ **Test 2** — `advance_turn` trigger: Player A chronicle rows have `turn_number` 1 and 2 (incrementing correctly)
- ✅ **Test 3** — Queue clear: `pending_in_queue = 0` for Player A (all fixtures resolved)
- ✅ **Test 4** — Branch limit fixture: `branch_count = 3` for Player A from root — Edge Function would block a 4th fork
- ✅ **Test 6** — Travel duration formula: `computed_duration_units = 1` (expected)
- ✅ **Test 7** — RLS isolation data: Player A has 2 chronicle rows, Player B has 1 — data is in place for client-side RLS verification

**Persisted fixture reference:**
| Fixture | Value |
|---|---|
| Player A | `b6879b2f-801c-4459-aae1-6a8022e8e1a7` (`dev@chronicle.local`) |
| Player B | `00000000-0000-0000-0000-000000000002` (stub, no real auth user) |
| Character A | `character_id=1`, `health=10`, `size=1` |
| Character B | `character_id=2`, `health=10`, `size=1` |
| Genesis setting | `setting_id=1`, origin `(0,0,0)` |
| Test environment | `environment_id=100`, `density=4`, `hydration=6` |
| Test material | `material_id=100`, `durability=2.0`, `implementation='2'` |
| Player A branches | 3 forks from `parent_branch_id=0` (branch cap at maximum) |

**Schema discoveries during test run (now fixed in repo):**
- `settings` columns are `time_unit, origin_x, origin_y, origin_z, inspiration` (not `x, y, z, time`)
- `materials.implementation` is `text`; `materials.durability` is `real` — travel formula requires `CAST(implementation AS numeric)`
- `chronicle.details_json` is NOT NULL — all inserts must supply `'{}'` minimum
- All PKs on `events`, `chronicle`, `materials`, `physical_environments` are plain integers with no sequence — must be supplied explicitly in fixtures

**Remaining client-side checks (manual — requires browser + live frontend):**
- [ ] Sign in as Player A (`dev@chronicle.local`) → submit one action → confirm chronicle panel updates and cooldown resets on Realtime broadcast
- [ ] Open second browser/incognito as a different auth user → confirm Player A's chronicle rows do not appear (RLS isolation)
- [ ] Attempt 4th branch fork from client → confirm Edge Function returns `409`
- [ ] Attempt submit without `setting_id` from client → confirm `500` response

---

### 🔲 Milestone 8 — Polish, Docs & Deploy Pipeline
**Status:** Not started
**Depends on:** Milestone 7 client-side checks passing (or deemed acceptable to proceed)

**What to build:**
- [ ] `README.md` — project overview, local dev setup, deploy instructions
- [ ] Mobile responsiveness for canvas grid
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
| Live URL | `https://andredavisme.github.io/chronicle-worlds/` |
| Migration 001 | `001_core_schema` — 10 base tables; `events.setting_id` NOT NULL |
| Migration 002 | `002_multiplayer_extensions` — players, branches, RLS, trigger, view |
| Migration 003 | `003_developer_proposals` — proposal intake tables (separate from game logic) |
| Migration 004 | `004_milestone7_tests` — full edge-case test suite (ROLLBACK version; reference only) |
| Migration 005 | `005_persist_test_fixtures` — persisted fixtures with COMMIT (applied 2026-05-10) |
| Edge Function | `resolve-turn` (ID: `a68468fa`, v2, ACTIVE) |
| Publishable Key | `sb_publishable_haKvwV0M7KMj4Qz69M6WGg_KmIfU-aI` |
| Genesis seed | `settings` row `id=1` required before any event insert |
| Player A (dev) | `b6879b2f-801c-4459-aae1-6a8022e8e1a7` — `dev@chronicle.local` |
| Player B (stub) | `00000000-0000-0000-0000-000000000002` — no real auth user |
| Root timeline | `branch_id = 0` |
| Max branches/lineage | 3 |
| Action durations | Exchange Info=10u, Resolve Conflict=7u, Introduce Conflict=5u, Exchange Material=3u, Travel=calculated |
| Client cooldown | 1 real minute (UX only, not server-enforced) |
| Default setting_id | `1` (hardcoded in `turn-manager.js` as `DEFAULT_SETTING_ID`) |
| Inspired by | [andredavisme/the-world](https://github.com/andredavisme/the-world) |

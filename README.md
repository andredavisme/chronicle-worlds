# Chronicle Worlds

> Turn-based multiplayer procedural world simulation built on Supabase, GitHub, and GitHub Pages.

**Live:** [andredavisme.github.io/chronicle-worlds](https://andredavisme.github.io/chronicle-worlds/)

Inspired by [andredavisme/the-world](https://github.com/andredavisme/the-world).

---

## What is this?

Chronicle Worlds is a shared, persistent world that evolves over time — driven by player actions and natural progression running underneath. Players control characters on a 3D grid, issuing one of five actions per turn. All players submit simultaneously; the server race-resolves by timestamp. Time is the core resource: it advances with every action, and limited backward time travel forks branched chronicles.

---

## Gameplay

### Actions

| Action | Duration | Effect |
|---|---|---|
| Exchange Information | 10u | `inspiration +3` |
| Resolve Conflict | 7u | `health +3` |
| Introduce Conflict | 5u | `health -3` |
| Exchange Material | 3u | `wealth +3` |
| Travel | Calculated | Move on the grid; cost depends on environment density/hydration, character size/health, and material durability |

- All players submit simultaneously. First valid submission wins; conflicts auto-queue.
- Client cooldown: **1 real minute** between actions (strategic timing, not a hard server lock).
- Each action is an event that spawns or modifies entities and relationships in the chronicle.

### Time & Branching

- Every action advances in-world time by its duration (1 event duration unit = 1/100 of a time unit).
- **Forward time jumps:** any player may jump ahead post-seed, spawning new settings.
- **Backward time travel:** replaces the traveling character's attributes with current values and forks a new branch. Max **3 branches per lineage**.
- `branch_id = 0` is always the root/main timeline.

### Natural Progression

Running continuously underneath all player actions (via `world_tick()` on a 1-minute pg_cron job):

| Cycle | Frequency |
|---|---|
| Environment | Every 100 time units |
| Material (major) | Every 80 time units |
| Material (minor) | Every 3 duration units |
| Population spawn | Every 50 duration units |
| New settings | 25 events per 500 time units |

---

## Architecture — Truth / Reality Model

The simulation is split into two layers:

### Truth Schema (canonical)
Tables `characters`, `settings`, `materials`, `physical_environments`, and `events` are the **truth schema** — authoritative entity records with no names, descriptions, or narrative. Adding a truth entity makes it available to all realities automatically.

### Realities (interpretive world instances)
A **reality** (`realities` table) is a named world instance that interprets the truth schema. When a reality encounters a truth entity it spawns an **entity copy** (`entity_copies` table) seeded with truth attribute values, then gains reality-exclusive attributes: `name`, `description`, and a `local_attributes` JSONB delta that diverges independently.

- **Realities** = world-instance axis (parallel worlds)
- **Branches** = time axis (chronicle forks within a reality)

```
Truth Schema
  └─ Reality A  (branch_id=0 → branch_id=1 → branch_id=2)
  └─ Reality B  (branch_id=0 → ...)
  └─ Reality C  (branch_id=0 → ...)
```

Names are never stored in truth — they are computed deterministically from `proc_words` vocabulary + `copy_id` seed + reality context. Same truth entity → different name per reality; stable within a reality.

---

## Tech Stack

| Layer | Technology | Purpose |
|---|---|---|
| Database | Supabase PostgreSQL | Schema, RLS, Auth, Realtime, pg_cron |
| Backend Logic | Supabase Edge Functions (Deno/TS) | Turn resolution, race queue, modifiers, cell discovery |
| Repository | GitHub | Migrations, versioning, CI/CD |
| Frontend | GitHub Pages + Vite + JS | Game UI, isometric canvas grid, Realtime client |

---

## Local Development

### Prerequisites

- [Node.js](https://nodejs.org/) v18+
- [Supabase CLI](https://supabase.com/docs/guides/cli) (for local Edge Function development)
- A Supabase project (free tier works for development)

### 1. Clone the repo

```bash
git clone https://github.com/andredavisme/chronicle-worlds.git
cd chronicle-worlds
```

### 2. Install frontend dependencies

```bash
cd frontend
npm install
```

### 3. Configure Supabase credentials

Create `frontend/src/config.js` (gitignored) with your project values:

```js
export const SUPABASE_URL = 'https://<your-project-ref>.supabase.co';
export const SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_...';
```

Or set them directly in `frontend/src/supabase-client.js`.

### 4. Apply migrations

In the [Supabase SQL Editor](https://supabase.com/dashboard/project/_/sql), run each migration **in order**:

```
backend/migrations/001_core_schema.sql
backend/migrations/002_multiplayer_extensions.sql
backend/migrations/003_developer_proposals.sql
# 004 is a ROLLBACK test suite — do NOT apply to production; run manually in SQL Editor only
backend/migrations/005_persist_test_fixtures.sql
backend/migrations/006_auto_provision_players.sql
backend/migrations/007_add_pk_sequences.sql
backend/migrations/008_rls_policies_and_trigger_fix.sql
backend/migrations/009_natural_progression_loop.sql
backend/migrations/010_world_seeding.sql
backend/migrations/011_public_read_world_state.sql
backend/migrations/012_public_read_game_tables.sql
backend/migrations/013_add_setting_discovery_fields.sql
backend/migrations/014_realities_and_entity_copies.sql
```

> ⚠️ **Skip `004` in production.** It is a QA/test script wrapped in `BEGIN`/`ROLLBACK` — it intentionally undoes all its inserts and requires manual UUID substitution.

### 5. Run the frontend locally

```bash
cd frontend
npm run dev
```

Opens at `http://localhost:5173/chronicle-worlds/`.

---

## Deploy

### GitHub Pages (automatic)

1. Go to **GitHub repo → Settings → Pages → Source: Deploy from branch `gh-pages`, folder `/ (root)`**.
2. Any push to `main` that touches `frontend/**` automatically triggers the deploy workflow (`.github/workflows/deploy.yml`), builds via Vite, and publishes to the `gh-pages` branch root.

> ⚠️ Never edit `docs/index.html` directly — it is the Vite build output and is overwritten on every deploy. All source changes go in `frontend/src/` and `frontend/index.html`.

### Edge Functions

Edge Functions live in `functions/` and are deployed to Supabase directly. To redeploy manually:

```bash
supabase functions deploy resolve-turn --project-ref <your-project-ref>
supabase functions deploy discover-cell --project-ref <your-project-ref>
```

### Database migrations

Migrations are in `backend/migrations/` and are applied manually via the Supabase SQL Editor or CLI. They are numbered sequentially and must be applied in order (see step 4 above).

---

## Project Structure

```
chronicle-worlds/
├── .github/
│   └── workflows/
│       └── deploy.yml                          # GitHub Pages auto-deploy
├── backend/
│   └── migrations/
│       ├── 001_core_schema.sql
│       ├── 002_multiplayer_extensions.sql
│       ├── 003_developer_proposals.sql
│       ├── 004_milestone7_tests.sql             # Test suite (ROLLBACK — reference only, never apply to production)
│       ├── 005_persist_test_fixtures.sql
│       ├── 006_auto_provision_players.sql
│       ├── 007_add_pk_sequences.sql
│       ├── 008_rls_policies_and_trigger_fix.sql
│       ├── 009_natural_progression_loop.sql     # world_tick(), pg_cron, proc_words
│       ├── 010_world_seeding.sql                # 7x7 grid_cells, entity_positions seed
│       ├── 011_public_read_world_state.sql
│       ├── 012_public_read_game_tables.sql
│       ├── 013_add_setting_discovery_fields.sql # max_cells, cycle_order on settings
│       └── 014_realities_and_entity_copies.sql  # realities, entity_copies, root reality seed
├── docs/                                        # Built frontend (served by GitHub Pages — do not edit directly)
├── frontend/
│   ├── index.html
│   ├── package.json
│   ├── vite.config.js
│   └── src/
│       ├── app.js              # Auth state machine, Realtime wiring, action handlers
│       ├── supabase-client.js  # Auth helpers
│       ├── turn-manager.js     # submitAction(), cooldown timer
│       ├── grid-renderer.js    # Isometric canvas renderer, setting colour palette
│       └── chronicle-reader.js # Player-filtered chronicle panel
├── functions/
│   ├── resolve-turn/
│   │   └── index.ts            # Core turn resolution Edge Function (race queue, modifiers)
│   └── discover-cell/
│       └── index.ts            # Cell discovery Edge Function (setting assignment, entity_copy seeding)
├── PROGRESS.md                 # Development log — source of truth for current state and next steps
├── DOCUMENTATION-PHILOSOPHY.md
└── README.md
```

---

## Key Design Decisions

- **RLS is the sole visibility gate** — no API-layer filtering; players see only their own chronicle rows via `player_id = auth.uid()`.
- **Publishable key in client** — uses `sb_publishable_...` (not legacy anon key) for better security and independent rotation.
- **Service role key in Edge Functions** — bypasses RLS for server-side writes; never exposed to the client.
- **`events.setting_id` is NOT NULL** — every event must belong to a setting. The genesis `settings` row (`id=1`) must exist before any turn can be submitted.
- **Branch fork limit enforced in Edge Function** — not a DB constraint; the function checks `SELECT COUNT(*) FROM branches WHERE parent_branch_id = X` and rejects with `409` if ≥ 3.
- **`branch_id = 0` = root timeline** — all initial play happens here.
- **Truth schema is inert** — no names, descriptions, or narrative ever stored in core tables; all player-facing identity lives in `entity_copies` per reality.
- **`discover-cell` owns cell creation** — `getAdjacentCellId()` in the frontend always invokes the Edge Function; cells are never created client-side.
- **Setting names are procedurally derived** — deterministic from `proc_words` + `setting_id` seed within a reality; stable and unique across realities without storing names in truth.

---

## Development Log

See [PROGRESS.md](./PROGRESS.md) for the full milestone-by-milestone development history, schema decisions, test results, and what to do next.

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
- **Backward time travel:** replaces the traveling character’s attributes with current values and forks a new branch. Max **3 branches per lineage**.
- `branch_id = 0` is always the root/main timeline.

### Natural Progression

Running continuously underneath all player actions:

| Cycle | Frequency |
|---|---|
| Environment | Every 100 time units |
| Material (major) | Every 80 time units |
| Material (minor) | Every 3 duration units |
| Population spawn | Every 50 time units |
| New settings | 25 events per 500 time units |

---

## Tech Stack

| Layer | Technology | Purpose |
|---|---|---|
| Database | Supabase PostgreSQL | Schema, RLS, Auth, Realtime |
| Backend Logic | Supabase Edge Functions (Deno/TS) | Turn resolution, race queue, modifiers |
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

In the [Supabase SQL Editor](https://supabase.com/dashboard/project/_/sql), run each migration in order:

```
backend/migrations/001_core_schema.sql
backend/migrations/002_multiplayer_extensions.sql
```

To seed the genesis world state (required before any turn can be submitted):

```sql
INSERT INTO settings (setting_id, time_unit, origin_x, origin_y, origin_z)
VALUES (1, 0, 0, 0, 0)
ON CONFLICT DO NOTHING;
```

### 5. Run the frontend locally

```bash
cd frontend
npm run dev
```

Opens at `http://localhost:5173/chronicle-worlds/`.

---

## Deploy

### GitHub Pages (automatic)

1. Go to **GitHub repo → Settings → Pages → Source: Deploy from branch `main`, folder `/docs`**.
2. Any push to `main` that touches `frontend/**` or `docs/**` automatically triggers the deploy workflow (`.github/workflows/deploy.yml`), builds via Vite, and publishes to `/docs`.

### Edge Functions

Edge Functions live in `functions/` and are deployed to Supabase directly. To redeploy manually:

```bash
supabase functions deploy resolve-turn --project-ref hhyhulqngdkwsxhymmcd
```

### Database migrations

Migrations are in `backend/migrations/` and are applied manually via the Supabase SQL Editor or CLI. They are numbered sequentially and must be applied in order.

---

## Project Structure

```
chronicle-worlds/
├── .github/
│   └── workflows/
│       └── deploy.yml          # GitHub Pages auto-deploy
├── backend/
│   └── migrations/
│       ├── 001_core_schema.sql
│       ├── 002_multiplayer_extensions.sql
│       ├── 003_developer_proposals.sql
│       ├── 004_milestone7_tests.sql    # Test suite (ROLLBACK — reference only)
│       └── 005_persist_test_fixtures.sql
├── docs/                       # Built frontend (served by GitHub Pages)
├── frontend/
│   ├── index.html
│   ├── package.json
│   ├── vite.config.js
│   └── src/
│       ├── app.js              # Auth state machine, Realtime wiring
│       ├── supabase-client.js  # Auth helpers
│       ├── turn-manager.js     # submitAction(), cooldown timer
│       ├── grid-renderer.js    # Isometric canvas renderer
│       └── chronicle-reader.js # Player-filtered chronicle panel
├── functions/
│   └── resolve-turn/
│       └── index.ts            # Core turn resolution Edge Function
├── PROGRESS.md                 # Development log (source of truth)
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

---

## Development Log

See [PROGRESS.md](./PROGRESS.md) for the full milestone-by-milestone development history, schema decisions, test results, and what to do next.

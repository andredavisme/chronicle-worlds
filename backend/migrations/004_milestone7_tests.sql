-- =============================================================
-- Migration 004 — Milestone 7 Test Suite
-- Chronicle Worlds
-- =============================================================
-- PURPOSE: Edge-case validation for race resolution, trigger
-- correctness, branch limits, natural progression schedule, and
-- RLS isolation data setup.
--
-- HOW TO RUN:
--   1. Replace PLAYER_A_UUID and PLAYER_B_UUID with real
--      auth.users UUIDs from the Supabase dashboard.
--   2. Paste the entire file into Supabase SQL Editor.
--   3. Run — inspect each SELECT result set in order.
--   4. This migration is wrapped in a transaction and ROLLS BACK
--      at the end so no test data is persisted to production.
--      To persist fixtures for live client testing, change
--      ROLLBACK to COMMIT at the bottom.
--
-- DEPENDENCIES:
--   001_core_schema        — settings, characters, events, chronicle,
--                            attribute_modifiers, materials,
--                            physical_environments
--   002_multiplayer_extensions — players, branches, player_chronicle_access,
--                                turn_queue view, advance_turn trigger,
--                                RLS policy on chronicle
-- =============================================================

BEGIN;

-- ─────────────────────────────────────────────
-- 0. INPUTS — replace before running
-- ─────────────────────────────────────────────
DO $$
BEGIN
  IF 'PLAYER_A_UUID'::text = 'PLAYER_A_UUID' THEN
    RAISE EXCEPTION
      'Replace PLAYER_A_UUID with your real auth user UUID before running';
  END IF;
END $$;

CREATE TEMP TABLE _test_inputs AS
SELECT
  'PLAYER_A_UUID'::uuid AS player_a,
  -- Optional: second auth user for RLS isolation test.
  -- Leave as all-zeros to skip that section.
  '00000000-0000-0000-0000-000000000000'::uuid AS player_b;

-- ─────────────────────────────────────────────
-- 1. FIXTURES
-- ─────────────────────────────────────────────
-- Genesis setting (required; events.setting_id NOT NULL).
INSERT INTO settings (setting_id, x, y, z, time)
VALUES (1, 0, 0, 0, 0)
ON CONFLICT (setting_id) DO NOTHING;

-- Primary character.
INSERT INTO characters (
  character_id, age, health, attack, defense, wealth, inspiration, size
)
VALUES (1, 0, 10, 0, 0, 0, 0, 1)
ON CONFLICT (character_id) DO NOTHING;

-- Secondary character for player B.
INSERT INTO characters (
  character_id, age, health, attack, defense, wealth, inspiration, size
)
VALUES (2, 0, 10, 0, 0, 0, 0, 1)
ON CONFLICT (character_id) DO NOTHING;

-- Player A row.
INSERT INTO players (player_id, controlled_character_id)
SELECT i.player_a, 1
FROM _test_inputs i
ON CONFLICT (player_id) DO NOTHING;

-- Player B row (only if a real UUID was supplied).
INSERT INTO players (player_id, controlled_character_id)
SELECT i.player_b, 2
FROM _test_inputs i
WHERE i.player_b <> '00000000-0000-0000-0000-000000000000'::uuid
ON CONFLICT (player_id) DO NOTHING;

-- Physical environment for travel duration math.
INSERT INTO physical_environments (
  environment_id, setting_id, temperature, density, hydration, population
)
VALUES (1, 1, 20, 4, 6, 1)
ON CONFLICT (environment_id) DO NOTHING;

-- Material for travel duration math.
INSERT INTO materials (
  material_id, event_id, source_character_id, durability, implementation
)
VALUES (1, NULL, 1, 2, 2)
ON CONFLICT (material_id) DO NOTHING;

-- ─────────────────────────────────────────────
-- TEST 1: setting_id NOT NULL enforcement
-- Expected: the good insert succeeds; the bad
-- insert (commented out) would raise an error.
-- ─────────────────────────────────────────────
INSERT INTO events (
  event_type, duration_units, start_timestamp,
  resolution_state, setting_id
)
VALUES (
  'exchange_information', 10,
  EXTRACT(EPOCH FROM NOW()), 'pending', 1
);

SELECT 'TEST 1 PASS — setting_id insert succeeded' AS result;

-- Uncomment to verify NOT NULL rejection:
-- INSERT INTO events (
--   event_type, duration_units, start_timestamp, resolution_state
-- )
-- VALUES ('exchange_information', 10, EXTRACT(EPOCH FROM NOW()), 'pending');

-- ─────────────────────────────────────────────
-- TEST 2: advance_turn trigger increments turn_number
-- Expected: two chronicle inserts for player A
-- produce turn_number = N and N+1 automatically.
-- ─────────────────────────────────────────────
WITH e1 AS (
  INSERT INTO events (
    event_type, duration_units, start_timestamp,
    resolution_state, setting_id, submit_timestamp
  )
  VALUES (
    'exchange_information', 10,
    EXTRACT(EPOCH FROM NOW()), 'resolved', 1,
    EXTRACT(EPOCH FROM NOW())
  )
  RETURNING event_id
)
INSERT INTO chronicle (
  event_id, character_id, player_id, branch_id,
  timestamp, sequence_index, submit_timestamp, resolution_order
)
SELECT
  e1.event_id, 1, i.player_a, 0,
  EXTRACT(EPOCH FROM NOW()), 1,
  EXTRACT(EPOCH FROM NOW()), 1
FROM e1, _test_inputs i;

WITH e2 AS (
  INSERT INTO events (
    event_type, duration_units, start_timestamp,
    resolution_state, setting_id, submit_timestamp
  )
  VALUES (
    'exchange_material', 3,
    EXTRACT(EPOCH FROM NOW()), 'resolved', 1,
    EXTRACT(EPOCH FROM NOW())
  )
  RETURNING event_id
)
INSERT INTO chronicle (
  event_id, character_id, player_id, branch_id,
  timestamp, sequence_index, submit_timestamp, resolution_order
)
SELECT
  e2.event_id, 1, i.player_a, 0,
  EXTRACT(EPOCH FROM NOW()), 2,
  EXTRACT(EPOCH FROM NOW()), 2
FROM e2, _test_inputs i;

-- Inspect: turn_number should increment 1 → 2
SELECT
  'TEST 2' AS test,
  chronicle_id,
  turn_number,
  player_id
FROM chronicle
WHERE player_id = (SELECT player_a FROM _test_inputs)
ORDER BY chronicle_id DESC
LIMIT 4;

-- ─────────────────────────────────────────────
-- TEST 3: turn_queue race ordering
-- Expected: lower submit_timestamp → queue_pos 1.
-- ─────────────────────────────────────────────
WITH p1 AS (
  INSERT INTO events (
    event_type, duration_units, start_timestamp,
    resolution_state, setting_id, submit_timestamp
  )
  VALUES (
    'introduce_conflict', 5,
    EXTRACT(EPOCH FROM NOW()), 'pending', 1,
    1000.001   -- earlier
  )
  RETURNING event_id
)
INSERT INTO chronicle (
  event_id, character_id, player_id, branch_id,
  timestamp, sequence_index, submit_timestamp, resolution_order
)
SELECT
  p1.event_id, 1, i.player_a, 0,
  EXTRACT(EPOCH FROM NOW()), 10,
  1000.001, 1
FROM p1, _test_inputs i;

WITH p2 AS (
  INSERT INTO events (
    event_type, duration_units, start_timestamp,
    resolution_state, setting_id, submit_timestamp
  )
  VALUES (
    'resolve_conflict', 7,
    EXTRACT(EPOCH FROM NOW()), 'pending', 1,
    1000.002   -- later
  )
  RETURNING event_id
)
INSERT INTO chronicle (
  event_id, character_id, player_id, branch_id,
  timestamp, sequence_index, submit_timestamp, resolution_order
)
SELECT
  p2.event_id, 1, i.player_a, 0,
  EXTRACT(EPOCH FROM NOW()), 11,
  1000.002, 2
FROM p2, _test_inputs i;

SELECT
  'TEST 3' AS test,
  queue_pos,
  player_id,
  turn_number,
  submit_timestamp
FROM turn_queue
WHERE player_id = (SELECT player_a FROM _test_inputs)
ORDER BY turn_number DESC, queue_pos ASC
LIMIT 5;

-- ─────────────────────────────────────────────
-- TEST 4: branch limit count query
-- The Edge Function rejects a 4th fork using:
--   SELECT COUNT(*) FROM branches WHERE parent_branch_id = X
-- DB itself does NOT enforce max-3 (app-layer rule).
-- Expected: count = 3 for parent_branch_id = 0.
-- ─────────────────────────────────────────────
INSERT INTO branches (fork_timestamp, player_id, parent_branch_id)
SELECT
  EXTRACT(EPOCH FROM NOW()) + s.n,
  i.player_a,
  0
FROM _test_inputs i,
     (VALUES (1),(2),(3)) AS s(n)
ON CONFLICT DO NOTHING;

SELECT
  'TEST 4' AS test,
  parent_branch_id,
  COUNT(*) AS branch_count,
  CASE
    WHEN COUNT(*) >= 3 THEN 'LIMIT REACHED — Edge Function would block 4th fork'
    ELSE 'UNDER LIMIT'
  END AS status
FROM branches
WHERE player_id = (SELECT player_a FROM _test_inputs)
  AND parent_branch_id = 0
GROUP BY parent_branch_id;

-- ─────────────────────────────────────────────
-- TEST 5: natural progression schedule
-- Generates expected event ticks for 500 time units.
-- No automation in DB yet — these are design-doc
-- validation queries for Milestone 7 sign-off.
-- Expected: cycles appear at correct intervals.
-- ─────────────────────────────────────────────
SELECT
  'TEST 5 — environment/material/population schedule' AS test;

SELECT
  t,
  ARRAY_REMOVE(ARRAY[
    CASE WHEN t % 100 = 0 THEN 'environment_cycle'    END,
    CASE WHEN t % 80  = 0 THEN 'material_major_change' END,
    CASE WHEN t % 50  = 0 THEN 'population_spawn'      END
  ], NULL) AS events_at_t
FROM generate_series(50, 500, 1) AS t
WHERE t % 100 = 0
   OR t % 80  = 0
   OR t % 50  = 0
ORDER BY t;

-- Material minor change every 3 event-duration-units:
SELECT
  d AS duration_unit,
  'material_minor_change' AS event
FROM generate_series(3, 15, 3) AS d
ORDER BY d;

-- ─────────────────────────────────────────────
-- TEST 6: travel duration formula validation
-- Uses environment_id=1 (density=4, hydration=6)
-- and material_id=1 (durability=2, implementation=2)
-- with character health=10, size=1, inspiration=0.
-- Expected: duration = max(1, round(5 * 0.1 / 4 * 1)) = 1
-- ─────────────────────────────────────────────
SELECT
  'TEST 6 — travel duration formula' AS test,
  GREATEST(1, ROUND(
    ((pe.density + pe.hydration) / 2.0)
    * (c.size / GREATEST(c.health, 0.1))
    / (m.durability * m.implementation)
    * (CASE WHEN c.inspiration > 0 THEN 0.9 ELSE 1 END)
  ))::int AS computed_duration_units
FROM
  physical_environments pe,
  characters            c,
  materials             m
WHERE pe.environment_id = 1
  AND c.character_id    = 1
  AND m.material_id     = 1;

-- ─────────────────────────────────────────────
-- TEST 7: RLS isolation data setup
-- Inserts a chronicle row for player B so a live
-- client test can verify player A cannot see it.
-- Skipped if player_b is the all-zeros placeholder.
-- ─────────────────────────────────────────────
WITH eb AS (
  INSERT INTO events (
    event_type, duration_units, start_timestamp,
    resolution_state, setting_id, submit_timestamp
  )
  SELECT
    'exchange_information', 10,
    EXTRACT(EPOCH FROM NOW()), 'resolved', 1,
    EXTRACT(EPOCH FROM NOW())
  FROM _test_inputs i
  WHERE i.player_b <> '00000000-0000-0000-0000-000000000000'::uuid
  RETURNING event_id
)
INSERT INTO chronicle (
  event_id, character_id, player_id, branch_id,
  timestamp, sequence_index, submit_timestamp, resolution_order
)
SELECT
  eb.event_id, 2, i.player_b, 0,
  EXTRACT(EPOCH FROM NOW()), 20,
  EXTRACT(EPOCH FROM NOW()), 1
FROM eb, _test_inputs i
WHERE i.player_b <> '00000000-0000-0000-0000-000000000000'::uuid;

SELECT
  'TEST 7 — chronicle rows per player (service-role view)' AS test,
  player_id,
  COUNT(*) AS chronicle_rows
FROM chronicle
WHERE player_id IN (
  SELECT player_a FROM _test_inputs
  UNION ALL
  SELECT player_b FROM _test_inputs
    WHERE player_b <> '00000000-0000-0000-0000-000000000000'::uuid
)
GROUP BY player_id
ORDER BY player_id;

-- RLS client-side verification (manual):
--   1. Sign in as player A in the frontend.
--   2. Chronicle panel must show ONLY player A rows.
--   3. Sign in as player B.
--   4. Chronicle panel must show ONLY player B rows.
-- The "Player chronicle view" policy (002_multiplayer_extensions)
-- enforces USING (player_id = auth.uid()) — no API filtering needed.

-- ─────────────────────────────────────────────
-- ROLLBACK — no test data persisted.
-- Change to COMMIT to keep fixtures for live
-- client testing.
-- ─────────────────────────────────────────────
ROLLBACK;

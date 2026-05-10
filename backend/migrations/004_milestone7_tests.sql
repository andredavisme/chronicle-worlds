-- =============================================================
-- Migration 004 — Milestone 7 Test Suite
-- Chronicle Worlds
-- =============================================================
-- HOW TO RUN:
--   1. Replace PLAYER_A_UUID with your real auth user UUID.
--   2. Paste into Supabase SQL Editor and run.
--   3. Ends with ROLLBACK — change to COMMIT to persist fixtures.
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
  '00000000-0000-0000-0000-000000000000'::uuid AS player_b;

-- ─────────────────────────────────────────────
-- 1. FIXTURES
-- IDs start at 100 to avoid collision with existing rows.
-- All PKs are plain integers with no sequence — must be explicit.
-- ─────────────────────────────────────────────
INSERT INTO settings (setting_id, time_unit, origin_x, origin_y, origin_z, inspiration)
VALUES (1, 0, 0, 0, 0, NULL)
ON CONFLICT (setting_id) DO NOTHING;

INSERT INTO characters (
  character_id, age, health, attack, defense, wealth, inspiration, size
) VALUES
  (1, 0, 10, 0, 0, 0, 0, 1),
  (2, 0, 10, 0, 0, 0, 0, 1)
ON CONFLICT (character_id) DO NOTHING;

INSERT INTO players (player_id, controlled_character_id)
SELECT i.player_a, 1 FROM _test_inputs i
ON CONFLICT (player_id) DO NOTHING;

INSERT INTO players (player_id, controlled_character_id)
SELECT i.player_b, 2 FROM _test_inputs i
WHERE i.player_b <> '00000000-0000-0000-0000-000000000000'::uuid
ON CONFLICT (player_id) DO NOTHING;

INSERT INTO physical_environments (
  environment_id, setting_id, temperature, density, hydration, population
) VALUES (100, 1, 20, 4, 6, 1)
ON CONFLICT (environment_id) DO NOTHING;

INSERT INTO materials (material_id, source, durability, implementation)
VALUES (100, 'test', 2, 2)
ON CONFLICT (material_id) DO NOTHING;

-- ─────────────────────────────────────────────
-- TEST 1: setting_id NOT NULL enforcement
-- Expected: insert succeeds, TEST 1 PASS returned.
-- ─────────────────────────────────────────────
INSERT INTO events (
  event_id, event_type, duration_units, start_timestamp,
  resolution_state, setting_id
) VALUES (
  100, 'exchange_information', 10,
  EXTRACT(EPOCH FROM NOW()), 'pending', 1
);

SELECT 'TEST 1 PASS — setting_id insert succeeded' AS result;

-- ─────────────────────────────────────────────
-- TEST 2: advance_turn trigger increments turn_number
-- Expected: turn_number increments 1 → 2.
-- ─────────────────────────────────────────────
INSERT INTO events (
  event_id, event_type, duration_units, start_timestamp,
  resolution_state, setting_id, submit_timestamp
) VALUES (
  101, 'exchange_information', 10,
  EXTRACT(EPOCH FROM NOW()), 'resolved', 1,
  EXTRACT(EPOCH FROM NOW())
);

INSERT INTO chronicle (
  chronicle_id, event_id, character_id, player_id, branch_id,
  timestamp, sequence_index, submit_timestamp, resolution_order
)
SELECT
  100, 101, 1, i.player_a, 0,
  EXTRACT(EPOCH FROM NOW()), 1,
  EXTRACT(EPOCH FROM NOW()), 1
FROM _test_inputs i;

INSERT INTO events (
  event_id, event_type, duration_units, start_timestamp,
  resolution_state, setting_id, submit_timestamp
) VALUES (
  102, 'exchange_material', 3,
  EXTRACT(EPOCH FROM NOW()), 'resolved', 1,
  EXTRACT(EPOCH FROM NOW())
);

INSERT INTO chronicle (
  chronicle_id, event_id, character_id, player_id, branch_id,
  timestamp, sequence_index, submit_timestamp, resolution_order
)
SELECT
  101, 102, 1, i.player_a, 0,
  EXTRACT(EPOCH FROM NOW()), 2,
  EXTRACT(EPOCH FROM NOW()), 2
FROM _test_inputs i;

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
-- Expected: submit_timestamp 1000.001 → queue_pos 1.
-- ─────────────────────────────────────────────
INSERT INTO events (
  event_id, event_type, duration_units, start_timestamp,
  resolution_state, setting_id, submit_timestamp
) VALUES
  (103, 'introduce_conflict', 5, EXTRACT(EPOCH FROM NOW()), 'pending', 1, 1000.001),
  (104, 'resolve_conflict',   7, EXTRACT(EPOCH FROM NOW()), 'pending', 1, 1000.002);

INSERT INTO chronicle (
  chronicle_id, event_id, character_id, player_id, branch_id,
  timestamp, sequence_index, submit_timestamp, resolution_order
)
SELECT 102, 103, 1, i.player_a, 0, EXTRACT(EPOCH FROM NOW()), 10, 1000.001, 1
FROM _test_inputs i;

INSERT INTO chronicle (
  chronicle_id, event_id, character_id, player_id, branch_id,
  timestamp, sequence_index, submit_timestamp, resolution_order
)
SELECT 103, 104, 1, i.player_a, 0, EXTRACT(EPOCH FROM NOW()), 11, 1000.002, 2
FROM _test_inputs i;

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
-- TEST 4: branch limit count
-- Expected: branch_count = 3, status = LIMIT REACHED.
-- ─────────────────────────────────────────────
INSERT INTO branches (fork_timestamp, player_id, parent_branch_id)
SELECT
  EXTRACT(EPOCH FROM NOW()) + s.n,
  i.player_a,
  0
FROM _test_inputs i,
     (VALUES (1),(2),(3)) AS s(n);

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
-- Expected: events_at_t arrays at correct intervals.
-- ─────────────────────────────────────────────
SELECT 'TEST 5 — environment/material/population schedule' AS test;

SELECT
  t,
  ARRAY_REMOVE(ARRAY[
    CASE WHEN t % 100 = 0 THEN 'environment_cycle'    END,
    CASE WHEN t % 80  = 0 THEN 'material_major_change' END,
    CASE WHEN t % 50  = 0 THEN 'population_spawn'      END
  ], NULL) AS events_at_t
FROM generate_series(50, 500, 1) AS t
WHERE t % 100 = 0 OR t % 80 = 0 OR t % 50 = 0
ORDER BY t;

SELECT d AS duration_unit, 'material_minor_change' AS event
FROM generate_series(3, 15, 3) AS d
ORDER BY d;

-- ─────────────────────────────────────────────
-- TEST 6: travel duration formula
-- Expected: computed_duration_units = 1
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
WHERE pe.environment_id = 100
  AND c.character_id    = 1
  AND m.material_id     = 100;

-- ─────────────────────────────────────────────
-- TEST 7: RLS isolation data setup
-- Skipped if player_b is the all-zeros placeholder.
-- ─────────────────────────────────────────────
INSERT INTO events (
  event_id, event_type, duration_units, start_timestamp,
  resolution_state, setting_id, submit_timestamp
)
SELECT
  105, 'exchange_information', 10,
  EXTRACT(EPOCH FROM NOW()), 'resolved', 1,
  EXTRACT(EPOCH FROM NOW())
FROM _test_inputs i
WHERE i.player_b <> '00000000-0000-0000-0000-000000000000'::uuid;

INSERT INTO chronicle (
  chronicle_id, event_id, character_id, player_id, branch_id,
  timestamp, sequence_index, submit_timestamp, resolution_order
)
SELECT
  104, 105, 2, i.player_b, 0,
  EXTRACT(EPOCH FROM NOW()), 20,
  EXTRACT(EPOCH FROM NOW()), 1
FROM _test_inputs i
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

-- Manual RLS verification:
--   1. Sign in as player A → Chronicle panel shows ONLY player A rows.
--   2. Sign in as player B → Chronicle panel shows ONLY player B rows.

ROLLBACK;

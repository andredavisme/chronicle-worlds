-- Migration: 005_persist_test_fixtures
-- Purpose: Persist test fixtures for multiplayer/branch/RLS testing.
-- Applied: 2026-05-10 | Status: COMMIT

-- Genesis setting (required; events.setting_id NOT NULL)
INSERT INTO settings (setting_id, name, origin_x, origin_y, origin_z)
VALUES (1, 'Genesis', 0, 0, 0)
ON CONFLICT (setting_id) DO NOTHING;

-- Player A auth user (dev@chronicle.local)
INSERT INTO auth.users (id, email)
VALUES ('b6879b2f-801c-4459-aae1-6a8022e8e1a7', 'dev@chronicle.local')
ON CONFLICT (id) DO NOTHING;

-- Player B stub
INSERT INTO auth.users (id, email)
VALUES ('00000000-0000-0000-0000-000000000002', 'playerb@chronicle.local')
ON CONFLICT (id) DO NOTHING;

-- Test player (test@chroincle.local — typo preserved intentionally)
INSERT INTO auth.users (id, email)
VALUES ('d30fe4d9-a9f3-43a2-947d-30c8d9d2cdd5', 'test@chroincle.local')
ON CONFLICT (id) DO NOTHING;

-- Seed characters for Player A and Test player
INSERT INTO characters (character_id, name, age, health, wealth)
VALUES
  (1, 'Player A Character', 1000, 100, 100),
  (7, 'Test Character',     1000, 100, 100)
ON CONFLICT (character_id) DO NOTHING;

-- players rows
INSERT INTO players (player_id, controlled_character_id)
VALUES
  ('b6879b2f-801c-4459-aae1-6a8022e8e1a7', 1),
  ('00000000-0000-0000-0000-000000000002', NULL),
  ('d30fe4d9-a9f3-43a2-947d-30c8d9d2cdd5', 7)
ON CONFLICT (player_id) DO NOTHING;

-- 3 branches for Player A (at fork cap)
INSERT INTO branches (branch_id, fork_timestamp, player_id, parent_branch_id)
VALUES
  (1, 0.0, 'b6879b2f-801c-4459-aae1-6a8022e8e1a7', 0),
  (2, 1.0, 'b6879b2f-801c-4459-aae1-6a8022e8e1a7', 0),
  (3, 2.0, 'b6879b2f-801c-4459-aae1-6a8022e8e1a7', 0)
ON CONFLICT (branch_id) DO NOTHING;

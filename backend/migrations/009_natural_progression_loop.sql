-- ============================================================
-- Migration: 009_natural_progression_loop
-- Purpose:   Autonomous world simulation tick via pg_cron.
--            Fires every 1 real minute = 1 duration unit.
-- Spec:
--   - Every tick:   age all characters +1, increment setting time_unit
--   - Every 3  du:  minor material tick (durability -1, age +1)
--   - Every 50 du:  spawn 1 age-0 character per setting
--   - Every 80 du:  major material change (randomise source/implementation)
--   - Every 100 tu: environment cycle (randomise temp/density/hydration)
--   - Every 500 tu: spawn new random setting (world expansion)
--   Broadcast: pg_notify('world_tick', json) after every tick
-- ============================================================

-- ------------------------------------------------------------
-- 1. Sequences for auto-spawned rows (idempotent)
-- ------------------------------------------------------------
CREATE SEQUENCE IF NOT EXISTS characters_character_id_seq;
ALTER TABLE characters
  ALTER COLUMN character_id SET DEFAULT nextval('characters_character_id_seq');
SELECT setval('characters_character_id_seq',
  COALESCE((SELECT MAX(character_id) FROM characters), 0) + 1, false);

CREATE SEQUENCE IF NOT EXISTS settings_setting_id_seq;
ALTER TABLE settings
  ALTER COLUMN setting_id SET DEFAULT nextval('settings_setting_id_seq');
SELECT setval('settings_setting_id_seq',
  COALESCE((SELECT MAX(setting_id) FROM settings), 0) + 1, false);

CREATE SEQUENCE IF NOT EXISTS physical_environments_environment_id_seq;
ALTER TABLE physical_environments
  ALTER COLUMN environment_id SET DEFAULT nextval('physical_environments_environment_id_seq');
SELECT setval('physical_environments_environment_id_seq',
  COALESCE((SELECT MAX(environment_id) FROM physical_environments), 0) + 1, false);

CREATE SEQUENCE IF NOT EXISTS materials_material_id_seq;
ALTER TABLE materials
  ALTER COLUMN material_id SET DEFAULT nextval('materials_material_id_seq');
SELECT setval('materials_material_id_seq',
  COALESCE((SELECT MAX(material_id) FROM materials), 0) + 1, false);

CREATE SEQUENCE IF NOT EXISTS relationship_effects_relationship_id_seq;
ALTER TABLE relationship_effects
  ALTER COLUMN relationship_id SET DEFAULT nextval('relationship_effects_relationship_id_seq');
SELECT setval('relationship_effects_relationship_id_seq',
  COALESCE((SELECT MAX(relationship_id) FROM relationship_effects), 0) + 1, false);

-- ------------------------------------------------------------
-- 2. world_tick_state — singleton duration counter
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS world_tick_state (
  id            INT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  duration_unit BIGINT NOT NULL DEFAULT 0,
  last_tick_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
INSERT INTO world_tick_state (id, duration_unit, last_tick_at)
VALUES (1, 0, now())
ON CONFLICT (id) DO NOTHING;

-- Enable Realtime on world_tick_state so the frontend receives tick updates
ALTER TABLE world_tick_state REPLICA IDENTITY FULL;

-- ------------------------------------------------------------
-- 3. proc_words — vocabulary for procedural generation
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS proc_words (
  category TEXT NOT NULL,
  word     TEXT NOT NULL
);
INSERT INTO proc_words (category, word) VALUES
  ('source',   'stone'), ('source',   'wood'),  ('source',  'bone'),
  ('source',   'metal'), ('source',   'clay'),  ('source',  'silk'),
  ('source',   'ice'),   ('source',   'glass'),
  ('impl',     'carved'),('impl',     'woven'), ('impl',    'cast'),
  ('impl',     'forged'),('impl',     'grown'), ('impl',    'etched'),
  ('rel_type', 'ally'),  ('rel_type', 'rival'), ('rel_type','kin'),
  ('rel_type', 'trade'), ('rel_type', 'debt'),  ('rel_type','myth')
ON CONFLICT DO NOTHING;

-- ------------------------------------------------------------
-- 4. world_tick() — core simulation function
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.world_tick()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_du        BIGINT;
  v_setting   RECORD;
  v_new_char  INT;
  v_new_set   INT;
  v_src       TEXT;
  v_impl      TEXT;
  v_rel       TEXT;
  v_payload   JSONB;
BEGIN

  -- Increment global duration counter
  UPDATE world_tick_state
  SET duration_unit = duration_unit + 1,
      last_tick_at  = now()
  WHERE id = 1
  RETURNING duration_unit INTO v_du;

  -- Per-setting loop
  FOR v_setting IN SELECT * FROM settings LOOP

    -- Always: increment setting story-time
    UPDATE settings
      SET time_unit = time_unit + 1
    WHERE setting_id = v_setting.setting_id;

    -- Always: age all active characters in this setting
    UPDATE characters c
      SET age = age + 1
    FROM entity_positions ep
    JOIN grid_cells gc ON gc.grid_cell_id = ep.grid_cell_id
    WHERE ep.entity_type    = 'character'
      AND ep.entity_id      = c.character_id
      AND ep.timestamp_end  IS NULL
      AND gc.setting_id     = v_setting.setting_id;

    -- Every 3 du: minor material tick
    IF v_du % 3 = 0 THEN
      UPDATE materials m
        SET age        = age + 1,
            durability = GREATEST(0, durability - 1)
      FROM entity_positions ep
      JOIN grid_cells gc ON gc.grid_cell_id = ep.grid_cell_id
      WHERE ep.entity_type  = 'material'
        AND ep.entity_id    = m.material_id
        AND ep.timestamp_end IS NULL
        AND gc.setting_id   = v_setting.setting_id;
    END IF;

    -- Every 50 du: spawn 1 age-0 character at setting origin
    IF v_du % 50 = 0 THEN
      INSERT INTO characters (age, health, defense, attack, wealth, inspiration, size)
      VALUES (0, 100, 10, 10, 0, 0, 1)
      RETURNING character_id INTO v_new_char;

      INSERT INTO entity_positions (entity_type, entity_id, grid_cell_id, effective_size)
      SELECT 'character', v_new_char, gc.grid_cell_id, 1
      FROM grid_cells gc
      WHERE gc.setting_id = v_setting.setting_id
        AND gc.x = v_setting.origin_x
        AND gc.y = v_setting.origin_y
        AND gc.z = v_setting.origin_z
      LIMIT 1;

      -- Random relationship to an existing character
      SELECT word INTO v_rel FROM proc_words WHERE category = 'rel_type'
        ORDER BY random() LIMIT 1;

      INSERT INTO relationship_effects
        (relationship_type, source_entity_type, source_entity_id,
         target_entity_type, target_entity_id, effect_json, start_timestamp)
      SELECT v_rel, 'character', v_new_char,
             'character', ep.entity_id,
             jsonb_build_object('strength', (random()*10)::int),
             extract(epoch FROM now())
      FROM entity_positions ep
      JOIN grid_cells gc ON gc.grid_cell_id = ep.grid_cell_id
      WHERE ep.entity_type    = 'character'
        AND ep.timestamp_end  IS NULL
        AND gc.setting_id     = v_setting.setting_id
        AND ep.entity_id     <> v_new_char
      LIMIT 1;
    END IF;

    -- Every 80 du: major material change
    IF v_du % 80 = 0 THEN
      SELECT word INTO v_src  FROM proc_words WHERE category = 'source' ORDER BY random() LIMIT 1;
      SELECT word INTO v_impl FROM proc_words WHERE category = 'impl'   ORDER BY random() LIMIT 1;
      UPDATE materials m
        SET source         = v_src,
            implementation = v_impl,
            inspiration    = (random() * 10)::int
      FROM entity_positions ep
      JOIN grid_cells gc ON gc.grid_cell_id = ep.grid_cell_id
      WHERE ep.entity_type    = 'material'
        AND ep.entity_id      = m.material_id
        AND ep.timestamp_end  IS NULL
        AND gc.setting_id     = v_setting.setting_id;
    END IF;

    -- Every 100 tu (story-time): environment cycle
    IF (v_setting.time_unit + 1) % 100 = 0 THEN
      UPDATE physical_environments
        SET temperature = (random() * 80 - 20)::int,
            density     = (random() * 100)::int,
            hydration   = (random() * 100)::int,
            age         = age + 1
      WHERE setting_id = v_setting.setting_id;
    END IF;

    -- Every 500 tu: spawn new random setting
    IF (v_setting.time_unit + 1) % 500 = 0 THEN
      INSERT INTO settings (origin_x, origin_y, origin_z, time_unit, inspiration)
      VALUES (
        v_setting.origin_x + (floor(random()*11) - 5)::int,
        v_setting.origin_y + (floor(random()*11) - 5)::int,
        0,
        0,
        (random() * 10)::int
      )
      RETURNING setting_id INTO v_new_set;

      INSERT INTO physical_environments
        (setting_id, age, temperature, density, population, hydration)
      VALUES (
        v_new_set, 0,
        (random() * 80 - 20)::int,
        (random() * 100)::int,
        0,
        (random() * 100)::int
      );
    END IF;

  END LOOP;

  -- Broadcast tick (also triggers Realtime via world_tick_state UPDATE above)
  v_payload := jsonb_build_object('duration_unit', v_du, 'tick_at', now());
  PERFORM pg_notify('world_tick', v_payload::text);

END;
$$;

-- ------------------------------------------------------------
-- 5. pg_cron: every minute
-- ------------------------------------------------------------
SELECT cron.unschedule('world-tick') WHERE EXISTS (
  SELECT 1 FROM cron.job WHERE jobname = 'world-tick'
);
SELECT cron.schedule(
  'world-tick',
  '* * * * *',
  $$SELECT public.world_tick();$$
);

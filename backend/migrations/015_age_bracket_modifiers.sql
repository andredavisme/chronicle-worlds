-- ============================================================
-- Migration: 015_age_bracket_modifiers
-- Purpose:   Age-based attribute modification.
--            When a character's age crosses a bracket threshold
--            during world_tick(), permanent attribute_modifiers
--            are inserted (replacing any prior bracket modifier
--            for that character+attribute).
--
-- Brackets (thresholds are the age AT WHICH the bracket begins):
--   youth  → age  1   (applied at spawn / first tick)
--   prime  → age 20
--   elder  → age 60
--
-- Modifier schema (attribute_modifiers):
--   source_entity_type = 'age_bracket'
--   source_entity_id   = age_bracket.bracket_id
--   operator           = 'add'
--   end_timestamp      = NULL  (permanent)
-- ============================================================

-- ------------------------------------------------------------
-- 1. age_brackets config table
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS age_brackets (
  bracket_id        SERIAL PRIMARY KEY,
  bracket_name      TEXT NOT NULL UNIQUE,   -- 'youth' | 'prime' | 'elder'
  age_threshold     INT  NOT NULL,          -- age >= this → bracket applies
  attribute         TEXT NOT NULL,          -- which character attribute to modify
  operator          TEXT NOT NULL DEFAULT 'add',
  value             REAL NOT NULL           -- delta applied (can be negative)
);

-- Seed: one row per bracket×attribute pair
-- Youth  (age ≥  1): inspiration +2, health +5
-- Prime  (age ≥ 20): health +10, attack +5, defense +5, inspiration −2
-- Elder  (age ≥ 60): health −15, attack −3, defense +8, inspiration +5
INSERT INTO age_brackets (bracket_name, age_threshold, attribute, operator, value) VALUES
  ('youth',  1,  'inspiration', 'add',  2),
  ('youth',  1,  'health',      'add',  5),
  ('prime',  20, 'health',      'add',  10),
  ('prime',  20, 'attack',      'add',  5),
  ('prime',  20, 'defense',     'add',  5),
  ('prime',  20, 'inspiration', 'add', -2),
  ('elder',  60, 'health',      'add', -15),
  ('elder',  60, 'attack',      'add', -3),
  ('elder',  60, 'defense',     'add',  8),
  ('elder',  60, 'inspiration', 'add',  5)
ON CONFLICT DO NOTHING;

-- ------------------------------------------------------------
-- 2. Helper: apply_age_bracket_modifiers(character_id, new_age)
--    Called by world_tick() after aging each character.
--    For each bracket the character now qualifies for, upsert
--    a single attribute_modifier row keyed on
--    (source_entity_type='age_bracket', source_entity_id=bracket_id,
--     target_entity_type='character', target_entity_id=character_id,
--     target_attribute).
--    Only fires when new_age crosses a threshold (= exact match),
--    so it runs at most once per character per bracket.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.apply_age_bracket_modifiers(
  p_character_id INT,
  p_new_age      INT
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_bracket age_brackets%ROWTYPE;
BEGIN
  FOR v_bracket IN
    SELECT * FROM age_brackets
    WHERE age_threshold = p_new_age   -- only the bracket(s) crossed this tick
  LOOP
    -- Delete any prior modifier for this character+attribute from any bracket
    -- (so brackets replace each other rather than stack)
    DELETE FROM attribute_modifiers
    WHERE source_entity_type = 'age_bracket'
      AND target_entity_type = 'character'
      AND target_entity_id   = p_character_id
      AND target_attribute   = v_bracket.attribute;

    -- Insert the new bracket modifier
    INSERT INTO attribute_modifiers (
      source_entity_type, source_entity_id,
      target_entity_type, target_entity_id,
      target_attribute, operator, value,
      priority, start_timestamp, end_timestamp
    ) VALUES (
      'age_bracket', v_bracket.bracket_id,
      'character',   p_character_id,
      v_bracket.attribute, v_bracket.operator, v_bracket.value,
      10,                                      -- higher priority than action modifiers (0)
      extract(epoch FROM now()),
      NULL                                     -- permanent
    );
  END LOOP;
END;
$$;

-- ------------------------------------------------------------
-- 3. Patch world_tick() to call apply_age_bracket_modifiers
--    after aging each character.
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
  v_char      RECORD;
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

    -- Always: age all active characters in this setting, then apply bracket modifiers
    FOR v_char IN
      SELECT c.character_id, c.age + 1 AS new_age
      FROM characters c
      JOIN entity_positions ep ON ep.entity_id = c.character_id
      JOIN grid_cells gc       ON gc.grid_cell_id = ep.grid_cell_id
      WHERE ep.entity_type   = 'character'
        AND ep.timestamp_end IS NULL
        AND gc.setting_id    = v_setting.setting_id
    LOOP
      UPDATE characters SET age = v_char.new_age WHERE character_id = v_char.character_id;
      PERFORM apply_age_bracket_modifiers(v_char.character_id, v_char.new_age);
    END LOOP;

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

      -- Apply youth bracket immediately at spawn (age 0→ first tick will be 1,
      -- but bootstrap it now so the new character starts with modifiers)
      PERFORM apply_age_bracket_modifiers(v_new_char, 1);

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

  -- Broadcast tick
  v_payload := jsonb_build_object('duration_unit', v_du, 'tick_at', now());
  PERFORM pg_notify('world_tick', v_payload::text);

END;
$$;

-- ------------------------------------------------------------
-- 4. Backfill: apply modifiers to all existing characters
--    based on their current age
-- ------------------------------------------------------------
DO $$
DECLARE
  v_char RECORD;
  v_bracket age_brackets%ROWTYPE;
BEGIN
  FOR v_char IN SELECT character_id, age FROM characters LOOP
    FOR v_bracket IN
      SELECT * FROM age_brackets WHERE age_threshold <= v_char.age
      ORDER BY age_threshold ASC
    LOOP
      -- Delete any existing bracket modifier for this char+attribute
      DELETE FROM attribute_modifiers
      WHERE source_entity_type = 'age_bracket'
        AND target_entity_type = 'character'
        AND target_entity_id   = v_char.character_id
        AND target_attribute   = v_bracket.attribute;

      INSERT INTO attribute_modifiers (
        source_entity_type, source_entity_id,
        target_entity_type, target_entity_id,
        target_attribute, operator, value,
        priority, start_timestamp, end_timestamp
      ) VALUES (
        'age_bracket', v_bracket.bracket_id,
        'character',   v_char.character_id,
        v_bracket.attribute, v_bracket.operator, v_bracket.value,
        10,
        extract(epoch FROM now()),
        NULL
      );
    END LOOP;
  END LOOP;
END;
$$;

-- ------------------------------------------------------------
-- 5. RLS: public SELECT on age_brackets (read-only config)
-- ------------------------------------------------------------
ALTER TABLE age_brackets ENABLE ROW LEVEL SECURITY;
CREATE POLICY "age_brackets public read"
  ON age_brackets FOR SELECT USING (true);

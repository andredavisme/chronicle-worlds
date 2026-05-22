-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 017 — Vertical z-Axis Physics (Option F)
-- Adds z_properties config table; flight + breath columns on characters;
-- world_tick() patched with per-tick fall and suffocation logic.
--
-- z-layer rules (canonical):
--   z =  0  ground        — always accessible
--   z ≥  1  air           — requires flight > 0; characters with flight=0 fall 1z/tick
--   z = -1  shallow water — accessible to all; material durability decay ×2/tick
--   z ≤ -2  deep water    — requires breath > 0; health -1/tick if breath = 0
-- ─────────────────────────────────────────────────────────────────────────────

-- ── 1. z_properties config table ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS z_properties (
  z_layer                    INT  PRIMARY KEY,
  layer_name                 TEXT NOT NULL,
  requires_flight            BOOL NOT NULL DEFAULT false,
  requires_breath            BOOL NOT NULL DEFAULT false,
  health_decay               INT  NOT NULL DEFAULT 0,
  durability_decay_multiplier INT NOT NULL DEFAULT 1
);

-- Seed canonical layers
INSERT INTO z_properties (z_layer, layer_name, requires_flight, requires_breath, health_decay, durability_decay_multiplier)
VALUES
  (-3, 'abyss',        false, true,  2, 1),
  (-2, 'deep water',   false, true,  1, 1),
  (-1, 'shallow water',false, false, 0, 2),
  ( 0, 'ground',       false, false, 0, 1),
  ( 1, 'air',          true,  false, 0, 1),
  ( 2, 'high air',     true,  false, 0, 1),
  ( 3, 'upper air',    true,  false, 0, 1)
ON CONFLICT (z_layer) DO NOTHING;

-- Public read; service role writes
ALTER TABLE z_properties ENABLE ROW LEVEL SECURITY;
CREATE POLICY "public read z_properties"
  ON z_properties FOR SELECT TO public USING (true);

-- ── 2. Add flight + breath columns to characters ──────────────────────────────
ALTER TABLE characters
  ADD COLUMN IF NOT EXISTS flight INT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS breath INT NOT NULL DEFAULT 0;

COMMENT ON COLUMN characters.flight IS
  'Ticks of active flight remaining. >0 required to occupy z≥1; decremented externally.';
COMMENT ON COLUMN characters.breath IS
  'Ticks of breath remaining. >0 required to avoid health decay at z≤-2.';

-- ── 3. Helper: get a character's current z from entity_positions ──────────────
CREATE OR REPLACE FUNCTION character_current_z(p_character_id INT)
RETURNS INT
LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT gc.z
  FROM entity_positions ep
  JOIN grid_cells gc ON gc.grid_cell_id = ep.grid_cell_id
  WHERE ep.entity_type   = 'character'
    AND ep.entity_id     = p_character_id
    AND ep.timestamp_end IS NULL
  LIMIT 1;
$$;

-- ── 4. Helper: move a character to the nearest grid_cell at a target z ─────────
-- Keeps same x,y within the same setting; falls back to origin if no cell exists.
CREATE OR REPLACE FUNCTION move_character_z(
  p_character_id INT,
  p_target_z     INT
)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_current_cell_id INT;
  v_setting_id      INT;
  v_x               INT;
  v_y               INT;
  v_target_cell_id  INT;
BEGIN
  -- Resolve current position
  SELECT ep.grid_cell_id, gc.setting_id, gc.x, gc.y
    INTO v_current_cell_id, v_setting_id, v_x, v_y
  FROM entity_positions ep
  JOIN grid_cells gc ON gc.grid_cell_id = ep.grid_cell_id
  WHERE ep.entity_type   = 'character'
    AND ep.entity_id     = p_character_id
    AND ep.timestamp_end IS NULL
  LIMIT 1;

  IF v_current_cell_id IS NULL THEN RETURN; END IF;

  -- Find a target cell at same x,y but target z
  SELECT grid_cell_id INTO v_target_cell_id
  FROM grid_cells
  WHERE setting_id = v_setting_id
    AND x          = v_x
    AND y          = v_y
    AND z          = p_target_z
  LIMIT 1;

  -- If no cell at that z, fall back to setting origin at z=0
  IF v_target_cell_id IS NULL THEN
    SELECT grid_cell_id INTO v_target_cell_id
    FROM grid_cells gc
    JOIN settings s ON s.setting_id = gc.setting_id
    WHERE gc.setting_id = v_setting_id
      AND gc.x          = s.origin_x
      AND gc.y          = s.origin_y
      AND gc.z          = 0
    LIMIT 1;
  END IF;

  IF v_target_cell_id IS NULL OR v_target_cell_id = v_current_cell_id THEN RETURN; END IF;

  -- End current position record
  UPDATE entity_positions
     SET timestamp_end = extract(epoch FROM now())
  WHERE entity_type    = 'character'
    AND entity_id      = p_character_id
    AND timestamp_end  IS NULL;

  -- Insert new position
  INSERT INTO entity_positions (entity_type, entity_id, grid_cell_id, effective_size)
  SELECT 'character', p_character_id, v_target_cell_id,
         COALESCE(
           (SELECT effective_size FROM entity_positions
            WHERE entity_type  = 'character'
              AND entity_id    = p_character_id
            ORDER BY timestamp_start DESC LIMIT 1),
           1
         );
END;
$$;

-- ── 5. Patch world_tick() — add fall + suffocation logic ──────────────────────
CREATE OR REPLACE FUNCTION public.world_tick()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER AS $$
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
  v_drawn     INT;
  v_char_z    INT;
  v_zp        z_properties%ROWTYPE;
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

    -- Always: age all active characters; apply bracket modifiers; z-physics
    FOR v_char IN
      SELECT c.character_id, c.age + 1 AS new_age,
             c.flight, c.breath, c.health
      FROM characters c
      JOIN entity_positions ep ON ep.entity_id = c.character_id
      JOIN grid_cells gc       ON gc.grid_cell_id = ep.grid_cell_id
      WHERE ep.entity_type   = 'character'
        AND ep.timestamp_end IS NULL
        AND gc.setting_id    = v_setting.setting_id
    LOOP
      UPDATE characters SET age = v_char.new_age WHERE character_id = v_char.character_id;
      PERFORM apply_age_bracket_modifiers(v_char.character_id, v_char.new_age);

      -- ── z-physics ──────────────────────────────────────────────────────────
      v_char_z := character_current_z(v_char.character_id);

      IF v_char_z IS NOT NULL THEN
        SELECT * INTO v_zp FROM z_properties WHERE z_layer = v_char_z;

        -- Fall: air layer (z≥1) with no flight → drop 1z
        IF v_char_z >= 1 AND v_char.flight = 0 THEN
          PERFORM move_character_z(v_char.character_id, v_char_z - 1);
          v_char_z := v_char_z - 1;
          -- Re-fetch z_properties after fall
          SELECT * INTO v_zp FROM z_properties WHERE z_layer = v_char_z;
        END IF;

        -- Suffocation: deep water (z≤-2) with no breath → health -1
        IF v_char_z <= -2 AND v_char.breath = 0 THEN
          UPDATE characters
             SET health = GREATEST(0, health - 1)
          WHERE character_id = v_char.character_id;
        END IF;

        -- Deep-water health_decay from z_properties (stacks; e.g. abyss = -2/tick)
        IF v_zp.health_decay <> 0 AND NOT (v_char_z <= -2 AND v_char.breath = 0) THEN
          -- Only apply z_properties decay if suffocation rule didn't already fire
          -- (prevents double-dipping at z=-2 when breath=0)
          UPDATE characters
             SET health = GREATEST(0, health - v_zp.health_decay)
          WHERE character_id = v_char.character_id;
        END IF;

      END IF;
      -- ── end z-physics ──────────────────────────────────────────────────────
    END LOOP;

    -- Every 3 du: minor material tick (shallow water ×2 durability decay applied here)
    IF v_du % 3 = 0 THEN
      -- Standard decay for materials NOT in shallow water
      UPDATE materials m
        SET age        = age + 1,
            durability = GREATEST(0, durability - 1)
      FROM entity_positions ep
      JOIN grid_cells gc ON gc.grid_cell_id = ep.grid_cell_id
      WHERE ep.entity_type    = 'material'
        AND ep.entity_id      = m.material_id
        AND ep.timestamp_end  IS NULL
        AND gc.setting_id     = v_setting.setting_id
        AND gc.z              <> -1;  -- exclude shallow water

      -- Double decay for materials in shallow water (z=-1)
      UPDATE materials m
        SET age        = age + 1,
            durability = GREATEST(0, durability - 2)
      FROM entity_positions ep
      JOIN grid_cells gc ON gc.grid_cell_id = ep.grid_cell_id
      WHERE ep.entity_type    = 'material'
        AND ep.entity_id      = m.material_id
        AND ep.timestamp_end  IS NULL
        AND gc.setting_id     = v_setting.setting_id
        AND gc.z              = -1;
    END IF;

    -- Every 50 du: spawn 1 age-0 character at setting origin
    IF v_du % 50 = 0 THEN
      INSERT INTO characters (age, health, defense, attack, wealth, inspiration, size, flight, breath)
      VALUES (0, 100, 10, 10, 0, 0, 1, 0, 0)
      RETURNING character_id INTO v_new_char;

      INSERT INTO entity_positions (entity_type, entity_id, grid_cell_id, effective_size)
      SELECT 'character', v_new_char, gc.grid_cell_id, 1
      FROM grid_cells gc
      WHERE gc.setting_id = v_setting.setting_id
        AND gc.x = v_setting.origin_x
        AND gc.y = v_setting.origin_y
        AND gc.z = v_setting.origin_z
      LIMIT 1;

      -- Apply youth bracket immediately at spawn
      PERFORM apply_age_bracket_modifiers(v_new_char, 1);

      -- Draw inherited modifiers from the pool (ecological inheritance)
      v_drawn := draw_from_attribute_pool(v_setting.setting_id, 'character', v_new_char, 2);

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

    -- Every 500 tu: spawn new random setting (always at z=0)
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

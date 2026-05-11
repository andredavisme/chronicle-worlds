-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 016 — Attribute Pool on Entity Destruction
-- When a character (health=0) or material (durability=0) is destroyed,
-- their attribute_modifiers rows are harvested into attribute_pool.
-- world_tick() spawn logic seeds new entities from the pool (local to setting).
-- ─────────────────────────────────────────────────────────────────────────────

-- ── 1. attribute_pool table ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS attribute_pool (
  pool_id          SERIAL PRIMARY KEY,
  setting_id       INT        NOT NULL REFERENCES settings(setting_id),
  source_entity_type TEXT     NOT NULL,  -- original entity type before destruction
  target_entity_type TEXT     NOT NULL,  -- what kind of entity should inherit this
  target_attribute   TEXT     NOT NULL,
  operator           TEXT     NOT NULL CHECK (operator IN ('add','multiply','set')),
  value              REAL     NOT NULL,
  priority           INT      NOT NULL DEFAULT 0,
  created_at         REAL     NOT NULL DEFAULT extract(epoch FROM now())
);

CREATE INDEX IF NOT EXISTS idx_attribute_pool_setting ON attribute_pool(setting_id);
CREATE INDEX IF NOT EXISTS idx_attribute_pool_entity_type ON attribute_pool(target_entity_type);

-- Public read; service role writes (triggers run as definer)
ALTER TABLE attribute_pool ENABLE ROW LEVEL SECURITY;
CREATE POLICY "public read attribute_pool"
  ON attribute_pool FOR SELECT TO public USING (true);

-- ── 2. harvest helper: called by destruction triggers ────────────────────────
CREATE OR REPLACE FUNCTION harvest_attribute_modifiers(
  p_entity_type TEXT,
  p_entity_id   INT
)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_setting_id INT;
BEGIN
  -- Find the setting the entity is currently in
  SELECT gc.setting_id INTO v_setting_id
  FROM entity_positions ep
  JOIN grid_cells gc ON gc.grid_cell_id = ep.grid_cell_id
  WHERE ep.entity_type    = p_entity_type
    AND ep.entity_id      = p_entity_id
    AND ep.timestamp_end  IS NULL
  LIMIT 1;

  IF v_setting_id IS NULL THEN RETURN; END IF;

  -- Move non-age-bracket modifiers into the pool
  -- (age_bracket modifiers are structural; only action/event-derived ones carry forward)
  INSERT INTO attribute_pool
    (setting_id, source_entity_type, target_entity_type, target_attribute, operator, value, priority)
  SELECT
    v_setting_id,
    p_entity_type,             -- where it came from
    p_entity_type,             -- what kind of entity should inherit it
    target_attribute,
    operator,
    value,
    priority
  FROM attribute_modifiers
  WHERE target_entity_type = p_entity_type
    AND target_entity_id   = p_entity_id
    AND source_entity_type <> 'age_bracket'  -- skip structural bracket modifiers
    AND end_timestamp IS NULL;               -- only active modifiers

  -- Clean up the entity's modifiers
  DELETE FROM attribute_modifiers
  WHERE target_entity_type = p_entity_type
    AND target_entity_id   = p_entity_id;

  -- End the entity's position record
  UPDATE entity_positions
    SET timestamp_end = extract(epoch FROM now())
  WHERE entity_type   = p_entity_type
    AND entity_id     = p_entity_id
    AND timestamp_end IS NULL;

END;
$$;

-- ── 3. Destruction trigger on characters (health = 0) ────────────────────────
CREATE OR REPLACE FUNCTION trg_character_destruction()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  IF NEW.health <= 0 AND OLD.health > 0 THEN
    PERFORM harvest_attribute_modifiers('character', NEW.character_id);
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS character_destruction_trigger ON characters;
CREATE TRIGGER character_destruction_trigger
  AFTER UPDATE OF health ON characters
  FOR EACH ROW EXECUTE FUNCTION trg_character_destruction();

-- ── 4. Destruction trigger on materials (durability = 0) ─────────────────────
CREATE OR REPLACE FUNCTION trg_material_destruction()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  IF NEW.durability <= 0 AND OLD.durability > 0 THEN
    PERFORM harvest_attribute_modifiers('material', NEW.material_id);
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS material_destruction_trigger ON materials;
CREATE TRIGGER material_destruction_trigger
  AFTER UPDATE OF durability ON materials
  FOR EACH ROW EXECUTE FUNCTION trg_material_destruction();

-- ── 5. Pool-seeded spawn helper ───────────────────────────────────────────────
-- Called by world_tick() after spawning a new entity.
-- Draws up to p_max_draws rows from the pool for the given setting+entity_type,
-- applies them as attribute_modifiers on the new entity, and removes from pool.
CREATE OR REPLACE FUNCTION draw_from_attribute_pool(
  p_setting_id       INT,
  p_entity_type      TEXT,
  p_entity_id        INT,
  p_max_draws        INT DEFAULT 2
)
RETURNS INT   -- returns number of modifiers drawn
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_row    attribute_pool%ROWTYPE;
  v_count  INT := 0;
BEGIN
  FOR v_row IN
    SELECT * FROM attribute_pool
    WHERE setting_id       = p_setting_id
      AND target_entity_type = p_entity_type
    ORDER BY created_at ASC   -- oldest first (FIFO)
    LIMIT p_max_draws
  LOOP
    INSERT INTO attribute_modifiers (
      source_entity_type, source_entity_id,
      target_entity_type, target_entity_id,
      target_attribute, operator, value,
      priority, start_timestamp, end_timestamp
    ) VALUES (
      'attribute_pool', v_row.pool_id,
      p_entity_type,    p_entity_id,
      v_row.target_attribute, v_row.operator, v_row.value,
      v_row.priority,
      extract(epoch FROM now()),
      NULL
    );

    DELETE FROM attribute_pool WHERE pool_id = v_row.pool_id;
    v_count := v_count + 1;
  END LOOP;

  RETURN v_count;
END;
$$;

-- ── 6. Patch world_tick() to draw from pool on character spawn ────────────────
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

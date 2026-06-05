-- ============================================================
-- Migration: 020_seed_setting_grid_z_layers
-- Purpose:   Add p_z_layers param to seed_setting_grid() so a
--            setting can be seeded as a multi-storey stack of
--            z-planes. Default p_z_layers = 1 preserves existing
--            behaviour. Also updates world_tick() to pass the
--            param explicitly on auto-spawned settings.
-- Applied:   2026-06-05
-- ============================================================

CREATE OR REPLACE FUNCTION public.seed_setting_grid(
  p_setting_id INT,
  p_radius     INT DEFAULT 3,
  p_z_layers   INT DEFAULT 1
)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_setting settings%ROWTYPE;
  v_z       INT;
BEGIN
  SELECT * INTO v_setting FROM settings WHERE setting_id = p_setting_id;
  IF NOT FOUND THEN RETURN; END IF;

  -- Seed grid_cells for each z-layer
  FOR v_z IN v_setting.origin_z .. (v_setting.origin_z + GREATEST(p_z_layers, 1) - 1) LOOP
    INSERT INTO grid_cells (setting_id, x, y, z, capacity_units, expansion_state)
    SELECT
      p_setting_id,
      v_setting.origin_x + dx,
      v_setting.origin_y + dy,
      v_z,
      10,
      'stable'
    FROM generate_series(-p_radius, p_radius) AS dx
    CROSS JOIN generate_series(-p_radius, p_radius) AS dy
    ON CONFLICT DO NOTHING;
  END LOOP;

  -- Place setting entity marker at ground-floor origin cell only
  INSERT INTO entity_positions (entity_type, entity_id, grid_cell_id, effective_size, timestamp_start)
  SELECT
    'setting',
    p_setting_id,
    gc.grid_cell_id,
    7,
    extract(epoch FROM now())
  FROM grid_cells gc
  WHERE gc.setting_id = p_setting_id
    AND gc.x = v_setting.origin_x
    AND gc.y = v_setting.origin_y
    AND gc.z = v_setting.origin_z
  LIMIT 1
  ON CONFLICT DO NOTHING;
END;
$$;

-- Update world_tick() to pass p_z_layers := 1 explicitly on auto-spawned settings
CREATE OR REPLACE FUNCTION public.world_tick()
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_du BIGINT; v_setting RECORD; v_new_char INT; v_new_set INT;
  v_src TEXT; v_impl TEXT; v_rel TEXT; v_payload JSONB;
BEGIN
  UPDATE world_tick_state SET duration_unit = duration_unit + 1, last_tick_at = now()
  WHERE id = 1 RETURNING duration_unit INTO v_du;

  FOR v_setting IN SELECT * FROM settings LOOP
    UPDATE settings SET time_unit = time_unit + 1 WHERE setting_id = v_setting.setting_id;
    UPDATE characters c SET age = age + 1
    FROM entity_positions ep JOIN grid_cells gc ON gc.grid_cell_id = ep.grid_cell_id
    WHERE ep.entity_type = 'character' AND ep.entity_id = c.character_id
      AND ep.timestamp_end IS NULL AND gc.setting_id = v_setting.setting_id;

    IF v_du % 3 = 0 THEN
      UPDATE materials m SET age = age + 1, durability = GREATEST(0, durability - 1)
      FROM entity_positions ep JOIN grid_cells gc ON gc.grid_cell_id = ep.grid_cell_id
      WHERE ep.entity_type = 'material' AND ep.entity_id = m.material_id
        AND ep.timestamp_end IS NULL AND gc.setting_id = v_setting.setting_id;
    END IF;

    IF v_du % 50 = 0 THEN
      INSERT INTO characters (age, health, defense, attack, wealth, inspiration, size)
      VALUES (0, 100, 10, 10, 0, 0, 1) RETURNING character_id INTO v_new_char;
      INSERT INTO entity_positions (entity_type, entity_id, grid_cell_id, effective_size, timestamp_start)
      SELECT 'character', v_new_char, gc.grid_cell_id, 1, extract(epoch FROM now())
      FROM grid_cells gc WHERE gc.setting_id = v_setting.setting_id
        AND gc.x = v_setting.origin_x AND gc.y = v_setting.origin_y AND gc.z = v_setting.origin_z LIMIT 1;
      SELECT word INTO v_rel FROM proc_words WHERE category = 'rel_type' ORDER BY random() LIMIT 1;
      INSERT INTO relationship_effects
        (relationship_type, source_entity_type, source_entity_id, target_entity_type, target_entity_id, effect_json, start_timestamp)
      SELECT v_rel, 'character', v_new_char, 'character', ep.entity_id,
             jsonb_build_object('strength', (random()*10)::int), extract(epoch FROM now())
      FROM entity_positions ep JOIN grid_cells gc ON gc.grid_cell_id = ep.grid_cell_id
      WHERE ep.entity_type = 'character' AND ep.timestamp_end IS NULL
        AND gc.setting_id = v_setting.setting_id AND ep.entity_id <> v_new_char LIMIT 1;
    END IF;

    IF v_du % 80 = 0 THEN
      SELECT word INTO v_src FROM proc_words WHERE category = 'source' ORDER BY random() LIMIT 1;
      SELECT word INTO v_impl FROM proc_words WHERE category = 'impl' ORDER BY random() LIMIT 1;
      UPDATE materials m SET source = v_src, implementation = v_impl, inspiration = (random()*10)::int
      FROM entity_positions ep JOIN grid_cells gc ON gc.grid_cell_id = ep.grid_cell_id
      WHERE ep.entity_type = 'material' AND ep.entity_id = m.material_id
        AND ep.timestamp_end IS NULL AND gc.setting_id = v_setting.setting_id;
    END IF;

    IF (v_setting.time_unit + 1) % 100 = 0 THEN
      UPDATE physical_environments
      SET temperature = (random()*80-20)::int, density = (random()*100)::int,
          hydration = (random()*100)::int, age = age + 1
      WHERE setting_id = v_setting.setting_id;
    END IF;

    IF (v_setting.time_unit + 1) % 500 = 0 THEN
      INSERT INTO settings (origin_x, origin_y, origin_z, time_unit, inspiration)
      VALUES (
        v_setting.origin_x + (floor(random()*11)-5)::int,
        v_setting.origin_y + (floor(random()*11)-5)::int,
        0, 0, (random()*10)::int
      )
      RETURNING setting_id INTO v_new_set;
      PERFORM public.seed_setting_grid(v_new_set, 3, 1);
      INSERT INTO physical_environments (setting_id, age, temperature, density, population, hydration)
      VALUES (v_new_set, 0, (random()*80-20)::int, (random()*100)::int, 0, (random()*100)::int);
    END IF;
  END LOOP;

  v_payload := jsonb_build_object('duration_unit', v_du, 'tick_at', now());
  PERFORM pg_notify('world_tick', v_payload::text);
END;
$$;

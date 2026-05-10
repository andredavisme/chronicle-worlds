-- Migration: 007_add_pk_sequences
-- Purpose: Add sequences + defaults to PKs that were missing them,
--          causing null PK errors on insert.
-- Applied: 2026-05-10
-- Affected tables: events, chronicle, attribute_modifiers, entity_positions

-- events
CREATE SEQUENCE IF NOT EXISTS events_event_id_seq;
ALTER TABLE events
  ALTER COLUMN event_id SET DEFAULT nextval('events_event_id_seq');
SELECT setval('events_event_id_seq', COALESCE((SELECT MAX(event_id) FROM events), 0) + 1, false);

-- chronicle
CREATE SEQUENCE IF NOT EXISTS chronicle_chronicle_id_seq;
ALTER TABLE chronicle
  ALTER COLUMN chronicle_id SET DEFAULT nextval('chronicle_chronicle_id_seq');
SELECT setval('chronicle_chronicle_id_seq', COALESCE((SELECT MAX(chronicle_id) FROM chronicle), 0) + 1, false);

-- attribute_modifiers
CREATE SEQUENCE IF NOT EXISTS attribute_modifiers_modifier_id_seq;
ALTER TABLE attribute_modifiers
  ALTER COLUMN modifier_id SET DEFAULT nextval('attribute_modifiers_modifier_id_seq');
SELECT setval('attribute_modifiers_modifier_id_seq', COALESCE((SELECT MAX(modifier_id) FROM attribute_modifiers), 0) + 1, false);

-- entity_positions
CREATE SEQUENCE IF NOT EXISTS entity_positions_position_id_seq;
ALTER TABLE entity_positions
  ALTER COLUMN position_id SET DEFAULT nextval('entity_positions_position_id_seq');
SELECT setval('entity_positions_position_id_seq', COALESCE((SELECT MAX(position_id) FROM entity_positions), 0) + 1, false);

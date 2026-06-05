-- Migration 018: add conflict_modifier to z_properties
-- Makes height-advantage damage data-driven instead of hardcoded.

ALTER TABLE z_properties
  ADD COLUMN IF NOT EXISTS conflict_modifier NUMERIC NOT NULL DEFAULT 0;

-- Seed values: ground = 0, each air layer adds 0.5, void = 1.5
-- Water layers: negative modifier (disadvantage from below)
UPDATE z_properties SET conflict_modifier =  0.0 WHERE z_layer = 0;
UPDATE z_properties SET conflict_modifier = -0.5 WHERE z_layer = -1;
UPDATE z_properties SET conflict_modifier = -1.0 WHERE z_layer = -2;
UPDATE z_properties SET conflict_modifier = -1.5 WHERE z_layer = -3;
UPDATE z_properties SET conflict_modifier =  0.5 WHERE z_layer = 1;
UPDATE z_properties SET conflict_modifier =  1.0 WHERE z_layer = 2;
UPDATE z_properties SET conflict_modifier =  1.5 WHERE z_layer = 3;

COMMENT ON COLUMN z_properties.conflict_modifier IS
  'Bonus/penalty added to introduce_conflict damage when actor is at this z_layer. Positive = advantage (height), negative = disadvantage (submerged).';

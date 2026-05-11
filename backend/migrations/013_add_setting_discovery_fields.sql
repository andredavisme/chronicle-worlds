-- =============================================================
-- Migration 013 — Add Setting Discovery Fields
-- Chronicle Worlds
-- Applied to Supabase during Milestone 12 (World Discovery System).
-- Synced to repo 2026-05-11.
-- Note: Applied as 'add_setting_discovery_fields' in Supabase.
-- =============================================================

-- max_cells: upper bound on grid cells a setting can own.
-- When a setting is full, discover-cell assigns new cells
-- to the next setting in cycle_order.
ALTER TABLE public.settings
  ADD COLUMN IF NOT EXISTS max_cells INTEGER DEFAULT 49;

-- cycle_order: determines which setting gets new cells next
-- when the current setting is full. NULL = no successor
-- (triggers dynamic setting spawn).
ALTER TABLE public.settings
  ADD COLUMN IF NOT EXISTS cycle_order INTEGER DEFAULT NULL;

-- =============================================================
-- Migration 012 — Public Read: Entity Positions, Grid Cells, Players
-- Chronicle Worlds
-- Applied to Supabase during Milestone 11 (Travel Action).
-- Synced to repo 2026-05-11.
-- =============================================================

-- Allow anonymous/public SELECT on entity_positions
-- so the frontend grid renderer can show all entity locations.
CREATE POLICY "Public read entity_positions"
  ON public.entity_positions
  FOR SELECT
  USING (true);

-- Allow anonymous/public SELECT on grid_cells
-- so the frontend can render the full grid without auth.
CREATE POLICY "Public read grid_cells"
  ON public.grid_cells
  FOR SELECT
  USING (true);

-- Allow anonymous/public SELECT on players
-- so the frontend can resolve player → character mappings.
CREATE POLICY "Public read players"
  ON public.players
  FOR SELECT
  USING (true);

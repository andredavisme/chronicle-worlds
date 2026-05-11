-- =============================================================
-- Migration 011 — Public Read: World Tick State + Settings
-- Chronicle Worlds
-- Applied to Supabase during Milestone 11 (Travel Action).
-- Synced to repo 2026-05-11.
-- =============================================================

-- Allow anonymous/public SELECT on world_tick_state
-- so the frontend can read current du/tu without auth.
CREATE POLICY "Public read world_tick_state"
  ON public.world_tick_state
  FOR SELECT
  USING (true);

-- Allow anonymous/public SELECT on settings
-- so the frontend can display setting info without auth.
CREATE POLICY "Public read settings"
  ON public.settings
  FOR SELECT
  USING (true);

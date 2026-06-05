-- =============================================================
-- Migration 015 — Player character creation RLS policies
-- Chronicle Worlds
-- Purpose: Allow authenticated users to insert their own character
--          and position records when creating a new character from
--          the frontend. Previously only service_role could insert
--          into characters and entity_positions.
--
-- Also adds authenticated INSERT on entity_copies so the frontend
-- can seed the root-reality name for a newly created character.
--
-- Depends on: 001 (characters, entity_positions), 008 (RLS enabled
--             on players), 014 (entity_copies RLS)
-- =============================================================

-- ─────────────────────────────────────────────
-- characters
-- ─────────────────────────────────────────────
ALTER TABLE public.characters ENABLE ROW LEVEL SECURITY;

-- Authenticated users may INSERT their own character row.
DROP POLICY IF EXISTS authenticated_insert_characters ON public.characters;
CREATE POLICY authenticated_insert_characters
  ON public.characters
  FOR INSERT
  TO authenticated
  WITH CHECK (true);

-- Authenticated users may SELECT any character row.
DROP POLICY IF EXISTS public_read_characters ON public.characters;
CREATE POLICY public_read_characters
  ON public.characters
  FOR SELECT
  USING (true);

-- Authenticated users may UPDATE only the character they control.
DROP POLICY IF EXISTS authenticated_update_own_character ON public.characters;
CREATE POLICY authenticated_update_own_character
  ON public.characters
  FOR UPDATE
  TO authenticated
  USING (
    character_id IN (
      SELECT controlled_character_id
      FROM public.players
      WHERE player_id = auth.uid()
    )
  );

-- ─────────────────────────────────────────────
-- entity_positions
-- ─────────────────────────────────────────────
ALTER TABLE public.entity_positions ENABLE ROW LEVEL SECURITY;

-- Public read (grid renderer needs all positions).
DROP POLICY IF EXISTS public_read_entity_positions ON public.entity_positions;
CREATE POLICY public_read_entity_positions
  ON public.entity_positions
  FOR SELECT
  USING (true);

-- Authenticated INSERT covers initial placement at character creation.
DROP POLICY IF EXISTS authenticated_insert_entity_positions ON public.entity_positions;
CREATE POLICY authenticated_insert_entity_positions
  ON public.entity_positions
  FOR INSERT
  TO authenticated
  WITH CHECK (true);

-- ─────────────────────────────────────────────
-- entity_copies — extend to allow authenticated INSERT
-- ─────────────────────────────────────────────
DROP POLICY IF EXISTS "Service role insert entity_copies" ON public.entity_copies;
CREATE POLICY "Service role or authenticated insert entity_copies"
  ON public.entity_copies
  FOR INSERT
  WITH CHECK (
    auth.role() = 'service_role'
    OR auth.uid() IS NOT NULL
  );

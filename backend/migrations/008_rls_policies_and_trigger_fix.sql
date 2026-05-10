-- Migration: 008_rls_policies_and_trigger_fix
-- Purpose: Fix RLS blocking service_role trigger inserts; add player read/update policies.
-- Applied: 2026-05-10

-- Allow service_role to insert characters (needed by trigger functions)
DROP POLICY IF EXISTS service_role_insert_characters ON characters;
CREATE POLICY service_role_insert_characters ON characters
  FOR INSERT
  TO service_role
  WITH CHECK (true);

-- Allow service_role to insert players
DROP POLICY IF EXISTS service_role_insert_players ON players;
CREATE POLICY service_role_insert_players ON players
  FOR INSERT
  TO service_role
  WITH CHECK (true);

-- Allow authenticated users to read their own player row
DROP POLICY IF EXISTS player_read_own ON players;
CREATE POLICY player_read_own ON players
  FOR SELECT
  TO authenticated
  USING (player_id = auth.uid());

-- Allow authenticated users to update their own player row
DROP POLICY IF EXISTS player_update_own ON players;
CREATE POLICY player_update_own ON players
  FOR UPDATE
  TO authenticated
  USING (player_id = auth.uid());

-- Fix provision_player trigger: ensure search_path is set to avoid
-- "relation not found" errors when trigger fires in auth schema context
CREATE OR REPLACE FUNCTION public.provision_player()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.players (player_id, controlled_character_id)
  VALUES (NEW.id, NULL)
  ON CONFLICT (player_id) DO NOTHING;
  RETURN NEW;
END;
$$;

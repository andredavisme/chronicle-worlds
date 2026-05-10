-- Migration: 006_auto_provision_players
-- Purpose: Automatically create a players row for every new auth.users signup.
--          Also backfills existing auth users who have no players row.
-- Applied: 2026-05-10

-- Trigger function: fires AFTER INSERT on auth.users
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

-- Attach trigger to auth.users
DROP TRIGGER IF EXISTS trg_provision_player ON auth.users;
CREATE TRIGGER trg_provision_player
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.provision_player();

-- Backfill: create players rows for all existing auth users
INSERT INTO public.players (player_id, controlled_character_id)
SELECT id, NULL
FROM auth.users
ON CONFLICT (player_id) DO NOTHING;

-- 002_multiplayer_extensions.sql
-- Chronicle Worlds: Player identity, turn mechanics, time-travel branching, RLS
-- Depends on: 001_core_schema.sql

-- ─────────────────────────────────────────────
-- PLAYERS
-- ─────────────────────────────────────────────
CREATE TABLE players (
  player_id              UUID    PRIMARY KEY DEFAULT gen_random_uuid(),
  controlled_character_id INTEGER REFERENCES characters(character_id)
);

-- ─────────────────────────────────────────────
-- BRANCHES (time-travel forks)
-- branch_id = 0 is root/main timeline
-- Max 3 forks per lineage — enforced at Edge Function layer, not DB
-- ─────────────────────────────────────────────
CREATE TABLE branches (
  branch_id        SERIAL  PRIMARY KEY,
  fork_timestamp   REAL    NOT NULL,
  player_id        UUID    REFERENCES players(player_id),
  parent_branch_id INTEGER DEFAULT 0
);

-- ─────────────────────────────────────────────
-- PLAYER CHRONICLE ACCESS
-- Maps which chronicle entries each player can see
-- ─────────────────────────────────────────────
CREATE TABLE player_chronicle_access (
  player_id    UUID REFERENCES players(player_id),
  chronicle_id INTEGER REFERENCES chronicle(chronicle_id),
  access_level TEXT DEFAULT 'view'
);

-- ─────────────────────────────────────────────
-- EXTEND CHRONICLE for multiplayer
-- ─────────────────────────────────────────────
ALTER TABLE chronicle
  ADD COLUMN player_id        UUID REFERENCES players(player_id),
  ADD COLUMN branch_id        INTEGER DEFAULT 0,
  ADD COLUMN turn_number      INTEGER,
  ADD COLUMN submit_timestamp REAL,
  ADD COLUMN resolution_order INTEGER;

-- ─────────────────────────────────────────────
-- EXTEND EVENTS for multiplayer
-- ─────────────────────────────────────────────
ALTER TABLE events
  ADD COLUMN turn_number      INTEGER,
  ADD COLUMN submit_timestamp REAL;

-- ─────────────────────────────────────────────
-- RLS: Players see only their own chronicle rows
-- ─────────────────────────────────────────────
ALTER TABLE chronicle ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Player chronicle view"
  ON chronicle
  FOR SELECT
  USING (player_id = auth.uid());

-- ─────────────────────────────────────────────
-- TRIGGER: Auto-increment turn_number per player
-- ─────────────────────────────────────────────
CREATE OR REPLACE FUNCTION advance_turn()
RETURNS TRIGGER AS $$
BEGIN
  NEW.turn_number := COALESCE(
    (SELECT MAX(turn_number) FROM chronicle WHERE player_id = NEW.player_id),
    0
  ) + 1;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_turn_number
  BEFORE INSERT ON chronicle
  FOR EACH ROW EXECUTE FUNCTION advance_turn();

-- ─────────────────────────────────────────────
-- VIEW: turn_queue — race resolution queue
-- Ranks pending turns by submit_timestamp ASC per turn_number
-- NOTE: resolution_state lives on events, not chronicle — join is intentional
-- ─────────────────────────────────────────────
CREATE VIEW turn_queue AS
SELECT
  c.*,
  ROW_NUMBER() OVER (
    PARTITION BY c.turn_number
    ORDER BY e.submit_timestamp ASC, c.player_id ASC
  ) AS queue_pos
FROM chronicle c
JOIN events e ON e.event_id = c.event_id
WHERE e.resolution_state = 'pending';

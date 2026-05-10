-- 003_developer_proposals.sql
-- Depends on: 001_core_schema.sql, 002_multiplayer_extensions.sql
-- Used by: proposal-form frontend, submit-proposal edge function

-- ─────────────────────────────────────────────
-- INVITE LINKS (for future auth-gated access)
-- ─────────────────────────────────────────────
CREATE TABLE proposal_invites (
  invite_id     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  token         TEXT UNIQUE NOT NULL DEFAULT encode(gen_random_bytes(24), 'hex'),
  project_slug  TEXT NOT NULL DEFAULT 'chronicle-worlds',
  description   TEXT,                        -- project pitch shown on auth screen
  created_at    TIMESTAMPTZ DEFAULT now(),
  expires_at    TIMESTAMPTZ,                 -- NULL = no expiry
  max_uses      INT DEFAULT NULL,            -- NULL = unlimited
  use_count     INT DEFAULT 0,
  is_active     BOOLEAN DEFAULT true
);

-- ─────────────────────────────────────────────
-- PROPOSAL SUBMISSIONS
-- ─────────────────────────────────────────────
CREATE TABLE developer_proposals (
  proposal_id     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  invite_id       UUID REFERENCES proposal_invites(invite_id), -- NULL during open phase
  submitted_at    TIMESTAMPTZ DEFAULT now(),

  -- Developer info
  dev_name        TEXT NOT NULL,
  dev_email       TEXT NOT NULL,
  dev_role        TEXT NOT NULL,
  dev_portfolio   TEXT,

  -- Proposal response
  status          TEXT NOT NULL CHECK (status IN ('accept', 'counter', 'decline')),

  -- Scope (array of selected scope keys)
  scope           TEXT[] NOT NULL DEFAULT '{}',

  -- Estimate
  est_weeks       TEXT NOT NULL,
  est_cost        TEXT NOT NULL,
  availability    TEXT NOT NULL,

  -- Flagged concerns
  concerns        TEXT[] DEFAULT '{}',

  -- Comments
  comments        TEXT NOT NULL,
  internal_notes  TEXT,

  -- Review tracking (owner use)
  reviewed        BOOLEAN DEFAULT false,
  reviewer_notes  TEXT,
  reviewed_at     TIMESTAMPTZ
);

-- ─────────────────────────────────────────────
-- RLS POLICIES
-- ─────────────────────────────────────────────

-- Phase 1: Public submissions (no auth required)
ALTER TABLE developer_proposals ENABLE ROW LEVEL SECURITY;

CREATE POLICY "public_insert_proposals"
  ON developer_proposals
  FOR INSERT
  WITH CHECK (true);  -- open during initial deployment

-- Only authenticated owners can read/update proposals
CREATE POLICY "owner_read_proposals"
  ON developer_proposals
  FOR SELECT
  USING (auth.role() = 'authenticated');

CREATE POLICY "owner_update_proposals"
  ON developer_proposals
  FOR UPDATE
  USING (auth.role() = 'authenticated');

-- Invite table: authenticated owner management
ALTER TABLE proposal_invites ENABLE ROW LEVEL SECURITY;

CREATE POLICY "owner_manage_invites"
  ON proposal_invites
  FOR ALL
  USING (auth.role() = 'authenticated');

-- Public read for token validation on gate screen
CREATE POLICY "public_read_invites_by_token"
  ON proposal_invites
  FOR SELECT
  USING (true);

-- ─────────────────────────────────────────────
-- INVITE USE COUNTER TRIGGER
-- Auto-increments use_count on each submission
-- ─────────────────────────────────────────────
CREATE OR REPLACE FUNCTION increment_invite_use()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.invite_id IS NOT NULL THEN
    UPDATE proposal_invites
    SET use_count = use_count + 1
    WHERE invite_id = NEW.invite_id;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_invite_use
AFTER INSERT ON developer_proposals
FOR EACH ROW EXECUTE FUNCTION increment_invite_use();

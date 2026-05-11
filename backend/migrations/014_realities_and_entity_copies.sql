-- =============================================================
-- Migration 014 — Realities + Entity Copies
-- Chronicle Worlds
-- Applied to Supabase during Milestone 13a (Truth/Reality Schema).
-- Synced to repo 2026-05-11.
-- =============================================================
-- Establishes the Truth / Reality architecture:
--   - Truth schema (characters, settings, materials, etc.) = canonical, inert
--   - Realities = named world instances that interpret truth entities
--   - Entity copies = per-reality interpretations with name, description, local_attributes
-- =============================================================

-- ─────────────────────────────────────────────
-- Realities table
-- World-instance axis (orthogonal to branch time axis)
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.realities (
  reality_id        SERIAL PRIMARY KEY,
  name              TEXT NOT NULL,
  parent_reality_id INTEGER REFERENCES public.realities(reality_id) DEFAULT NULL,
  created_at        REAL NOT NULL DEFAULT EXTRACT(EPOCH FROM NOW())
);

-- ─────────────────────────────────────────────
-- Entity copies table
-- One copy per truth entity per reality.
-- local_attributes JSONB delta diverges independently from truth.
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.entity_copies (
  copy_id              SERIAL PRIMARY KEY,
  reality_id           INTEGER NOT NULL REFERENCES public.realities(reality_id),
  truth_entity_type    TEXT NOT NULL CHECK (truth_entity_type IN (
                         'character', 'material', 'setting',
                         'physical_environment', 'event'
                       )),
  truth_entity_id      INTEGER NOT NULL,
  name                 TEXT,
  description          TEXT,
  local_attributes     JSONB NOT NULL DEFAULT '{}',
  created_at           REAL NOT NULL DEFAULT EXTRACT(EPOCH FROM NOW()),
  UNIQUE (reality_id, truth_entity_type, truth_entity_id)
);

-- ─────────────────────────────────────────────
-- Indexes
-- ─────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_entity_copies_reality_id
  ON public.entity_copies (reality_id);

CREATE INDEX IF NOT EXISTS idx_entity_copies_truth_entity
  ON public.entity_copies (truth_entity_type, truth_entity_id);

CREATE INDEX IF NOT EXISTS idx_entity_copies_reality_type
  ON public.entity_copies (reality_id, truth_entity_type);

-- ─────────────────────────────────────────────
-- RLS
-- ─────────────────────────────────────────────
ALTER TABLE public.realities ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.entity_copies ENABLE ROW LEVEL SECURITY;

-- Public SELECT (frontend reads names/descriptions without auth)
CREATE POLICY "Public read realities"
  ON public.realities FOR SELECT USING (true);

CREATE POLICY "Public read entity_copies"
  ON public.entity_copies FOR SELECT USING (true);

-- Service role INSERT/UPDATE (Edge Functions write copies)
CREATE POLICY "Service role insert realities"
  ON public.realities FOR INSERT
  WITH CHECK (auth.role() = 'service_role');

CREATE POLICY "Service role update realities"
  ON public.realities FOR UPDATE
  USING (auth.role() = 'service_role');

CREATE POLICY "Service role insert entity_copies"
  ON public.entity_copies FOR INSERT
  WITH CHECK (auth.role() = 'service_role');

CREATE POLICY "Service role update entity_copies"
  ON public.entity_copies FOR UPDATE
  USING (auth.role() = 'service_role');

-- ─────────────────────────────────────────────
-- Seed root reality
-- ─────────────────────────────────────────────
INSERT INTO public.realities (reality_id, name, parent_reality_id)
VALUES (1, 'Root', NULL)
ON CONFLICT (reality_id) DO NOTHING;

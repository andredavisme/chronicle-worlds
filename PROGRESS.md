# Chronicle Worlds — Progress Log

This document tracks milestones, decisions, and status updates as development progresses. Updated as work is completed, reviewed, and noted.

---

## Project Overview

**Chronicle Worlds** is a turn-based, multiplayer, procedural world simulation hosted entirely on Supabase, GitHub, and GitHub Pages. Players control characters on a shared 3D grid, issuing one of five actions per turn simultaneously, with time as the core resource.

**Stack:** Supabase (PostgreSQL + Edge Functions + Auth + Realtime) · GitHub (migrations, versioning, CI/CD) · GitHub Pages (Vite + JS frontend)

---

## Milestone Log

### ✅ Milestone 1 — Database Schema: Core Tables
**Date:** 2026-05-10  
**Status:** Complete  
**Migration:** `001_core_schema`  
**Project:** andredavisme's Project (Supabase)

**Tables created:**
- `settings` — world settings with 3D origin coordinates and time tracking
- `grid_cells` — individual 3D grid positions linked to settings
- `characters` — player-controlled entities with stat attributes (health, attack, defense, wealth, inspiration, size)
- `physical_environments` — environment state per setting (temperature, density, hydration, population)
- `events` — game actions logged with timestamps, type, duration, and resolution state
- `materials` — in-world items with durability, source, and implementation
- `entity_positions` — tracks where any entity is on the grid over time
- `chronicle` — master event log linking all entities, timestamped and sequenced
- `attribute_modifiers` — dynamic stat modifiers applied by events to any entity
- `relationship_effects` — relational outcomes between entities driven by events

**Notes:**
- All integer PKs; `chronicle` is the central join table referencing all entity types
- `events.resolution_state` defaults to `'pending'`; drives game loop logic

---

### ✅ Milestone 2 — Database Schema: Multiplayer Extensions
**Date:** 2026-05-10  
**Status:** Complete  
**Migration:** `002_multiplayer_extensions`  
**Project:** andredavisme's Project (Supabase)

**Tables created:**
- `players` — UUID-identified players, each linked to a `controlled_character_id`
- `branches` — time-travel fork tracking; each branch has a `parent_branch_id` (max 3 forks per lineage enforced at query level)
- `player_chronicle_access` — maps player visibility into chronicle slices with an `access_level`

**Columns added:**
- `chronicle`: `player_id`, `branch_id`, `turn_number`, `submit_timestamp`, `resolution_order`
- `events`: `turn_number`, `submit_timestamp`

**Security:**
- Row Level Security (RLS) enabled on `chronicle`
- Policy `"Player chronicle view"`: players can only `SELECT` their own chronicle rows (`player_id = auth.uid()`)

**Trigger:**
- `advance_turn()` — fires `BEFORE INSERT` on `chronicle`; auto-increments `turn_number` per player

**View:**
- `turn_queue` — joins `chronicle` → `events` filtered by `resolution_state = 'pending'`; ranks rows by `submit_timestamp` ASC within each `turn_number` to resolve race conditions

**Notes:**
- `turn_queue` view intentionally reads `resolution_state` from `events` (not `chronicle`) — this is where action state lives
- Branch fork limit check: `SELECT COUNT(*) FROM branches WHERE parent_branch_id = X` before allowing any backward time-travel insert

---

## Up Next

- [ ] Milestone 3 — Backend: Edge Function `/functions/resolve-turn`
- [ ] Milestone 4 — Frontend: GitHub Pages scaffold (Vite + canvas grid + Supabase client)
- [ ] Milestone 5 — Realtime: Turn subscription + cooldown timer
- [ ] Milestone 6 — Chronicle panel: Player-filtered event display
- [ ] Milestone 7 — Testing: Multiplayer load tests, branch limits, causality edge cases
- [ ] Milestone 8 — Polish: README, mobile responsiveness, deploy pipeline

---

## Reference

- Developer Handoff: Chronicle Worlds Full Development Pitch & Technical Specification
- Supabase Project: andredavisme's Project
- Inspired by: [andredavisme/the-world](https://github.com/andredavisme/the-world)

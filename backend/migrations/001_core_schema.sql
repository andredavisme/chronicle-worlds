-- 001_core_schema.sql
-- Chronicle Worlds: Core world simulation tables
-- No auth or player identity — pure game entity layer

CREATE TABLE settings (
  setting_id   INTEGER PRIMARY KEY,
  time_unit    INTEGER NOT NULL DEFAULT 0,
  origin_x     INTEGER NOT NULL,
  origin_y     INTEGER NOT NULL,
  origin_z     INTEGER NOT NULL,
  inspiration  TEXT
);

CREATE TABLE grid_cells (
  grid_cell_id    INTEGER PRIMARY KEY,
  setting_id      INTEGER NOT NULL REFERENCES settings(setting_id),
  x               INTEGER NOT NULL,
  y               INTEGER NOT NULL,
  z               INTEGER NOT NULL,
  capacity_units  INTEGER NOT NULL DEFAULT 1,
  expansion_state TEXT NOT NULL DEFAULT 'active'
);

CREATE TABLE characters (
  character_id  INTEGER PRIMARY KEY,
  age           INTEGER NOT NULL DEFAULT 0,
  health        INTEGER NOT NULL DEFAULT 0,
  defense       INTEGER NOT NULL DEFAULT 0,
  attack        INTEGER NOT NULL DEFAULT 0,
  material      INTEGER NOT NULL DEFAULT 0,
  wealth        INTEGER NOT NULL DEFAULT 0,
  inspiration   INTEGER NOT NULL DEFAULT 0,
  size          REAL    NOT NULL DEFAULT 1.0
);

CREATE TABLE physical_environments (
  environment_id  INTEGER PRIMARY KEY,
  setting_id      INTEGER NOT NULL REFERENCES settings(setting_id),
  age             INTEGER NOT NULL DEFAULT 0,
  temperature     REAL    NOT NULL DEFAULT 0,
  density         REAL    NOT NULL DEFAULT 0,
  population      INTEGER NOT NULL DEFAULT 0,
  hydration       REAL    NOT NULL DEFAULT 0,
  grid_cell_id    INTEGER REFERENCES grid_cells(grid_cell_id)
);

CREATE TABLE materials (
  material_id    INTEGER PRIMARY KEY,
  source         TEXT,
  age            INTEGER NOT NULL DEFAULT 0,
  durability     REAL    NOT NULL DEFAULT 0,
  implementation TEXT,
  inspiration    TEXT
);

CREATE TABLE events (
  event_id         INTEGER PRIMARY KEY,
  setting_id       INTEGER REFERENCES settings(setting_id),
  age              INTEGER NOT NULL DEFAULT 0,
  duration_units   INTEGER NOT NULL DEFAULT 0,
  start_timestamp  REAL    NOT NULL,
  end_timestamp    REAL,
  event_type       TEXT,
  details          TEXT,
  inspiration      TEXT,
  sequence_index   INTEGER NOT NULL DEFAULT 0,
  resolution_state TEXT    NOT NULL DEFAULT 'pending'
);

CREATE TABLE entity_positions (
  position_id     INTEGER PRIMARY KEY,
  entity_type     TEXT    NOT NULL,
  entity_id       INTEGER NOT NULL,
  grid_cell_id    INTEGER NOT NULL REFERENCES grid_cells(grid_cell_id),
  effective_size  REAL    NOT NULL DEFAULT 1.0,
  occupied_units  INTEGER NOT NULL DEFAULT 1,
  timestamp_start REAL    NOT NULL,
  timestamp_end   REAL
);

CREATE TABLE chronicle (
  chronicle_id   INTEGER PRIMARY KEY,
  timestamp      REAL    NOT NULL,
  sequence_index INTEGER NOT NULL DEFAULT 0,
  character_id   INTEGER REFERENCES characters(character_id),
  setting_id     INTEGER REFERENCES settings(setting_id),
  environment_id INTEGER REFERENCES physical_environments(environment_id),
  event_id       INTEGER REFERENCES events(event_id),
  material_id    INTEGER REFERENCES materials(material_id),
  grid_cell_id   INTEGER REFERENCES grid_cells(grid_cell_id),
  details_json   TEXT    NOT NULL
);

CREATE TABLE attribute_modifiers (
  modifier_id        INTEGER PRIMARY KEY,
  source_entity_type TEXT    NOT NULL,
  source_entity_id   INTEGER NOT NULL,
  target_entity_type TEXT    NOT NULL,
  target_entity_id   INTEGER NOT NULL,
  target_attribute   TEXT    NOT NULL,
  operator           TEXT    NOT NULL,
  value              REAL    NOT NULL,
  priority           INTEGER NOT NULL DEFAULT 0,
  start_timestamp    REAL    NOT NULL,
  end_timestamp      REAL
);

CREATE TABLE relationship_effects (
  relationship_id   INTEGER PRIMARY KEY,
  relationship_type TEXT    NOT NULL,
  source_entity_type TEXT   NOT NULL,
  source_entity_id  INTEGER NOT NULL,
  target_entity_type TEXT   NOT NULL,
  target_entity_id  INTEGER NOT NULL,
  effect_json       TEXT    NOT NULL,
  start_timestamp   REAL    NOT NULL,
  end_timestamp     REAL
);

-- Default.db 元库 Schema — Need04
PRAGMA journal_mode=WAL;
PRAGMA foreign_keys=ON;

CREATE TABLE IF NOT EXISTS db_registry (
    id               TEXT PRIMARY KEY,
    path             TEXT NOT NULL UNIQUE COLLATE NOCASE,
    alias            TEXT NOT NULL UNIQUE COLLATE NOCASE,
    remark           TEXT,
    status           TEXT NOT NULL DEFAULT 'available' CHECK (status IN ('available','missing')),
    created_at       INTEGER NOT NULL,
    last_opened_at   INTEGER,
    dim_count        INTEGER NOT NULL DEFAULT 0,
    module_count     INTEGER NOT NULL DEFAULT 0,
    favorite_count   INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_registry_status ON db_registry(status);
CREATE INDEX IF NOT EXISTS idx_registry_last_opened ON db_registry(last_opened_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS idx_registry_path_norm ON db_registry(path COLLATE NOCASE);

CREATE TABLE IF NOT EXISTS app_settings (
    k TEXT PRIMARY KEY,
    v TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS temp_carry (
    id           TEXT PRIMARY KEY,
    payload_json TEXT NOT NULL,
    updated_at   INTEGER NOT NULL
);

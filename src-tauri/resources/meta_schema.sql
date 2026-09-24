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
 CREATE TABLE IF NOT EXISTS generation_ledger (
   id          TEXT PRIMARY KEY,
   task_id     TEXT NOT NULL UNIQUE,
   source      TEXT NOT NULL DEFAULT 'queue' CHECK (source IN ('queue','single')),
   status      TEXT NOT NULL CHECK (status IN ('succeeded','failed','cancelled')),
   elapsed_ms  INTEGER NOT NULL DEFAULT 0,
   size        TEXT NOT NULL DEFAULT '1K',
   ratio       TEXT NOT NULL DEFAULT '1:1',
   pixels      INTEGER NOT NULL DEFAULT 0,
   filename    TEXT,
   prompt_hash TEXT,
   created_at  INTEGER NOT NULL,
   finished_at INTEGER NOT NULL
 );
 CREATE INDEX IF NOT EXISTS idx_ledger_finished ON generation_ledger(finished_at);
 CREATE INDEX IF NOT EXISTS idx_ledger_status ON generation_ledger(status);
 CREATE INDEX IF NOT EXISTS idx_ledger_source ON generation_ledger(source);

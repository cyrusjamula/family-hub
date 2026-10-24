-- Additive, restricted diagnostics. No chat, identities or payload columns.
CREATE TABLE IF NOT EXISTS diagnostics (
 id TEXT PRIMARY KEY,
 created INTEGER NOT NULL,
 route TEXT NOT NULL,
 method TEXT NOT NULL,
 status INTEGER NOT NULL,
 duration_ms INTEGER NOT NULL,
 category TEXT NOT NULL,
 release TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS diagnostics_created ON diagnostics(created);

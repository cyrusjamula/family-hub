-- Additive, room-scoped task intake. No external actions or notification triggers.
CREATE TABLE IF NOT EXISTS tasks(
 id TEXT PRIMARY KEY,
 room TEXT NOT NULL CHECK(room IN ('family','parents')),
 creator_id TEXT NOT NULL,
 assignee_id TEXT NOT NULL,
 assistant TEXT NOT NULL,
 title TEXT NOT NULL,
 details TEXT NOT NULL,
 source TEXT NOT NULL DEFAULT 'hub',
 provenance TEXT NOT NULL,
 approval_required INTEGER NOT NULL CHECK(approval_required IN (0,1)),
 approval TEXT NOT NULL DEFAULT 'not_required' CHECK(approval IN ('not_required','requested','approved','rejected')),
 status TEXT NOT NULL DEFAULT 'todo' CHECK(status IN ('todo','working','done','cancelled')),
 version INTEGER NOT NULL DEFAULT 1,
 created TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 updated TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 result_note TEXT NOT NULL DEFAULT '',
 updated_by TEXT,
 decided_by TEXT
);
CREATE INDEX IF NOT EXISTS tasks_room_created ON tasks(room,created,id);

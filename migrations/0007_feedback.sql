-- Additive. No GitHub calls or changes to existing Hub records.
CREATE TABLE IF NOT EXISTS feedback (
 id TEXT PRIMARY KEY,
 reporter TEXT NOT NULL,
 reporter_id TEXT NOT NULL,
 payload TEXT NOT NULL,
 screenshot TEXT,
 digest TEXT NOT NULL,
 state TEXT NOT NULL DEFAULT 'pending' CHECK(state IN ('pending','publishing','published','uncertain','rejected')),
 public_payload TEXT,
 issue_url TEXT,
 created TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS feedback_reporter_created ON feedback(reporter,created);

-- Review-only schema, not a production migration. No binding is created here.
-- Retain consumed handles across restarts and uncertain provider outcomes.
CREATE TABLE mcp_consent_claims (
 handle_digest TEXT PRIMARY KEY CHECK(length(handle_digest)=64),
 member_id TEXT NOT NULL,
 client_id TEXT NOT NULL,
 decision TEXT NOT NULL CHECK(decision IN ('allow','deny')),
 state TEXT NOT NULL CHECK(state='consumed'),
 expires_at INTEGER NOT NULL
);

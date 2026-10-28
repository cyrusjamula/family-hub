-- Review-only schema for local synthetic tests. This is not a production migration.
-- Grants apply to one client, member and exact task version. Owner consent is
-- required even where an authenticated member may otherwise see the task.
CREATE TABLE mcp_task_read_grants (
 id TEXT PRIMARY KEY,
 task_id TEXT NOT NULL,
 task_version INTEGER NOT NULL CHECK(task_version > 0),
 member_id TEXT NOT NULL,
 client_id TEXT NOT NULL,
 approved_by TEXT NOT NULL,
 expires_at INTEGER NOT NULL,
 revoked INTEGER NOT NULL DEFAULT 0 CHECK(revoked IN (0,1))
);
CREATE INDEX mcp_task_read_grants_lookup ON mcp_task_read_grants(task_id,task_version,member_id,client_id,revoked,expires_at);
CREATE UNIQUE INDEX mcp_task_read_grants_one_active ON mcp_task_read_grants(task_id,task_version,member_id,client_id) WHERE revoked=0;

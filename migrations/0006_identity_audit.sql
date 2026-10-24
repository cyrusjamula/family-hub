-- Additive and safe to reapply. Existing owners/ciphertexts are not rewritten.
-- Authenticated mutation attempts only, not action success or room content.
CREATE TABLE IF NOT EXISTS identity_audit (
 id TEXT PRIMARY KEY,
 member_id TEXT NOT NULL,
 sign_in_email TEXT NOT NULL,
 route TEXT NOT NULL,
 method TEXT NOT NULL,
 created TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS identity_audit_member_created ON identity_audit(member_id,created);

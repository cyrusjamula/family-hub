-- Review-only schema: not included in deployed migrations or applied automatically.
-- One row is the global serialization point for this repository's factory.
CREATE TABLE IF NOT EXISTS factory_claim_slot (
  singleton INTEGER PRIMARY KEY CHECK(singleton = 1),
  paused INTEGER NOT NULL DEFAULT 1 CHECK(paused IN (0, 1)),
  operation_id TEXT,
  scope_digest TEXT,
  state TEXT NOT NULL DEFAULT 'idle' CHECK(state IN ('idle', 'claimed', 'uncertain')),
  CHECK((state = 'idle' AND operation_id IS NULL AND scope_digest IS NULL)
    OR (state <> 'idle' AND operation_id IS NOT NULL AND scope_digest IS NOT NULL))
);
INSERT OR IGNORE INTO factory_claim_slot(singleton) VALUES (1);

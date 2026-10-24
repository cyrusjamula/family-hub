CREATE TABLE IF NOT EXISTS reminders(id TEXT PRIMARY KEY,owner TEXT NOT NULL,room TEXT NOT NULL CHECK(room IN ('family','parents')),content TEXT NOT NULL,due INTEGER NOT NULL,state TEXT NOT NULL DEFAULT 'pending' CHECK(state IN ('pending','delivered','cancelled')),created TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE INDEX IF NOT EXISTS reminders_due ON reminders(state,due);

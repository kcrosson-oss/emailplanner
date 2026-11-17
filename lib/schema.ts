// Tables are created automatically on startup (safe to run repeatedly).
export const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS people (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT UNIQUE,
  role TEXT NOT NULL DEFAULT 'member',
  is_admin BOOLEAN NOT NULL DEFAULT FALSE,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS emails (
  id SERIAL PRIMARY KEY,
  title TEXT NOT NULL,
  send_date TEXT NOT NULL,
  send_time TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS versions (
  id SERIAL PRIMARY KEY,
  email_id INTEGER NOT NULL REFERENCES emails(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  audience TEXT NOT NULL DEFAULT '',
  exclusions TEXT NOT NULL DEFAULT '',
  subject TEXT NOT NULL DEFAULT '',
  preheader TEXT NOT NULL DEFAULT '',
  links JSONB NOT NULL DEFAULT '[]',
  preview_url TEXT NOT NULL DEFAULT '',
  notes TEXT NOT NULL DEFAULT '',
  owner_id INTEGER REFERENCES people(id) ON DELETE SET NULL,
  sort_order INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS steps (
  id SERIAL PRIMARY KEY,
  version_id INTEGER NOT NULL REFERENCES versions(id) ON DELETE CASCADE,
  key TEXT NOT NULL,
  assignee_id INTEGER REFERENCES people(id) ON DELETE SET NULL,
  due_date TEXT NOT NULL,
  due_time TEXT,
  due_overridden BOOLEAN NOT NULL DEFAULT FALSE,
  completed_by_id INTEGER REFERENCES people(id) ON DELETE SET NULL,
  completed_at TIMESTAMPTZ,
  changes_requested BOOLEAN NOT NULL DEFAULT FALSE,
  changes_note TEXT,
  UNIQUE (version_id, key)
);
CREATE TABLE IF NOT EXISTS activity (
  id SERIAL PRIMARY KEY,
  email_id INTEGER NOT NULL REFERENCES emails(id) ON DELETE CASCADE,
  version_id INTEGER REFERENCES versions(id) ON DELETE SET NULL,
  person_id INTEGER REFERENCES people(id) ON DELETE SET NULL,
  kind TEXT NOT NULL,
  message TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE emails ADD COLUMN IF NOT EXISTS is_launch BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE versions ADD COLUMN IF NOT EXISTS city TEXT NOT NULL DEFAULT '';
CREATE TABLE IF NOT EXISTS launch_delays (
  id SERIAL PRIMARY KEY,
  city TEXT NOT NULL,
  old_launch_date TEXT NOT NULL,
  new_launch_date TEXT NOT NULL,
  reason TEXT NOT NULL DEFAULT '',
  reported_by_id INTEGER REFERENCES people(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS reschedule_suggestions (
  id SERIAL PRIMARY KEY,
  delay_id INTEGER NOT NULL REFERENCES launch_delays(id) ON DELETE CASCADE,
  email_id INTEGER REFERENCES emails(id) ON DELETE SET NULL,
  email_title TEXT NOT NULL,
  version_ids JSONB NOT NULL DEFAULT '[]',
  version_names JSONB NOT NULL DEFAULT '[]',
  current_send_date TEXT NOT NULL,
  suggested_date TEXT NOT NULL,
  moved_off_weekend BOOLEAN NOT NULL DEFAULT FALSE,
  plan TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  final_date TEXT,
  decided_by_id INTEGER REFERENCES people(id) ON DELETE SET NULL,
  decided_at TIMESTAMPTZ,
  note TEXT
);
CREATE INDEX IF NOT EXISTS activity_email_idx ON activity(email_id, created_at DESC);
`;

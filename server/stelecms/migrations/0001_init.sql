-- Stele CMS – Grundschema (SPEC §4)

CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);

CREATE TABLE roles (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL UNIQUE COLLATE NOCASE,
  description TEXT NOT NULL DEFAULT '',
  is_admin INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);

CREATE TABLE role_permissions (
  role_id INTEGER NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  permission TEXT NOT NULL,
  PRIMARY KEY (role_id, permission)
);

CREATE TABLE users (
  id INTEGER PRIMARY KEY,
  username TEXT NOT NULL UNIQUE COLLATE NOCASE,
  display_name TEXT NOT NULL,
  email TEXT NOT NULL DEFAULT '',
  password_hash TEXT NOT NULL,
  role_id INTEGER NOT NULL REFERENCES roles(id),
  is_active INTEGER NOT NULL DEFAULT 1,
  is_demo INTEGER NOT NULL DEFAULT 0,
  must_change_password INTEGER NOT NULL DEFAULT 0,
  failed_logins INTEGER NOT NULL DEFAULT 0,
  locked_until TEXT,
  session_version INTEGER NOT NULL DEFAULT 1,
  last_login_at TEXT,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);

CREATE TABLE contents (
  id INTEGER PRIMARY KEY,
  uid TEXT NOT NULL UNIQUE,
  type TEXT NOT NULL CHECK (type IN ('image','video','pdf','text','web')),
  title TEXT NOT NULL,
  tags TEXT NOT NULL DEFAULT '[]',
  data TEXT NOT NULL DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'ready' CHECK (status IN ('processing','ready','error')),
  status_message TEXT NOT NULL DEFAULT '',
  progress INTEGER,
  file_name TEXT, mime TEXT, size_bytes INTEGER,
  width INTEGER, height INTEGER, duration_s REAL, page_count INTEGER,
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  updated_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);

CREATE TABLE designs (
  id INTEGER PRIMARY KEY, name TEXT NOT NULL, config TEXT NOT NULL,
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  updated_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);

CREATE TABLE touch_menus (
  id INTEGER PRIMARY KEY, name TEXT NOT NULL, config TEXT NOT NULL,
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  updated_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);

CREATE TABLE presentations (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  settings TEXT NOT NULL,
  design_id INTEGER REFERENCES designs(id) ON DELETE SET NULL,
  touch_menu_id INTEGER REFERENCES touch_menus(id) ON DELETE SET NULL,
  published_snapshot TEXT,
  published_source TEXT,
  published_hash TEXT,
  published_at TEXT,
  published_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  review_state TEXT NOT NULL DEFAULT 'none' CHECK (review_state IN ('none','requested','rejected')),
  review_note TEXT NOT NULL DEFAULT '',
  review_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  review_at TEXT,
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  updated_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);

CREATE TABLE presentation_items (
  id INTEGER PRIMARY KEY,
  presentation_id INTEGER NOT NULL REFERENCES presentations(id) ON DELETE CASCADE,
  position INTEGER NOT NULL,
  content_id INTEGER NOT NULL REFERENCES contents(id) ON DELETE RESTRICT,
  enabled INTEGER NOT NULL DEFAULT 1,
  duration_s REAL,
  transition TEXT,
  valid_from TEXT, valid_until TEXT,
  caption TEXT NOT NULL DEFAULT '',
  options TEXT NOT NULL DEFAULT '{}'
);

CREATE TABLE steles (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  location TEXT NOT NULL DEFAULT '',
  ip_address TEXT NOT NULL DEFAULT '',
  width INTEGER NOT NULL DEFAULT 1080,
  height INTEGER NOT NULL DEFAULT 1920,
  player_key TEXT NOT NULL UNIQUE,
  default_presentation_id INTEGER REFERENCES presentations(id) ON DELETE RESTRICT,
  settings TEXT NOT NULL DEFAULT '{}',
  paired_at TEXT,
  last_seen_at TEXT,
  last_state TEXT NOT NULL DEFAULT '{}',
  last_agent_at TEXT,
  last_agent TEXT NOT NULL DEFAULT '{}',
  last_ping_at TEXT, last_ping_ok INTEGER, last_ping_ms REAL,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);

CREATE TABLE schedule_entries (
  id INTEGER PRIMARY KEY,
  stele_id INTEGER NOT NULL REFERENCES steles(id) ON DELETE CASCADE,
  presentation_id INTEGER NOT NULL REFERENCES presentations(id) ON DELETE RESTRICT,
  label TEXT NOT NULL DEFAULT '',
  days TEXT NOT NULL DEFAULT '[1,2,3,4,5,6,7]',
  start_time TEXT NOT NULL,
  end_time TEXT NOT NULL,
  date_from TEXT, date_until TEXT,
  priority INTEGER NOT NULL DEFAULT 0,
  enabled INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);

CREATE TABLE pairing_requests (
  code TEXT PRIMARY KEY,
  device_info TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL, expires_at TEXT NOT NULL,
  stele_id INTEGER REFERENCES steles(id) ON DELETE CASCADE,
  claimed_at TEXT
);

CREATE TABLE stele_commands (
  id INTEGER PRIMARY KEY,
  stele_id INTEGER NOT NULL REFERENCES steles(id) ON DELETE CASCADE,
  command TEXT NOT NULL CHECK (command IN ('reload','identify','screenshot','clear_cache')),
  payload TEXT NOT NULL DEFAULT '{}',
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL, delivered_at TEXT, done_at TEXT, result TEXT NOT NULL DEFAULT ''
);

CREATE TABLE stele_online_segments (
  id INTEGER PRIMARY KEY,
  stele_id INTEGER NOT NULL REFERENCES steles(id) ON DELETE CASCADE,
  start_at TEXT NOT NULL, end_at TEXT NOT NULL
);

CREATE TABLE stele_events (
  id INTEGER PRIMARY KEY,
  stele_id INTEGER NOT NULL REFERENCES steles(id) ON DELETE CASCADE,
  ts TEXT NOT NULL,
  level TEXT NOT NULL CHECK (level IN ('info','warning','error')),
  kind TEXT NOT NULL,
  message TEXT NOT NULL,
  details TEXT NOT NULL DEFAULT '{}'
);

CREATE TABLE stele_metrics (
  stele_id INTEGER NOT NULL REFERENCES steles(id) ON DELETE CASCADE,
  ts TEXT NOT NULL, cpu REAL, ram REAL, disk REAL, temp REAL,
  PRIMARY KEY (stele_id, ts)
);

CREATE TABLE playback_log (
  id INTEGER PRIMARY KEY,
  stele_id INTEGER NOT NULL REFERENCES steles(id) ON DELETE CASCADE,
  started_at TEXT NOT NULL, duration_s REAL,
  presentation_id INTEGER, item_id INTEGER, content_id INTEGER, title TEXT NOT NULL DEFAULT ''
);

CREATE TABLE touch_log (
  id INTEGER PRIMARY KEY,
  stele_id INTEGER NOT NULL REFERENCES steles(id) ON DELETE CASCADE,
  ts TEXT NOT NULL,
  event TEXT NOT NULL CHECK (event IN ('session_start','tile_open','session_end')),
  session_id TEXT NOT NULL DEFAULT '', tile_id TEXT, label TEXT, duration_s REAL
);

CREATE TABLE audit_log (
  id INTEGER PRIMARY KEY,
  ts TEXT NOT NULL,
  user_id INTEGER, username TEXT NOT NULL, user_display TEXT NOT NULL DEFAULT '',
  action TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id INTEGER, entity_name TEXT NOT NULL DEFAULT '',
  summary TEXT NOT NULL,
  details TEXT NOT NULL DEFAULT '{}',
  ip TEXT NOT NULL DEFAULT ''
);

CREATE TABLE jobs (
  id INTEGER PRIMARY KEY,
  kind TEXT NOT NULL,
  content_id INTEGER REFERENCES contents(id) ON DELETE CASCADE,
  status TEXT NOT NULL CHECK (status IN ('queued','running','done','error')),
  progress INTEGER NOT NULL DEFAULT 0, message TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);

CREATE TABLE feed_cache (
  url TEXT PRIMARY KEY, fetched_at TEXT, ok INTEGER NOT NULL DEFAULT 0,
  items TEXT NOT NULL DEFAULT '[]', error TEXT NOT NULL DEFAULT ''
);

-- Indizes
CREATE INDEX idx_audit_ts ON audit_log(ts);
CREATE INDEX idx_audit_user ON audit_log(user_id);
CREATE INDEX idx_playback_stele_ts ON playback_log(stele_id, started_at);
CREATE INDEX idx_touch_stele_ts ON touch_log(stele_id, ts);
CREATE INDEX idx_events_stele_ts ON stele_events(stele_id, ts);
CREATE INDEX idx_items_pres_pos ON presentation_items(presentation_id, position);
CREATE INDEX idx_items_content ON presentation_items(content_id);
CREATE INDEX idx_segments_stele ON stele_online_segments(stele_id, end_at);
CREATE INDEX idx_commands_stele ON stele_commands(stele_id, created_at);
CREATE INDEX idx_schedule_stele ON schedule_entries(stele_id);
CREATE INDEX idx_jobs_status ON jobs(status, id);
CREATE INDEX idx_contents_updated ON contents(updated_at);

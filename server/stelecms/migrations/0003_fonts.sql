-- Hochgeladene Schriften (SPEC §5.5, §7.6): eine Datei je Schrift unter MEDIA_DIR/<uid>/<file_name>.
-- Verweis in Design/Info-Folie per Schlüssel „custom-<id>“; mitgelieferte Schriften stehen nicht in der Tabelle.
CREATE TABLE fonts (
  id INTEGER PRIMARY KEY,
  uid TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  file_name TEXT NOT NULL,
  format TEXT NOT NULL CHECK (format IN ('woff2','woff','ttf','otf')),
  weight INTEGER,                 -- NULL = variable Schrift (alle Stärken), sonst 100..900
  size_bytes INTEGER NOT NULL,
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL
);

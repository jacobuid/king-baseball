CREATE TABLE music_tracks (
  id TEXT PRIMARY KEY,
  owner_user_id TEXT NOT NULL,
  video_id TEXT NOT NULL,
  title TEXT NOT NULL,
  artist TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'queued' CHECK(status IN ('queued','processing','ready','failed')),
  object_key TEXT NOT NULL,
  duration REAL,
  error TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(owner_user_id, video_id)
);
CREATE INDEX music_owner ON music_tracks(owner_user_id, created_at);
-- Separate from roster rows: saving a roster replaces those rows transactionally.
-- Future player clip settings belong separately; team playlist entries play in full.
CREATE TABLE music_assignments (
  owner_user_id TEXT NOT NULL,
  target TEXT NOT NULL,
  tracks_json TEXT NOT NULL DEFAULT '[]',
  PRIMARY KEY(owner_user_id, target)
);
CREATE TABLE music_search_limits (
  owner_user_id TEXT PRIMARY KEY,
  requested_at INTEGER NOT NULL
);

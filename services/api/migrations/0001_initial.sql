CREATE TABLE IF NOT EXISTS profiles (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, name TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE INDEX IF NOT EXISTS profiles_user ON profiles(user_id);
CREATE TABLE IF NOT EXISTS media (id TEXT PRIMARY KEY, title TEXT NOT NULL, description TEXT NOT NULL DEFAULT '', category TEXT NOT NULL DEFAULT 'Movies', video_key TEXT NOT NULL UNIQUE, thumbnail_key TEXT, mime_type TEXT NOT NULL DEFAULT 'video/mp4', created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS progress (profile_id TEXT NOT NULL, media_id TEXT NOT NULL, position_seconds INTEGER NOT NULL DEFAULT 0, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, PRIMARY KEY(profile_id,media_id), FOREIGN KEY(profile_id) REFERENCES profiles(id), FOREIGN KEY(media_id) REFERENCES media(id));
CREATE TABLE IF NOT EXISTS favorites (profile_id TEXT NOT NULL, media_id TEXT NOT NULL, PRIMARY KEY(profile_id,media_id));

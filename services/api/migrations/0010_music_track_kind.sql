ALTER TABLE music_tracks ADD COLUMN kind TEXT NOT NULL DEFAULT 'song' CHECK(kind IN ('song','intro'));
CREATE INDEX music_owner_kind ON music_tracks(owner_user_id, kind, created_at);

-- Retain legacy inline logos until their next successful team save migrates them.
ALTER TABLE teams ADD COLUMN logo_key TEXT;

-- Keep ALTER TABLE compatible with D1's migration engine on populated tables.
-- The API validates six-digit hex colors before every write.
ALTER TABLE teams ADD COLUMN primary_color TEXT NOT NULL DEFAULT '#16845b';

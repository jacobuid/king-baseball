ALTER TABLE teams ADD COLUMN division TEXT CHECK(division IS NULL OR length(division) BETWEEN 1 AND 60);

ALTER TABLE players ADD COLUMN jersey_number TEXT
  CHECK(jersey_number IS NULL OR (length(jersey_number) = 2 AND jersey_number GLOB '[0-9][0-9]'));

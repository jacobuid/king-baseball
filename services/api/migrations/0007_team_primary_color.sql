ALTER TABLE teams ADD COLUMN primary_color TEXT NOT NULL DEFAULT '#16845b'
  CHECK(length(primary_color) = 7 AND primary_color GLOB '#[0-9a-fA-F][0-9a-fA-F][0-9a-fA-F][0-9a-fA-F][0-9a-fA-F][0-9a-fA-F]');

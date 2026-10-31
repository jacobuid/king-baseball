-- Small, resized team badges travel with the team; original uploads are not stored.
ALTER TABLE teams ADD COLUMN logo_data_url TEXT CHECK(logo_data_url IS NULL OR length(logo_data_url) <= 180000);

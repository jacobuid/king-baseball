PRAGMA defer_foreign_keys = true;

CREATE TABLE teams_multi (
  id TEXT PRIMARY KEY,
  owner_user_id TEXT NOT NULL,
  name TEXT NOT NULL CHECK(length(trim(name)) BETWEEN 1 AND 48),
  version INTEGER NOT NULL DEFAULT 1 CHECK(version >= 1),
  mutation_id TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  logo_data_url TEXT,
  division TEXT,
  logo_key TEXT,
  primary_color TEXT NOT NULL DEFAULT '#041c36'
);
INSERT INTO teams_multi SELECT id,owner_user_id,name,version,mutation_id,created_at,updated_at,logo_data_url,division,logo_key,primary_color FROM teams;

CREATE TABLE players_multi (
  team_id TEXT NOT NULL REFERENCES teams_multi(id) ON DELETE CASCADE,
  id TEXT NOT NULL,
  name TEXT NOT NULL CHECK(length(trim(name)) BETWEEN 1 AND 55),
  roster_order INTEGER NOT NULL CHECK(roster_order >= 0),
  jersey_number TEXT CHECK(jersey_number IS NULL OR (length(jersey_number)=2 AND jersey_number GLOB '[0-9][0-9]')),
  PRIMARY KEY(team_id,id), UNIQUE(team_id,roster_order)
);
INSERT INTO players_multi SELECT team_id,id,name,roster_order,jersey_number FROM players;

UPDATE music_assignments SET target = 'team:' || (SELECT id FROM teams WHERE teams.owner_user_id = music_assignments.owner_user_id) WHERE target = 'team';
DROP TABLE players;
DROP TABLE teams;
ALTER TABLE teams_multi RENAME TO teams;
ALTER TABLE players_multi RENAME TO players;
CREATE INDEX teams_owner ON teams(owner_user_id,updated_at DESC);

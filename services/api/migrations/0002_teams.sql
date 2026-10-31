-- The current Team screen manages one team per account.
CREATE TABLE teams (
  id TEXT PRIMARY KEY,
  owner_user_id TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL CHECK(length(trim(name)) BETWEEN 1 AND 48),
  version INTEGER NOT NULL DEFAULT 1 CHECK(version >= 1),
  mutation_id TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE players (
  team_id TEXT NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  id TEXT NOT NULL,
  name TEXT NOT NULL CHECK(length(trim(name)) BETWEEN 1 AND 55),
  roster_order INTEGER NOT NULL CHECK(roster_order >= 0),
  PRIMARY KEY(team_id, id),
  UNIQUE(team_id, roster_order)
);

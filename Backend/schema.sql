-- schema.sql

-- 🧑 Players table
CREATE TABLE IF NOT EXISTS players (
  id INTEGER PRIMARY KEY,
  name TEXT UNIQUE NOT NULL,
  balance INTEGER NOT NULL DEFAULT 1000, -- starting coins
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

-- 🏁 Races table
CREATE TABLE IF NOT EXISTS races (
  id INTEGER PRIMARY KEY,
  track_len INTEGER NOT NULL,
  status TEXT NOT NULL,         -- 'bet' | 'racing' | 'payout' | 'done'
  started_at TEXT,
  finished_at TEXT
);

-- 🐎 Race horses (8 per race, random emojis)
CREATE TABLE IF NOT EXISTS race_horses (
  id INTEGER PRIMARY KEY,
  race_id INTEGER NOT NULL,
  slot INTEGER NOT NULL,        -- 0..7
  emoji TEXT NOT NULL,
  FOREIGN KEY(race_id) REFERENCES races(id)
);

-- 💰 Bets
CREATE TABLE IF NOT EXISTS bets (
  id INTEGER PRIMARY KEY,
  race_id INTEGER NOT NULL,
  player_id INTEGER NOT NULL,
  horse_slot INTEGER NOT NULL,  -- 0..7
  amount INTEGER NOT NULL,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(race_id) REFERENCES races(id),
  FOREIGN KEY(player_id) REFERENCES players(id)
);

-- 🏆 Payouts (audit log of winnings)
CREATE TABLE IF NOT EXISTS payouts (
  id INTEGER PRIMARY KEY,
  race_id INTEGER NOT NULL,
  player_id INTEGER NOT NULL,
  amount INTEGER NOT NULL,      -- credited to player
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(race_id) REFERENCES races(id),
  FOREIGN KEY(player_id) REFERENCES players(id)
);

-- 🎲 Race events (optional log of boosts, slips, etc.)
CREATE TABLE IF NOT EXISTS race_events (
  id INTEGER PRIMARY KEY,
  race_id INTEGER NOT NULL,
  tick INTEGER NOT NULL,        -- frame or ms index
  horse_slot INTEGER NOT NULL,
  label TEXT NOT NULL,          -- "🚀", "🍌", "💨", etc.
  FOREIGN KEY(race_id) REFERENCES races(id)
);

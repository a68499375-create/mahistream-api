-- MahiStream Database Schema for PostgreSQL
-- Jalankan: psql -U mahistream -d mahistream -f schema.sql

CREATE TABLE IF NOT EXISTS anime (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  title_jp TEXT DEFAULT '',
  alt_titles TEXT DEFAULT '',
  poster TEXT DEFAULT '',
  synopsis TEXT DEFAULT '',
  genre TEXT DEFAULT '',
  status TEXT DEFAULT 'ongoing',
  rating REAL DEFAULT 0,
  year INTEGER,
  type TEXT DEFAULT 'TV',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS episodes (
  id SERIAL PRIMARY KEY,
  anime_id TEXT NOT NULL REFERENCES anime(id) ON DELETE CASCADE,
  number INTEGER NOT NULL,
  title TEXT DEFAULT '',
  gdrive_links TEXT DEFAULT '[]',
  duration INTEGER DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS requests (
  id SERIAL PRIMARY KEY,
  title TEXT NOT NULL,
  notes TEXT DEFAULT '',
  user_id TEXT DEFAULT 'anon',
  status TEXT DEFAULT 'pending',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  uid TEXT UNIQUE,
  username TEXT,
  display_name TEXT,
  email TEXT,
  picture TEXT DEFAULT '',
  bio TEXT DEFAULT '',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS history (
  id SERIAL PRIMARY KEY,
  user_id TEXT,
  anime_id TEXT,
  title TEXT DEFAULT '',
  poster_url TEXT DEFAULT '',
  episode TEXT DEFAULT '',
  progress_seconds INTEGER DEFAULT 0,
  duration_seconds INTEGER DEFAULT 0,
  watched_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS bookmarks (
  id SERIAL PRIMARY KEY,
  user_id TEXT,
  anime_id TEXT,
  title TEXT DEFAULT '',
  poster_url TEXT DEFAULT '',
  added_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(user_id, anime_id)
);

CREATE INDEX IF NOT EXISTS idx_anime_title ON anime USING gin(to_tsvector('simple', title));
CREATE INDEX IF NOT EXISTS idx_anime_genre ON anime(genre);
CREATE INDEX IF NOT EXISTS idx_episodes_anime ON episodes(anime_id);
CREATE INDEX IF NOT EXISTS idx_history_user ON history(user_id);
CREATE INDEX IF NOT EXISTS idx_history_anime ON history(anime_id);
CREATE INDEX IF NOT EXISTS idx_bookmarks_user ON bookmarks(user_id);
CREATE INDEX IF NOT EXISTS idx_requests_user ON requests(user_id);

-- Bytesized Arcade: Song Sleuth Database Schema
-- Run this in the Neon SQL Editor (console.neon.tech → your project → SQL Editor)

CREATE TABLE IF NOT EXISTS songs (
  id SERIAL PRIMARY KEY,
  title TEXT NOT NULL,
  artist TEXT NOT NULL,
  tags TEXT[] NOT NULL DEFAULT '{}',
  year INTEGER NOT NULL,
  mood TEXT NOT NULL DEFAULT 'bright',
  tempo TEXT NOT NULL DEFAULT 'mid',
  category TEXT NOT NULL DEFAULT '80s_top10',
  peak_position INTEGER,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_songs_category ON songs(category);
CREATE INDEX idx_songs_artist ON songs(artist);

CREATE TABLE IF NOT EXISTS game_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  secret_song_id INTEGER REFERENCES songs(id),
  category TEXT NOT NULL,
  guesses INTEGER DEFAULT 0,
  hints_used INTEGER DEFAULT 0,
  solved BOOLEAN DEFAULT FALSE,
  final_score INTEGER,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

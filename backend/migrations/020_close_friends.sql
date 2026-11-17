-- Migration 020: Close Friends Stories Support
-- Scope: Stories module ONLY (does not apply to Posts or general feeds).
-- Creates the close_friends relationship table and adds audience targeting to stories.

-- 1. Close Friends Relationship Table
CREATE TABLE IF NOT EXISTS close_friends (
  user_id        INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  friend_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, friend_user_id),
  CHECK (user_id <> friend_user_id)
);

-- Fast reverse lookup index for feed and story access authorization:
-- "Is current user on the story creator's close friends list?"
CREATE INDEX IF NOT EXISTS idx_close_friends_friend_user
  ON close_friends (friend_user_id, user_id);

-- 2. Add audience targeting to stories
ALTER TABLE stories
  ADD COLUMN IF NOT EXISTS audience VARCHAR(20) NOT NULL DEFAULT 'everyone'
  CHECK (audience IN ('everyone', 'close_friends'));

-- 3. Composite index for filtered timeline queries
CREATE INDEX IF NOT EXISTS idx_stories_active_audience
  ON stories (user_id, audience, expires_at);

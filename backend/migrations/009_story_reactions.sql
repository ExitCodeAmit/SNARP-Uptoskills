-- Migration 009: Story Reactions table
-- Implements single-reaction-per-user with 5 approved reaction types and cascading cleanup.

CREATE TABLE IF NOT EXISTS story_reactions (
  story_id   BIGINT NOT NULL REFERENCES stories(id) ON DELETE CASCADE,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type       VARCHAR(10) NOT NULL CHECK (type IN ('love', 'haha', 'wow', 'sad', 'like')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (story_id, user_id)
);

CREATE INDEX IF NOT EXISTS story_reactions_story_idx ON story_reactions (story_id, created_at DESC);
CREATE INDEX IF NOT EXISTS story_reactions_user_idx ON story_reactions (user_id, story_id);

-- Migration 010: Story Replies table
-- Stores replies sent by viewers to story owners with cascade deletion and strict length validation.

CREATE TABLE IF NOT EXISTS story_replies (
  id             BIGSERIAL PRIMARY KEY,
  story_id       BIGINT NOT NULL REFERENCES stories(id) ON DELETE CASCADE,
  sender_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  story_owner_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  text           VARCHAR(500) NOT NULL CHECK (length(trim(text)) > 0 AND length(text) <= 500),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (sender_id <> story_owner_id)
);

CREATE INDEX IF NOT EXISTS story_replies_story_created_idx ON story_replies (story_id, created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS story_replies_owner_created_idx ON story_replies (story_owner_id, created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS story_replies_sender_created_idx ON story_replies (sender_id, created_at DESC, id DESC);

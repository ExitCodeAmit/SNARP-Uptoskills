-- Migration 016: Story Mentions, Reshares, and Notifications Expansion
-- Supports user mentions on stories (@username), story reshares with original attribution,
-- and notification kinds for both interactions.

-- 1. Expand notifications.kind check constraint to include story_mention and story_reshare
DO $$
DECLARE
  v_conname text;
BEGIN
  -- Find existing check constraint on column 'kind' in table 'notifications'
  SELECT con.conname INTO v_conname
  FROM pg_constraint con
  JOIN pg_attribute att ON att.attrelid = con.conrelid AND att.attnum = ANY(con.conkey)
  WHERE con.conrelid = 'notifications'::regclass
    AND con.contype = 'c'
    AND att.attname = 'kind';

  -- Drop existing constraint
  IF v_conname IS NOT NULL THEN
    EXECUTE 'ALTER TABLE notifications DROP CONSTRAINT ' || quote_ident(v_conname);
  END IF;

  -- Add expanded check constraint preserving all 8 existing kinds + 2 new kinds
  ALTER TABLE notifications ADD CONSTRAINT notifications_kind_check
    CHECK (kind IN (
      'like',
      'comment',
      'paper_review',
      'message',
      'story_poll_vote',
      'story_question_response',
      'story_question_answered',
      'story_quiz_answer',
      'story_mention',
      'story_reshare'
    ));
END $$;

-- 2. Deduplication partial unique indexes for mention and reshare notifications
CREATE UNIQUE INDEX IF NOT EXISTS idx_notifications_story_mention
ON notifications (user_id, actor_id, kind, entity_type, entity_id)
WHERE kind = 'story_mention';

CREATE UNIQUE INDEX IF NOT EXISTS idx_notifications_story_reshare
ON notifications (user_id, actor_id, kind, entity_type, entity_id)
WHERE kind = 'story_reshare';

-- 3. Story Reshare Reference column on stories
ALTER TABLE stories
ADD COLUMN IF NOT EXISTS original_story_id BIGINT REFERENCES stories(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_stories_original_story_id ON stories (original_story_id);

-- 4. Story Mentions Table
CREATE TABLE IF NOT EXISTS story_mentions (
  id         BIGSERIAL PRIMARY KEY,
  story_id   BIGINT NOT NULL REFERENCES stories(id) ON DELETE CASCADE,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT unq_story_mentions_story_user UNIQUE (story_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_story_mentions_story_id ON story_mentions (story_id);
CREATE INDEX IF NOT EXISTS idx_story_mentions_user_id ON story_mentions (user_id);

-- 5. Story Reshares Table (tracks reshare actions and prevents duplicate active reshares)
CREATE TABLE IF NOT EXISTS story_reshares (
  id                  BIGSERIAL PRIMARY KEY,
  original_story_id   BIGINT REFERENCES stories(id) ON DELETE SET NULL,
  reshared_story_id   BIGINT NOT NULL REFERENCES stories(id) ON DELETE CASCADE,
  reshared_by_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT unq_story_reshares_reshared_story UNIQUE (reshared_story_id),
  CONSTRAINT unq_story_reshares_user_original UNIQUE (reshared_by_user_id, original_story_id)
);

CREATE INDEX IF NOT EXISTS idx_story_reshares_original ON story_reshares (original_story_id);
CREATE INDEX IF NOT EXISTS idx_story_reshares_user ON story_reshares (reshared_by_user_id);

-- Migration 014: Story Questions and Answers Schema with Notifications Expansion
-- Supports Instagram-style question stickers on stories, text responses from viewers,
-- owner-only response viewing, answer sharing, and notification integration.

-- 1. Expand notifications.kind check constraint to include story_question_response and story_question_answered
DO $$
DECLARE
  v_conname text;
BEGIN
  SELECT con.conname INTO v_conname
  FROM pg_constraint con
  JOIN pg_attribute att ON att.attrelid = con.conrelid AND att.attnum = ANY(con.conkey)
  WHERE con.conrelid = 'notifications'::regclass
    AND con.contype = 'c'
    AND att.attname = 'kind';

  IF v_conname IS NOT NULL THEN
    EXECUTE 'ALTER TABLE notifications DROP CONSTRAINT ' || quote_ident(v_conname);
  END IF;

  ALTER TABLE notifications ADD CONSTRAINT notifications_kind_check
    CHECK (kind IN (
      'like',
      'comment',
      'paper_review',
      'message',
      'story_poll_vote',
      'story_question_response',
      'story_question_answered'
    ));
END $$;

-- 2. Deduplication indexes for story question notifications
CREATE UNIQUE INDEX IF NOT EXISTS idx_notifications_story_question_response
ON notifications (user_id, actor_id, kind, entity_type, entity_id)
WHERE kind = 'story_question_response';

CREATE UNIQUE INDEX IF NOT EXISTS idx_notifications_story_question_answered
ON notifications (user_id, actor_id, kind, entity_type, entity_id)
WHERE kind = 'story_question_answered';

-- 3. Story Questions Table
CREATE TABLE IF NOT EXISTS story_questions (
  id            BIGSERIAL PRIMARY KEY,
  story_id      BIGINT NOT NULL REFERENCES stories(id) ON DELETE CASCADE,
  question_text VARCHAR(200) NOT NULL CHECK (length(trim(question_text)) > 0 AND length(question_text) <= 200),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT unq_story_questions_story_id UNIQUE (story_id)
);

CREATE INDEX IF NOT EXISTS idx_story_questions_story_id ON story_questions (story_id);

-- 4. Story Question Responses Table
CREATE TABLE IF NOT EXISTS story_question_responses (
  id              BIGSERIAL PRIMARY KEY,
  question_id     BIGINT NOT NULL REFERENCES story_questions(id) ON DELETE CASCADE,
  responder_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  response_text   VARCHAR(500) NOT NULL CHECK (length(trim(response_text)) > 0 AND length(response_text) <= 500),
  shared_story_id BIGINT REFERENCES stories(id) ON DELETE SET NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT unq_story_question_responses_user UNIQUE (question_id, responder_id)
);

CREATE INDEX IF NOT EXISTS idx_story_question_responses_question ON story_question_responses (question_id);
CREATE INDEX IF NOT EXISTS idx_story_question_responses_responder ON story_question_responses (responder_id);

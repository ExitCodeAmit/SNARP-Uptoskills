-- Migration 015: Story Quizzes Schema with Notifications Expansion
-- Supports interactive quiz stickers on stories, 2-4 options, exactly one correct option,
-- single response per user, no cross-quiz option selection, and owner analytics.

-- 1. Expand notifications.kind check constraint to include story_quiz_answer
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
      'story_question_answered',
      'story_quiz_answer'
    ));
END $$;

-- 2. Deduplication index for story quiz answer notifications
CREATE UNIQUE INDEX IF NOT EXISTS idx_notifications_story_quiz_answer
ON notifications (user_id, actor_id, kind, entity_type, entity_id)
WHERE kind = 'story_quiz_answer';

-- 3. Story Quizzes Table
CREATE TABLE IF NOT EXISTS story_quizzes (
  id                BIGSERIAL PRIMARY KEY,
  story_id          BIGINT NOT NULL REFERENCES stories(id) ON DELETE CASCADE,
  question_text     VARCHAR(200) NOT NULL CHECK (length(trim(question_text)) > 0 AND length(question_text) <= 200),
  correct_option_id BIGINT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT unq_story_quizzes_story_id UNIQUE (story_id),
  CONSTRAINT unq_story_quizzes_id_story UNIQUE (id, story_id)
);

CREATE INDEX IF NOT EXISTS idx_story_quizzes_story_id ON story_quizzes (story_id);

-- 4. Story Quiz Options Table
CREATE TABLE IF NOT EXISTS story_quiz_options (
  id            BIGSERIAL PRIMARY KEY,
  quiz_id       BIGINT NOT NULL REFERENCES story_quizzes(id) ON DELETE CASCADE,
  option_text   VARCHAR(60) NOT NULL CHECK (length(trim(option_text)) > 0 AND length(option_text) <= 60),
  display_order INTEGER NOT NULL DEFAULT 0,
  CONSTRAINT unq_story_quiz_options_quiz_order UNIQUE (quiz_id, display_order),
  CONSTRAINT unq_story_quiz_options_id_quiz UNIQUE (id, quiz_id)
);

CREATE INDEX IF NOT EXISTS idx_story_quiz_options_quiz_id ON story_quiz_options (quiz_id, display_order ASC);

-- 5. Add foreign key from story_quizzes (correct_option_id, id) to story_quiz_options (id, quiz_id)
-- Deferrable so options can be inserted in the same transaction
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'fk_story_quizzes_correct_option'
  ) THEN
    ALTER TABLE story_quizzes
    ADD CONSTRAINT fk_story_quizzes_correct_option
    FOREIGN KEY (correct_option_id, id)
    REFERENCES story_quiz_options (id, quiz_id)
    ON DELETE CASCADE
    DEFERRABLE INITIALLY DEFERRED;
  END IF;
END $$;

-- 6. Story Quiz Responses Table
CREATE TABLE IF NOT EXISTS story_quiz_responses (
  quiz_id            BIGINT NOT NULL REFERENCES story_quizzes(id) ON DELETE CASCADE,
  user_id            INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  selected_option_id BIGINT NOT NULL,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (quiz_id, user_id),
  FOREIGN KEY (selected_option_id, quiz_id) REFERENCES story_quiz_options(id, quiz_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_story_quiz_responses_selected ON story_quiz_responses (selected_option_id);
CREATE INDEX IF NOT EXISTS idx_story_quiz_responses_user ON story_quiz_responses (user_id);

-- 7. Constraint Trigger: Ensure each quiz has between 2 and 4 options and a valid correct_option_id upon commit
CREATE OR REPLACE FUNCTION check_story_quiz_constraints()
RETURNS TRIGGER AS $$
DECLARE
  v_opt_count integer;
BEGIN
  IF EXISTS (SELECT 1 FROM story_quizzes WHERE id = NEW.id) THEN
    IF NEW.correct_option_id IS NULL THEN
      RAISE EXCEPTION 'Story quiz % must have a valid correct_option_id', NEW.id;
    END IF;

    SELECT count(*) INTO v_opt_count FROM story_quiz_options WHERE quiz_id = NEW.id;
    IF v_opt_count < 2 OR v_opt_count > 4 THEN
      RAISE EXCEPTION 'Story quiz % must have between 2 and 4 options (found %)', NEW.id, v_opt_count;
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_story_quiz_constraints ON story_quizzes;
CREATE CONSTRAINT TRIGGER trg_story_quiz_constraints
AFTER INSERT OR UPDATE ON story_quizzes
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW
EXECUTE FUNCTION check_story_quiz_constraints();

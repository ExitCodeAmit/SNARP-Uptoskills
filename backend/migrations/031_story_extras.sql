-- Stories extras from PR #21 (aman-kumar41), built on the existing stories table:
-- close friends audience, reactions, replies, highlights, polls, questions, quizzes and reshares.

CREATE TABLE IF NOT EXISTS close_friends (
  user_id        INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  friend_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, friend_user_id),
  CHECK (user_id <> friend_user_id)
);

-- Fast reverse lookup index for feed and story access authorization:
CREATE INDEX IF NOT EXISTS idx_close_friends_friend_user
  ON close_friends (friend_user_id, user_id);

-- Stories can be shared with followers, friends (mutual followers) or the close friends list.
ALTER TABLE stories ALTER COLUMN audience TYPE VARCHAR(20);
ALTER TABLE stories DROP CONSTRAINT IF EXISTS stories_audience_check;
ALTER TABLE stories ADD CONSTRAINT stories_audience_check CHECK (audience IN ('followers', 'friends', 'close_friends'));
ALTER TABLE stories ADD COLUMN IF NOT EXISTS original_story_id BIGINT REFERENCES stories(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_stories_original_story_id ON stories (original_story_id);

CREATE TABLE IF NOT EXISTS story_reactions (
  story_id   BIGINT NOT NULL REFERENCES stories(id) ON DELETE CASCADE,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type       VARCHAR(10) NOT NULL CHECK (type IN ('love', 'haha', 'wow', 'sad', 'like')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (story_id, user_id)
);

CREATE INDEX IF NOT EXISTS story_reactions_story_idx ON story_reactions (story_id, created_at DESC);
CREATE INDEX IF NOT EXISTS story_reactions_user_idx ON story_reactions (user_id, story_id);

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

CREATE TABLE IF NOT EXISTS story_highlights (
  id              BIGSERIAL PRIMARY KEY,
  user_id         INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title           VARCHAR(60) NOT NULL,
  cover_story_id  BIGINT REFERENCES stories(id) ON DELETE SET NULL,
  display_order   INTEGER NOT NULL DEFAULT 0,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT chk_story_highlight_title_len CHECK (length(trim(title)) > 0 AND length(title) <= 60)
);

CREATE INDEX IF NOT EXISTS idx_story_highlights_user_order ON story_highlights (user_id, display_order ASC, created_at DESC);

CREATE TABLE IF NOT EXISTS story_highlight_items (
  id             BIGSERIAL PRIMARY KEY,
  highlight_id   BIGINT NOT NULL REFERENCES story_highlights(id) ON DELETE CASCADE,
  story_id       BIGINT NOT NULL REFERENCES stories(id) ON DELETE CASCADE,
  display_order  INTEGER NOT NULL DEFAULT 0,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (highlight_id, story_id)
);

CREATE INDEX IF NOT EXISTS idx_story_highlight_items_highlight ON story_highlight_items (highlight_id, display_order ASC, created_at ASC);
CREATE INDEX IF NOT EXISTS idx_story_highlight_items_story ON story_highlight_items (story_id);

CREATE OR REPLACE FUNCTION check_story_highlight_item_owner()
RETURNS TRIGGER AS $$
DECLARE
  v_highlight_user_id INTEGER;
  v_story_user_id INTEGER;
BEGIN
  SELECT user_id INTO v_highlight_user_id FROM story_highlights WHERE id = NEW.highlight_id;
  SELECT user_id INTO v_story_user_id FROM stories WHERE id = NEW.story_id;
  IF v_highlight_user_id IS NULL OR v_story_user_id IS NULL OR v_highlight_user_id <> v_story_user_id THEN
    RAISE EXCEPTION 'Cannot add story % (user %) into highlight % (user %)',
      NEW.story_id, v_story_user_id, NEW.highlight_id, v_highlight_user_id;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_story_highlight_item_owner ON story_highlight_items;
CREATE CONSTRAINT TRIGGER trg_story_highlight_item_owner
AFTER INSERT OR UPDATE ON story_highlight_items
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW
EXECUTE FUNCTION check_story_highlight_item_owner();

CREATE TABLE IF NOT EXISTS story_polls (
  id         BIGSERIAL PRIMARY KEY,
  story_id   BIGINT NOT NULL REFERENCES stories(id) ON DELETE CASCADE,
  question   VARCHAR(120) NOT NULL CHECK (length(trim(question)) > 0 AND length(question) <= 120),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT unq_story_polls_story_id UNIQUE (story_id)
);

CREATE INDEX IF NOT EXISTS idx_story_polls_story_id ON story_polls (story_id);

CREATE TABLE IF NOT EXISTS story_poll_options (
  id            BIGSERIAL PRIMARY KEY,
  poll_id       BIGINT NOT NULL REFERENCES story_polls(id) ON DELETE CASCADE,
  option_text   VARCHAR(60) NOT NULL CHECK (length(trim(option_text)) > 0 AND length(option_text) <= 60),
  display_order INTEGER NOT NULL DEFAULT 0,
  CONSTRAINT unq_story_poll_options_poll_order UNIQUE (poll_id, display_order),
  CONSTRAINT unq_story_poll_options_id_poll UNIQUE (id, poll_id)
);

CREATE INDEX IF NOT EXISTS idx_story_poll_options_poll_id ON story_poll_options (poll_id, display_order ASC);

CREATE TABLE IF NOT EXISTS story_poll_votes (
  poll_id    BIGINT NOT NULL REFERENCES story_polls(id) ON DELETE CASCADE,
  option_id  BIGINT NOT NULL,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (poll_id, user_id),
  FOREIGN KEY (option_id, poll_id) REFERENCES story_poll_options(id, poll_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_story_poll_votes_option ON story_poll_votes (option_id);
CREATE INDEX IF NOT EXISTS idx_story_poll_votes_user ON story_poll_votes (user_id);

CREATE OR REPLACE FUNCTION check_story_poll_min_options()
RETURNS TRIGGER AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM story_polls WHERE id = NEW.id) THEN
    IF (SELECT count(*) FROM story_poll_options WHERE poll_id = NEW.id) < 2 THEN
      RAISE EXCEPTION 'Story poll % must have at least 2 options', NEW.id;
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_story_poll_min_options ON story_polls;
CREATE CONSTRAINT TRIGGER trg_story_poll_min_options
AFTER INSERT OR UPDATE ON story_polls
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW
EXECUTE FUNCTION check_story_poll_min_options();

CREATE TABLE IF NOT EXISTS story_questions (
  id            BIGSERIAL PRIMARY KEY,
  story_id      BIGINT NOT NULL REFERENCES stories(id) ON DELETE CASCADE,
  question_text VARCHAR(200) NOT NULL CHECK (length(trim(question_text)) > 0 AND length(question_text) <= 200),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT unq_story_questions_story_id UNIQUE (story_id)
);

CREATE INDEX IF NOT EXISTS idx_story_questions_story_id ON story_questions (story_id);

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
  v_correct_id bigint;
  v_opt_count integer;
BEGIN
  -- 1. Safely check if the quiz row still exists in the database
  SELECT correct_option_id INTO v_correct_id
  FROM story_quizzes
  WHERE id = NEW.id;

  -- If the row was deleted in the same transaction, skip verification
  IF NOT FOUND THEN
    RETURN NEW;
  END IF;

  -- 2. Verify that correct_option_id is not NULL
  IF v_correct_id IS NULL THEN
    RAISE EXCEPTION 'Story quiz % must have a valid correct_option_id', NEW.id;
  END IF;

  -- 3. Verify that correct_option_id belongs to this quiz
  IF NOT EXISTS (
    SELECT 1 FROM story_quiz_options
    WHERE id = v_correct_id AND quiz_id = NEW.id
  ) THEN
    RAISE EXCEPTION 'Story quiz % correct_option_id % does not belong to quiz', NEW.id, v_correct_id;
  END IF;

  -- 4. Verify option count is between 2 and 4
  SELECT count(*) INTO v_opt_count
  FROM story_quiz_options
  WHERE quiz_id = NEW.id;

  IF v_opt_count < 2 OR v_opt_count > 4 THEN
    RAISE EXCEPTION 'Story quiz % must have between 2 and 4 options (found %)', NEW.id, v_opt_count;
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

ALTER TABLE notifications DROP CONSTRAINT IF EXISTS notifications_kind_check;
ALTER TABLE notifications ADD CONSTRAINT notifications_kind_check
  CHECK (kind IN ('like', 'comment', 'paper_review', 'message', 'follow', 'paper_like', 'paper_comment', 'review_request', 'coauthor', 'story_mention', 'reel_like', 'reel_comment', 'reel_tag', 'doc_invite', 'doc_joined', 'story_poll_vote', 'story_question_response', 'story_question_answered', 'story_quiz_answer', 'story_reshare', 'story_reaction', 'story_reply'));
CREATE UNIQUE INDEX IF NOT EXISTS idx_notifications_story_poll_vote ON notifications (user_id, actor_id, kind, entity_type, entity_id) WHERE kind = 'story_poll_vote';
CREATE UNIQUE INDEX IF NOT EXISTS idx_notifications_story_question_response ON notifications (user_id, actor_id, kind, entity_type, entity_id) WHERE kind = 'story_question_response';
CREATE UNIQUE INDEX IF NOT EXISTS idx_notifications_story_question_answered ON notifications (user_id, actor_id, kind, entity_type, entity_id) WHERE kind = 'story_question_answered';
CREATE UNIQUE INDEX IF NOT EXISTS idx_notifications_story_quiz_answer ON notifications (user_id, actor_id, kind, entity_type, entity_id) WHERE kind = 'story_quiz_answer';
CREATE UNIQUE INDEX IF NOT EXISTS idx_notifications_story_reshare ON notifications (user_id, actor_id, kind, entity_type, entity_id) WHERE kind = 'story_reshare';
CREATE UNIQUE INDEX IF NOT EXISTS idx_notifications_story_reaction ON notifications (user_id, actor_id, kind, entity_type, entity_id) WHERE kind = 'story_reaction';
CREATE UNIQUE INDEX IF NOT EXISTS idx_notifications_story_reply ON notifications (user_id, actor_id, kind, entity_type, entity_id) WHERE kind = 'story_reply';

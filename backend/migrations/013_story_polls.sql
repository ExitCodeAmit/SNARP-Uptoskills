-- Migration 013: Story Polls and Voting Schema
-- Supports creating polls on stories, multi-option voting, single vote per user,
-- relational guarantee that selected option belongs to the poll, and min 2 options.

-- 1. Story Polls table
CREATE TABLE IF NOT EXISTS story_polls (
  id         BIGSERIAL PRIMARY KEY,
  story_id   BIGINT NOT NULL REFERENCES stories(id) ON DELETE CASCADE,
  question   VARCHAR(120) NOT NULL CHECK (length(trim(question)) > 0 AND length(question) <= 120),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT unq_story_polls_story_id UNIQUE (story_id)
);

CREATE INDEX IF NOT EXISTS idx_story_polls_story_id ON story_polls (story_id);

-- 2. Story Poll Options table
CREATE TABLE IF NOT EXISTS story_poll_options (
  id            BIGSERIAL PRIMARY KEY,
  poll_id       BIGINT NOT NULL REFERENCES story_polls(id) ON DELETE CASCADE,
  option_text   VARCHAR(60) NOT NULL CHECK (length(trim(option_text)) > 0 AND length(option_text) <= 60),
  display_order INTEGER NOT NULL DEFAULT 0,
  CONSTRAINT unq_story_poll_options_poll_order UNIQUE (poll_id, display_order),
  CONSTRAINT unq_story_poll_options_id_poll UNIQUE (id, poll_id)
);

CREATE INDEX IF NOT EXISTS idx_story_poll_options_poll_id ON story_poll_options (poll_id, display_order ASC);

-- 3. Story Poll Votes table
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

-- 4. Constraint trigger: Ensure each poll has at least two options upon commit
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

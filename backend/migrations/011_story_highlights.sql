-- 011_story_highlights.sql
-- Story Highlights Schema

-- 1. Story Highlights Collections table
CREATE TABLE story_highlights (
  id              BIGSERIAL PRIMARY KEY,
  user_id         INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title           VARCHAR(60) NOT NULL,
  cover_story_id  BIGINT REFERENCES stories(id) ON DELETE SET NULL,
  display_order   INTEGER NOT NULL DEFAULT 0,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT chk_story_highlight_title_len CHECK (length(trim(title)) > 0 AND length(title) <= 60)
);

CREATE INDEX idx_story_highlights_user_order ON story_highlights (user_id, display_order ASC, created_at DESC);

-- 2. Story Highlight Items linking table (connects highlights to stories)
CREATE TABLE story_highlight_items (
  id             BIGSERIAL PRIMARY KEY,
  highlight_id   BIGINT NOT NULL REFERENCES story_highlights(id) ON DELETE CASCADE,
  story_id       BIGINT NOT NULL REFERENCES stories(id) ON DELETE CASCADE,
  display_order  INTEGER NOT NULL DEFAULT 0,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (highlight_id, story_id)
);

CREATE INDEX idx_story_highlight_items_highlight ON story_highlight_items (highlight_id, display_order ASC, created_at ASC);
CREATE INDEX idx_story_highlight_items_story ON story_highlight_items (story_id);

-- 3. Trigger: Prevent cross-user contamination (highlight and story must belong to the same user)
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

CREATE CONSTRAINT TRIGGER trg_story_highlight_item_owner
AFTER INSERT OR UPDATE ON story_highlight_items
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW
EXECUTE FUNCTION check_story_highlight_item_owner();

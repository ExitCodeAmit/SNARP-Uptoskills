-- 1. Stories metadata table
CREATE TABLE stories (
  id               BIGSERIAL PRIMARY KEY,
  user_id          INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type             VARCHAR(10) NOT NULL CHECK (type IN ('text', 'photo', 'video')),
  content          VARCHAR(500) NOT NULL DEFAULT '',
  background_style VARCHAR(30) NOT NULL DEFAULT 'gradient-sunset' CHECK (
    background_style IN (
      'gradient-sunset',
      'gradient-ocean',
      'gradient-emerald',
      'gradient-royal',
      'gradient-amber',
      'solid-dark',
      'solid-slate'
    )
  ),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at       TIMESTAMPTZ NOT NULL DEFAULT (now() + interval '24 hours'),
  UNIQUE (id, type),
  CHECK (
    (type = 'text' AND length(trim(content)) > 0) OR
    (type IN ('photo', 'video'))
  ),
  CHECK (length(content) <= 500)
);

-- Fast B-tree composite indexes for timeline queries
CREATE INDEX stories_active_timeline_idx ON stories (expires_at, created_at DESC);
CREATE INDEX stories_user_active_idx ON stories (user_id, expires_at, created_at DESC);

-- 2. Dedicated binary storage table for story media
CREATE TABLE story_media (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  story_id   BIGINT NOT NULL UNIQUE,
  media_type VARCHAR(10) NOT NULL CHECK (media_type IN ('photo', 'video')),
  mime       VARCHAR(50) NOT NULL,
  size_bytes INTEGER NOT NULL CHECK (size_bytes > 0 AND size_bytes <= 15728640),
  data       BYTEA NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  FOREIGN KEY (story_id, media_type) REFERENCES stories(id, type) ON DELETE CASCADE,
  CHECK (
    (media_type = 'photo' AND mime IN ('image/jpeg', 'image/png', 'image/gif', 'image/webp')) OR
    (media_type = 'video' AND mime = 'video/mp4')
  )
);

-- 3. Trigger 1: Ensure photo and video stories have media upon creation/update
CREATE OR REPLACE FUNCTION check_story_mandatory_media()
RETURNS TRIGGER AS $$
BEGIN
  -- If the story was deleted in the same transaction, skip the check
  IF EXISTS (
    SELECT 1 FROM stories
    WHERE id = NEW.id AND type IN ('photo', 'video')
  ) THEN
    IF NOT EXISTS (SELECT 1 FROM story_media WHERE story_id = NEW.id) THEN
      RAISE EXCEPTION 'Story % of type % must have an associated media record', NEW.id, NEW.type;
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE CONSTRAINT TRIGGER trg_story_mandatory_media
AFTER INSERT OR UPDATE ON stories
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW
EXECUTE FUNCTION check_story_mandatory_media();

-- 4. Trigger 2: Prevent direct deletion or removal of media from active photo/video stories
CREATE OR REPLACE FUNCTION check_story_media_removal()
RETURNS TRIGGER AS $$
BEGIN
  -- If parent story still exists and is photo/video, it MUST retain an associated media row
  IF EXISTS (
    SELECT 1 FROM stories
    WHERE id = OLD.story_id AND type IN ('photo', 'video')
  ) THEN
    IF NOT EXISTS (
      SELECT 1 FROM story_media WHERE story_id = OLD.story_id
    ) THEN
      RAISE EXCEPTION 'Cannot remove media from existing story %', OLD.story_id;
    END IF;
  END IF;
  RETURN OLD;
END;
$$ LANGUAGE plpgsql;

CREATE CONSTRAINT TRIGGER trg_story_media_removal
AFTER DELETE OR UPDATE OF story_id ON story_media
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW
EXECUTE FUNCTION check_story_media_removal();

-- 5. Story View Tracking table
CREATE TABLE story_views (
  story_id   BIGINT NOT NULL REFERENCES stories(id) ON DELETE CASCADE,
  viewer_id  INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  viewed_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (story_id, viewer_id)
);

CREATE INDEX story_views_story_idx ON story_views (story_id, viewed_at DESC);
CREATE INDEX story_views_viewer_idx ON story_views (viewer_id, story_id);

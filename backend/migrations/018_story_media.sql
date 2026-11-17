-- Stories can be a photo, a video (split into parts of up to 15 seconds) or text on a coloured background.
-- Text and @mentions are stored as overlay layers so they stay sharp and mentions stay tappable.
CREATE TABLE IF NOT EXISTS story_media (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  mime       VARCHAR(40) NOT NULL,
  data       BYTEA NOT NULL,
  duration   REAL NOT NULL CHECK (duration > 0 AND duration <= 61),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- Uncompressed out-of-line storage makes byte-range reads (video seeking) cheap.
ALTER TABLE story_media ALTER COLUMN data SET STORAGE EXTERNAL;

ALTER TABLE stories ALTER COLUMN image_id DROP NOT NULL;
ALTER TABLE stories ADD COLUMN IF NOT EXISTS kind VARCHAR(10) NOT NULL DEFAULT 'image';
ALTER TABLE stories ADD COLUMN IF NOT EXISTS media_id UUID REFERENCES story_media(id) ON DELETE CASCADE;
ALTER TABLE stories ADD COLUMN IF NOT EXISTS clip_start REAL;
ALTER TABLE stories ADD COLUMN IF NOT EXISTS clip_end REAL;
ALTER TABLE stories ADD COLUMN IF NOT EXISTS part SMALLINT;
ALTER TABLE stories ADD COLUMN IF NOT EXISTS parts SMALLINT;
ALTER TABLE stories ADD COLUMN IF NOT EXISTS background VARCHAR(20);
ALTER TABLE stories ADD COLUMN IF NOT EXISTS overlay JSONB NOT NULL DEFAULT '[]'::jsonb;

ALTER TABLE stories DROP CONSTRAINT IF EXISTS stories_kind_check;
ALTER TABLE stories ADD CONSTRAINT stories_kind_check CHECK (
  (kind = 'image' AND image_id IS NOT NULL)
  OR (kind = 'video' AND media_id IS NOT NULL AND clip_start >= 0 AND clip_end > clip_start AND clip_end - clip_start <= 15.05)
  OR (kind = 'text' AND background IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS stories_media_idx ON stories (media_id) WHERE media_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS story_mentions (
  story_id BIGINT NOT NULL REFERENCES stories(id) ON DELETE CASCADE,
  user_id  INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  PRIMARY KEY (story_id, user_id)
);

ALTER TABLE notifications DROP CONSTRAINT IF EXISTS notifications_kind_check;
ALTER TABLE notifications ADD CONSTRAINT notifications_kind_check
  CHECK (kind IN ('like', 'comment', 'paper_review', 'message', 'follow', 'paper_like', 'paper_comment', 'review_request', 'coauthor', 'story_mention'));

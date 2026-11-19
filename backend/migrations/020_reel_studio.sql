-- Reel studio: edits chosen while creating a reel (applied by the player, the source video is never re-encoded),
-- a generated cover photo, tagged people and per-reel settings.

ALTER TABLE reels
  ADD COLUMN trim_start REAL NOT NULL DEFAULT 0 CHECK (trim_start >= 0),
  ADD COLUMN trim_end REAL,
  ADD COLUMN cover_image_id UUID REFERENCES images(id) ON DELETE SET NULL,
  ADD COLUMN crop JSONB NOT NULL DEFAULT '{"aspect": "original", "zoom": 1, "x": 0.5, "y": 0.5}',
  ADD COLUMN filter VARCHAR(20) NOT NULL DEFAULT 'none',
  ADD COLUMN audio_muted BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN hide_counts BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN comments_off BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN alt_text VARCHAR(300) NOT NULL DEFAULT '',
  ADD COLUMN location VARCHAR(100) NOT NULL DEFAULT '',
  ADD CONSTRAINT reels_trim_check CHECK (trim_end IS NULL OR trim_end > trim_start);

CREATE TABLE reel_tags (
  reel_id BIGINT NOT NULL REFERENCES reels(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  PRIMARY KEY (reel_id, user_id)
);

CREATE INDEX reel_tags_user_idx ON reel_tags (user_id);

ALTER TABLE notifications DROP CONSTRAINT IF EXISTS notifications_kind_check;
ALTER TABLE notifications ADD CONSTRAINT notifications_kind_check
  CHECK (kind IN ('like', 'comment', 'paper_review', 'message', 'follow', 'paper_like', 'paper_comment', 'review_request', 'coauthor', 'story_mention', 'reel_like', 'reel_comment', 'reel_tag'));

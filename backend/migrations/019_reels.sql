-- Short vertical videos ("reels"). The video file lives on ImageKit; the row keeps the verified file details.

CREATE TABLE reels (
  id BIGSERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  caption VARCHAR(2200) NOT NULL DEFAULT '',
  file_id VARCHAR(100) NOT NULL UNIQUE,
  video_url TEXT NOT NULL,
  thumbnail_url TEXT,
  mime VARCHAR(40) NOT NULL,
  file_size BIGINT NOT NULL CHECK (file_size > 0),
  duration REAL CHECK (duration IS NULL OR duration > 0),
  width INTEGER,
  height INTEGER,
  view_count INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX reels_created_idx ON reels (created_at DESC, id DESC);
CREATE INDEX reels_user_idx ON reels (user_id, created_at DESC);

CREATE TABLE reel_likes (
  reel_id BIGINT NOT NULL REFERENCES reels(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (reel_id, user_id)
);

CREATE TABLE reel_saves (
  reel_id BIGINT NOT NULL REFERENCES reels(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (reel_id, user_id)
);

CREATE INDEX reel_saves_user_idx ON reel_saves (user_id, created_at DESC);

CREATE TABLE reel_comments (
  id BIGSERIAL PRIMARY KEY,
  reel_id BIGINT NOT NULL REFERENCES reels(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  body VARCHAR(2000) NOT NULL CHECK (length(trim(body)) > 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX reel_comments_reel_idx ON reel_comments (reel_id, created_at, id);

-- Video files whose reel was deleted but could not be removed from ImageKit yet; retried by the cleanup job.
CREATE TABLE reel_file_trash (
  file_id VARCHAR(100) PRIMARY KEY,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE notifications DROP CONSTRAINT IF EXISTS notifications_kind_check;
ALTER TABLE notifications ADD CONSTRAINT notifications_kind_check
  CHECK (kind IN ('like', 'comment', 'paper_review', 'message', 'follow', 'paper_like', 'paper_comment', 'review_request', 'coauthor', 'story_mention', 'reel_like', 'reel_comment'));

CREATE TABLE IF NOT EXISTS stories (
  id         BIGSERIAL PRIMARY KEY,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  image_id   UUID NOT NULL REFERENCES images(id) ON DELETE CASCADE,
  caption    TEXT NOT NULL DEFAULT '' CHECK (char_length(caption) <= 200),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL DEFAULT now() + interval '24 hours',
  CHECK (expires_at > created_at)
);

CREATE INDEX IF NOT EXISTS stories_user_expires_idx ON stories (user_id, expires_at DESC);
CREATE INDEX IF NOT EXISTS stories_expires_idx ON stories (expires_at);

CREATE TABLE IF NOT EXISTS story_views (
  story_id  BIGINT NOT NULL REFERENCES stories(id) ON DELETE CASCADE,
  viewer_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  viewed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (story_id, viewer_id)
);

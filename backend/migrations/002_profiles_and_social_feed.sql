CREATE TABLE user_profiles (
  user_id            INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  institution        VARCHAR(200) NOT NULL DEFAULT '',
  department         VARCHAR(160) NOT NULL DEFAULT '',
  research_interests TEXT[] NOT NULL DEFAULT '{}',
  bio                TEXT NOT NULL DEFAULT '',
  skills             TEXT[] NOT NULL DEFAULT '{}',
  links              JSONB NOT NULL DEFAULT '[]',
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (length(bio) <= 2000)
);

ALTER TABLE posts ADD COLUMN updated_at TIMESTAMPTZ NOT NULL DEFAULT now();

CREATE TABLE likes (
  post_id    INTEGER NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (post_id, user_id)
);
CREATE INDEX likes_user_id_idx ON likes (user_id);

CREATE TABLE comments (
  id         BIGSERIAL PRIMARY KEY,
  post_id    INTEGER NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  body       VARCHAR(2000) NOT NULL CHECK (length(trim(body)) > 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX comments_post_created_at_idx ON comments (post_id, created_at DESC, id DESC);

CREATE TABLE reports (
  id          BIGSERIAL PRIMARY KEY,
  post_id     INTEGER NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  reported_by INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  reason      VARCHAR(1000) NOT NULL CHECK (length(trim(reason)) >= 5),
  status      VARCHAR(20) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'reviewed', 'dismissed')),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (post_id, reported_by)
);
CREATE INDEX reports_status_created_at_idx ON reports (status, created_at DESC);

CREATE TABLE follows (
  follower_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  followee_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (follower_id, followee_id),
  CHECK (follower_id <> followee_id)
);
CREATE INDEX follows_followee_idx ON follows (followee_id, created_at DESC);

CREATE TABLE paper_likes (
  paper_id   BIGINT NOT NULL REFERENCES papers(id) ON DELETE CASCADE,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (paper_id, user_id)
);

CREATE TABLE paper_comments (
  id         BIGSERIAL PRIMARY KEY,
  paper_id   BIGINT NOT NULL REFERENCES papers(id) ON DELETE CASCADE,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  body       VARCHAR(2000) NOT NULL CHECK (length(trim(body)) > 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX paper_comments_paper_idx ON paper_comments (paper_id, created_at, id);

CREATE TABLE paper_saves (
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  paper_id   BIGINT NOT NULL REFERENCES papers(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, paper_id)
);
CREATE INDEX paper_saves_user_idx ON paper_saves (user_id, created_at DESC);

ALTER TABLE notifications DROP CONSTRAINT IF EXISTS notifications_kind_check;
ALTER TABLE notifications ADD CONSTRAINT notifications_kind_check
  CHECK (kind IN ('like', 'comment', 'paper_review', 'message', 'follow', 'paper_like', 'paper_comment'));

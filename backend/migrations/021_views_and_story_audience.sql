-- Unique viewers of posts and papers (a view is counted once per person, never for the author),
-- and who a story is shared with.

CREATE TABLE post_views (
  post_id INTEGER NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  viewed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (post_id, user_id)
);

CREATE TABLE paper_views (
  paper_id BIGINT NOT NULL REFERENCES papers(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  viewed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (paper_id, user_id)
);

-- 'followers': everyone who follows you. 'friends': only followers you follow back.
ALTER TABLE stories ADD COLUMN audience VARCHAR(12) NOT NULL DEFAULT 'followers'
  CHECK (audience IN ('followers', 'friends'));

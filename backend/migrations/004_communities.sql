CREATE TABLE communities (
  id          BIGSERIAL PRIMARY KEY,
  name        VARCHAR(100) NOT NULL,
  description VARCHAR(2000) NOT NULL DEFAULT '',
  category    VARCHAR(120) NOT NULL,
  created_by  INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (name),
  CHECK (length(trim(name)) > 0),
  CHECK (length(trim(category)) > 0)
);
CREATE INDEX communities_category_name_idx ON communities (lower(category), lower(name));
CREATE UNIQUE INDEX communities_name_ci_idx ON communities (lower(name));

CREATE TABLE community_members (
  community_id BIGINT NOT NULL REFERENCES communities(id) ON DELETE CASCADE,
  user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role         VARCHAR(20) NOT NULL DEFAULT 'member' CHECK (role IN ('owner', 'moderator', 'member')),
  joined_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (community_id, user_id)
);
CREATE INDEX community_members_user_idx ON community_members (user_id, joined_at DESC);

CREATE TABLE community_posts (
  id           BIGSERIAL PRIMARY KEY,
  community_id BIGINT NOT NULL REFERENCES communities(id) ON DELETE CASCADE,
  user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  body         VARCHAR(5000) NOT NULL CHECK (length(trim(body)) > 0),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX community_posts_feed_idx ON community_posts (community_id, created_at DESC, id DESC);

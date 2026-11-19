-- Researcher matching (PR #24): matching interests, collaboration profiles and collaboration requests.
CREATE TABLE IF NOT EXISTS research_interests (
  id         SERIAL PRIMARY KEY,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  interest   VARCHAR(80) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, interest)
);
CREATE INDEX IF NOT EXISTS research_interests_interest_idx ON research_interests (lower(interest));

CREATE TABLE IF NOT EXISTS researcher_profiles (
  id              SERIAL PRIMARY KEY,
  user_id         INTEGER NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  bio             TEXT DEFAULT '',
  institution     VARCHAR(200),
  research_domain VARCHAR(150),
  skills          TEXT[] NOT NULL DEFAULT '{}',
  projects        TEXT DEFAULT '',
  publications    TEXT DEFAULT '',
  availability    VARCHAR(30) DEFAULT 'open' CHECK (availability IN ('open', 'busy', 'unavailable')),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS collaboration_requests (
  id          SERIAL PRIMARY KEY,
  sender_id   INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  receiver_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status      VARCHAR(20) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'rejected')),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (sender_id <> receiver_id),
  UNIQUE (sender_id, receiver_id)
);
CREATE INDEX IF NOT EXISTS collaboration_receiver_status_idx ON collaboration_requests (receiver_id, status);

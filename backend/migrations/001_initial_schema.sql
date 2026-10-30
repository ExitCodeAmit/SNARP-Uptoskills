-- Baseline schema and safe upgrades for databases created by the earlier
-- startup-based schema setup. All changes preserve existing rows.
CREATE TABLE IF NOT EXISTS users (
  id            SERIAL PRIMARY KEY,
  name          VARCHAR(100) NOT NULL,
  email         VARCHAR(255) NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role          VARCHAR(20) NOT NULL DEFAULT 'user' CHECK (role IN ('admin', 'moderator', 'author', 'user')),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS images (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  mime       VARCHAR(20) NOT NULL,
  data       BYTEA NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE users ADD COLUMN IF NOT EXISTS profile_image_id UUID REFERENCES images(id) ON DELETE SET NULL;

CREATE TABLE IF NOT EXISTS posts (
  id         SERIAL PRIMARY KEY,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  body       TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS posts_created_at_idx ON posts (created_at DESC);

-- Upgrade posts tables created before image support.
ALTER TABLE posts ADD COLUMN IF NOT EXISTS image_id UUID REFERENCES images(id) ON DELETE SET NULL;
ALTER TABLE posts DROP CONSTRAINT IF EXISTS posts_body_check;
DO $$ BEGIN
  ALTER TABLE posts ADD CONSTRAINT posts_content_check
    CHECK (length(body) <= 5000 AND (length(trim(body)) > 0 OR image_id IS NOT NULL));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS papers (
  id                 BIGSERIAL PRIMARY KEY,
  user_id            INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title              VARCHAR(300) NOT NULL,
  abstract           TEXT NOT NULL,
  doi                VARCHAR(255),
  domain             VARCHAR(120) NOT NULL,
  tags               TEXT[] NOT NULL DEFAULT '{}',
  authors            JSONB NOT NULL,
  pdf_data           BYTEA NOT NULL,
  pdf_filename       VARCHAR(255) NOT NULL,
  pdf_content_type   VARCHAR(100) NOT NULL DEFAULT 'application/pdf' CHECK (pdf_content_type = 'application/pdf'),
  pdf_size           INTEGER NOT NULL CHECK (pdf_size > 0 AND pdf_size <= 10485760),
  additional_notes   TEXT,
  status             VARCHAR(20) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  idempotency_key    UUID,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, idempotency_key)
);
ALTER TABLE papers ADD COLUMN IF NOT EXISTS reviewed_by INTEGER REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE papers ADD COLUMN IF NOT EXISTS reviewed_at TIMESTAMPTZ;
ALTER TABLE papers ADD COLUMN IF NOT EXISTS rejection_reason TEXT;
CREATE INDEX IF NOT EXISTS papers_status_created_at_idx ON papers (status, created_at DESC);

CREATE TABLE IF NOT EXISTS auth_sessions (
  id          UUID PRIMARY KEY,
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at  TIMESTAMPTZ NOT NULL,
  revoked_at  TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS auth_sessions_user_id_idx ON auth_sessions (user_id);
CREATE INDEX IF NOT EXISTS auth_sessions_expires_at_idx ON auth_sessions (expires_at);

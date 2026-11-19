CREATE TABLE password_resets (
  token_hash  CHAR(64) PRIMARY KEY,
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at  TIMESTAMPTZ NOT NULL,
  used_at     TIMESTAMPTZ
);
CREATE INDEX password_resets_user_id_idx ON password_resets (user_id);

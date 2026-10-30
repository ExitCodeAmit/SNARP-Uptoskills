-- Durable paper decision history and a minimal administrative audit trail.
CREATE TABLE paper_reviews (
  id          BIGSERIAL PRIMARY KEY,
  paper_id    BIGINT NOT NULL REFERENCES papers(id) ON DELETE CASCADE,
  reviewer_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  decision    VARCHAR(20) NOT NULL CHECK (decision IN ('approved', 'rejected')),
  comment     VARCHAR(2000) NOT NULL DEFAULT '',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX paper_reviews_paper_created_idx ON paper_reviews (paper_id, created_at DESC, id DESC);

CREATE TABLE audit_logs (
  id          BIGSERIAL PRIMARY KEY,
  actor_id    INTEGER REFERENCES users(id) ON DELETE SET NULL,
  action      VARCHAR(80) NOT NULL,
  target_type VARCHAR(40) NOT NULL,
  target_id   VARCHAR(80) NOT NULL,
  details     JSONB NOT NULL DEFAULT '{}',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX audit_logs_created_idx ON audit_logs (created_at DESC, id DESC);

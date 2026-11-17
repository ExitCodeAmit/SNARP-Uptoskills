CREATE TABLE coauthor_checks (
  paper_id    BIGINT NOT NULL REFERENCES papers(id) ON DELETE CASCADE,
  round       INTEGER NOT NULL,
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  decision    VARCHAR(10) NOT NULL CHECK (decision IN ('approve', 'changes')),
  comment     TEXT NOT NULL DEFAULT '',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (paper_id, round, user_id)
);

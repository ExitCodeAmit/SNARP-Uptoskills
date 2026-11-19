-- Paper of the Day (PR #23): one featured published paper per date, never repeated.
CREATE TABLE IF NOT EXISTS paper_of_the_day (
  id            BIGSERIAL PRIMARY KEY,
  paper_id      BIGINT NOT NULL UNIQUE REFERENCES papers(id) ON DELETE CASCADE,
  featured_date DATE NOT NULL UNIQUE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

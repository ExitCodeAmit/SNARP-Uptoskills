BEGIN;

ALTER TABLE papers
  ADD COLUMN IF NOT EXISTS full_text TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS keywords TEXT[] NOT NULL DEFAULT '{}';

CREATE TABLE IF NOT EXISTS paper_chunks (
  id          BIGSERIAL PRIMARY KEY,
  paper_id    BIGINT NOT NULL REFERENCES papers(id) ON DELETE CASCADE,
  chunk_index INTEGER NOT NULL,
  content     TEXT NOT NULL,
  tsv         TSVECTOR NOT NULL,
  UNIQUE (paper_id, chunk_index)
);

CREATE INDEX IF NOT EXISTS paper_chunks_tsv_idx
  ON paper_chunks USING GIN (tsv);

COMMIT;
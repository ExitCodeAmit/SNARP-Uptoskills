-- Paper chat (PR #19): searchable passages of published papers and saved chat sessions with cited answers.
CREATE TABLE IF NOT EXISTS paper_chunks (
  id          BIGSERIAL PRIMARY KEY,
  paper_id    BIGINT NOT NULL REFERENCES papers(id) ON DELETE CASCADE,
  chunk_index INTEGER NOT NULL,
  content     TEXT NOT NULL,
  tsv         TSVECTOR NOT NULL,
  UNIQUE (paper_id, chunk_index)
);
CREATE INDEX IF NOT EXISTS paper_chunks_tsv_idx ON paper_chunks USING GIN (tsv);

-- Papers whose text has been indexed (or could not be read), so they are not retried every time.
CREATE TABLE IF NOT EXISTS paper_chunk_status (
  paper_id   BIGINT PRIMARY KEY REFERENCES papers(id) ON DELETE CASCADE,
  chunks     INTEGER NOT NULL DEFAULT 0,
  indexed_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS chat_sessions (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  paper_id   BIGINT REFERENCES papers(id) ON DELETE SET NULL,
  title      VARCHAR(120) NOT NULL DEFAULT 'New chat',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS chat_sessions_user_updated_idx ON chat_sessions (user_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS chat_messages (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID NOT NULL REFERENCES chat_sessions(id) ON DELETE CASCADE,
  role       VARCHAR(10) NOT NULL CHECK (role IN ('user', 'assistant')),
  content    TEXT NOT NULL,
  sources    JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS chat_messages_session_created_idx ON chat_messages (session_id, created_at);

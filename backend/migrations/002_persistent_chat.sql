BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

DO $$
DECLARE
  session_id_type TEXT;
BEGIN
  SELECT data_type
  INTO session_id_type
  FROM information_schema.columns
  WHERE table_schema = 'public'
    AND table_name = 'chat_sessions'
    AND column_name = 'id';

  IF session_id_type IS NOT NULL AND session_id_type <> 'uuid' THEN
    IF to_regclass('public.chat_sessions_legacy') IS NOT NULL
       OR to_regclass('public.chat_messages_legacy') IS NOT NULL THEN
      RAISE EXCEPTION 'Legacy chat migration tables already exist';
    END IF;

    IF to_regclass('public.chat_messages') IS NOT NULL THEN
      ALTER TABLE public.chat_messages RENAME TO chat_messages_legacy;
    ELSE
      CREATE TABLE public.chat_messages_legacy (
        session_id BIGINT,
        role TEXT,
        content TEXT,
        created_at TIMESTAMPTZ
      );
    END IF;

    ALTER TABLE public.chat_sessions RENAME TO chat_sessions_legacy;
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS chat_sessions (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  paper_id   BIGINT REFERENCES papers(id) ON DELETE SET NULL,
  title      TEXT NOT NULL DEFAULT 'New chat',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS chat_messages (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID NOT NULL REFERENCES chat_sessions(id) ON DELETE CASCADE,
  role       TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
  content    TEXT NOT NULL,
  sources    JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

DO $$
BEGIN
  IF to_regclass('public.chat_sessions_legacy') IS NOT NULL THEN
    CREATE TEMP TABLE chat_session_id_map (
      legacy_id BIGINT PRIMARY KEY,
      session_id UUID NOT NULL
    ) ON COMMIT DROP;

    INSERT INTO chat_session_id_map (legacy_id, session_id)
    SELECT id, gen_random_uuid()
    FROM chat_sessions_legacy;

    INSERT INTO chat_sessions (id, user_id, paper_id, title, created_at, updated_at)
    SELECT mapped.session_id,
      old.user_id,
      NULL,
      COALESCE(NULLIF(BTRIM(old.title), ''), 'New chat'),
      old.created_at,
      GREATEST(old.created_at, COALESCE(MAX(messages.created_at), old.created_at))
    FROM chat_sessions_legacy old
    JOIN chat_session_id_map mapped ON mapped.legacy_id = old.id
    LEFT JOIN chat_messages_legacy messages ON messages.session_id = old.id
    GROUP BY mapped.session_id, old.id, old.user_id, old.title, old.created_at;

    INSERT INTO chat_messages (session_id, role, content, sources, created_at)
    SELECT mapped.session_id,
      old.role,
      old.content,
      '[]'::jsonb,
      old.created_at
    FROM chat_messages_legacy old
    JOIN chat_session_id_map mapped ON mapped.legacy_id = old.session_id;

    DROP TABLE chat_messages_legacy;
    DROP TABLE chat_sessions_legacy;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS chat_sessions_user_updated_idx
  ON chat_sessions (user_id, updated_at DESC);

CREATE INDEX IF NOT EXISTS chat_messages_session_created_idx
  ON chat_messages (session_id, created_at);

COMMIT;
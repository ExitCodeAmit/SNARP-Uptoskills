-- Migration 012: Expand notifications.kind CHECK constraint to include story_poll_vote
-- Preserves existing notification records, read states, and historical data.

DO $$
DECLARE
  v_conname text;
BEGIN
  -- 1. Find the existing check constraint on column 'kind' in table 'notifications'
  SELECT con.conname INTO v_conname
  FROM pg_constraint con
  JOIN pg_attribute att ON att.attrelid = con.conrelid AND att.attnum = ANY(con.conkey)
  WHERE con.conrelid = 'notifications'::regclass
    AND con.contype = 'c'
    AND att.attname = 'kind';

  -- 2. Drop the existing check constraint if present
  IF v_conname IS NOT NULL THEN
    EXECUTE 'ALTER TABLE notifications DROP CONSTRAINT ' || quote_ident(v_conname);
  END IF;

  -- 3. Add the expanded check constraint with story_poll_vote
  ALTER TABLE notifications ADD CONSTRAINT notifications_kind_check
    CHECK (kind IN ('like', 'comment', 'paper_review', 'message', 'story_poll_vote'));
END $$;

-- 4. Unique partial index to prevent duplicate unread poll vote notifications from the same actor
CREATE UNIQUE INDEX IF NOT EXISTS idx_notifications_story_poll_vote
ON notifications (user_id, actor_id, kind, entity_type, entity_id)
WHERE kind = 'story_poll_vote';

-- Migration 021: Story Reactions and Story Replies Notification Expansion
-- Expands notifications.kind check constraint to include 'story_reaction' and 'story_reply'
-- and adds deduplication unique indexes to prevent duplicate notification cards.

DO $$
DECLARE
  v_conname text;
BEGIN
  -- 1. Find existing check constraint on column 'kind' in table 'notifications'
  SELECT con.conname INTO v_conname
  FROM pg_constraint con
  JOIN pg_attribute att ON att.attrelid = con.conrelid AND att.attnum = ANY(con.conkey)
  WHERE con.conrelid = 'notifications'::regclass
    AND con.contype = 'c'
    AND att.attname = 'kind';

  -- 2. Drop existing constraint
  IF v_conname IS NOT NULL THEN
    EXECUTE 'ALTER TABLE notifications DROP CONSTRAINT ' || quote_ident(v_conname);
  END IF;

  -- 3. Add expanded check constraint preserving all 10 existing kinds + 2 new kinds
  ALTER TABLE notifications ADD CONSTRAINT notifications_kind_check
    CHECK (kind IN (
      'like',
      'comment',
      'paper_review',
      'message',
      'story_poll_vote',
      'story_question_response',
      'story_question_answered',
      'story_quiz_answer',
      'story_mention',
      'story_reshare',
      'story_reaction',
      'story_reply'
    ));
END $$;

-- 4. Deduplication partial unique index for story reaction notifications
CREATE UNIQUE INDEX IF NOT EXISTS idx_notifications_story_reaction
ON notifications (user_id, actor_id, kind, entity_type, entity_id)
WHERE kind = 'story_reaction';

-- 5. Deduplication partial unique index for story reply notifications
CREATE UNIQUE INDEX IF NOT EXISTS idx_notifications_story_reply
ON notifications (user_id, actor_id, kind, entity_type, entity_id)
WHERE kind = 'story_reply';

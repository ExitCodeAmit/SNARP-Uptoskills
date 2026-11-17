-- Migration 017: Story Reshare Media Support
-- Allows reshared stories (stories with original_story_id IS NOT NULL) to have
-- type 'photo' or 'video' by referencing the original story's media row in story_media
-- without duplicating BYTEA payloads.
-- Safely supports original story deletion via ON DELETE SET NULL.

-- 1. Update check_story_mandatory_media trigger function
CREATE OR REPLACE FUNCTION check_story_mandatory_media()
RETURNS TRIGGER AS $$
BEGIN
  -- If the story was deleted in the same transaction, skip the check
  IF EXISTS (
    SELECT 1 FROM stories
    WHERE id = NEW.id AND type IN ('photo', 'video')
  ) THEN
    -- Case A: Active reshare referencing an existing original story
    IF NEW.original_story_id IS NOT NULL THEN
      IF NOT EXISTS (SELECT 1 FROM story_media WHERE story_id = NEW.original_story_id) THEN
        RAISE EXCEPTION 'Reshared story % of type % must reference an original story with media', NEW.id, NEW.type;
      END IF;

    -- Case B: Reshare whose original story was deleted (ON DELETE SET NULL set original_story_id to NULL)
    -- Identified by tracking row in story_reshares surviving via reshared_story_id CASCADE
    ELSIF EXISTS (
      SELECT 1 FROM story_reshares
      WHERE reshared_story_id = NEW.id
    ) THEN
      -- Reshare of deleted original: media is gone, but deletion transaction must not be blocked
      NULL;

    -- Case C: Direct original photo/video story must strictly have its own media record
    ELSE
      IF NOT EXISTS (SELECT 1 FROM story_media WHERE story_id = NEW.id) THEN
        RAISE EXCEPTION 'Story % of type % must have an associated media record', NEW.id, NEW.type;
      END IF;
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- 2. Index to accelerate active reshare lookups by original_story_id and expiry
CREATE INDEX IF NOT EXISTS idx_stories_active_reshares
ON stories (original_story_id, expires_at)
WHERE original_story_id IS NOT NULL;

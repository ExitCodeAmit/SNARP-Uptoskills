-- Migration 022: Fix Story Quiz Deferred Constraint Trigger
-- In PostgreSQL, deferred row-level AFTER INSERT triggers capture the NEW record at insertion time.
-- When a story quiz is inserted, correct_option_id is initially NULL because options must be inserted first.
-- The subsequent UPDATE sets correct_option_id, but the queued AFTER INSERT trigger still evaluates
-- the initial NEW record where correct_option_id was NULL, causing a false P0001 exception on COMMIT.
-- This migration updates check_story_quiz_constraints() to fetch the current state from story_quizzes.

CREATE OR REPLACE FUNCTION check_story_quiz_constraints()
RETURNS TRIGGER AS $$
DECLARE
  v_correct_id bigint;
  v_opt_count integer;
BEGIN
  -- 1. Safely check if the quiz row still exists in the database
  SELECT correct_option_id INTO v_correct_id
  FROM story_quizzes
  WHERE id = NEW.id;

  -- If the row was deleted in the same transaction, skip verification
  IF NOT FOUND THEN
    RETURN NEW;
  END IF;

  -- 2. Verify that correct_option_id is not NULL
  IF v_correct_id IS NULL THEN
    RAISE EXCEPTION 'Story quiz % must have a valid correct_option_id', NEW.id;
  END IF;

  -- 3. Verify that correct_option_id belongs to this quiz
  IF NOT EXISTS (
    SELECT 1 FROM story_quiz_options
    WHERE id = v_correct_id AND quiz_id = NEW.id
  ) THEN
    RAISE EXCEPTION 'Story quiz % correct_option_id % does not belong to quiz', NEW.id, v_correct_id;
  END IF;

  -- 4. Verify option count is between 2 and 4
  SELECT count(*) INTO v_opt_count
  FROM story_quiz_options
  WHERE quiz_id = NEW.id;

  IF v_opt_count < 2 OR v_opt_count > 4 THEN
    RAISE EXCEPTION 'Story quiz % must have between 2 and 4 options (found %)', NEW.id, v_opt_count;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Recreate constraint trigger to ensure it uses the updated function
DROP TRIGGER IF EXISTS trg_story_quiz_constraints ON story_quizzes;
CREATE CONSTRAINT TRIGGER trg_story_quiz_constraints
AFTER INSERT OR UPDATE ON story_quizzes
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW
EXECUTE FUNCTION check_story_quiz_constraints();

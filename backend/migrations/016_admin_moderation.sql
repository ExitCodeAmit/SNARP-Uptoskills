ALTER TABLE users ADD COLUMN IF NOT EXISTS blocked_at TIMESTAMPTZ;
ALTER TABLE users ADD COLUMN IF NOT EXISTS blocked_reason TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS blocked_by INTEGER REFERENCES users(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS users_role_idx ON users (role);
CREATE INDEX IF NOT EXISTS users_blocked_idx ON users (blocked_at) WHERE blocked_at IS NOT NULL;

ALTER TABLE papers DROP CONSTRAINT IF EXISTS papers_status_check;
UPDATE papers SET status = 'published' WHERE status = 'approved';
ALTER TABLE papers ADD CONSTRAINT papers_status_check
  CHECK (status IN ('coauthor_check', 'pending', 'under_review', 'revision_requested', 'approved', 'rejected', 'published'));

ALTER TABLE papers ADD COLUMN IF NOT EXISTS assigned_to INTEGER REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE papers ADD COLUMN IF NOT EXISTS review_started_at TIMESTAMPTZ;
ALTER TABLE papers ADD COLUMN IF NOT EXISTS published_at TIMESTAMPTZ;
ALTER TABLE papers ADD COLUMN IF NOT EXISTS published_by INTEGER REFERENCES users(id) ON DELETE SET NULL;
UPDATE papers SET published_at = COALESCE(reviewed_at, created_at), published_by = COALESCE(reviewed_by, user_id)
  WHERE status = 'published' AND published_at IS NULL;
CREATE INDEX IF NOT EXISTS papers_published_idx ON papers (published_at DESC, id DESC) WHERE status = 'published';
CREATE INDEX IF NOT EXISTS papers_assigned_idx ON papers (assigned_to) WHERE assigned_to IS NOT NULL;
CREATE INDEX IF NOT EXISTS papers_reviewed_by_idx ON papers (reviewed_by, reviewed_at DESC);

ALTER TABLE paper_reviews DROP CONSTRAINT IF EXISTS paper_reviews_decision_check;
ALTER TABLE paper_reviews ADD CONSTRAINT paper_reviews_decision_check
  CHECK (decision IN ('approved', 'rejected', 'revision_requested', 'resubmitted', 'coauthor_update', 'coauthors_approved',
    'under_review', 'released', 'published', 'status_changed'));
CREATE INDEX IF NOT EXISTS paper_reviews_reviewer_idx ON paper_reviews (reviewer_id, created_at DESC);

CREATE TABLE IF NOT EXISTS paper_notes (
  id         BIGSERIAL PRIMARY KEY,
  paper_id   BIGINT NOT NULL REFERENCES papers(id) ON DELETE CASCADE,
  author_id  INTEGER REFERENCES users(id) ON DELETE SET NULL,
  body       VARCHAR(2000) NOT NULL CHECK (length(trim(body)) > 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS paper_notes_paper_idx ON paper_notes (paper_id, created_at, id);

ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS actor_role VARCHAR(20);
UPDATE audit_logs a SET actor_role = u.role FROM users u WHERE u.id = a.actor_id AND a.actor_role IS NULL;
CREATE INDEX IF NOT EXISTS audit_logs_action_idx ON audit_logs (action, created_at DESC);
CREATE INDEX IF NOT EXISTS audit_logs_actor_idx ON audit_logs (actor_id, created_at DESC);

CREATE OR REPLACE FUNCTION audit_logs_fill_role() RETURNS trigger AS $$
BEGIN
  IF NEW.actor_role IS NULL AND NEW.actor_id IS NOT NULL THEN
    SELECT role INTO NEW.actor_role FROM users WHERE id = NEW.actor_id;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS audit_logs_fill_role ON audit_logs;
CREATE TRIGGER audit_logs_fill_role BEFORE INSERT ON audit_logs
  FOR EACH ROW EXECUTE FUNCTION audit_logs_fill_role();

CREATE OR REPLACE FUNCTION audit_logs_immutable() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'audit log entries cannot be deleted';
  END IF;
  IF NEW.id IS DISTINCT FROM OLD.id OR NEW.action IS DISTINCT FROM OLD.action OR NEW.target_type IS DISTINCT FROM OLD.target_type
    OR NEW.target_id IS DISTINCT FROM OLD.target_id OR NEW.details IS DISTINCT FROM OLD.details
    OR NEW.created_at IS DISTINCT FROM OLD.created_at OR NEW.actor_role IS DISTINCT FROM OLD.actor_role
    OR (NEW.actor_id IS NOT NULL AND NEW.actor_id IS DISTINCT FROM OLD.actor_id) THEN
    RAISE EXCEPTION 'audit log entries cannot be changed';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS audit_logs_immutable ON audit_logs;
CREATE TRIGGER audit_logs_immutable BEFORE UPDATE OR DELETE ON audit_logs
  FOR EACH ROW EXECUTE FUNCTION audit_logs_immutable();

ALTER TABLE notifications DROP CONSTRAINT IF EXISTS notifications_kind_check;
ALTER TABLE notifications ADD CONSTRAINT notifications_kind_check
  CHECK (kind IN ('like', 'comment', 'paper_review', 'message', 'follow', 'paper_like', 'paper_comment', 'review_request', 'coauthor'));

CREATE INDEX IF NOT EXISTS papers_authors_gin_idx ON papers USING gin (authors jsonb_path_ops);

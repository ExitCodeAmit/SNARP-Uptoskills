-- Support the user's profile timeline and submission history sort patterns.
CREATE INDEX posts_user_timeline_idx ON posts (user_id, created_at DESC, id DESC);
CREATE INDEX papers_user_submissions_idx ON papers (user_id, created_at DESC, id DESC);

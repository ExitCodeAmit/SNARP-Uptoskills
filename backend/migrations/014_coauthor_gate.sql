ALTER TABLE papers DROP CONSTRAINT IF EXISTS papers_status_check;
ALTER TABLE papers ADD CONSTRAINT papers_status_check
  CHECK (status IN ('coauthor_check', 'pending', 'revision_requested', 'approved', 'rejected'));
ALTER TABLE papers ADD COLUMN IF NOT EXISTS draft INTEGER NOT NULL DEFAULT 1 CHECK (draft BETWEEN 1 AND 100);

ALTER TABLE paper_versions ADD COLUMN IF NOT EXISTS draft INTEGER NOT NULL DEFAULT 1;
ALTER TABLE paper_versions DROP CONSTRAINT IF EXISTS paper_versions_paper_id_round_key;
ALTER TABLE paper_versions ADD CONSTRAINT paper_versions_paper_round_draft_key UNIQUE (paper_id, round, draft);

ALTER TABLE coauthor_checks ADD COLUMN IF NOT EXISTS draft INTEGER NOT NULL DEFAULT 1;
ALTER TABLE coauthor_checks DROP CONSTRAINT IF EXISTS coauthor_checks_pkey;
ALTER TABLE coauthor_checks ADD PRIMARY KEY (paper_id, round, draft, user_id);

ALTER TABLE paper_reviews DROP CONSTRAINT IF EXISTS paper_reviews_decision_check;
ALTER TABLE paper_reviews ADD CONSTRAINT paper_reviews_decision_check
  CHECK (decision IN ('approved', 'rejected', 'revision_requested', 'resubmitted', 'coauthor_update', 'coauthors_approved'));

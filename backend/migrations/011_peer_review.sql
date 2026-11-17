ALTER TABLE papers DROP CONSTRAINT IF EXISTS papers_status_check;
ALTER TABLE papers ADD CONSTRAINT papers_status_check
  CHECK (status IN ('pending', 'revision_requested', 'approved', 'rejected'));
ALTER TABLE papers ADD COLUMN IF NOT EXISTS round INTEGER NOT NULL DEFAULT 1 CHECK (round BETWEEN 1 AND 50);
ALTER TABLE papers ADD COLUMN IF NOT EXISTS revision_note TEXT;
ALTER TABLE papers ADD COLUMN IF NOT EXISTS resubmitted_at TIMESTAMPTZ;

CREATE TABLE paper_versions (
  id               BIGSERIAL PRIMARY KEY,
  paper_id         BIGINT NOT NULL REFERENCES papers(id) ON DELETE CASCADE,
  round            INTEGER NOT NULL,
  title            VARCHAR(300) NOT NULL,
  abstract         TEXT NOT NULL,
  pdf_data         BYTEA NOT NULL,
  pdf_filename     VARCHAR(255) NOT NULL,
  pdf_size         INTEGER NOT NULL,
  submitted_at     TIMESTAMPTZ NOT NULL,
  archived_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (paper_id, round)
);

CREATE TABLE peer_reviews (
  id                     BIGSERIAL PRIMARY KEY,
  paper_id               BIGINT NOT NULL REFERENCES papers(id) ON DELETE CASCADE,
  round                  INTEGER NOT NULL,
  reviewer_id            INTEGER REFERENCES users(id) ON DELETE SET NULL,
  overall_rating         SMALLINT NOT NULL CHECK (overall_rating BETWEEN 1 AND 5),
  originality            SMALLINT NOT NULL CHECK (originality BETWEEN 1 AND 5),
  methodology            SMALLINT NOT NULL CHECK (methodology BETWEEN 1 AND 5),
  clarity                SMALLINT NOT NULL CHECK (clarity BETWEEN 1 AND 5),
  significance           SMALLINT NOT NULL CHECK (significance BETWEEN 1 AND 5),
  recommendation         VARCHAR(20) NOT NULL CHECK (recommendation IN ('accept', 'minor_revision', 'major_revision', 'reject')),
  comments               TEXT NOT NULL,
  confidential_comments  TEXT NOT NULL DEFAULT '',
  created_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (paper_id, round, reviewer_id)
);
CREATE INDEX peer_reviews_reviewer_idx ON peer_reviews (reviewer_id, created_at DESC);

CREATE TABLE review_suggestions (
  id               BIGSERIAL PRIMARY KEY,
  review_id        BIGINT NOT NULL REFERENCES peer_reviews(id) ON DELETE CASCADE,
  position         SMALLINT NOT NULL,
  section          VARCHAR(120) NOT NULL DEFAULT '',
  body             VARCHAR(2000) NOT NULL,
  status           VARCHAR(10) NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'addressed', 'declined')),
  author_response  VARCHAR(2000) NOT NULL DEFAULT '',
  responded_at     TIMESTAMPTZ
);
CREATE INDEX review_suggestions_review_idx ON review_suggestions (review_id, position);

ALTER TABLE paper_reviews DROP CONSTRAINT IF EXISTS paper_reviews_decision_check;
ALTER TABLE paper_reviews ADD CONSTRAINT paper_reviews_decision_check
  CHECK (decision IN ('approved', 'rejected', 'revision_requested', 'resubmitted'));
ALTER TABLE paper_reviews ADD COLUMN IF NOT EXISTS round INTEGER NOT NULL DEFAULT 1;
ALTER TABLE paper_reviews ALTER COLUMN comment TYPE TEXT;

ALTER TABLE notifications DROP CONSTRAINT IF EXISTS notifications_kind_check;
ALTER TABLE notifications ADD CONSTRAINT notifications_kind_check
  CHECK (kind IN ('like', 'comment', 'paper_review', 'message', 'follow', 'paper_like', 'paper_comment', 'review_request'));

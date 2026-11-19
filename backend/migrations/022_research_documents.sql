-- SNARP Docs: collaborative research documents. The rich text lives in ydoc_state (a Yjs update),
-- written by the real-time collaboration server; sharing goes through invitations the invitee accepts.

CREATE TABLE research_documents (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title       VARCHAR(300) NOT NULL CHECK (length(btrim(title)) > 0),
  description VARCHAR(5000) NOT NULL DEFAULT '',
  ydoc_state  BYTEA,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX research_documents_owner_updated_idx ON research_documents (owner_id, updated_at DESC);

CREATE TABLE research_document_members (
  document_id UUID NOT NULL REFERENCES research_documents(id) ON DELETE CASCADE,
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  permission  VARCHAR(10) NOT NULL CHECK (permission IN ('editor', 'viewer')),
  added_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (document_id, user_id)
);

CREATE INDEX research_document_members_user_idx ON research_document_members (user_id, document_id);

CREATE TABLE research_document_invitations (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id  UUID NOT NULL REFERENCES research_documents(id) ON DELETE CASCADE,
  inviter_id   INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  invitee_id   INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  permission   VARCHAR(10) NOT NULL CHECK (permission IN ('editor', 'viewer')),
  status       VARCHAR(10) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'rejected', 'cancelled')),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  responded_at TIMESTAMPTZ,
  CHECK (inviter_id <> invitee_id)
);

CREATE UNIQUE INDEX research_document_invitations_pending_idx
  ON research_document_invitations (document_id, invitee_id) WHERE status = 'pending';
CREATE INDEX research_document_invitations_inbox_idx
  ON research_document_invitations (invitee_id, created_at DESC) WHERE status = 'pending';

ALTER TABLE notifications DROP CONSTRAINT IF EXISTS notifications_kind_check;
ALTER TABLE notifications ADD CONSTRAINT notifications_kind_check
  CHECK (kind IN ('like', 'comment', 'paper_review', 'message', 'follow', 'paper_like', 'paper_comment', 'review_request', 'coauthor', 'story_mention', 'reel_like', 'reel_comment', 'reel_tag', 'doc_invite', 'doc_joined'));

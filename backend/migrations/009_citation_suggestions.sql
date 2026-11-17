
-- Automatic citation detection suggestions
-- Suggestions are NOT citations until the author accepts them.

CREATE TABLE IF NOT EXISTS citation_suggestions (
    id BIGSERIAL PRIMARY KEY,

    citing_paper_id BIGINT NOT NULL
        REFERENCES papers(id) ON DELETE CASCADE,

    cited_paper_id BIGINT NOT NULL
        REFERENCES papers(id) ON DELETE CASCADE,

    created_by BIGINT NOT NULL
        REFERENCES users(id) ON DELETE CASCADE,

    citation_id BIGINT
        REFERENCES paper_citations(id) ON DELETE SET NULL,

    match_type TEXT NOT NULL
        CHECK (match_type IN ('doi', 'title')),

    confidence NUMERIC(4,3) NOT NULL
        CHECK (confidence >= 0 AND confidence <= 1),

    evidence_text TEXT NOT NULL DEFAULT '',

    status TEXT NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'accepted', 'dismissed')),

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT citation_suggestion_not_self
        CHECK (citing_paper_id <> cited_paper_id),

    CONSTRAINT unique_citation_suggestion
        UNIQUE (citing_paper_id, cited_paper_id)
);

CREATE INDEX IF NOT EXISTS idx_citation_suggestions_creator
    ON citation_suggestions(created_by, status);

CREATE INDEX IF NOT EXISTS idx_citation_suggestions_source
    ON citation_suggestions(citing_paper_id);

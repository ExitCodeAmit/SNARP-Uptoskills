CREATE TABLE IF NOT EXISTS paper_citations (
    id BIGSERIAL PRIMARY KEY,

    citing_paper_id BIGINT NOT NULL
        REFERENCES papers(id) ON DELETE CASCADE,

    cited_paper_id BIGINT NOT NULL
        REFERENCES papers(id) ON DELETE CASCADE,

    created_by BIGINT NOT NULL
        REFERENCES users(id) ON DELETE CASCADE,

    created_at TIMESTAMPTZ DEFAULT NOW(),

    CONSTRAINT unique_paper_citation
        UNIQUE (citing_paper_id, cited_paper_id),

    CONSTRAINT prevent_self_citation
        CHECK (citing_paper_id <> cited_paper_id)
);

CREATE INDEX idx_citations_cited
ON paper_citations(cited_paper_id);

CREATE INDEX idx_citations_citing
ON paper_citations(citing_paper_id);
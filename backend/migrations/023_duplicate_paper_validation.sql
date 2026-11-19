-- Duplicate detection fingerprint columns
ALTER TABLE papers ADD COLUMN IF NOT EXISTS file_hash VARCHAR(64);
ALTER TABLE papers ADD COLUMN IF NOT EXISTS content_hash VARCHAR(64);

-- Partial unique indexes for dedup (NULLs are excluded so legacy rows are safe)
CREATE UNIQUE INDEX IF NOT EXISTS papers_file_hash_uniq ON papers (file_hash) WHERE file_hash IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS papers_content_hash_uniq ON papers (content_hash) WHERE content_hash IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS papers_doi_uniq ON papers (LOWER(TRIM(BOTH FROM REGEXP_REPLACE(doi, '^(?:https?://(?:dx\\.)?doi\\.org/|doi:\\s*)', '', 'i')))) WHERE doi IS NOT NULL AND TRIM(doi) != '';

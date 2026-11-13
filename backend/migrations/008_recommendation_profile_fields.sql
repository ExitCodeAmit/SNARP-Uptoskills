ALTER TABLE users
  ADD COLUMN IF NOT EXISTS research_interests TEXT[] NOT NULL DEFAULT '{}';

ALTER TABLE papers
  ADD COLUMN IF NOT EXISTS publication_date DATE;

UPDATE users u
SET research_interests = up.research_interests
FROM user_profiles up
WHERE up.user_id = u.id
  AND cardinality(u.research_interests) = 0
  AND cardinality(up.research_interests) > 0;

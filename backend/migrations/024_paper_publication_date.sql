-- Optional date the paper was published elsewhere (journal or conference), shown on paper cards.
ALTER TABLE papers ADD COLUMN IF NOT EXISTS publication_date DATE;

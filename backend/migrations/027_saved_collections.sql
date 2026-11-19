-- Collections (PR #2): personal folders for saved posts and papers. Each user gets an "Unsorted" default folder.
CREATE TABLE IF NOT EXISTS save_folders (
  id         SERIAL PRIMARY KEY,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name       VARCHAR(80) NOT NULL,
  is_default BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS save_folders_user_name_idx ON save_folders (user_id, lower(name));
CREATE UNIQUE INDEX IF NOT EXISTS save_folders_one_default_idx ON save_folders (user_id) WHERE is_default;

CREATE TABLE IF NOT EXISTS saved_items (
  id         BIGSERIAL PRIMARY KEY,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  folder_id  INTEGER NOT NULL REFERENCES save_folders(id) ON DELETE CASCADE,
  post_id    INTEGER REFERENCES posts(id) ON DELETE CASCADE,
  paper_id   BIGINT REFERENCES papers(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK ((post_id IS NOT NULL AND paper_id IS NULL) OR (post_id IS NULL AND paper_id IS NOT NULL))
);
CREATE UNIQUE INDEX IF NOT EXISTS saved_items_folder_post_idx ON saved_items (folder_id, post_id) WHERE post_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS saved_items_folder_paper_idx ON saved_items (folder_id, paper_id) WHERE paper_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS saved_items_user_created_idx ON saved_items (user_id, created_at DESC);

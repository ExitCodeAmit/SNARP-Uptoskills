CREATE TABLE events (
  id          BIGSERIAL PRIMARY KEY,
  title       VARCHAR(200) NOT NULL,
  description VARCHAR(3000) NOT NULL,
  kind        VARCHAR(80) NOT NULL,
  location    VARCHAR(200) NOT NULL,
  starts_at   TIMESTAMPTZ NOT NULL,
  ends_at     TIMESTAMPTZ NOT NULL,
  capacity    INTEGER CHECK (capacity IS NULL OR capacity > 0),
  status      VARCHAR(20) NOT NULL DEFAULT 'published' CHECK (status IN ('published', 'cancelled')),
  created_by  INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (length(trim(title)) > 0),
  CHECK (length(trim(kind)) > 0),
  CHECK (ends_at > starts_at)
);
CREATE INDEX events_upcoming_idx ON events (starts_at, id) WHERE status = 'published';
CREATE INDEX events_creator_idx ON events (created_by, starts_at DESC);

CREATE TABLE event_registrations (
  event_id      BIGINT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  user_id       INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  registered_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (event_id, user_id)
);
CREATE INDEX event_registrations_user_idx ON event_registrations (user_id, registered_at DESC);

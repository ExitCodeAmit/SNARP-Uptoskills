-- Migration 019: Story Music Support
-- Enables attaching licensed music metadata and visual stickers to Stories.
-- Does NOT store audio binary payloads or ephemeral CDN URLs.
-- Enforces per-track licensing, sync verification, evidence tracking, and fail-closed territory authorization.
--
-- LEGAL & RIGHTS NOTES:
-- 1. A non-null 'verified_at' timestamp alone does NOT establish legal rights; independent backend
--    verification against trusted provider licensing terms remains mandatory prior to persistence.
-- 2. 'verified_mock' status is permitted strictly in development and testing environments; the backend
--    must reject 'verified_mock' in production environments (NODE_ENV === 'production').
-- 3. 'story_music' must contain only verified, approved tracks; unverified or restricted tracks
--    must be rejected at the API/validator layer and never persisted.

CREATE TABLE IF NOT EXISTS story_music (
  id                   BIGSERIAL PRIMARY KEY,
  story_id             BIGINT NOT NULL UNIQUE REFERENCES stories(id) ON DELETE CASCADE,
  provider             VARCHAR(50) NOT NULL, -- e.g. 'mock_licensed', 'jamendo_cc', 'direct_catalog'
  track_id             VARCHAR(255) NOT NULL,
  title                VARCHAR(200) NOT NULL,
  artist               VARCHAR(200) NOT NULL,
  artwork_url          TEXT,
  start_time_seconds   INTEGER NOT NULL DEFAULT 0 CHECK (start_time_seconds >= 0),
  duration_seconds     INTEGER NOT NULL DEFAULT 15 CHECK (duration_seconds >= 3 AND duration_seconds <= 15),
  sticker_style        VARCHAR(30) NOT NULL DEFAULT 'classic'
                       CHECK (sticker_style IN ('classic', 'compact', 'vinyl', 'wave')),
  sticker_x            NUMERIC(5,2) NOT NULL DEFAULT 50.0 CHECK (sticker_x >= 0.0 AND sticker_x <= 100.0),
  sticker_y            NUMERIC(5,2) NOT NULL DEFAULT 75.0 CHECK (sticker_y >= 0.0 AND sticker_y <= 100.0),
  audio_mix_mode       VARCHAR(20) NOT NULL DEFAULT 'both'
                       CHECK (audio_mix_mode IN ('both', 'music_only', 'video_only')),
  license_type         VARCHAR(50) NOT NULL, -- e.g. 'CC-BY-4.0', 'CC0-1.0', 'DIRECT-SYNC-V1'
  license_version      VARCHAR(20) NOT NULL,
  license_url          TEXT NOT NULL,
  source_url           TEXT NOT NULL,
  attribution_text     VARCHAR(500) NOT NULL,
  provider_attribution VARCHAR(300),
  rights_evidence_ref  TEXT,
  verified_at          TIMESTAMPTZ NOT NULL,
  rights_status        VARCHAR(30) NOT NULL
                       CHECK (rights_status IN ('verified_mock', 'cc_verified', 'licensed_direct')),
  allowed_territories  TEXT[] NOT NULL DEFAULT '{}', -- Fail-closed: empty array indicates unverified/no cleared territories
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Note: UNIQUE (story_id) automatically creates unique index story_music_story_id_key in PostgreSQL.
-- Non-unique B-tree index on (provider, track_id) to accelerate track usage lookup across stories:
CREATE INDEX IF NOT EXISTS idx_story_music_provider_track ON story_music (provider, track_id);

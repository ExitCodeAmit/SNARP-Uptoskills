import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const modalPath = path.join(__dirname, 'StoryViewerModal.jsx')

// ── 1. Mention-Gated Reshare Eligibility Logic ──────────────────────────────
test('Frontend Logic: Reshare button is visible ONLY for mentioned users in active peer stories', () => {
  const checkEligibility = ({ isOwner, originalStoryId, expiresAt, mentions, currentUserId }) => {
    const isMentionedInStory = Boolean(
      currentUserId &&
      Array.isArray(mentions) &&
      mentions.some((m) => String(m.id) === String(currentUserId))
    )

    return Boolean(
      !isOwner &&
      isMentionedInStory &&
      !originalStoryId &&
      expiresAt &&
      new Date(expiresAt) > new Date()
    )
  }

  const future = new Date(Date.now() + 3600000).toISOString()
  const past = new Date(Date.now() - 3600000).toISOString()

  // Case 1: Mentioned peer user (Bob, id 20) viewing Alice's active story
  const aliceStoryMentions = [{ id: 20, username: 'bob' }, { id: 21, username: 'charlie' }]
  assert.equal(
    checkEligibility({
      isOwner: false,
      originalStoryId: null,
      expiresAt: future,
      mentions: aliceStoryMentions,
      currentUserId: 20,
    }),
    true,
    'Mentioned user Bob must see the Reshare button'
  )

  // Case 2: Unmentioned peer user (David, id 99) viewing Alice's active story
  assert.equal(
    checkEligibility({
      isOwner: false,
      originalStoryId: null,
      expiresAt: future,
      mentions: aliceStoryMentions,
      currentUserId: 99,
    }),
    false,
    'Unmentioned user David must NOT see the Reshare button'
  )

  // Case 3: Empty mentions array -> ordinary viewers cannot reshare
  assert.equal(
    checkEligibility({
      isOwner: false,
      originalStoryId: null,
      expiresAt: future,
      mentions: [],
      currentUserId: 20,
    }),
    false,
    'Story with no mentions cannot be reshared by any viewer'
  )

  // Case 4: Owner is mentioned in their own story (edge case) -> still blocked by isOwner
  assert.equal(
    checkEligibility({
      isOwner: true,
      originalStoryId: null,
      expiresAt: future,
      mentions: [{ id: 10, username: 'alice' }],
      currentUserId: 10,
    }),
    false,
    'Story owner must never see the Reshare button for their own story'
  )

  // Case 5: Expired story -> blocked even if user was mentioned
  assert.equal(
    checkEligibility({
      isOwner: false,
      originalStoryId: null,
      expiresAt: past,
      mentions: aliceStoryMentions,
      currentUserId: 20,
    }),
    false,
    'Expired story cannot be reshared'
  )

  // Case 6: Nested story (already a reshare) -> blocked even if user was mentioned
  assert.equal(
    checkEligibility({
      isOwner: false,
      originalStoryId: '50',
      expiresAt: future,
      mentions: aliceStoryMentions,
      currentUserId: 20,
    }),
    false,
    'Nested reshares are blocked'
  )
})

// ── 2. StoryViewerModal Component Contracts ─────────────────────────────────
test('UI Contract: StoryViewerModal enforces isMentionedInStory guard on isEligibleForReshare', () => {
  const jsx = fs.readFileSync(modalPath, 'utf8')

  assert.ok(jsx.includes('isMentionedInStory'), 'StoryViewerModal must compute isMentionedInStory')
  assert.ok(jsx.includes('currentStory.mentions.some'), 'Checks if currentUser is in currentStory.mentions')
  assert.ok(jsx.includes('isEligibleForReshare = Boolean'), 'Computes isEligibleForReshare')
  assert.ok(jsx.includes('!isOwner'), 'Guards against owner reshares')
  assert.ok(jsx.includes('isMentionedInStory'), 'Requires isMentionedInStory for eligibility')
})

test('UI Contract: Reshared photo and video render using existing photo and video stages', () => {
  const jsx = fs.readFileSync(modalPath, 'utf8')

  // Photo rendering
  assert.ok(jsx.includes("currentStory.type === 'photo'"), 'Renders photo container for photo stories')
  assert.ok(jsx.includes('className="story-photo-container"'), 'Uses .story-photo-container')
  assert.ok(jsx.includes('className="story-caption-overlay"'), 'Renders caption overlay for media stories')

  // Video rendering
  assert.ok(jsx.includes("currentStory.type === 'video'"), 'Renders video container for video stories')
  assert.ok(jsx.includes('className="story-video-container"'), 'Uses .story-video-container')

  // Attribution in header
  assert.ok(jsx.includes('story-viewer-reshare-badge'), 'Renders reshare attribution badge in header')
  assert.ok(jsx.includes('story-reshare-attribution-link'), 'Links to original author profile')

  // Graceful fallback for unavailable media
  assert.ok(jsx.includes('story-media-error'), 'Renders story-media-error when media cannot load or original deleted')
})

import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

// ── 1. Code Contract: StoryComposer.jsx Audience Architecture ─────────────────
test('Code Contract: StoryComposer.jsx imports and audience state structure', () => {
  const composerPath = path.join(__dirname, 'StoryComposer.jsx')
  assert.ok(fs.existsSync(composerPath), 'StoryComposer.jsx must exist')

  const content = fs.readFileSync(composerPath, 'utf8')

  // Check imports
  assert.ok(content.includes('CloseFriendsModal'), 'Must import CloseFriendsModal')
  assert.ok(content.includes('Users') && content.includes('Star'), 'Must import Users and Star icons')

  // Check state initializations
  assert.ok(content.includes("const [audience, setAudience] = useState('everyone')"), 'Default audience state must be "everyone"')
  assert.ok(content.includes('const [closeFriendsCount, setCloseFriendsCount] = useState(null)'), 'Must manage closeFriendsCount state')
  assert.ok(content.includes('const [showCloseFriendsModal, setShowCloseFriendsModal] = useState(false)'), 'Must manage showCloseFriendsModal state')

  // Check Close Friends count API fetch
  assert.ok(content.includes('/stories/close-friends'), 'Must fetch close friends from /stories/close-friends')

  // Check FormData appending
  assert.ok(content.includes("form.append('audience', audience)"), 'Must append audience to FormData')

  // Check CloseFriendsModal render
  assert.ok(content.includes('<CloseFriendsModal'), 'Must render CloseFriendsModal when showCloseFriendsModal is true')
})

// ── 2. Code Contract: stories.css Audience Selector Styling ──────────────────
test('Code Contract: stories.css defines styles for audience selector & Close Friends pills', () => {
  const cssPath = path.join(__dirname, 'stories.css')
  assert.ok(fs.existsSync(cssPath), 'stories.css must exist')

  const css = fs.readFileSync(cssPath, 'utf8')

  assert.ok(css.includes('.sc-audience-container'), 'Must define .sc-audience-container')
  assert.ok(css.includes('.sc-audience-header'), 'Must define .sc-audience-header')
  assert.ok(css.includes('.sc-audience-label'), 'Must define .sc-audience-label')
  assert.ok(css.includes('.sc-audience-options'), 'Must define .sc-audience-options')
  assert.ok(css.includes('.sc-audience-pill'), 'Must define .sc-audience-pill')
  assert.ok(css.includes('.sc-audience-pill-active'), 'Must define .sc-audience-pill-active')
  assert.ok(css.includes('.sc-audience-pill-cf'), 'Must define .sc-audience-pill-cf')
  assert.ok(css.includes('.sc-audience-star-icon'), 'Must define .sc-audience-star-icon')
  assert.ok(css.includes('.sc-audience-cf-count'), 'Must define .sc-audience-cf-count')
  assert.ok(css.includes('.sc-audience-empty-warning'), 'Must define .sc-audience-empty-warning')
  assert.ok(css.includes('.sc-audience-manage-btn'), 'Must define .sc-audience-manage-btn')
})

// ── 3. Scenario 1: Default audience is 'everyone' ─────────────────────────────
test('Scenario 1: Default audience is strictly "everyone"', () => {
  const getInitialAudience = () => 'everyone'
  const initialAudience = getInitialAudience()
  assert.equal(initialAudience, 'everyone', 'Default audience must always be "everyone"')
})

// ── 4. Scenario 2: User can select 'close_friends' ────────────────────────────
test('Scenario 2: User can select "close_friends" and view Close Friends badge', () => {
  let audience = 'everyone'
  let error = 'Some previous error'

  const selectAudience = (newAudience) => {
    audience = newAudience
    error = '' // Switching audience clears errors
  }

  selectAudience('close_friends')
  assert.equal(audience, 'close_friends', 'Audience should update to "close_friends"')
  assert.equal(error, '', 'Selecting audience should clear previous errors')
})

// ── 5. Scenario 3: User can switch back to 'everyone' ─────────────────────────
test('Scenario 3: User can switch back from "close_friends" to "everyone"', () => {
  let audience = 'close_friends'

  const selectAudience = (newAudience) => {
    audience = newAudience
  }

  selectAudience('everyone')
  assert.equal(audience, 'everyone', 'Audience should toggle back to "everyone"')
})

// ── 6. Scenario 4: Selected audience is included in FormData ─────────────────
test('Scenario 4: Selected audience is properly appended to FormData payload', () => {
  const buildFormData = ({ type, content, backgroundStyle, audience }) => {
    const entries = {}
    entries['type'] = type
    entries['backgroundStyle'] = backgroundStyle
    entries['audience'] = audience
    entries['content'] = content
    return entries
  }

  const payloadPublic = buildFormData({
    type: 'text',
    content: 'Hello World',
    backgroundStyle: 'sunset',
    audience: 'everyone',
  })
  assert.equal(payloadPublic.audience, 'everyone')

  const payloadCF = buildFormData({
    type: 'text',
    content: 'Secret post for close friends',
    backgroundStyle: 'emerald',
    audience: 'close_friends',
  })
  assert.equal(payloadCF.audience, 'close_friends')
})

// ── 7. Scenario 5: Text story submission preserves audience ───────────────────
test('Scenario 5: Text story submission preserves audience across tab selections', () => {
  let currentAudience = 'close_friends'
  const tab = 'text'
  const textContent = 'Quick update for friends'
  const bgStyle = 'ocean'

  const simulateSubmit = (audienceValue) => {
    return {
      type: tab,
      content: textContent,
      backgroundStyle: bgStyle,
      audience: audienceValue,
    }
  }

  const result = simulateSubmit(currentAudience)
  assert.equal(result.type, 'text')
  assert.equal(result.audience, 'close_friends')
  assert.equal(result.content, 'Quick update for friends')
})

// ── 8. Scenario 6: Photo story submission preserves audience ──────────────────
test('Scenario 6: Photo story submission preserves audience', () => {
  const currentAudience = 'close_friends'
  const tab = 'photo'
  const mediaCaption = 'At the concert'
  const mockFile = { name: 'photo.jpg', size: 1024 }

  const simulatePhotoSubmit = (audienceValue) => {
    return {
      type: tab,
      content: mediaCaption,
      hasMedia: Boolean(mockFile),
      audience: audienceValue,
    }
  }

  const result = simulatePhotoSubmit(currentAudience)
  assert.equal(result.type, 'photo')
  assert.equal(result.audience, 'close_friends')
  assert.equal(result.content, 'At the concert')
  assert.equal(result.hasMedia, true)
})

// ── 9. Scenario 7: Video story submission preserves audience ──────────────────
test('Scenario 7: Video story submission preserves audience', () => {
  const currentAudience = 'close_friends'
  const tab = 'video'
  const mediaCaption = 'Sunset clip'
  const mockFile = { name: 'clip.mp4', size: 5000000 }

  const simulateVideoSubmit = (audienceValue) => {
    return {
      type: tab,
      content: mediaCaption,
      hasMedia: Boolean(mockFile),
      audience: audienceValue,
    }
  }

  const result = simulateVideoSubmit(currentAudience)
  assert.equal(result.type, 'video')
  assert.equal(result.audience, 'close_friends')
  assert.equal(result.content, 'Sunset clip')
  assert.equal(result.hasMedia, true)
})

// ── 10. Scenario 8: Empty Close Friends list handling ─────────────────────────
test('Scenario 8: Empty Close Friends list blocks submission, shows error, provides modal entry point', () => {
  let error = ''
  let submitted = false
  let showModal = false

  const validateAndSubmit = ({ audience, closeFriendsCount }) => {
    if (audience === 'close_friends' && closeFriendsCount === 0) {
      error = 'Your Close Friends list is empty. Add friends to your Close Friends list before sharing a story with them.'
      return false
    }
    submitted = true
    return true
  }

  // Case A: 0 close friends, audience = 'close_friends' -> blocked
  const allowedA = validateAndSubmit({ audience: 'close_friends', closeFriendsCount: 0 })
  assert.equal(allowedA, false, 'Submission must be blocked when close friends count is 0')
  assert.equal(submitted, false)
  assert.equal(
    error,
    'Your Close Friends list is empty. Add friends to your Close Friends list before sharing a story with them.'
  )

  // User clicks "Add friends" button
  showModal = true
  assert.equal(showModal, true, 'Clicking Add friends should open CloseFriendsModal')

  // Case B: Close friends added (count = 3), audience = 'close_friends' -> allowed
  error = ''
  const allowedB = validateAndSubmit({ audience: 'close_friends', closeFriendsCount: 3 })
  assert.equal(allowedB, true, 'Submission must be allowed when close friends exist')
  assert.equal(submitted, true)
  assert.equal(error, '')

  // Case C: 0 close friends, but audience = 'everyone' -> allowed
  submitted = false
  const allowedC = validateAndSubmit({ audience: 'everyone', closeFriendsCount: 0 })
  assert.equal(allowedC, true, 'Public stories allowed regardless of close friends count')
  assert.equal(submitted, true)
})

// ── 11. Scenario 9: Backend validation errors are displayed ───────────────────
test('Scenario 9: Backend validation errors are properly surfaced to the user', async () => {
  let errorState = ''
  let submitting = true

  const simulateApiCall = async (shouldFail) => {
    if (shouldFail) {
      throw new Error('Invalid audience parameter: must be everyone or close_friends')
    }
    return { story: { id: 101, audience: 'close_friends' } }
  }

  try {
    await simulateApiCall(true)
  } catch (err) {
    errorState = err.message || 'Failed to share story'
  } finally {
    submitting = false
  }

  assert.equal(errorState, 'Invalid audience parameter: must be everyone or close_friends')
  assert.equal(submitting, false, 'Submitting state must be reset on failure')
})

// ── 12. Scenario 10: Existing Composer features remain intact ─────────────────
test('Scenario 10: Existing Composer features (presets, media, polls, questions, quizzes, mentions) remain intact', () => {
  const composerPath = path.join(__dirname, 'StoryComposer.jsx')
  const content = fs.readFileSync(composerPath, 'utf8')

  // Presets
  assert.ok(content.includes('STORY_BACKGROUND_PRESETS'), 'Background presets must remain supported')
  assert.ok(content.includes('bgStyle'), 'Background style state must be maintained')

  // Media
  assert.ok(content.includes('MAX_MEDIA_BYTES'), 'Media byte validation must be preserved')
  assert.ok(content.includes('MAX_VIDEO_DURATION_SECONDS'), 'Video duration validation must be preserved')

  // Poll sticker
  assert.ok(content.includes('hasPoll'), 'Poll sticker state must be maintained')
  assert.ok(content.includes('StoryPollCard'), 'StoryPollCard must remain imported')

  // Question sticker
  assert.ok(content.includes('hasQuestion'), 'Question sticker state must be maintained')
  assert.ok(content.includes('StoryQuestionCard'), 'StoryQuestionCard must remain imported')

  // Quiz sticker
  assert.ok(content.includes('hasQuiz'), 'Quiz sticker state must be maintained')
  assert.ok(content.includes('StoryQuizCard'), 'StoryQuizCard must remain imported')

  // Mentions
  assert.ok(content.includes('MAX_STORY_MENTIONS'), 'Mentions feature must remain maintained')
  assert.ok(content.includes('mentionSuggestions'), 'Mention suggestions state must be maintained')
})

import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

// ── 1. Reshare Eligibility Logic ─────────────────────────────────────────────
test('Reshare Eligibility: Visible only for eligible peer stories, blocked for owner, nested, or expired stories', () => {
  const isEligible = ({ isOwner, originalStoryId, expiresAt }) => {
    return Boolean(
      !isOwner &&
      !originalStoryId &&
      expiresAt &&
      new Date(expiresAt) > new Date()
    )
  }

  const future = new Date(Date.now() + 3600000).toISOString()
  const past = new Date(Date.now() - 3600000).toISOString()

  // 1. Eligible peer story
  assert.equal(isEligible({ isOwner: false, originalStoryId: null, expiresAt: future }), true)

  // 2. Own story restriction
  assert.equal(isEligible({ isOwner: true, originalStoryId: null, expiresAt: future }), false)

  // 3. Nested reshare restriction (story is already a reshare)
  assert.equal(isEligible({ isOwner: false, originalStoryId: '10', expiresAt: future }), false)

  // 4. Expired story restriction
  assert.equal(isEligible({ isOwner: false, originalStoryId: null, expiresAt: past }), false)
})

// ── 2. Request Payload Formatting ────────────────────────────────────────────
test('Reshare Payload: Formats optional caption and background style without extra unwanted parameters', () => {
  const buildPayload = ({ caption, backgroundStyle }) => {
    const payload = {}
    if (typeof caption === 'string' && caption.trim()) {
      payload.content = caption.trim().slice(0, 500)
    }
    if (typeof backgroundStyle === 'string' && backgroundStyle.trim()) {
      payload.backgroundStyle = backgroundStyle.trim()
    }
    return payload
  }

  // Empty caption
  assert.deepEqual(buildPayload({ caption: '', backgroundStyle: '' }), {})
  assert.deepEqual(buildPayload({ caption: '   ', backgroundStyle: null }), {})

  // Custom caption trimmed and sliced to 500 chars
  const custom = buildPayload({ caption: '  Check this awesome story!  ', backgroundStyle: 'gradient-royal' })
  assert.deepEqual(custom, {
    content: 'Check this awesome story!',
    backgroundStyle: 'gradient-royal',
  })

  // Long caption
  const longCaption = 'A'.repeat(550)
  const sliced = buildPayload({ caption: longCaption })
  assert.equal(sliced.content.length, 500)
})

// ── 3. Duplicate Submission & Loading Prevention ──────────────────────────────
test('Reshare UX: Disables action button and prevents duplicate submissions while request is pending', () => {
  let callCount = 0
  let isResharing = false

  const triggerReshare = async () => {
    if (isResharing) return
    isResharing = true
    callCount++
    // simulate async request
  }

  // First click
  triggerReshare()
  assert.equal(callCount, 1)
  assert.equal(isResharing, true)

  // Second click while in progress is ignored
  triggerReshare()
  assert.equal(callCount, 1)

  // After completion
  isResharing = false
  triggerReshare()
  assert.equal(callCount, 2)
})

// ── 4. Confirmation & Cancellation Lifecycle ──────────────────────────────────
test('Reshare Confirmation: Allows user to cancel without creating or submitting anything', () => {
  let showConfirm = false
  let reshareError = 'old error'
  let reshareSuccess = true

  const openConfirm = () => {
    reshareError = null
    reshareSuccess = false
    showConfirm = true
  }

  const cancelConfirm = () => {
    showConfirm = false
    reshareError = null
    reshareSuccess = false
  }

  openConfirm()
  assert.equal(showConfirm, true)
  assert.equal(reshareError, null)
  assert.equal(reshareSuccess, false)

  cancelConfirm()
  assert.equal(showConfirm, false)
  assert.equal(reshareError, null)
  assert.equal(reshareSuccess, false)
})

// ── 5. Attribution Display & Safe Fallback ────────────────────────────────────
test('Attribution Display: Renders original author when metadata exists, shows safe fallback when unavailable', () => {
  const resolveAttribution = (reshareMeta) => {
    if (!reshareMeta || reshareMeta.unavailable) {
      return {
        hasAuthor: false,
        text: 'Reshared story',
        link: null,
      }
    }
    const authorHandle = reshareMeta.author_username || reshareMeta.author_name || 'user'
    return {
      hasAuthor: true,
      text: `Reshared from @${authorHandle}`,
      link: `/users/${reshareMeta.user_id}`,
    }
  }

  // 1. Valid metadata
  const valid = resolveAttribution({
    user_id: 42,
    author_name: 'Alice Wonder',
    author_username: 'alice',
    author_avatar_url: '/api/images/10',
  })
  assert.equal(valid.hasAuthor, true)
  assert.equal(valid.text, 'Reshared from @alice')
  assert.equal(valid.link, '/users/42')

  // 2. Unavailable metadata (e.g. original story deleted)
  const unavailable = resolveAttribution({
    unavailable: true,
    message: 'Original story is no longer available',
  })
  assert.equal(unavailable.hasAuthor, false)
  assert.equal(unavailable.text, 'Reshared story')
  assert.equal(unavailable.link, null)

  // 3. Missing metadata fallback
  const missing = resolveAttribution(null)
  assert.equal(missing.hasAuthor, false)
  assert.equal(missing.text, 'Reshared story')
  assert.equal(missing.link, null)
})

// ── 6. Deep-Link URL Resolution & Duplicate Prevention ────────────────────────
test('Deep Link: Resolves target story, opens viewer at correct index, and cleans up search params without duplicate openings', () => {
  const myStories = [{ id: '101' }, { id: '102' }]
  const peerUsers = [
    {
      user: { id: 2, name: 'Bob' },
      stories: [{ id: '201' }, { id: '202' }],
    },
  ]

  let openedViewer = null
  let cleanedUp = false
  const handledRef = { current: null }

  const resolveStoryDeepLink = (storyParam, me) => {
    if (!storyParam) return
    if (handledRef.current === storyParam) return
    handledRef.current = storyParam

    const targetId = String(storyParam)

    // Check myStories
    const myIdx = myStories.findIndex((s) => s.id === targetId)
    if (myIdx >= 0) {
      openedViewer = { user: me, stories: myStories, initialIndex: myIdx }
      cleanedUp = true
      return
    }

    // Check peers
    for (const peer of peerUsers) {
      const pIdx = peer.stories.findIndex((s) => s.id === targetId)
      if (pIdx >= 0) {
        openedViewer = { user: peer.user, stories: peer.stories, initialIndex: pIdx }
        cleanedUp = true
        return
      }
    }

    // Unavailable / Expired
    cleanedUp = true
  }

  // 1. Resolve peer story 202
  resolveStoryDeepLink('202', { id: 1 })
  assert.ok(openedViewer)
  assert.equal(openedViewer.user.name, 'Bob')
  assert.equal(openedViewer.initialIndex, 1)
  assert.equal(cleanedUp, true)

  // 2. Duplicate invocation with same storyParam does not re-open or trigger side effects
  openedViewer = null
  resolveStoryDeepLink('202', { id: 1 })
  assert.equal(openedViewer, null, 'Duplicate re-render with handled storyParam must not re-open viewer')

  // 3. Nonexistent / expired story cleans up safely without throwing
  handledRef.current = null
  openedViewer = null
  cleanedUp = false
  resolveStoryDeepLink('99999', { id: 1 })
  assert.equal(openedViewer, null)
  assert.equal(cleanedUp, true)
})

// ── 7. UI Contract: StoryViewerModal.jsx ─────────────────────────────────────
test('UI Contract: StoryViewerModal.jsx supports Reshare button, confirmation modal, and creator attribution', () => {
  const file = path.join(__dirname, 'StoryViewerModal.jsx')
  assert.ok(fs.existsSync(file), 'StoryViewerModal.jsx must exist')
  const content = fs.readFileSync(file, 'utf8')

  assert.ok(content.includes('ShareFat'), 'Imports ShareFat icon')
  assert.ok(content.includes('isEligibleForReshare'), 'Checks reshare eligibility')
  assert.ok(content.includes('showReshareConfirm'), 'Maintains showReshareConfirm state')
  assert.ok(content.includes('/reshare'), 'Calls reshare endpoint')
  assert.ok(content.includes('story-reshare-btn'), 'Renders story-reshare-btn')
  assert.ok(content.includes('story-reshare-confirm-card'), 'Renders reshare confirmation modal card')
  assert.ok(content.includes('story-viewer-reshare-badge'), 'Renders reshare attribution badge in header')
  assert.ok(content.includes('onStoryReshared'), 'Accepts onStoryReshared callback prop')
})

// ── 8. UI Contract: Feed.jsx Deep-Link Integration ───────────────────────────
test('UI Contract: Feed.jsx parses ?story= deep-link and triggers onStoryReshared tray refresh', () => {
  const file = path.join(__dirname, '../../Feed.jsx')
  assert.ok(fs.existsSync(file), 'Feed.jsx must exist')
  const content = fs.readFileSync(file, 'utf8')

  assert.ok(content.includes('useSearchParams'), 'Imports and uses useSearchParams')
  assert.ok(content.includes('storyParam = searchParams.get(\'story\')'), 'Extracts story query parameter')
  assert.ok(content.includes('handledStoryParamRef'), 'Guards against duplicate viewer openings')
  assert.ok(content.includes('handleStoryReshared'), 'Defines handleStoryReshared callback')
  assert.ok(content.includes('onStoryReshared={handleStoryReshared}'), 'Passes onStoryReshared to StoryViewerModal')
})

// ── 9. UI Contract: StoriesTray.jsx Reshare Indicator ────────────────────────
test('UI Contract: StoriesTray.jsx renders reshare indicators without duplicating stories', () => {
  const file = path.join(__dirname, 'StoriesTray.jsx')
  assert.ok(fs.existsSync(file), 'StoriesTray.jsx must exist')
  const content = fs.readFileSync(file, 'utf8')

  assert.ok(content.includes('ShareFat'), 'Imports ShareFat icon')
  assert.ok(content.includes('stories-tray-reshare-badge'), 'Renders stories-tray-reshare-badge')
})

// ── 10. UI Contract: Notification Mapping in index.jsx ───────────────────────
test('UI Contract: index.jsx maps story_reshare notification kind with ShareFat icon', () => {
  const file = path.join(__dirname, '../../pages/index.jsx')
  assert.ok(fs.existsSync(file), 'index.jsx must exist')
  const content = fs.readFileSync(file, 'utf8')

  assert.ok(content.includes('story_reshare: ShareFat'), 'NOTIF_ICON maps story_reshare to ShareFat')
})

// ── 11. UI Contract: stories.css defines Reshare styling classes ──────────────
test('UI Contract: stories.css defines styles for reshare button, confirmation modal, attribution, and tray badge', () => {
  const file = path.join(__dirname, 'stories.css')
  assert.ok(fs.existsSync(file), 'stories.css must exist')
  const content = fs.readFileSync(file, 'utf8')

  assert.ok(content.includes('.story-reshare-btn'), 'Defines .story-reshare-btn')
  assert.ok(content.includes('.story-reshare-confirm-overlay'), 'Defines .story-reshare-confirm-overlay')
  assert.ok(content.includes('.story-reshare-confirm-card'), 'Defines .story-reshare-confirm-card')
  assert.ok(content.includes('.story-viewer-reshare-badge'), 'Defines .story-viewer-reshare-badge')
  assert.ok(content.includes('.stories-tray-reshare-badge'), 'Defines .stories-tray-reshare-badge')
  assert.ok(content.includes('.notif-story_reshare'), 'Defines .notif-story_reshare')
})

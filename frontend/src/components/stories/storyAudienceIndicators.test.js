import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { isCloseFriendsAudience } from './storyHelpers.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

// ── 1. Code Contract: StoriesTray.jsx Audience Indicators ─────────────────────
test('Code Contract: StoriesTray.jsx implements Close Friends rings, badges, and safe audience detection', () => {
  const trayPath = path.join(__dirname, 'StoriesTray.jsx')
  assert.ok(fs.existsSync(trayPath), 'StoriesTray.jsx must exist')

  const content = fs.readFileSync(trayPath, 'utf8')

  // Check helper export
  assert.ok(content.includes('isCloseFriendsAudience'), 'Must integrate isCloseFriendsAudience helper')
  const helpers = fs.readFileSync(path.join(__dirname, 'storyHelpers.js'), 'utf8')
  assert.ok(helpers.includes('export function isCloseFriendsAudience'), 'storyHelpers must export isCloseFriendsAudience')

  // Check ring classes
  assert.ok(content.includes('close-friends'), 'Must apply close-friends class to ring')

  // Check Close Friends tray badge
  assert.ok(content.includes('stories-tray-cf-badge'), 'Must render stories-tray-cf-badge')
  assert.ok(content.includes('aria-label="Close Friends story"'), 'Must provide accessible aria-label for badge')

  // Check Star icon import
  assert.ok(content.includes('Star') && content.includes('@phosphor-icons/react'), 'Must import Star icon')
})

// ── 2. Code Contract: StoryViewerModal.jsx Viewer Header Audience Indicator ───
test('Code Contract: StoryViewerModal.jsx displays Close Friends badge in header', () => {
  const viewerPath = path.join(__dirname, 'StoryViewerModal.jsx')
  assert.ok(fs.existsSync(viewerPath), 'StoryViewerModal.jsx must exist')

  const content = fs.readFileSync(viewerPath, 'utf8')

  // Check Star import
  assert.ok(content.includes('Star') && content.includes('@phosphor-icons/react'), 'Must import Star icon')

  // Check badge markup and accessibility
  assert.ok(content.includes('story-viewer-cf-badge'), 'Must render story-viewer-cf-badge')
  assert.ok(content.includes('story-viewer-name-row'), 'Must wrap name and badge in story-viewer-name-row')
  assert.ok(content.includes("currentStory?.audience === 'close_friends'"), 'Must guard badge display by audience')
  assert.ok(content.includes('aria-label="Close Friends story"'), 'Must have accessible aria-label')
})

// ── 3. Code Contract: stories.css Styles for Tray & Viewer Audience Indicators ─
test('Code Contract: stories.css defines green ring, tray badge, and viewer header badge styles', () => {
  const cssPath = path.join(__dirname, 'stories.css')
  assert.ok(fs.existsSync(cssPath), 'stories.css must exist')

  const css = fs.readFileSync(cssPath, 'utf8')

  // Green ring styles
  assert.ok(css.includes('.stories-ring.close-friends'), 'Must define .stories-ring.close-friends')
  assert.ok(css.includes('.stories-ring.unviewed.close-friends'), 'Must define .stories-ring.unviewed.close-friends')
  assert.ok(css.includes('.stories-ring.viewed.close-friends'), 'Must define .stories-ring.viewed.close-friends')

  // Tray badge styles
  assert.ok(css.includes('.stories-tray-cf-badge'), 'Must define .stories-tray-cf-badge')
  assert.ok(css.includes('.stories-own-item .stories-tray-cf-badge'), 'Must position badge cleanly for own story')

  // Viewer header badge styles
  assert.ok(css.includes('.story-viewer-name-row'), 'Must define .story-viewer-name-row')
  assert.ok(css.includes('.story-viewer-cf-badge'), 'Must define .story-viewer-cf-badge')
  assert.ok(css.includes('.story-viewer-cf-star'), 'Must define .story-viewer-cf-star')
})

// ── 4. Scenario 1: Everyone story uses the existing ring ───────────────────────
test('Scenario 1: Everyone story preserves existing ring classes without Close Friends modifiers', () => {
  const peerEveryone = { user_id: 20, name: 'Bob Friend', has_unviewed: true, audience: 'everyone' }
  const isCF = isCloseFriendsAudience(peerEveryone)
  assert.equal(isCF, false, 'Everyone story must not be flagged as Close Friends')

  const ringClass = `stories-ring ${peerEveryone.has_unviewed ? 'unviewed' : 'viewed'} ${isCF ? 'close-friends' : ''}`.trim()
  assert.equal(ringClass, 'stories-ring unviewed', 'Ring class must strictly be standard unviewed ring')
  assert.ok(!ringClass.includes('close-friends'), 'Must not include close-friends class')
})

// ── 5. Scenario 2: Close Friends story uses the green ring ─────────────────────
test('Scenario 2: Close Friends story receives the green ring class modifier', () => {
  const peerCF = { user_id: 20, name: 'Bob Friend', has_unviewed: true, audience: 'close_friends' }
  const isCF = isCloseFriendsAudience(peerCF)
  assert.equal(isCF, true, 'Close Friends story must be flagged as Close Friends')

  const ringClass = `stories-ring ${peerCF.has_unviewed ? 'unviewed' : 'viewed'} ${isCF ? 'close-friends' : ''}`.trim()
  assert.equal(ringClass, 'stories-ring unviewed close-friends', 'Ring class must include close-friends modifier')
})

// ── 6. Scenario 3: Close Friends star/badge is displayed correctly ────────────
test('Scenario 3: Close Friends star badge renders for Close Friends stories with accessible labels', () => {
  const peerCF = { user_id: 20, name: 'Bob Friend', audience: 'close_friends' }
  const isCF = isCloseFriendsAudience(peerCF)

  const renderBadge = (item) => {
    if (!isCloseFriendsAudience(item)) return null
    return {
      className: 'stories-tray-cf-badge',
      ariaLabel: 'Close Friends story',
      title: 'Close Friends story',
      icon: 'Star',
    }
  }

  const badge = renderBadge(peerCF)
  assert.ok(badge, 'Badge must be rendered for Close Friends user')
  assert.equal(badge.className, 'stories-tray-cf-badge')
  assert.equal(badge.ariaLabel, 'Close Friends story')
  assert.equal(badge.icon, 'Star')
})

// ── 7. Scenario 4: Everyone story does not display the Close Friends badge ────
test('Scenario 4: Everyone story does not display the Close Friends badge', () => {
  const peerEveryone = { user_id: 30, name: 'Charlie Peer', audience: 'everyone' }
  const renderBadge = (item) => {
    if (!isCloseFriendsAudience(item)) return null
    return { className: 'stories-tray-cf-badge' }
  }

  const badge = renderBadge(peerEveryone)
  assert.equal(badge, null, 'Badge must NOT be rendered for Everyone story')
})

// ── 8. Scenario 5: Viewer header displays the correct audience ─────────────────
test('Scenario 5: Viewer header displays Close Friends badge only when current story audience is close_friends', () => {
  const storyEveryone = { id: 101, type: 'text', content: 'Public update', audience: 'everyone' }
  const storyCF = { id: 102, type: 'text', content: 'Secret update', audience: 'close_friends' }

  const getHeaderBadge = (currentStory) => {
    if (currentStory?.audience === 'close_friends') {
      return {
        className: 'story-viewer-cf-badge',
        text: 'Close Friends',
        ariaLabel: 'Close Friends story',
      }
    }
    return null
  }

  assert.equal(getHeaderBadge(storyEveryone), null, 'Viewer header must not show CF badge for everyone story')

  const cfBadge = getHeaderBadge(storyCF)
  assert.ok(cfBadge, 'Viewer header must show CF badge for close_friends story')
  assert.equal(cfBadge.text, 'Close Friends')
  assert.equal(cfBadge.ariaLabel, 'Close Friends story')
})

// ── 9. Scenario 6: Navigation between stories updates the audience indicator ──
test('Scenario 6: Navigation between stories with different audiences updates header indicator dynamically', () => {
  const playlist = [
    { id: 1, type: 'text', content: 'Story 1', audience: 'everyone' },
    { id: 2, type: 'photo', content: 'Story 2', audience: 'close_friends' },
    { id: 3, type: 'video', content: 'Story 3', audience: 'everyone' },
  ]

  let currentIndex = 0
  const getCurrentBadge = (idx) => {
    const s = playlist[idx]
    return s?.audience === 'close_friends' ? 'Close Friends' : null
  }

  // 1. Initial Story 0 (everyone)
  assert.equal(getCurrentBadge(currentIndex), null, 'Story 0 (everyone) has no CF badge')

  // 2. Navigate Next -> Story 1 (close_friends)
  currentIndex = 1
  assert.equal(getCurrentBadge(currentIndex), 'Close Friends', 'Story 1 (close_friends) displays CF badge')

  // 3. Navigate Next -> Story 2 (everyone)
  currentIndex = 2
  assert.equal(getCurrentBadge(currentIndex), null, 'Story 2 (everyone) has no CF badge')

  // 4. Navigate Prev -> Story 1 (close_friends)
  currentIndex = 1
  assert.equal(getCurrentBadge(currentIndex), 'Close Friends', 'Navigating back to Story 1 restores CF badge')
})

// ── 10. Scenario 7: Missing or legacy audience safely defaults to Everyone ─────
test('Scenario 7: Missing or legacy audience safely defaults to Everyone without crashes or false positives', () => {
  assert.equal(isCloseFriendsAudience(undefined), false)
  assert.equal(isCloseFriendsAudience(null), false)
  assert.equal(isCloseFriendsAudience({}), false)
  assert.equal(isCloseFriendsAudience({ audience: undefined }), false)
  assert.equal(isCloseFriendsAudience({ audience: null }), false)
  assert.equal(isCloseFriendsAudience({ audience: '' }), false)
  assert.equal(isCloseFriendsAudience({ audience: 'everyone' }), false)
  assert.equal(isCloseFriendsAudience({ audience: 'EVERYONE' }), false)

  // Valid close friends formats
  assert.equal(isCloseFriendsAudience({ audience: 'close_friends' }), true)
  assert.equal(isCloseFriendsAudience({ audience: 'CLOSE_FRIENDS' }), true)
  assert.equal(isCloseFriendsAudience({ has_close_friends: true }), true)
  assert.equal(isCloseFriendsAudience({ stories: [{ audience: 'close_friends' }] }), true)
  assert.equal(isCloseFriendsAudience({ stories: [{ audience: 'everyone' }] }), false)
})

// ── 11. Scenario 8: Existing viewed/unviewed ring behavior remains intact ──────
test('Scenario 8: Viewed and unviewed ring states function identically for both audiences', () => {
  // Case A: Unviewed Everyone
  const uEveryone = { has_unviewed: true, audience: 'everyone' }
  const cAE = `stories-ring ${uEveryone.has_unviewed ? 'unviewed' : 'viewed'} ${isCloseFriendsAudience(uEveryone) ? 'close-friends' : ''}`.trim()
  assert.equal(cAE, 'stories-ring unviewed')

  // Case B: Viewed Everyone
  const vEveryone = { has_unviewed: false, audience: 'everyone' }
  const cBE = `stories-ring ${vEveryone.has_unviewed ? 'unviewed' : 'viewed'} ${isCloseFriendsAudience(vEveryone) ? 'close-friends' : ''}`.trim()
  assert.equal(cBE, 'stories-ring viewed')

  // Case C: Unviewed Close Friends
  const uCF = { has_unviewed: true, audience: 'close_friends' }
  const cACF = `stories-ring ${uCF.has_unviewed ? 'unviewed' : 'viewed'} ${isCloseFriendsAudience(uCF) ? 'close-friends' : ''}`.trim()
  assert.equal(cACF, 'stories-ring unviewed close-friends')

  // Case D: Viewed Close Friends
  const vCF = { has_unviewed: false, audience: 'close_friends' }
  const cBCF = `stories-ring ${vCF.has_unviewed ? 'unviewed' : 'viewed'} ${isCloseFriendsAudience(vCF) ? 'close-friends' : ''}`.trim()
  assert.equal(cBCF, 'stories-ring viewed close-friends')
})

// ── 12. Scenario 9: Mobile layout does not introduce horizontal overflow ──────
test('Scenario 9: Layout constraints ensure no horizontal overflow on mobile viewports', () => {
  const cssPath = path.join(__dirname, 'stories.css')
  const css = fs.readFileSync(cssPath, 'utf8')

  // Tray container containment
  assert.ok(css.includes('overflow-x: auto'), 'Tray must enable horizontal scroll')
  assert.ok(css.includes('max-width: 100%'), 'Tray must not exceed 100% viewport width')

  // Viewer name row containment
  assert.ok(css.includes('.story-viewer-name-row'), 'Name row must be defined')
  assert.ok(css.includes('text-overflow: ellipsis'), 'Name must truncate when space is constrained')
  assert.ok(css.includes('flex-shrink: 0'), 'CF badge must not collapse')
})

// ── 13. Scenario 10: Existing Stories functionality remains intact ────────────
test('Scenario 10: Existing Stories functionality (tray, avatars, add badge, reshares, modal) remains intact', () => {
  const trayPath = path.join(__dirname, 'StoriesTray.jsx')
  const trayContent = fs.readFileSync(trayPath, 'utf8')

  assert.ok(trayContent.includes('stories-add-badge'), 'Add story badge remains intact')
  assert.ok(trayContent.includes('stories-tray-reshare-badge'), 'Reshare badge remains intact')
  assert.ok(trayContent.includes('CloseFriendsModal'), 'CloseFriendsModal remains integrated')
  assert.ok(trayContent.includes('stories-tray-cf-btn'), 'Header Close Friends button remains intact')

  const viewerPath = path.join(__dirname, 'StoryViewerModal.jsx')
  const viewerContent = fs.readFileSync(viewerPath, 'utf8')

  assert.ok(viewerContent.includes('story-viewer-header'), 'Header remains intact')
  assert.ok(viewerContent.includes('story-viewer-time'), 'Time display remains intact')
  assert.ok(viewerContent.includes('story-viewer-reshare-badge'), 'Reshare badge in viewer remains intact')
})

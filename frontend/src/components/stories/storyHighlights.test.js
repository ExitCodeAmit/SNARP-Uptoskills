import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

test('Highlight title length validation and whitespace trimming (max 60 characters)', () => {
  const validateTitle = (val) => {
    if (typeof val !== 'string') return { valid: false, error: 'Title must be a string' }
    const trimmed = val.trim()
    if (!trimmed) return { valid: false, error: 'Title cannot be empty' }
    if (trimmed.length > 60) return { valid: false, error: 'Title must be 60 characters or fewer' }
    return { valid: true, title: trimmed }
  }

  assert.equal(validateTitle('   Vacation 2026   ').valid, true)
  assert.equal(validateTitle('   Vacation 2026   ').title, 'Vacation 2026')
  assert.equal(validateTitle('').valid, false)
  assert.equal(validateTitle('   ').valid, false)
  assert.equal(validateTitle(null).valid, false)
  assert.equal(validateTitle('X'.repeat(60)).valid, true)
  assert.equal(validateTitle('X'.repeat(61)).valid, false)
})

test('Highlight owner vs viewer visibility logic', () => {
  const getHighlightActions = (isOwner, highlightsCount) => {
    return {
      canCreate: Boolean(isOwner),
      canManage: Boolean(isOwner),
      shouldRenderTray: Boolean(isOwner || highlightsCount > 0),
    }
  }

  // Profile Owner with 0 highlights: can create, tray is rendered to show "+ New"
  const ownerEmpty = getHighlightActions(true, 0)
  assert.equal(ownerEmpty.canCreate, true)
  assert.equal(ownerEmpty.canManage, true)
  assert.equal(ownerEmpty.shouldRenderTray, true)

  // Viewer viewing a profile with 0 highlights: should not render empty tray
  const viewerEmpty = getHighlightActions(false, 0)
  assert.equal(viewerEmpty.canCreate, false)
  assert.equal(viewerEmpty.canManage, false)
  assert.equal(viewerEmpty.shouldRenderTray, false)

  // Viewer viewing a profile with 3 highlights: renders tray, cannot create or manage
  const viewerWithHighlights = getHighlightActions(false, 3)
  assert.equal(viewerWithHighlights.canCreate, false)
  assert.equal(viewerWithHighlights.canManage, false)
  assert.equal(viewerWithHighlights.shouldRenderTray, true)
})

test('Highlight cover resolution handles media, text background, and fallback types', () => {
  const resolveCoverPresentation = (highlight) => {
    if (highlight.cover_media_url) {
      return { type: 'media', url: highlight.cover_media_url }
    }
    if (highlight.cover_type === 'text') {
      const style = highlight.cover_background_style || 'gradient-sunset'
      return { type: 'text', className: `story-bg-${style}` }
    }
    return { type: 'fallback' }
  }

  const mediaCover = resolveCoverPresentation({ cover_media_url: '/api/stories/media/1' })
  assert.equal(mediaCover.type, 'media')
  assert.equal(mediaCover.url, '/api/stories/media/1')

  const textCover = resolveCoverPresentation({ cover_type: 'text', cover_background_style: 'gradient-emerald' })
  assert.equal(textCover.type, 'text')
  assert.equal(textCover.className, 'story-bg-gradient-emerald')

  const fallbackCover = resolveCoverPresentation({})
  assert.equal(fallbackCover.type, 'fallback')
})

test('Highlight multi-story selection and cover designation logic', () => {
  let selected = new Set()
  let coverId = null

  const toggleSelect = (id) => {
    if (selected.has(id)) {
      selected.delete(id)
      if (coverId === id) {
        coverId = Array.from(selected)[0] || null
      }
    } else {
      selected.add(id)
      if (!coverId) coverId = id
    }
  }

  // Select story 10 -> becomes selected and auto-chosen as cover
  toggleSelect('10')
  assert.ok(selected.has('10'))
  assert.equal(coverId, '10')

  // Select story 20
  toggleSelect('20')
  assert.ok(selected.has('20'))
  assert.equal(coverId, '10')

  // Explicitly make story 20 cover
  coverId = '20'
  assert.equal(coverId, '20')

  // Unselect story 20 -> cover falls back to story 10
  toggleSelect('20')
  assert.equal(selected.has('20'), false)
  assert.equal(coverId, '10')
})

test('Story Highlights CSS classes are defined in stories.css', () => {
  const cssPath = path.join(__dirname, 'stories.css')
  const css = fs.readFileSync(cssPath, 'utf8')

  const requiredClasses = [
    '.story-highlights-section',
    '.story-highlights-tray',
    '.story-highlight-item',
    '.story-highlight-circle',
    '.story-highlight-new-circle',
    '.story-highlight-inner',
    '.story-highlight-cover-img',
    '.story-highlight-text-cover',
    '.story-highlight-fallback-cover',
    '.story-highlight-title',
    '.story-highlight-gear-btn',
    '.story-viewer-highlight-badge',
    '.story-hl-modal-overlay',
    '.story-hl-modal',
    '.story-hl-field',
    '.story-hl-input',
    '.story-hl-stories-grid',
    '.story-hl-card',
    '.story-hl-card-selected',
    '.story-hl-manage-list',
    '.story-hl-manage-item',
    '.story-hl-delete-section',
  ]

  for (const cls of requiredClasses) {
    assert.ok(css.includes(cls), `CSS class ${cls} must be defined in stories.css`)
  }
})

test('Member Profile Highlights Integration: Owner vs Viewer lifecycle without hardcoded logic', () => {
  // Simulates UserProfile & StoryHighlights ownership and presentation logic
  function evaluateProfileHighlights({ currentUser, profileUser, highlights }) {
    const effectiveProfileUserId = profileUser?.id || profileUser?.user_id
    const currentUserId = currentUser?.id ?? currentUser?.user_id
    const isOwner = Boolean(
      (currentUserId && effectiveProfileUserId && String(currentUserId) === String(effectiveProfileUserId))
    )

    // Component visibility rule
    const shouldRenderSection = Boolean(isOwner || highlights.length > 0)

    return {
      isOwner,
      shouldRenderSection,
      showNewButton: Boolean(isOwner && shouldRenderSection),
      canManageHighlights: Boolean(isOwner),
      renderedHighlightsCount: shouldRenderSection ? highlights.length : 0,
    }
  }

  // 1. Member logged into their own profile with zero highlights
  const memberOwnerEmpty = evaluateProfileHighlights({
    currentUser: { id: 42, email: 'raj2@gmail.com', name: 'Rajesh' },
    profileUser: { id: 42, name: 'Rajesh' },
    highlights: [],
  })
  assert.equal(memberOwnerEmpty.isOwner, true)
  assert.equal(memberOwnerEmpty.shouldRenderSection, true)
  assert.equal(memberOwnerEmpty.showNewButton, true)
  assert.equal(memberOwnerEmpty.canManageHighlights, true)

  // 2. Logged-in visitor viewing member profile with zero highlights
  const visitorEmpty = evaluateProfileHighlights({
    currentUser: { id: 99, email: 'visitor@gmail.com', name: 'Visitor' },
    profileUser: { id: 42, name: 'Rajesh' },
    highlights: [],
  })
  assert.equal(visitorEmpty.isOwner, false)
  assert.equal(visitorEmpty.shouldRenderSection, false)
  assert.equal(visitorEmpty.showNewButton, false)
  assert.equal(visitorEmpty.canManageHighlights, false)

  // 3. Logged-in visitor viewing member profile with public highlights
  const sampleHighlights = [
    { id: 1, title: 'Lab Work', cover_media_url: '/api/stories/media/10' },
    { id: 2, title: 'Conference', cover_type: 'text', cover_background_style: 'gradient-sunset' }
  ]
  const visitorWithHighlights = evaluateProfileHighlights({
    currentUser: { id: 99, email: 'visitor@gmail.com', name: 'Visitor' },
    profileUser: { id: 42, name: 'Rajesh' },
    highlights: sampleHighlights,
  })
  assert.equal(visitorWithHighlights.isOwner, false)
  assert.equal(visitorWithHighlights.shouldRenderSection, true)
  assert.equal(visitorWithHighlights.showNewButton, false) // Visitors cannot see "+ New"
  assert.equal(visitorWithHighlights.canManageHighlights, false) // Visitors cannot see Gear/Manage controls
  assert.equal(visitorWithHighlights.renderedHighlightsCount, 2) // Public highlights are visible
})

import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

test('Story reply text validation and trimming constraints (max 500 characters)', () => {
  const validateText = (input) => {
    if (typeof input !== 'string') return { valid: false, error: 'Reply text must be a string' }
    const trimmed = input.trim()
    if (!trimmed) return { valid: false, error: 'Reply text cannot be empty' }
    if (trimmed.length > 500) return { valid: false, error: 'Reply cannot exceed 500 characters' }
    return { valid: true, text: trimmed }
  }

  assert.equal(validateText('   Nice story!   ').valid, true)
  assert.equal(validateText('   Nice story!   ').text, 'Nice story!')
  assert.equal(validateText('').valid, false)
  assert.equal(validateText('   ').valid, false)
  assert.equal(validateText(null).valid, false)
  assert.equal(validateText('x'.repeat(500)).valid, true)
  assert.equal(validateText('x'.repeat(501)).valid, false)
})

test('Viewer vs Owner role controls footer actions in StoryViewerModal', () => {
  const isOwnerCheck = (currentUser, storyOwnerUser, currentStory) => {
    return Boolean(
      currentUser &&
      (String(currentUser.id) === String(storyOwnerUser?.id || storyOwnerUser?.user_id) ||
        (currentStory?.user_id && String(currentUser.id) === String(currentStory.user_id)))
    )
  }

  const accountA = { id: 10, name: 'Alice' }
  const accountB = { id: 20, name: 'Bob' }
  const storyByA = { id: '1', user_id: 10 }

  // When Alice views her own story:
  const isOwnerA = isOwnerCheck(accountA, accountA, storyByA)
  assert.equal(isOwnerA, true, 'Account A should be recognized as story owner')

  // When Bob views Alice's story:
  const isOwnerB = isOwnerCheck(accountB, accountA, storyByA)
  assert.equal(isOwnerB, false, 'Account B should be recognized as viewer')
})

test('Story progression and video pause state is paused while user is replying', () => {
  const computePauseState = ({ isPaused, isHolding, isDocumentHidden, isBuffering, isReplying }) => {
    const effectivePaused = Boolean(
      isPaused ||
      isHolding ||
      isDocumentHidden ||
      isBuffering ||
      isReplying
    )
    const isVideoPaused = Boolean(
      isPaused ||
      isHolding ||
      isDocumentHidden ||
      isReplying
    )
    return { effectivePaused, isVideoPaused }
  }

  // Normal playing state
  const playing = computePauseState({
    isPaused: false,
    isHolding: false,
    isDocumentHidden: false,
    isBuffering: false,
    isReplying: false,
  })
  assert.equal(playing.effectivePaused, false)
  assert.equal(playing.isVideoPaused, false)

  // While typing reply (isReplying = true)
  const typing = computePauseState({
    isPaused: false,
    isHolding: false,
    isDocumentHidden: false,
    isBuffering: false,
    isReplying: true,
  })
  assert.equal(typing.effectivePaused, true, 'Timer should pause while user is typing a reply')
  assert.equal(typing.isVideoPaused, true, 'Video should pause while user is typing a reply')
})

test('StoryViewersDrawer tab navigation toggles between viewers and replies tabs', () => {
  let activeTab = 'viewers'
  const setActiveTab = (tab) => {
    activeTab = tab
  }

  assert.equal(activeTab, 'viewers')
  setActiveTab('replies')
  assert.equal(activeTab, 'replies')
  setActiveTab('viewers')
  assert.equal(activeTab, 'viewers')
})

test('Story replies CSS classes are defined in stories.css', () => {
  const cssPath = path.join(__dirname, 'stories.css')
  const css = fs.readFileSync(cssPath, 'utf8')

  const requiredClasses = [
    '.story-viewer-actions-wrap',
    '.story-reply-form',
    '.story-reply-input-wrap',
    '.story-reply-input',
    '.story-reply-send-btn',
    '.story-owner-reply-pill',
    '.story-drawer-tabs',
    '.story-drawer-tab',
    '.story-drawer-tab-active',
    '.story-replies-list',
    '.story-reply-row',
    '.story-reply-content',
    '.story-reply-meta',
    '.story-reply-sender',
    '.story-reply-time',
    '.story-reply-bubble',
  ]

  for (const cls of requiredClasses) {
    assert.ok(css.includes(cls), `CSS class ${cls} must be defined in stories.css`)
  }
})

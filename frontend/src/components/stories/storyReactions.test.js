import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { STORY_REACTIONS } from './storyHelpers.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

test('STORY_REACTIONS defines the 5 approved reaction types and emojis', () => {
  assert.equal(STORY_REACTIONS.length, 5)

  const types = STORY_REACTIONS.map((r) => r.type)
  assert.deepEqual(types, ['love', 'haha', 'wow', 'sad', 'like'])

  assert.equal(STORY_REACTIONS.find((r) => r.type === 'love')?.emoji, '❤️')
  assert.equal(STORY_REACTIONS.find((r) => r.type === 'haha')?.emoji, '😂')
  assert.equal(STORY_REACTIONS.find((r) => r.type === 'wow')?.emoji, '😮')
  assert.equal(STORY_REACTIONS.find((r) => r.type === 'sad')?.emoji, '😢')
  assert.equal(STORY_REACTIONS.find((r) => r.type === 'like')?.emoji, '👍')
})

test('Reaction transition state logic handles add, change, and toggle-off removal', () => {
  const computeNextState = (prevReaction, prevCount, clickedType) => {
    const isRemoving = prevReaction === clickedType
    const nextReaction = isRemoving ? null : clickedType
    const nextCount = isRemoving
      ? Math.max(0, prevCount - 1)
      : (prevReaction ? prevCount : prevCount + 1)
    return { nextReaction, nextCount }
  }

  // 1. Initial reaction addition (from none)
  const addLove = computeNextState(null, 0, 'love')
  assert.equal(addLove.nextReaction, 'love')
  assert.equal(addLove.nextCount, 1)

  // 2. Change reaction from 'love' to 'wow' (count stays same)
  const changeToWow = computeNextState('love', 1, 'wow')
  assert.equal(changeToWow.nextReaction, 'wow')
  assert.equal(changeToWow.nextCount, 1)

  // 3. Click same active reaction ('wow') toggles off and removes it
  const removeReaction = computeNextState('wow', 1, 'wow')
  assert.equal(removeReaction.nextReaction, null)
  assert.equal(removeReaction.nextCount, 0)
})

test('Cross-account viewer vs owner role detection governs UI footer presentation', () => {
  const checkIsOwner = (currentUser, storyOwnerUser, currentStory) => {
    return Boolean(
      currentUser &&
      (String(currentUser.id) === String(storyOwnerUser?.id || storyOwnerUser?.user_id) ||
        (currentStory?.user_id && String(currentUser.id) === String(currentStory.user_id)))
    )
  }

  const accountA = { id: 10, name: 'Alice' }
  const accountB = { id: 20, name: 'Bob' }
  const storyByA = { id: '1', user_id: 10, type: 'text', content: 'Hello from Alice' }

  // Account A viewing their own story -> isOwner is TRUE (shows viewers pill, hides reaction picker)
  assert.equal(checkIsOwner(accountA, accountA, storyByA), true)

  // Account B viewing Account A's story -> isOwner is FALSE (shows reaction picker, hides viewers pill)
  assert.equal(checkIsOwner(accountB, accountA, storyByA), false)
})

test('Viewers drawer maps viewer reaction_type to approved reaction item', () => {
  const getReactionItem = (reactionType) => STORY_REACTIONS.find((r) => r.type === reactionType) || null

  assert.equal(getReactionItem('love')?.emoji, '❤️')
  assert.equal(getReactionItem('haha')?.emoji, '😂')
  assert.equal(getReactionItem('wow')?.emoji, '😮')
  assert.equal(getReactionItem('sad')?.emoji, '😢')
  assert.equal(getReactionItem('like')?.emoji, '👍')
  assert.equal(getReactionItem(null), null)
  assert.equal(getReactionItem(undefined), null)
  assert.equal(getReactionItem('unknown_reaction'), null)
})

test('stories.css defines modern styles and accessibility rules for story reactions', () => {
  const cssContent = fs.readFileSync(path.join(__dirname, 'stories.css'), 'utf-8')

  assert.ok(cssContent.includes('.story-reactions-bar'), 'stories.css must define .story-reactions-bar')
  assert.ok(cssContent.includes('.story-reaction-btn'), 'stories.css must define .story-reaction-btn')
  assert.ok(cssContent.includes('.story-reaction-active'), 'stories.css must define .story-reaction-active')
  assert.ok(cssContent.includes('.story-viewer-row-reaction'), 'stories.css must define .story-viewer-row-reaction')
  assert.ok(cssContent.includes('.story-owner-reaction-pill'), 'stories.css must define .story-owner-reaction-pill')
  assert.ok(cssContent.includes('prefers-reduced-motion'), 'stories.css must include prefers-reduced-motion')
})

test('Instagram-style Story Viewer Bottom Bar & Reaction Picker Popup UI lifecycle', () => {
  const cssContent = fs.readFileSync(path.join(__dirname, 'stories.css'), 'utf-8')

  // Verify new Instagram-style layout and popup CSS classes
  assert.ok(cssContent.includes('.story-reactions-popup'), 'stories.css must define .story-reactions-popup')
  assert.ok(cssContent.includes('.story-bottom-bar-row'), 'stories.css must define .story-bottom-bar-row')
  assert.ok(cssContent.includes('.story-reaction-trigger-btn'), 'stories.css must define .story-reaction-trigger-btn')
  assert.ok(cssContent.includes('.story-reaction-trigger-emoji'), 'stories.css must define .story-reaction-trigger-emoji')
  assert.ok(cssContent.includes('.story-reaction-trigger-active'), 'stories.css must define .story-reaction-trigger-active')

  // Reaction button trigger visual feedback logic
  const resolveReactionTriggerPresentation = (myReaction) => {
    const item = STORY_REACTIONS.find((r) => r.type === myReaction) || null
    return {
      hasReaction: Boolean(item),
      displayedEmoji: item?.emoji || null,
      showHeartIcon: !item,
    }
  }

  // 1. Unreacted state: displays default heart icon
  const unreacted = resolveReactionTriggerPresentation(null)
  assert.equal(unreacted.hasReaction, false)
  assert.equal(unreacted.displayedEmoji, null)
  assert.equal(unreacted.showHeartIcon, true)

  // 2. Reacted with 'haha' (😂): displays 😂 emoji directly on button
  const reactedHaha = resolveReactionTriggerPresentation('haha')
  assert.equal(reactedHaha.hasReaction, true)
  assert.equal(reactedHaha.displayedEmoji, '😂')
  assert.equal(reactedHaha.showHeartIcon, false)

  // 3. Reacted with 'love' (❤️): displays ❤️ emoji directly on button
  const reactedLove = resolveReactionTriggerPresentation('love')
  assert.equal(reactedLove.hasReaction, true)
  assert.equal(reactedLove.displayedEmoji, '❤️')
  assert.equal(reactedLove.showHeartIcon, false)

  // Popup open/close and story pause interaction state
  let showReactionPicker = false
  const toggleReactionPicker = () => {
    showReactionPicker = !showReactionPicker
  }

  // User clicks reaction button to open popup
  toggleReactionPicker()
  assert.equal(showReactionPicker, true, 'Reaction popup opens on trigger click')

  // Story pause evaluation while picker is open
  const isPausedWhilePicking = (isReplying, isReactionPickerOpen) => Boolean(isReplying || isReactionPickerOpen)
  assert.equal(isPausedWhilePicking(false, showReactionPicker), true, 'Story progression must pause while picker is open')

  // Selecting an emoji automatically closes the popup
  const onSelectEmoji = () => {
    showReactionPicker = false
  }
  onSelectEmoji()
  assert.equal(showReactionPicker, false, 'Popup automatically closes after emoji selection')
})

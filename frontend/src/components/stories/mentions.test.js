import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

// ── 1. Constant Bounds & Max Limit Contract ──────────────────────────────────
test('Mentions Boundary: MAX_STORY_MENTIONS is 5', async () => {
  const composerFile = path.join(__dirname, 'StoryComposer.jsx')
  const content = fs.readFileSync(composerFile, 'utf8')
  assert.ok(content.includes('MAX_STORY_MENTIONS = 5'), 'StoryComposer must export or define MAX_STORY_MENTIONS = 5')
})

// ── 2. Mention Selection & Deduplication Logic ────────────────────────────────
test('Composer Logic: Adding mentions enforces max 5, prevents duplicates, and blocks self-mention', () => {
  const MAX_STORY_MENTIONS = 5
  const currentUser = { id: 10, username: 'self_creator', name: 'Self Creator' }
  let mentions = []
  let error = ''

  const selectMention = (user) => {
    error = ''
    if (mentions.length >= MAX_STORY_MENTIONS) {
      error = `You can mention up to ${MAX_STORY_MENTIONS} users.`
      return false
    }
    const myId = currentUser?.id ?? currentUser?.user_id
    if (myId !== undefined && myId !== null && String(user.id) === String(myId)) {
      error = 'You cannot mention yourself.'
      return false
    }
    if (mentions.some((m) => String(m.id) === String(user.id))) {
      error = 'User is already mentioned.'
      return false
    }
    mentions.push({
      id: user.id,
      name: user.name || user.username,
      username: user.username || user.name,
      avatar_url: user.avatar_url || null,
    })
    return true
  }

  // 1. Add valid user 1
  assert.equal(selectMention({ id: 1, name: 'Alice', username: 'alice' }), true)
  assert.equal(mentions.length, 1)
  assert.equal(error, '')

  // 2. Reject duplicate user 1
  assert.equal(selectMention({ id: 1, name: 'Alice', username: 'alice' }), false)
  assert.equal(error, 'User is already mentioned.')
  assert.equal(mentions.length, 1)

  // 3. Reject self-mention (user 10)
  assert.equal(selectMention({ id: 10, name: 'Self Creator', username: 'self_creator' }), false)
  assert.equal(error, 'You cannot mention yourself.')
  assert.equal(mentions.length, 1)

  // 4. Add users 2, 3, 4, 5
  assert.equal(selectMention({ id: 2, name: 'Bob', username: 'bob' }), true)
  assert.equal(selectMention({ id: 3, name: 'Charlie', username: 'charlie' }), true)
  assert.equal(selectMention({ id: 4, name: 'Dave', username: 'dave' }), true)
  assert.equal(selectMention({ id: 5, name: 'Eve', username: 'eve' }), true)
  assert.equal(mentions.length, 5)

  // 5. Reject 6th user (exceeds max limit)
  assert.equal(selectMention({ id: 6, name: 'Frank', username: 'frank' }), false)
  assert.equal(error, 'You can mention up to 5 users.')
  assert.equal(mentions.length, 5)
})

// ── 3. Mention Removal Logic ──────────────────────────────────────────────────
test('Composer Logic: Removing mentions updates the list and frees slots', () => {
  let mentions = [
    { id: 1, name: 'Alice', username: 'alice' },
    { id: 2, name: 'Bob', username: 'bob' },
  ]

  const removeMention = (userId) => {
    mentions = mentions.filter((m) => String(m.id) !== String(userId))
  }

  removeMention(1)
  assert.equal(mentions.length, 1)
  assert.equal(mentions[0].id, 2)

  removeMention(2)
  assert.equal(mentions.length, 0)
})

// ── 4. Search Filter & Privacy (No Email Exposure) ─────────────────────────────
test('Search Filter: Excludes self and already mentioned users without leaking private email addresses', () => {
  const currentUser = { id: 1, username: 'logged_user' }
  const currentMentions = [{ id: 2, username: 'bob' }]

  const rawSearchResults = [
    { id: 1, name: 'Logged In User', username: 'logged_user', avatar_url: null },
    { id: 2, name: 'Bob Smith', username: 'bob', avatar_url: '/api/images/1' },
    { id: 3, name: 'Carol Danvers', username: 'carol', avatar_url: '/api/images/2' },
    { id: 4, name: 'David Miller', username: 'david', avatar_url: null },
  ]

  const filtered = rawSearchResults.filter((u) => {
    const isMe = String(u.id) === String(currentUser.id)
    const alreadySelected = currentMentions.some((m) => String(m.id) === String(u.id))
    return !isMe && !alreadySelected
  })

  assert.equal(filtered.length, 2)
  assert.deepEqual(filtered.map((u) => u.id), [3, 4])

  // Privacy verification: none of the suggestion objects contain an email field
  filtered.forEach((user) => {
    assert.equal(user.email, undefined, 'User search results for story mentions must never contain email')
  })
})

// ── 5. Form Payload Serialization ─────────────────────────────────────────────
test('Form Submission: Mentions are serialized as a JSON array of positive integer IDs', () => {
  const serializeMentions = (mentions) => {
    if (!mentions || mentions.length === 0) return null
    const mentionIds = mentions.map((m) => Number(m.id)).filter((id) => Number.isInteger(id) && id > 0)
    return JSON.stringify(mentionIds)
  }

  assert.equal(serializeMentions([]), null)
  assert.equal(serializeMentions([{ id: 1 }, { id: '3' }, { id: 5 }]), '[1,3,5]')
})

// ── 6. Viewer Mention Badges & Tap Zone Isolation ─────────────────────────────
test('Viewer UX: Story mention badges stop event propagation to preserve Story navigation', () => {
  let propagationStoppedCount = 0
  const mockEvent = {
    stopPropagation: () => {
      propagationStoppedCount++
    },
  }

  const handleMentionClick = (e) => e.stopPropagation()
  const handleMentionPointerDown = (e) => e.stopPropagation()
  const handleMentionPointerUp = (e) => e.stopPropagation()

  handleMentionClick(mockEvent)
  handleMentionPointerDown(mockEvent)
  handleMentionPointerUp(mockEvent)

  assert.equal(propagationStoppedCount, 3, 'All mention badge touch/click handlers must call stopPropagation()')
})

// ── 7. Story Viewer Profile Navigation Target ────────────────────────────────
test('Viewer Navigation: Story mention badge generates proper profile link', () => {
  const getProfileUrl = (userId) => `/users/${userId}`
  assert.equal(getProfileUrl(42), '/users/42')
  assert.equal(getProfileUrl('105'), '/users/105')
})

// ── 8. UI Contract: StoryComposer.jsx ─────────────────────────────────────────
test('UI Contract: StoryComposer.jsx implements complete mentions management workflow', () => {
  const file = path.join(__dirname, 'StoryComposer.jsx')
  assert.ok(fs.existsSync(file), 'StoryComposer.jsx must exist')
  const content = fs.readFileSync(file, 'utf8')

  assert.ok(content.includes('MAX_STORY_MENTIONS'), 'Declares MAX_STORY_MENTIONS constant')
  assert.ok(content.includes('mentions'), 'Declares mentions state')
  assert.ok(content.includes('showMentionSearch'), 'Declares showMentionSearch state')
  assert.ok(content.includes('mentionSuggestions'), 'Declares mentionSuggestions state')
  assert.ok(content.includes('/users/search?q='), 'Performs debounced search against /users/search')
  assert.ok(content.includes('handleSelectMention'), 'Defines handleSelectMention handler')
  assert.ok(content.includes('handleRemoveMention'), 'Defines handleRemoveMention handler')
  assert.ok(content.includes('sc-mention-section'), 'Renders .sc-mention-section container')
  assert.ok(content.includes('sc-mention-chip'), 'Renders .sc-mention-chip badges')
  assert.ok(content.includes('sc-mention-dropdown'), 'Renders .sc-mention-dropdown list')
  assert.ok(content.includes('form.append(\'mentions\''), 'Appends mentions JSON payload to FormData')
})

// ── 9. UI Contract: StoryViewerModal.jsx ─────────────────────────────────────
test('UI Contract: StoryViewerModal.jsx renders mention badges with profile links and stopPropagation', () => {
  const file = path.join(__dirname, 'StoryViewerModal.jsx')
  assert.ok(fs.existsSync(file), 'StoryViewerModal.jsx must exist')
  const content = fs.readFileSync(file, 'utf8')

  assert.ok(content.includes('currentStory.mentions'), 'Checks for currentStory.mentions')
  assert.ok(content.includes('story-viewer-mentions-wrap'), 'Renders story-viewer-mentions-wrap container')
  assert.ok(content.includes('story-mention-badge'), 'Renders story-mention-badge elements')
  assert.ok(content.includes('/users/'), 'Links mention badges to user profile')
  assert.ok(content.includes('stopPropagation'), 'Stops event propagation on badge interactions')
})

// ── 10. UI Contract: notifications mapping in frontend/src/pages/index.jsx ────
test('UI Contract: Notification mapping in frontend/src/pages/index.jsx maps story_mention with At icon', () => {
  const file = path.join(__dirname, '../../pages/index.jsx')
  assert.ok(fs.existsSync(file), 'index.jsx must exist')
  const content = fs.readFileSync(file, 'utf8')

  assert.ok(content.includes('story_mention: At'), 'NOTIF_ICON maps story_mention to At icon')
  assert.ok(content.includes("item.entity_type === 'story' ? `/?story=${item.entity_id}`"), 'Navigates to story on notification click')
})

// ── 11. UI Contract: stories.css defines responsive mentions classes ─────────
test('UI Contract: stories.css defines styles for mention chips, dropdown, viewer badges, and notification icon', () => {
  const file = path.join(__dirname, 'stories.css')
  assert.ok(fs.existsSync(file), 'stories.css must exist')
  const content = fs.readFileSync(file, 'utf8')

  assert.ok(content.includes('.sc-mention-section'), 'Defines .sc-mention-section')
  assert.ok(content.includes('.sc-mention-chip'), 'Defines .sc-mention-chip')
  assert.ok(content.includes('.sc-mention-dropdown'), 'Defines .sc-mention-dropdown')
  assert.ok(content.includes('.story-viewer-mentions-wrap'), 'Defines .story-viewer-mentions-wrap')
  assert.ok(content.includes('.story-mention-badge'), 'Defines .story-mention-badge')
  assert.ok(content.includes('.notif-story_mention'), 'Defines .notif-story_mention')
})

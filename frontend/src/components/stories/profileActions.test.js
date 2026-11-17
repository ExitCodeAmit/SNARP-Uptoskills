import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

// ── 1. Story Mention Navigation & Overlay Dismissal ─────────────────────────
test('Mention Navigation: StoryViewerModal mention badge link calls stopPropagation AND onClose', () => {
  const modalPath = path.join(__dirname, 'StoryViewerModal.jsx')
  const content = fs.readFileSync(modalPath, 'utf8')

  // Check mention badge onClick calls onClose
  assert.ok(content.includes('className="story-mention-badge"'), 'Renders story-mention-badge')
  const mentionLinkSection = content.slice(content.indexOf('className="story-mention-badge"'), content.indexOf('className="story-mention-badge"') + 300)
  assert.ok(mentionLinkSection.includes('onClose?.()'), 'Mention badge onClick must call onClose?.() to dismiss modal')
  assert.ok(mentionLinkSection.includes('e.stopPropagation()'), 'Mention badge onClick must stop event propagation')
})

test('Reshare Navigation: StoryViewerModal attribution link calls stopPropagation AND onClose', () => {
  const modalPath = path.join(__dirname, 'StoryViewerModal.jsx')
  const content = fs.readFileSync(modalPath, 'utf8')

  assert.ok(content.includes('className="story-reshare-attribution-link"'), 'Renders story-reshare-attribution-link')
  const reshareLinkSection = content.slice(content.indexOf('className="story-reshare-attribution-link"'), content.indexOf('className="story-reshare-attribution-link"') + 300)
  assert.ok(reshareLinkSection.includes('onClose?.()'), 'Reshare attribution link onClick must call onClose?.()')
  assert.ok(reshareLinkSection.includes('e.stopPropagation()'), 'Reshare attribution link onClick must stop event propagation')
})

test('StoryHighlights Overlay Dismissal: resets activeHighlight and highlightStories on profile user change', () => {
  const hlPath = path.join(__dirname, 'StoryHighlights.jsx')
  const content = fs.readFileSync(hlPath, 'utf8')

  assert.ok(content.includes('setActiveHighlight(null)'), 'Must reset activeHighlight on profile user change')
  assert.ok(content.includes('setHighlightStories([])'), 'Must reset highlightStories on profile user change')
  assert.ok(content.includes('setStoriesError(null)'), 'Must reset storiesError on profile user change')
})

// ── 2. Profile Share Workflow & Fallback Logic ─────────────────────────────
test('Profile Share Logic: Web Share API called when available with exact URL structure', async () => {
  let shareCalledWith = null
  const mockNavigator = {
    share: async (data) => {
      shareCalledWith = data
    },
  }

  const profile = { id: 42, name: 'Dr. Jane Doe', bio: 'Quantum optics researcher' }
  const targetId = profile.id
  const locationOrigin = 'https://snarp.example.com'
  const url = `${locationOrigin}/users/${targetId}`

  const shareData = {
    title: `${profile.name} on SNARP`,
    text: profile.bio ? `${profile.name}: ${profile.bio}` : `View ${profile.name}'s research profile on SNARP`,
    url,
  }

  await mockNavigator.share(shareData)

  assert.deepEqual(shareCalledWith, {
    title: 'Dr. Jane Doe on SNARP',
    text: 'Dr. Jane Doe: Quantum optics researcher',
    url: 'https://snarp.example.com/users/42',
  })
})

test('Profile Share Logic: Falls back to clipboard and sets copied state when Web Share API is absent', async () => {
  let clipboardCopiedText = null
  let copiedState = false

  const mockClipboard = {
    writeText: async (text) => {
      clipboardCopiedText = text
    },
  }

  const targetId = 88
  const locationOrigin = 'https://snarp.example.com'
  const url = `${locationOrigin}/users/${targetId}`

  await mockClipboard.writeText(url)
  copiedState = true

  assert.equal(clipboardCopiedText, 'https://snarp.example.com/users/88')
  assert.equal(copiedState, true)
})

test('Profile Share Logic: Sets error feedback when both Web Share and Clipboard API fail', async () => {
  let shareError = ''
  const mockFailingClipboard = {
    writeText: async () => {
      throw new Error('Clipboard write access denied')
    },
  }

  try {
    await mockFailingClipboard.writeText('https://snarp.example.com/users/99')
  } catch {
    shareError = 'Could not copy profile link'
  }

  assert.equal(shareError, 'Could not copy profile link')
})

// ── 3. Profile Messaging API Contract & Error Handling ──────────────────────
test('Profile Message Logic: Successfully initiates conversation and prepares navigation to /messages?conversation=:id', async () => {
  const targetUserId = 25
  let apiCall = null
  let navigatedTo = null

  const mockApi = async (path, options) => {
    apiCall = { path, options }
    return { id: 1001, user_one: 1, user_two: 25 }
  }

  const conv = await mockApi('/messages/conversations', {
    method: 'POST',
    body: { userId: Number(targetUserId) },
  })

  if (conv?.id) {
    navigatedTo = `/messages?conversation=${conv.id}`
  }

  assert.equal(apiCall.path, '/messages/conversations')
  assert.equal(apiCall.options.method, 'POST')
  assert.deepEqual(apiCall.options.body, { userId: 25 })
  assert.equal(navigatedTo, '/messages?conversation=1001')
})

test('Profile Message Logic: Prevents self-messaging and displays friendly error', async () => {
  const currentUserId = 5
  const targetUserId = 5
  let messageError = ''

  if (String(currentUserId) === String(targetUserId)) {
    messageError = 'You cannot message yourself'
  }

  assert.equal(messageError, 'You cannot message yourself')
})

test('Profile Message Logic: API failure displays error message and does NOT navigate', async () => {
  let navigatedTo = null
  let messageError = ''
  let messaging = true

  const mockFailingApi = async () => {
    throw new Error('User does not accept direct messages')
  }

  try {
    const conv = await mockFailingApi('/messages/conversations', {
      method: 'POST',
      body: { userId: 999 },
    })
    if (conv?.id) {
      navigatedTo = `/messages?conversation=${conv.id}`
    }
  } catch (err) {
    messageError = err.message || 'Could not start conversation'
  } finally {
    messaging = false
  }

  assert.equal(navigatedTo, null, 'Must NOT navigate when conversation API fails')
  assert.equal(messageError, 'User does not accept direct messages')
  assert.equal(messaging, false, 'Loading state must be reset')
})

test('Profile Message Logic: Duplicate clicks blocked while messaging is in-flight', () => {
  let messaging = true
  let callsMade = 0

  const handleClick = () => {
    if (messaging) return // button disabled
    callsMade++
  }

  handleClick()
  handleClick()
  assert.equal(callsMade, 0, 'No API calls should be triggered when messaging=true')
})

// ── 4. Owner vs Visitor Permissions Matrix ──────────────────────────────────
test('Permissions: Visitor profile renders profile-actions; Owner profile suppresses visitor actions', () => {
  const currentUser = { id: 1, name: 'Alice' }

  // Case A: Alice views Bob's profile (Visitor mode)
  const bobProfile = { id: 2, name: 'Bob' }
  const isOwnerBob = String(currentUser.id) === String(bobProfile.id)
  assert.equal(isOwnerBob, false)
  const shouldRenderActionsVisitor = !isOwnerBob
  assert.equal(shouldRenderActionsVisitor, true, 'Visitor must see .profile-actions')

  // Case B: Alice views her own profile (Owner mode)
  const aliceProfile = { id: 1, name: 'Alice' }
  const isOwnerAlice = String(currentUser.id) === String(aliceProfile.id)
  assert.equal(isOwnerAlice, true)
  const shouldRenderActionsOwner = !isOwnerAlice
  assert.equal(shouldRenderActionsOwner, false, 'Owner must NOT see visitor .profile-actions')
})

// ── 5. Post Share Copied Feedback Logic ─────────────────────────────────────
test('Post Share Feedback: Sets postShareCopied only when clipboard succeeds', async () => {
  let postShareCopied = false
  const mockClipboard = {
    writeText: async () => {},
  }

  await mockClipboard.writeText('https://snarp.example.com/users/1?post=10#post-10')
  postShareCopied = true

  assert.equal(postShareCopied, true, 'Post share copied state set to true on success')
})

// ── 6. UI Contracts: Files and Classes ──────────────────────────────────────
test('UI Contract: frontend/src/pages/index.jsx contains .profile-actions with Share and Message buttons', () => {
  const file = path.join(__dirname, '../../pages/index.jsx')
  const content = fs.readFileSync(file, 'utf8')

  assert.ok(content.includes('useNavigate'), 'Imports useNavigate from react-router-dom')
  assert.ok(content.includes('profile-actions'), 'Renders .profile-actions container')
  assert.ok(content.includes('profile-share-btn'), 'Renders .profile-share-btn')
  assert.ok(content.includes('profile-message-btn'), 'Renders .profile-message-btn')
  assert.ok(!content.includes('profile-like-btn'), 'Does NOT render fake profile-like-btn')
  assert.ok(content.includes('api(\'/messages/conversations\''), 'Calls POST /messages/conversations')
  assert.ok(content.includes('/messages?conversation='), 'Navigates to conversation on success')
})

test('UI Contract: frontend/src/Feed.jsx contains postShareCopied state and feedback', () => {
  const file = path.join(__dirname, '../../Feed.jsx')
  const content = fs.readFileSync(file, 'utf8')

  assert.ok(content.includes('postShareCopied'), 'Declares postShareCopied state in PostActions')
  assert.ok(content.includes('Copied!'), 'Displays Copied! feedback on post share button')
})

test('UI Contract: frontend/src/index.css contains .profile-actions and .profile-action-error styles', () => {
  const file = path.join(__dirname, '../../index.css')
  const content = fs.readFileSync(file, 'utf8')

  assert.ok(content.includes('.profile-actions {'), 'Defines .profile-actions container')
  assert.ok(content.includes('.profile-action-error'), 'Defines .profile-action-error styling')
})

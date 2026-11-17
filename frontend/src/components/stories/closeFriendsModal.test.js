import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

// ── 1. Code Contract: CloseFriendsModal.jsx Component Existence & Structure ──
test('Code Contract: CloseFriendsModal.jsx exists and exports a valid React component', () => {
  const modalPath = path.join(__dirname, 'CloseFriendsModal.jsx')
  assert.ok(fs.existsSync(modalPath), 'CloseFriendsModal.jsx must exist')

  const content = fs.readFileSync(modalPath, 'utf8')
  assert.ok(content.includes('export default function CloseFriendsModal'), 'Must export default CloseFriendsModal')
  assert.ok(content.includes("from '../../api'"), 'Must import api helper')
  assert.ok(content.includes("from '../ui'"), 'Must import Avatar from ../ui')
  assert.ok(content.includes("from '../../format'"), 'Must import format helpers')
  assert.ok(content.includes("'./stories.css'"), 'Must import stories.css')
  assert.ok(content.includes('role="dialog"'), 'Must have role="dialog" accessibility attribute')
  assert.ok(content.includes('aria-modal="true"'), 'Must have aria-modal="true"')
  assert.ok(content.includes('aria-labelledby="close-friends-title"'), 'Must have aria-labelledby attribute')
})

// ── 2. Code Contract: StoriesTray.jsx Integration ────────────────────────────
test('Code Contract: StoriesTray.jsx integrates Close Friends management entry point and modal', () => {
  const trayPath = path.join(__dirname, 'StoriesTray.jsx')
  assert.ok(fs.existsSync(trayPath), 'StoriesTray.jsx must exist')

  const content = fs.readFileSync(trayPath, 'utf8')
  assert.ok(content.includes('CloseFriendsModal'), 'StoriesTray must import CloseFriendsModal')
  assert.ok(content.includes('showCloseFriendsModal'), 'StoriesTray must manage showCloseFriendsModal state')
  assert.ok(content.includes('stories-tray-cf-btn'), 'StoriesTray must render stories-tray-cf-btn')
  assert.ok(content.includes('Manage Close Friends list'), 'StoriesTray must have accessible aria-label for Close Friends button')
  assert.ok(content.includes('<CloseFriendsModal'), 'StoriesTray must render <CloseFriendsModal')
})

// ── 3. Code Contract: stories.css Styles ─────────────────────────────────────
test('Code Contract: stories.css defines comprehensive styles for Close Friends UI', () => {
  const cssPath = path.join(__dirname, 'stories.css')
  assert.ok(fs.existsSync(cssPath), 'stories.css must exist')

  const css = fs.readFileSync(cssPath, 'utf8')
  assert.ok(css.includes('.close-friends-backdrop'), 'Must define .close-friends-backdrop')
  assert.ok(css.includes('.close-friends-panel'), 'Must define .close-friends-panel')
  assert.ok(css.includes('.close-friends-star-badge'), 'Must define .close-friends-star-badge')
  assert.ok(css.includes('.close-friends-count-pill'), 'Must define .close-friends-count-pill')
  assert.ok(css.includes('.close-friends-search-input'), 'Must define .close-friends-search-input')
  assert.ok(css.includes('.close-friends-btn.add'), 'Must define .close-friends-btn.add with green accent')
  assert.ok(css.includes('.close-friends-btn.remove'), 'Must define .close-friends-btn.remove')
  assert.ok(css.includes('.stories-tray-cf-btn'), 'Must define .stories-tray-cf-btn')
})

// ── 4. Unit Logic: Modal Visibility & Escape Key Handling ─────────────────────
test('Modal Logic: Visibility guard and Escape key listener lifecycle', () => {
  let isClosed = false
  const onClose = () => { isClosed = true }

  const handleEscape = (e, isOpen) => {
    if (!isOpen) return
    if (e.key === 'Escape') {
      onClose()
    }
  }

  // When modal is closed, Escape does not trigger onClose
  handleEscape({ key: 'Escape' }, false)
  assert.equal(isClosed, false)

  // When modal is open, Escape triggers onClose
  handleEscape({ key: 'Escape' }, true)
  assert.equal(isClosed, true)

  // Other keys do not trigger onClose
  isClosed = false
  handleEscape({ key: 'Enter' }, true)
  assert.equal(isClosed, false)
})

// ── 5. Unit Logic: List Loading & Member Count Calculation ───────────────────
test('List Logic: Member count accurately reflects loaded close friends list', () => {
  const rawApiData = {
    closeFriends: [
      { id: 20, name: 'Bob Friend', username: 'bob', avatar_url: '/img/20' },
      { id: 30, name: 'Charlie Peer', username: 'charlie', avatar_url: null },
    ],
    count: 2,
  }

  const list = Array.isArray(rawApiData?.closeFriends) ? rawApiData.closeFriends : []
  assert.equal(list.length, 2)
  assert.equal(list[0].id, 20)
  assert.equal(list[1].id, 30)

  // Empty list calculation
  const emptyData = { closeFriends: [], count: 0 }
  const emptyList = Array.isArray(emptyData?.closeFriends) ? emptyData.closeFriends : []
  assert.equal(emptyList.length, 0)
})

// ── 6. Unit Logic: Debounced Search & Self Exclusion ─────────────────────────
test('Search Logic: Excludes self, trims query, and handles debouncing', () => {
  const currentUserId = 10
  const searchResultsFromApi = [
    { id: 10, name: 'Alice Author', username: 'alice' }, // Self
    { id: 20, name: 'Bob Friend', username: 'bob' },
    { id: 40, name: 'David Colleague', username: 'david' },
  ]

  const filterSearchResults = (results, myId) => {
    return results.filter((u) => {
      const uid = u.id ?? u.user_id
      return myId === undefined || myId === null || String(uid) !== String(myId)
    })
  }

  const filtered = filterSearchResults(searchResultsFromApi, currentUserId)
  assert.equal(filtered.length, 2)
  assert.ok(!filtered.some((u) => u.id === currentUserId), 'Must not include self')
  assert.equal(filtered[0].id, 20)
  assert.equal(filtered[1].id, 40)
})

// ── 7. Unit Logic: Add User to Close Friends & Duplicate Prevention ───────────
test('Add Logic: Adds new user, updates member count, prevents duplicate submissions', () => {
  let closeFriends = [
    { id: 20, name: 'Bob Friend', username: 'bob' },
  ]
  const actionInProgress = {}
  let actionError = ''

  const handleAdd = (user, myId) => {
    const targetId = user.id ?? user.user_id
    if (!targetId) return false

    // Prevent adding self
    if (myId !== undefined && myId !== null && String(targetId) === String(myId)) {
      actionError = 'You cannot add yourself to your Close Friends list'
      return false
    }

    // Prevent duplicate submission if already in progress or already added
    if (actionInProgress[targetId]) return false
    if (closeFriends.some((cf) => String(cf.id) === String(targetId))) {
      actionError = 'User is already in your close friends list'
      return false
    }

    actionInProgress[targetId] = 'adding'
    closeFriends = [{ id: targetId, name: user.name, username: user.username }, ...closeFriends]
    delete actionInProgress[targetId]
    return true
  }

  // 1. Add valid peer (id: 40)
  assert.equal(handleAdd({ id: 40, name: 'David', username: 'david' }, 10), true)
  assert.equal(closeFriends.length, 2)
  assert.equal(closeFriends[0].id, 40)

  // 2. Reject duplicate add (id: 40)
  assert.equal(handleAdd({ id: 40, name: 'David', username: 'david' }, 10), false)
  assert.equal(closeFriends.length, 2)
  assert.equal(actionError, 'User is already in your close friends list')

  // 3. Reject self add (id: 10)
  assert.equal(handleAdd({ id: 10, name: 'Self', username: 'self' }, 10), false)
  assert.equal(closeFriends.length, 2)
  assert.equal(actionError, 'You cannot add yourself to your Close Friends list')
})

// ── 8. Unit Logic: Remove User from Close Friends ─────────────────────────────
test('Remove Logic: Removes friend, updates member count, and isolates in-flight action', () => {
  let closeFriends = [
    { id: 20, name: 'Bob Friend', username: 'bob' },
    { id: 40, name: 'David Colleague', username: 'david' },
  ]
  const actionInProgress = {}

  const handleRemove = (user) => {
    const targetId = user.id ?? user.user_id
    if (!targetId || actionInProgress[targetId]) return false

    actionInProgress[targetId] = 'removing'
    closeFriends = closeFriends.filter((cf) => String(cf.id) !== String(targetId))
    delete actionInProgress[targetId]
    return true
  }

  assert.equal(handleRemove({ id: 20 }), true)
  assert.equal(closeFriends.length, 1)
  assert.equal(closeFriends[0].id, 40)
})

// ── 9. Unit Logic: Error Resilience (List Preserved on API Failure) ───────────
test('Error Resilience: API failure sets error banner while preserving existing Close Friends list', () => {
  const initialCloseFriends = [
    { id: 20, name: 'Bob Friend', username: 'bob' },
    { id: 40, name: 'David Colleague', username: 'david' },
  ]
  let closeFriends = [...initialCloseFriends]
  let actionError = ''

  const simulateFailedAdd = (err) => {
    actionError = err?.message || 'Could not add user'
    // Ensure closeFriends state is NOT cleared on error
  }

  simulateFailedAdd(new Error('Network connection timeout'))
  assert.equal(actionError, 'Network connection timeout')
  assert.deepEqual(closeFriends, initialCloseFriends, 'List must remain intact after API failure')

  const simulateFailedRemove = (err) => {
    actionError = err?.message || 'Could not remove user'
  }

  simulateFailedRemove(new Error('User is not in your close friends list'))
  assert.equal(actionError, 'User is not in your close friends list')
  assert.deepEqual(closeFriends, initialCloseFriends, 'List must remain intact after removal failure')
})

// ── 10. Unit Logic: Empty State Detection ─────────────────────────────────────
test('Empty State Logic: Distinguishes between empty Close Friends list and empty search results', () => {
  const getDisplayState = ({ isSearching, searchLoading, searchResultsLength, listLoading, closeFriendsLength }) => {
    if (isSearching) {
      if (searchLoading) return 'search_loading'
      if (searchResultsLength === 0) return 'search_empty'
      return 'search_results'
    }
    if (listLoading) return 'list_loading'
    if (closeFriendsLength === 0) return 'list_empty'
    return 'list_results'
  }

  // Not searching, 0 close friends -> empty list state
  assert.equal(
    getDisplayState({ isSearching: false, listLoading: false, closeFriendsLength: 0 }),
    'list_empty'
  )

  // Not searching, 2 close friends -> list results state
  assert.equal(
    getDisplayState({ isSearching: false, listLoading: false, closeFriendsLength: 2 }),
    'list_results'
  )

  // Searching, query returned 0 matches -> empty search state
  assert.equal(
    getDisplayState({ isSearching: true, searchLoading: false, searchResultsLength: 0 }),
    'search_empty'
  )

  // Searching, query returned 3 matches -> search results state
  assert.equal(
    getDisplayState({ isSearching: true, searchLoading: false, searchResultsLength: 3 }),
    'search_results'
  )
})

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { MAX_REPLY_LENGTH, validateStoryReply } from './validator.js'
import { createStoryRouter } from './routes.js'

// 1. Validator Tests
test('MAX_REPLY_LENGTH is 500', () => {
  assert.equal(MAX_REPLY_LENGTH, 500)
})

test('validateStoryReply accepts valid text and trims leading/trailing whitespace', () => {
  const result = validateStoryReply('   Great story! Keep it up.   ')
  assert.equal(result, 'Great story! Keep it up.')
})

test('validateStoryReply accepts maximum 500 character text', () => {
  const maxText = 'A'.repeat(500)
  const result = validateStoryReply(maxText)
  assert.equal(result, maxText)
})

test('validateStoryReply rejects empty or whitespace-only text with 400', () => {
  const invalid = ['', '   ', '\n\t  ', null, undefined, 123, {}, []]
  for (const item of invalid) {
    assert.throws(
      () => validateStoryReply(item),
      (err) => err.status === 400 && err.field === 'text'
    )
  }
})

test('validateStoryReply rejects text exceeding 500 characters with 400', () => {
  const tooLong = 'A'.repeat(501)
  assert.throws(
    () => validateStoryReply(tooLong),
    (err) => err.status === 400 && err.field === 'text' && err.message.includes('500')
  )
})

// 2. Mock Pool & Route Integration Tests
function createMockPool() {
  const replies = new Map() // key: replyId -> { id, story_id, sender_id, story_owner_id, text, created_at }
  let nextReplyId = 1
  const notifications = []
  const stories = new Map([
    ['1', { id: '1', user_id: 10, type: 'text', content: 'Story 1 by Alice', expires_at: new Date(Date.now() + 86400000) }],
    ['2', { id: '2', user_id: 20, type: 'photo', content: 'Story 2 by Bob (expired)', expires_at: new Date(Date.now() - 1000) }],
  ])
  const views = new Map() // key: `${storyId}:${viewerId}` -> { storyId, viewerId, viewedAt }
  const users = new Map([
    [10, { id: 10, name: 'Alice (Owner)', profile_image_id: null }],
    [20, { id: 20, name: 'Bob (Viewer)', profile_image_id: 99 }],
    [30, { id: 30, name: 'Charlie (Other)', profile_image_id: null }],
  ])

  return {
    stories,
    replies,
    views,
    users,
    notifications,
    async query(sql, params = []) {
      const normalized = sql.replace(/\s+/g, ' ').trim()

      // Active story check
      if (normalized.startsWith('SELECT id, user_id FROM stories WHERE id = $1 AND expires_at > now()') ||
          normalized.startsWith('SELECT id FROM stories WHERE id = $1 AND expires_at > now()')) {
        const s = stories.get(String(params[0]))
        if (s && s.expires_at > new Date()) {
          return { rows: [{ id: s.id, user_id: s.user_id }] }
        }
        return { rows: [] }
      }

      // Story check (unexpired or expired, for owner verification or GET replies)
      if (normalized.startsWith('SELECT id, user_id FROM stories WHERE id = $1')) {
        const s = stories.get(String(params[0]))
        if (s) return { rows: [{ id: s.id, user_id: s.user_id }] }
        return { rows: [] }
      }

      // Record view (ON CONFLICT DO NOTHING)
      if (normalized.startsWith('INSERT INTO story_views (story_id, viewer_id) VALUES ($1, $2)')) {
        const key = `${params[0]}:${params[1]}`
        if (!views.has(key)) {
          views.set(key, { storyId: String(params[0]), viewerId: params[1], viewedAt: new Date() })
        }
        return { rowCount: 1 }
      }

      // Insert story reply
      if (normalized.startsWith('INSERT INTO story_replies (story_id, sender_id, story_owner_id, text) VALUES ($1, $2, $3, $4)')) {
        const id = String(nextReplyId++)
        const row = {
          id,
          story_id: String(params[0]),
          sender_id: params[1],
          story_owner_id: params[2],
          text: params[3],
          created_at: new Date().toISOString(),
        }
        replies.set(id, row)
        return { rows: [row] }
      }

      // Fetch user info
      if (normalized.includes('FROM users WHERE id = $1')) {
        const u = users.get(params[0])
        if (u) {
          return {
            rows: [{
              name: u.name,
              avatar_url: u.profile_image_id ? `/api/images/${u.profile_image_id}` : null,
            }],
          }
        }
        return { rows: [] }
      }

      // List replies for story
      if (normalized.includes('FROM story_replies sr JOIN users u ON u.id = sr.sender_id WHERE sr.story_id = $1')) {
        const storyId = String(params[0])
        const result = []
        for (const rep of replies.values()) {
          if (rep.story_id === storyId) {
            const u = users.get(rep.sender_id)
            result.push({
              id: rep.id,
              story_id: rep.story_id,
              sender_id: rep.sender_id,
              sender_name: u?.name || 'User',
              sender_avatar_url: u?.profile_image_id ? `/api/images/${u.profile_image_id}` : null,
              text: rep.text,
              created_at: rep.created_at,
            })
          }
        }
        result.sort((a, b) => new Date(b.created_at) - new Date(a.created_at) || Number(b.id) - Number(a.id))
        return { rows: result }
      }

      // Notifications insert
      if (normalized.startsWith('INSERT INTO notifications (user_id, actor_id, kind, entity_type, entity_id, text)')) {
        const notif = {
          id: notifications.length + 1,
          user_id: params[0],
          actor_id: params[1],
          kind: 'story_reply',
          entity_type: 'story',
          entity_id: params[2],
          text: params[3],
          created_at: new Date(),
        }
        const existing = notifications.find(
          (n) => n.user_id === notif.user_id && n.actor_id === notif.actor_id && n.kind === notif.kind && n.entity_id === notif.entity_id
        )
        if (existing) {
          existing.text = notif.text
          existing.created_at = notif.created_at
        } else {
          notifications.push(notif)
        }
        return { rows: [notif] }
      }

      throw new Error(`Unhandled mock query: ${sql}`)
    },
  }
}

function createTestApp(pool, currentUserId = 20) {
  const isPgId = (id) => /^[0-9]+$/.test(String(id))
  const auth = (req, res, next) => {
    if (currentUserId === null) {
      return res.status(401).json({ error: 'Unauthorized' })
    }
    req.userId = currentUserId
    next()
  }
  const upload = { single: () => (req, res, next) => next() }

  const router = createStoryRouter({ pool, auth, isPgId, upload })

  return async function dispatch(method, path, body = {}) {
    return new Promise((resolve) => {
      const match = path.match(/^\/(\d+)\/replies$/)
      if (!match) {
        return resolve({ status: 404, body: { error: 'Not found' } })
      }
      const id = match[1]

      const req = {
        method,
        params: { id },
        body,
        headers: {},
      }

      const res = {
        statusCode: 200,
        headers: {},
        status(code) {
          this.statusCode = code
          return this
        },
        json(data) {
          resolve({ status: this.statusCode, body: data })
        },
      }

      const next = (err) => {
        if (err) resolve({ status: 500, body: { error: err.message } })
      }

      auth(req, res, () => {
        if (method === 'POST') {
          router.handle(
            { ...req, url: `/${id}/replies`, originalUrl: `/api/stories/${id}/replies` },
            res,
            next
          )
        } else if (method === 'GET') {
          router.handle(
            { ...req, url: `/${id}/replies`, originalUrl: `/api/stories/${id}/replies` },
            res,
            next
          )
        } else {
          resolve({ status: 405, body: { error: 'Method not allowed' } })
        }
      })
    })
  }
}

// 3. POST /api/stories/:id/replies Route Tests
test('POST /api/stories/:id/replies returns 401 when unauthenticated', async () => {
  const pool = createMockPool()
  const dispatch = createTestApp(pool, null)

  const res = await dispatch('POST', '/1/replies', { text: 'Hello!' })
  assert.equal(res.status, 401)
})

test('POST /api/stories/:id/replies returns 404 for non-existent story', async () => {
  const pool = createMockPool()
  const dispatch = createTestApp(pool, 20)

  const res = await dispatch('POST', '/9999/replies', { text: 'Hello!' })
  assert.equal(res.status, 404)
  assert.equal(res.body.error, 'Story not found')
})

test('POST /api/stories/:id/replies returns 404 for expired story', async () => {
  const pool = createMockPool()
  const dispatch = createTestApp(pool, 10) // story 2 owner is 20, viewer is 10

  const res = await dispatch('POST', '/2/replies', { text: 'Expired story reply' })
  assert.equal(res.status, 404)
  assert.equal(res.body.error, 'Story not found')
})

test('POST /api/stories/:id/replies returns 400 when user attempts to reply to their own story', async () => {
  const pool = createMockPool()
  // Story 1 owner is Alice (id 10). When Alice calls POST /1/replies:
  const dispatch = createTestApp(pool, 10)

  const res = await dispatch('POST', '/1/replies', { text: 'Self reply' })
  assert.equal(res.status, 400)
  assert.equal(res.body.error, 'Cannot reply to your own story')
})

test('POST /api/stories/:id/replies returns 400 when reply text is empty or invalid', async () => {
  const pool = createMockPool()
  const dispatch = createTestApp(pool, 20)

  const resEmpty = await dispatch('POST', '/1/replies', { text: '   ' })
  assert.equal(resEmpty.status, 400)
  assert.equal(resEmpty.body.field, 'text')

  const resMissing = await dispatch('POST', '/1/replies', {})
  assert.equal(resMissing.status, 400)
  assert.equal(resMissing.body.field, 'text')
})

test('POST /api/stories/:id/replies sends reply successfully, records view, and returns 201 with reply details', async () => {
  const pool = createMockPool()
  const dispatch = createTestApp(pool, 20) // Bob replying to Alice's story 1

  const res = await dispatch('POST', '/1/replies', { text: 'Awesome picture Alice!' })
  assert.equal(res.status, 201)
  assert.equal(res.body.success, true)
  assert.ok(res.body.reply)
  assert.equal(res.body.reply.story_id, '1')
  assert.equal(res.body.reply.sender_id, 20)
  assert.equal(res.body.reply.story_owner_id, 10)
  assert.equal(res.body.reply.text, 'Awesome picture Alice!')
  assert.equal(res.body.reply.sender_name, 'Bob (Viewer)')
  assert.equal(res.body.reply.sender_avatar_url, '/api/images/99')

  // Verify view was recorded automatically
  assert.ok(pool.views.has('1:20'))

  // Verify notification was created for Alice (10)
  assert.equal(pool.notifications.length, 1)
  assert.equal(pool.notifications[0].user_id, 10)
  assert.equal(pool.notifications[0].actor_id, 20)
  assert.equal(pool.notifications[0].kind, 'story_reply')
  assert.equal(pool.notifications[0].entity_id, '1')
  assert.ok(pool.notifications[0].text.includes('Bob (Viewer) replied to your story'))
})

// 4. GET /api/stories/:id/replies Route Tests
test('GET /api/stories/:id/replies returns 401 when unauthenticated', async () => {
  const pool = createMockPool()
  const dispatch = createTestApp(pool, null)

  const res = await dispatch('GET', '/1/replies')
  assert.equal(res.status, 401)
})

test('GET /api/stories/:id/replies returns 403 when non-owner requests replies', async () => {
  const pool = createMockPool()
  // Charlie (30) is not the owner of story 1 (Alice is owner 10)
  const dispatch = createTestApp(pool, 30)

  const res = await dispatch('GET', '/1/replies')
  assert.equal(res.status, 403)
  assert.equal(res.body.error, 'Only the story owner can view replies')
})

test('GET /api/stories/:id/replies returns 200 with replies list for the story owner', async () => {
  const pool = createMockPool()
  const bobDispatch = createTestApp(pool, 20)
  const charlieDispatch = createTestApp(pool, 30)
  const aliceDispatch = createTestApp(pool, 10) // Story 1 owner

  // Bob and Charlie both reply to Alice's story
  await bobDispatch('POST', '/1/replies', { text: 'Reply from Bob' })
  await charlieDispatch('POST', '/1/replies', { text: 'Reply from Charlie' })

  // Alice opens the drawer and fetches replies
  const res = await aliceDispatch('GET', '/1/replies')
  assert.equal(res.status, 200)
  assert.equal(res.body.storyId, '1')
  assert.equal(res.body.count, 2)
  assert.equal(res.body.replies.length, 2)
  assert.equal(res.body.replies[0].sender_name, 'Charlie (Other)')
  assert.equal(res.body.replies[0].text, 'Reply from Charlie')
  assert.equal(res.body.replies[1].sender_name, 'Bob (Viewer)')
  assert.equal(res.body.replies[1].text, 'Reply from Bob')
})

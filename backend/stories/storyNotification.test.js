import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createStoryRouter } from './routes.js'

function createMockNotificationPool() {
  const stories = new Map([
    ['101', { id: '101', user_id: 1, type: 'text', content: 'Story by Owner', audience: 'everyone', expires_at: new Date(Date.now() + 86400000) }],
    ['102', { id: '102', user_id: 1, type: 'photo', content: 'Expired Story', audience: 'everyone', expires_at: new Date(Date.now() - 1000) }],
  ])
  const users = new Map([
    [1, { id: 1, name: 'Alice Owner', email: 'alice@example.com', profile_image_id: null }],
    [2, { id: 2, name: 'Bob Reactor', email: 'bob@example.com', profile_image_id: 22 }],
    [3, { id: 3, name: 'Charlie Replier', email: 'charlie@example.com', profile_image_id: null }],
  ])
  const reactions = new Map() // key: `${storyId}:${userId}` -> { storyId, userId, type }
  const replies = new Map() // key: replyId -> { id, story_id, sender_id, story_owner_id, text }
  let nextReplyId = 1
  const views = new Map()
  const notifications = [] // array of { id, user_id, actor_id, kind, entity_type, entity_id, text, read_at, created_at }

  return {
    stories,
    users,
    reactions,
    replies,
    views,
    notifications,
    async query(sql, params = []) {
      const normalized = sql.replace(/\s+/g, ' ').trim()

      // Audience check
      if (normalized.startsWith('SELECT audience FROM stories WHERE id = $1')) {
        const s = stories.get(String(params[0]))
        return { rows: s ? [{ audience: s.audience }] : [] }
      }

      // Active story check
      if (normalized.startsWith('SELECT id, user_id FROM stories WHERE id = $1 AND expires_at > now()')) {
        const s = stories.get(String(params[0]))
        if (s && s.expires_at > new Date()) {
          return { rows: [{ id: s.id, user_id: s.user_id }] }
        }
        return { rows: [] }
      }

      // Story metadata check for GET /:id
      if (normalized.startsWith('SELECT id, user_id, expires_at > now() AS is_active FROM stories WHERE id = $1')) {
        const s = stories.get(String(params[0]))
        if (s) {
          return { rows: [{ id: s.id, user_id: s.user_id, is_active: s.expires_at > new Date() }] }
        }
        return { rows: [] }
      }

      // Record view
      if (normalized.startsWith('INSERT INTO story_views')) {
        views.set(`${params[0]}:${params[1]}`, new Date())
        return { rowCount: 1 }
      }

      // Upsert reaction
      if (normalized.startsWith('INSERT INTO story_reactions')) {
        reactions.set(`${params[0]}:${params[1]}`, { storyId: String(params[0]), userId: params[1], type: params[2] })
        return { rowCount: 1 }
      }

      // Delete reaction
      if (normalized.startsWith('DELETE FROM story_reactions WHERE story_id = $1 AND user_id = $2')) {
        reactions.delete(`${params[0]}:${params[1]}`)
        return { rowCount: 1 }
      }

      // Aggregate reaction counts
      if (normalized.includes('FROM story_reactions WHERE story_id = $1')) {
        let total = 0, love = 0, haha = 0, wow = 0, sad = 0, like = 0
        for (const r of reactions.values()) {
          if (r.storyId === String(params[0])) {
            total++
            if (r.type === 'love') love++
            if (r.type === 'haha') haha++
            if (r.type === 'wow') wow++
            if (r.type === 'sad') sad++
            if (r.type === 'like') like++
          }
        }
        return { rows: [{ total, love, haha, wow, sad, like }] }
      }

      // Insert story reply
      if (normalized.startsWith('INSERT INTO story_replies')) {
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

      // Fetch user details
      if (normalized.includes('FROM users') && normalized.includes('WHERE id = $1') || normalized.includes('WHERE u.id = $1')) {
        const u = users.get(Number(params[0]))
        if (u) {
          return {
            rows: [{
              id: u.id,
              name: u.name,
              full_name: u.name,
              username: u.email.split('@')[0],
              avatar_url: u.profile_image_id ? `/api/images/${u.profile_image_id}` : null,
            }],
          }
        }
        return { rows: [] }
      }

      // Insert or upsert notification
      if (normalized.startsWith('INSERT INTO notifications')) {
        const isReaction = normalized.includes("'story_reaction'")
        const isReply = normalized.includes("'story_reply'")
        const kind = isReaction ? 'story_reaction' : (isReply ? 'story_reply' : 'other')
        const userId = Number(params[0])
        const actorId = Number(params[1])
        const entityId = String(params[2])
        const text = params[3]

        const existing = notifications.find(
          (n) => n.user_id === userId && n.actor_id === actorId && n.kind === kind && String(n.entity_id) === entityId
        )
        if (existing) {
          existing.text = text
          existing.read_at = null
          existing.created_at = new Date()
          return { rows: [existing] }
        }
        const notif = {
          id: notifications.length + 1,
          user_id: userId,
          actor_id: actorId,
          kind,
          entity_type: 'story',
          entity_id: entityId,
          text,
          read_at: null,
          created_at: new Date(),
        }
        notifications.push(notif)
        return { rows: [notif] }
      }

      // Delete unread notification on reaction removal
      if (normalized.startsWith('DELETE FROM notifications')) {
        const userId = Number(params[0])
        const actorId = Number(params[1])
        const storyId = String(params[2])
        const idx = notifications.findIndex(
          (n) => n.user_id === userId && n.actor_id === actorId && n.kind === 'story_reaction' && String(n.entity_id) === storyId && n.read_at === null
        )
        if (idx !== -1) {
          notifications.splice(idx, 1)
          return { rowCount: 1 }
        }
        return { rowCount: 0 }
      }

      // Story list for owner in GET /:id
      if (normalized.includes('FROM stories s') && normalized.includes('WHERE s.user_id = $1')) {
        const storyId = String(params[2] || params[0])
        const s = stories.get(storyId)
        if (s) {
          return {
            rows: [{
              id: s.id,
              type: s.type,
              content: s.content,
              background_style: 'story-bg-gradient-sunset',
              audience: s.audience,
              created_at: new Date().toISOString(),
              expires_at: s.expires_at.toISOString(),
              media_url: null,
              viewed: false,
              view_count: 0,
              my_reaction: null,
              reaction_count: 0,
              reply_count: 0,
            }],
          }
        }
        return { rows: [] }
      }

      // Sticker sub-queries return null
      if (normalized.includes('FROM story_polls') || normalized.includes('FROM story_questions') || normalized.includes('FROM story_quizzes')) {
        return { rows: [] }
      }
      if (normalized.includes('FROM story_mentions') || normalized.includes('FROM story_reshares')) {
        return { rows: [] }
      }

      return { rows: [] }
    },
  }
}

function createDispatch(pool, currentUserId = 2) {
  const isPgId = (id) => /^[0-9]+$/.test(String(id))
  const auth = (req, res, next) => {
    if (currentUserId === null) return res.status(401).json({ error: 'Unauthenticated' })
    req.userId = currentUserId
    next()
  }
  const upload = { single: () => (req, res, next) => next() }
  const router = createStoryRouter({ pool, auth, isPgId, upload })

  return async (method, path, body = {}) => {
    return new Promise((resolve) => {
      const req = {
        method,
        url: path,
        originalUrl: `/api/stories${path}`,
        baseUrl: '/api/stories',
        path,
        params: {},
        body,
        headers: {},
      }
      const res = {
        statusCode: 200,
        headers: {},
        status(c) { this.statusCode = c; return this },
        set(k, v) { this.headers[k] = v; return this },
        json(data) { resolve({ status: this.statusCode, headers: this.headers, body: data }) },
        send(data) { resolve({ status: this.statusCode, headers: this.headers, body: data }) },
        end() { resolve({ status: this.statusCode, headers: this.headers, body: null }) },
      }
      router(req, res, (err) => {
        if (err) resolve({ status: err.status || 500, body: { error: err.message } })
        else resolve({ status: 404, body: { error: 'Not Found' } })
      })
    })
  }
}

// ── Tests ───────────────────────────────────────────────────────────────────

test('Story Reaction: adds reaction and generates notification for story owner', async () => {
  const pool = createMockNotificationPool()
  const dispatch = createDispatch(pool, 2) // Bob (2) reacting to Alice's story 101 (Owner: 1)

  const res = await dispatch('POST', '/101/reactions', { type: 'love' })
  assert.equal(res.status, 200)
  assert.equal(res.body.success, true)
  assert.equal(res.body.myReaction, 'love')

  // Verify notification was created for Alice (1)
  assert.equal(pool.notifications.length, 1)
  const notif = pool.notifications[0]
  assert.equal(notif.user_id, 1, 'Owner 1 receives the notification')
  assert.equal(notif.actor_id, 2, 'Actor 2 is Bob')
  assert.equal(notif.kind, 'story_reaction')
  assert.equal(notif.entity_type, 'story')
  assert.equal(notif.entity_id, '101')
  assert.equal(notif.text, 'Bob Reactor reacted to your story')
  assert.equal(notif.read_at, null)
})

test('Story Reaction: changing reaction updates existing notification without duplicating', async () => {
  const pool = createMockNotificationPool()
  const dispatch = createDispatch(pool, 2)

  // 1. Initial reaction 'love'
  await dispatch('POST', '/101/reactions', { type: 'love' })
  assert.equal(pool.notifications.length, 1)

  // 2. Bob changes reaction to 'haha'
  const res2 = await dispatch('POST', '/101/reactions', { type: 'haha' })
  assert.equal(res2.status, 200)

  // Deduplication check: count remains 1
  assert.equal(pool.notifications.length, 1, 'Does not duplicate notification')
  assert.equal(pool.notifications[0].user_id, 1)
  assert.equal(pool.notifications[0].read_at, null, 'Resets read state')
})

test('Story Reaction: deleting reaction removes unread reaction notification', async () => {
  const pool = createMockNotificationPool()
  const dispatch = createDispatch(pool, 2)

  // Add reaction
  await dispatch('POST', '/101/reactions', { type: 'love' })
  assert.equal(pool.notifications.length, 1)

  // Remove reaction
  const resDel = await dispatch('DELETE', '/101/reactions')
  assert.equal(resDel.status, 200)

  // Unread notification should be removed
  assert.equal(pool.notifications.length, 0, 'Unread notification removed on reaction delete')
})

test('Story Reaction: owner self-reaction is blocked and creates no notification', async () => {
  const pool = createMockNotificationPool()
  const dispatch = createDispatch(pool, 1) // Alice reacting to her own story 101

  const res = await dispatch('POST', '/101/reactions', { type: 'love' })
  assert.equal(res.status, 400)
  assert.equal(pool.notifications.length, 0, 'No notification on self-reaction')
})

test('Story Reply: sending reply generates notification for story owner with text preview', async () => {
  const pool = createMockNotificationPool()
  const dispatch = createDispatch(pool, 3) // Charlie (3) replying to Alice's story 101 (Owner: 1)

  const res = await dispatch('POST', '/101/replies', { text: 'Such an inspiring milestone!' })
  assert.equal(res.status, 201)
  assert.equal(res.body.success, true)

  // Verify notification
  assert.equal(pool.notifications.length, 1)
  const notif = pool.notifications[0]
  assert.equal(notif.user_id, 1, 'Owner 1 receives reply notification')
  assert.equal(notif.actor_id, 3, 'Actor 3 is Charlie')
  assert.equal(notif.kind, 'story_reply')
  assert.equal(notif.entity_type, 'story')
  assert.equal(notif.entity_id, '101')
  assert.ok(notif.text.includes('Charlie Replier replied to your story: "Such an inspiring milestone!"'))
  assert.equal(notif.read_at, null)
})

test('Story Reply: sending multiple replies to same story updates notification without duplicating', async () => {
  const pool = createMockNotificationPool()
  const dispatch = createDispatch(pool, 3)

  // First reply
  await dispatch('POST', '/101/replies', { text: 'First reply text' })
  assert.equal(pool.notifications.length, 1)

  // Second reply from same user
  const res2 = await dispatch('POST', '/101/replies', { text: 'Second reply with new details' })
  assert.equal(res2.status, 201)

  // Deduplication check: count remains 1, text updated
  assert.equal(pool.notifications.length, 1, 'No duplicate notification records')
  assert.ok(pool.notifications[0].text.includes('Second reply with new details'))
})

test('Story Reply: owner self-reply is blocked and creates no notification', async () => {
  const pool = createMockNotificationPool()
  const dispatch = createDispatch(pool, 1) // Alice replying to her own story 101

  const res = await dispatch('POST', '/101/replies', { text: 'Replying to myself' })
  assert.equal(res.status, 400)
  assert.equal(pool.notifications.length, 0, 'No notification on self-reply')
})

test('GET /api/stories/:id: returns story details and owner active sequence for notification navigation', async () => {
  const pool = createMockNotificationPool()
  const dispatch = createDispatch(pool, 2)

  const res = await dispatch('GET', '/101')
  assert.equal(res.status, 200)
  assert.equal(res.body.success, true)
  assert.ok(res.body.user)
  assert.equal(res.body.user.id, 1)
  assert.ok(Array.isArray(res.body.stories))
  assert.equal(res.body.stories[0].id, '101')
  assert.equal(res.body.initialIndex, 0)
})

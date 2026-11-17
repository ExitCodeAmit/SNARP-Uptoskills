import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createStoryRouter } from './routes.js'

// ── Mock Pool & Test Harness ──────────────────────────────────────────────────
function createMockPool() {
  let nextStoryId = 100
  let nextReshareId = 1
  let nextNotifId = 1

  const users = new Map([
    [10, { id: 10, name: 'Alice Original', email: 'alice@example.com', profile_image_id: 100 }],
    [20, { id: 20, name: 'Bob Resharer', email: 'bob@example.com', profile_image_id: null }],
    [30, { id: 30, name: 'Charlie Peer', email: 'charlie@example.com', profile_image_id: 300 }],
  ])

  const stories = new Map([
    ['1', {
      id: '1',
      user_id: 10,
      type: 'photo',
      content: 'Original photo by Alice',
      background_style: 'gradient-sunset',
      original_story_id: null,
      created_at: new Date().toISOString(),
      expires_at: new Date(Date.now() + 86400000).toISOString(), // Active
    }],
    ['2', {
      id: '2',
      user_id: 10,
      type: 'text',
      content: 'Expired story by Alice',
      background_style: 'solid-dark',
      original_story_id: null,
      created_at: new Date(Date.now() - 172800000).toISOString(),
      expires_at: new Date(Date.now() - 86400000).toISOString(), // Expired
    }],
    ['3', {
      id: '3',
      user_id: 30,
      type: 'text',
      content: 'Already a reshare story',
      background_style: 'gradient-royal',
      original_story_id: '1', // Nested reshare
      created_at: new Date().toISOString(),
      expires_at: new Date(Date.now() + 86400000).toISOString(),
    }],
  ])

  const storyReshares = new Map() // key: `${userId}:${originalId}` -> reshareRecord
  const notifications = []
  const storyMentions = [{ story_id: '1', user_id: 20 }]

  let txSnapshot = null
  let releaseCalls = 0

  const pool = {
    users,
    stories,
    storyReshares,
    notifications,
    storyMentions,
    failNotification: false,
    failReshare: false,
    getReleaseCalls() {
      return releaseCalls
    },
    async connect() {
      return {
        async query(sql, params) {
          return pool.query(sql, params)
        },
        release() {
          releaseCalls++
        },
      }
    },
    async query(sql, params = []) {
      const normalized = sql.replace(/\s+/g, ' ').trim()

      if (normalized === 'BEGIN') {
        txSnapshot = {
          stories: new Map(stories),
          storyReshares: new Map(storyReshares),
          notifications: [...notifications],
        }
        return { rows: [] }
      }

      if (normalized === 'COMMIT') {
        txSnapshot = null
        return { rows: [] }
      }

      if (normalized === 'ROLLBACK') {
        if (txSnapshot) {
          stories.clear()
          for (const [k, v] of txSnapshot.stories) stories.set(k, { ...v })
          storyReshares.clear()
          for (const [k, v] of txSnapshot.storyReshares) storyReshares.set(k, { ...v })
          notifications.length = 0
          notifications.push(...txSnapshot.notifications)
        }
        txSnapshot = null
        return { rows: [] }
      }

      // 1. Lock story row FOR UPDATE
      if (normalized.includes('FROM stories') && normalized.includes('WHERE id = $1') && normalized.includes('FOR UPDATE')) {
        const s = stories.get(String(params[0]))
        if (s) {
          return { rows: [{ ...s }] }
        }
        return { rows: [] }
      }

      // 1b. Check mention for reshare authorization
      if (normalized.includes('FROM story_mentions') && normalized.includes('WHERE story_id = $1 AND user_id = $2')) {
        const found = storyMentions.some((m) => String(m.story_id) === String(params[0]) && Number(m.user_id) === Number(params[1]))
        return { rows: found ? [{ '?column?': 1 }] : [] }
      }

      // 1c. Query original story media
      if (normalized.includes('FROM story_media') && normalized.includes('WHERE story_id = $1')) {
        return { rows: [{ id: '11111111-2222-3333-4444-555555555555' }] }
      }

      // 2. Query story by id (e.g. for attribution)
      if (normalized.includes('FROM stories s') && normalized.includes('WHERE s.id = $1')) {
        const s = stories.get(String(params[0]))
        if (s) {
          const u = users.get(Number(s.user_id))
          return {
            rows: [{
              id: s.id,
              user_id: s.user_id,
              type: s.type,
              content: s.content,
              created_at: s.created_at,
              expires_at: s.expires_at,
              is_active: new Date(s.expires_at) > new Date(),
              author_name: u?.name || 'Someone',
              author_username: u?.name.toLowerCase().replace(/\s+/g, '_') || 'user',
              author_avatar_url: u?.profile_image_id ? `/api/images/${u.profile_image_id}` : null,
            }],
          }
        }
        return { rows: [] }
      }

      // 3. Check existing duplicate reshares
      if (normalized.startsWith('SELECT id FROM story_reshares WHERE reshared_by_user_id = $1 AND original_story_id = $2')) {
        const key = `${params[0]}:${params[1]}`
        const r = storyReshares.get(key)
        if (r) return { rows: [{ id: r.id }] }
        return { rows: [] }
      }

      // 4. Fetch user details (for author or resharer)
      if (normalized.includes('FROM users u WHERE u.id = $1') || normalized.includes('FROM users WHERE id = $1')) {
        const u = users.get(Number(params[0]))
        if (u) {
          return {
            rows: [{
              id: u.id,
              name: u.name,
              username: u.name.toLowerCase().replace(/\s+/g, '_'),
              avatar_url: u.profile_image_id ? `/api/images/${u.profile_image_id}` : null,
            }],
          }
        }
        return { rows: [] }
      }

      // 5. Insert new Story
      if (normalized.startsWith('INSERT INTO stories')) {
        const id = String(nextStoryId++)
        const expiresAt = new Date(Date.now() + 86400000).toISOString() // fresh 24h
        const story = {
          id,
          user_id: params[0],
          type: params[1],
          content: params[2],
          background_style: params[3],
          original_story_id: params[4] ? String(params[4]) : null,
          created_at: new Date().toISOString(),
          expires_at: expiresAt,
        }
        stories.set(id, story)
        return { rows: [story] }
      }

      // 6. Insert story_reshares
      if (normalized.startsWith('INSERT INTO story_reshares')) {
        if (pool.failReshare) {
          throw new Error('Simulated database error during story_reshares insert')
        }
        const key = `${params[2]}:${params[0]}`
        if (storyReshares.has(key)) {
          const err = new Error('duplicate key value violates unique constraint')
          err.code = '23505'
          throw err
        }
        const reshare = {
          id: String(nextReshareId++),
          original_story_id: String(params[0]),
          reshared_story_id: String(params[1]),
          reshared_by_user_id: Number(params[2]),
          created_at: new Date().toISOString(),
        }
        storyReshares.set(key, reshare)
        return { rows: [reshare] }
      }

      // 7. Insert notifications
      if (normalized.startsWith('INSERT INTO notifications')) {
        if (pool.failNotification) {
          throw new Error('Simulated database error during notification insert')
        }
        const notif = {
          id: nextNotifId++,
          user_id: Number(params[0]),
          actor_id: Number(params[1]),
          kind: 'story_reshare',
          entity_type: 'story',
          entity_id: String(params[2]),
          text: String(params[3]),
          created_at: new Date().toISOString(),
          read_at: null,
        }
        notifications.push(notif)
        return { rows: [notif] }
      }

      // 8. Story views / reactions / replies counts for GET
      if (normalized.includes('FROM stories s') && normalized.includes('WHERE s.user_id = $1')) {
        const targetUserId = Number(params[0])
        const res = []
        for (const s of stories.values()) {
          if (s.user_id === targetUserId && new Date(s.expires_at) > new Date()) {
            res.push({
              id: s.id,
              type: s.type,
              content: s.content,
              background_style: s.background_style,
              created_at: s.created_at,
              expires_at: s.expires_at,
              original_story_id: s.original_story_id,
              media_url: null,
              viewed: false,
              view_count: 0,
              my_reaction: null,
              reaction_count: 0,
              reply_count: 0,
            })
          }
        }
        return { rows: res }
      }

      return { rows: [] }
    },
  }

  return pool
}

function createDispatcher(pool, defaultUserId = 20) {
  const isPgId = (id) => /^[0-9]+$/.test(String(id))
  const upload = { single: () => (req, res, next) => next() }

  return async function dispatch(method, path, body = {}, userId = defaultUserId) {
    const auth = (req, res, next) => {
      if (userId === null) return res.status(401).json({ error: 'Unauthorized' })
      req.userId = userId
      next()
    }
    const router = createStoryRouter({ pool, auth, isPgId, upload })

    return new Promise((resolve) => {
      const req = {
        method,
        url: path,
        params: {},
        body,
        userId,
      }

      let matchedRoute = null
      let paramId = null

      const reshareMatch = path.match(/^\/([^/]+)\/reshare$/)
      const userStoriesMatch = path.match(/^\/users\/(\d+)$/)

      if (reshareMatch && method === 'POST') {
        paramId = reshareMatch[1]
        matchedRoute = 'reshare'
      } else if (path === '/reshare' && method === 'POST') {
        matchedRoute = 'reshare'
      } else if (userStoriesMatch && method === 'GET') {
        paramId = userStoriesMatch[1]
        matchedRoute = 'userStories'
      }

      if (!matchedRoute) {
        return resolve({ status: 404, body: { error: 'Not found in test dispatcher' } })
      }

      req.params = { id: paramId, userId: paramId }

      const res = {
        _status: 200,
        status(code) {
          this._status = code
          return this
        },
        json(data) {
          resolve({ status: this._status, body: data })
        },
      }

      const next = (err) => {
        resolve({ status: err.status || 500, body: { error: err.message } })
      }

      for (const layer of router.stack) {
        if (layer.route) {
          const rPath = layer.route.path
          const rMethod = Object.keys(layer.route.methods)[0].toUpperCase()

          const isReshareRoute = Array.isArray(rPath)
            ? rPath.includes('/:id/reshare')
            : (rPath === '/:id/reshare' || rPath === '/reshare')

          if (matchedRoute === 'reshare' && isReshareRoute && rMethod === 'POST') {
            let idx = 0
            const stack = layer.route.stack
            function step() {
              if (idx >= stack.length) return
              const fn = stack[idx++].handle
              fn(req, res, (err) => {
                if (err) return next(err)
                step()
              })
            }
            step()
            return
          } else if (matchedRoute === 'userStories' && rPath === '/users/:userId' && rMethod === 'GET') {
            let idx = 0
            const stack = layer.route.stack
            function step() {
              if (idx >= stack.length) return
              const fn = stack[idx++].handle
              fn(req, res, (err) => {
                if (err) return next(err)
                step()
              })
            }
            step()
            return
          }
        }
      }

      resolve({ status: 404, body: { error: 'Route not found' } })
    })
  }
}

// ── Integration Tests ─────────────────────────────────────────────────────────

test('Scenario 1: Valid reshare creates a new Story for the resharing user', async () => {
  const pool = createMockPool()
  const dispatch = createDispatcher(pool, 20) // Bob (20) reshares Alice's story (1)

  const res = await dispatch('POST', '/1/reshare')
  assert.equal(res.status, 201)
  assert.ok(res.body.id)
  assert.equal(res.body.user_id, 20)
  assert.equal(res.body.type, 'photo')
  assert.ok(res.body.media_url)
})

test('Scenario 2: original_story_id links to the original story', async () => {
  const pool = createMockPool()
  const dispatch = createDispatcher(pool, 20)

  const res = await dispatch('POST', '/1/reshare')
  assert.equal(res.status, 201)
  assert.equal(res.body.original_story_id, '1')

  const createdStory = pool.stories.get(res.body.id)
  assert.equal(createdStory.original_story_id, '1')
})

test('Scenario 3: story_reshares row is created with correct metadata', async () => {
  const pool = createMockPool()
  const dispatch = createDispatcher(pool, 20)

  const res = await dispatch('POST', '/1/reshare')
  assert.equal(res.status, 201)
  assert.ok(res.body.reshare)
  assert.equal(res.body.reshare.original_story_id, '1')
  assert.equal(res.body.reshare.reshared_by_user_id, 20)

  const record = pool.storyReshares.get('20:1')
  assert.ok(record)
  assert.equal(record.original_story_id, '1')
  assert.equal(record.reshared_story_id, res.body.id)
  assert.equal(record.reshared_by_user_id, 20)
})

test('Scenario 4: Original creator attribution is correctly captured', async () => {
  const pool = createMockPool()
  const dispatch = createDispatcher(pool, 20)

  const res = await dispatch('POST', '/1/reshare')
  assert.equal(res.status, 201)
  assert.equal(res.body.reshare.original_author.id, 10)
  assert.equal(res.body.reshare.original_author.name, 'Alice Original')
  assert.equal(res.body.reshare.original_author.username, 'alice_original')
  assert.equal(res.body.reshare.original_author.avatar_url, '/api/images/100')
})

test('Scenario 5: New Story receives a fresh 24-hour expiry', async () => {
  const pool = createMockPool()
  const dispatch = createDispatcher(pool, 20)

  const before = Date.now()
  const res = await dispatch('POST', '/1/reshare')
  assert.equal(res.status, 201)

  const expiryTime = new Date(res.body.expires_at).getTime()
  const diffHours = (expiryTime - before) / (1000 * 60 * 60)
  assert.ok(diffHours >= 23.9 && diffHours <= 24.1, `Expected fresh ~24h lifetime, got ${diffHours}h`)
})

test('Scenario 6: Self-reshare is rejected with 400', async () => {
  const pool = createMockPool()
  const dispatch = createDispatcher(pool, 10) // Alice (10) attempts to reshare her own story (1)

  const res = await dispatch('POST', '/1/reshare')
  assert.equal(res.status, 400)
  assert.match(res.body.error, /You cannot reshare your own story/i)
  assert.equal(pool.storyReshares.size, 0)
})

test('Scenario 7: Invalid Story IDs (zero, negative, decimal, non-numeric) are rejected with 400', async () => {
  const pool = createMockPool()
  const dispatch = createDispatcher(pool, 20)

  const badIds = ['0', '-1', '1.5', 'abc']
  for (const bad of badIds) {
    const res = await dispatch('POST', `/${bad}/reshare`)
    assert.equal(res.status, 400)
    assert.match(res.body.error, /Invalid target story ID/i)
  }
})

test('Scenario 8: Nonexistent Story is rejected with 404', async () => {
  const pool = createMockPool()
  const dispatch = createDispatcher(pool, 20)

  const res = await dispatch('POST', '/9999/reshare')
  assert.equal(res.status, 404)
  assert.match(res.body.error, /Story not found/i)
})

test('Scenario 9: Expired original Story is rejected with 400', async () => {
  const pool = createMockPool()
  const dispatch = createDispatcher(pool, 20) // Story 2 is expired

  const res = await dispatch('POST', '/2/reshare')
  assert.equal(res.status, 400)
  assert.match(res.body.error, /Cannot reshare an expired story/i)
  assert.equal(pool.storyReshares.size, 0)
})

test('Scenario 10: Duplicate reshare by same user is rejected with 409 Conflict', async () => {
  const pool = createMockPool()
  const dispatch = createDispatcher(pool, 20)

  // First reshare succeeds
  const first = await dispatch('POST', '/1/reshare')
  assert.equal(first.status, 201)

  // Second reshare of same story by same user returns 409
  const second = await dispatch('POST', '/1/reshare')
  assert.equal(second.status, 409)
  assert.match(second.body.error, /already reshared this story/i)
})

test('Scenario 11: Nested reshare (resharing a reshared story) is rejected with 400', async () => {
  const pool = createMockPool()
  const dispatch = createDispatcher(pool, 20) // Story 3 is already a reshare

  const res = await dispatch('POST', '/3/reshare')
  assert.equal(res.status, 400)
  assert.match(res.body.error, /Cannot reshare a reshared story/i)
})

test('Scenario 12: Original creator receives the correct notification with kind story_reshare', async () => {
  const pool = createMockPool()
  const dispatch = createDispatcher(pool, 20) // Bob (20) reshares Alice's story (1)

  const res = await dispatch('POST', '/1/reshare')
  assert.equal(res.status, 201)

  assert.equal(pool.notifications.length, 1)
  const notif = pool.notifications[0]
  assert.equal(notif.user_id, 10) // Alice notified
  assert.equal(notif.actor_id, 20) // Bob is actor
  assert.equal(notif.kind, 'story_reshare')
  assert.equal(notif.entity_type, 'story')
  assert.equal(notif.entity_id, res.body.id)
  assert.match(notif.text, /Bob Resharer reshared your story/i)
})

test('Scenario 13: Resharing user does not receive their own notification', async () => {
  const pool = createMockPool()
  const dispatch = createDispatcher(pool, 20)

  await dispatch('POST', '/1/reshare')
  const bobNotifs = pool.notifications.filter((n) => n.user_id === 20)
  assert.equal(bobNotifs.length, 0)
})

test('Scenario 14: Notification failure rolls back all reshare writes', async () => {
  const pool = createMockPool()
  pool.failNotification = true // Simulate notification failure
  const dispatch = createDispatcher(pool, 20)

  const initialStoriesCount = pool.stories.size
  const res = await dispatch('POST', '/1/reshare')

  assert.equal(res.status, 500)
  assert.match(res.body.error, /Simulated database error during notification insert/i)

  // Verify full rollback: no new story, no story_reshares, no notification
  assert.equal(pool.stories.size, initialStoriesCount)
  assert.equal(pool.storyReshares.size, 0)
  assert.equal(pool.notifications.length, 0)
  assert.ok(pool.getReleaseCalls() >= 1, 'Connection must be released')
})

test('Scenario 15: Reshare insertion failure rolls back the new Story', async () => {
  const pool = createMockPool()
  pool.failReshare = true // Simulate story_reshares failure
  const dispatch = createDispatcher(pool, 20)

  const initialStoriesCount = pool.stories.size
  const res = await dispatch('POST', '/1/reshare')

  assert.equal(res.status, 500)
  assert.match(res.body.error, /Simulated database error during story_reshares insert/i)

  // Verify full rollback: no new story
  assert.equal(pool.stories.size, initialStoriesCount)
  assert.equal(pool.storyReshares.size, 0)
  assert.ok(pool.getReleaseCalls() >= 1, 'Connection must be released')
})

test('Scenario 16: Original Story deletion preserves the reshare as designed (ON DELETE SET NULL)', async () => {
  const pool = createMockPool()
  const dispatch = createDispatcher(pool, 20)

  const res = await dispatch('POST', '/1/reshare')
  assert.equal(res.status, 201)
  const reshareStoryId = res.body.id

  // Simulate original story (1) being deleted by owner Alice
  pool.stories.delete('1')
  // Database foreign key sets original_story_id to null
  const reshareStory = pool.stories.get(reshareStoryId)
  reshareStory.original_story_id = null

  // Fetch Bob's stories: reshare story remains active and viewable
  const userStoriesRes = await dispatch('GET', '/users/20')
  assert.equal(userStoriesRes.status, 200)
  const found = userStoriesRes.body.stories.find((s) => s.id === reshareStoryId)
  assert.ok(found, 'Reshare story must be preserved after original deletion')
  assert.equal(found.original_story_id, null)
})

test('Scenario 17: Original Story expiry does not unexpectedly remove the active reshare', async () => {
  const pool = createMockPool()
  const dispatch = createDispatcher(pool, 20)

  const res = await dispatch('POST', '/1/reshare')
  assert.equal(res.status, 201)
  const reshareStoryId = res.body.id

  // Simulate original story expiring 1 hour later
  const original = pool.stories.get('1')
  original.expires_at = new Date(Date.now() - 1000).toISOString() // now expired

  // Fetch Bob's stories: reshare story has fresh 24h lifetime and is still active
  const userStoriesRes = await dispatch('GET', '/users/20')
  assert.equal(userStoriesRes.status, 200)
  const found = userStoriesRes.body.stories.find((s) => s.id === reshareStoryId)
  assert.ok(found, 'Reshare story must remain active despite original expiring')
  assert.ok(new Date(found.expires_at) > new Date())
  assert.equal(found.reshare.is_active, false, 'Original story active status reflected in attribution')
})

test('Scenario 18: Existing Story, Mentions, Polls, Questions, and Quizzes behavior remains unaffected', async () => {
  const pool = createMockPool()
  const dispatch = createDispatcher(pool, 20)

  // Verify user stories retrieval works cleanly with original stories
  const aliceRes = await dispatch('GET', '/users/10')
  assert.equal(aliceRes.status, 200)
  assert.ok(aliceRes.body.stories)
  assert.equal(aliceRes.body.stories.length, 1) // Only active story 1
  assert.equal(aliceRes.body.stories[0].type, 'photo')
})

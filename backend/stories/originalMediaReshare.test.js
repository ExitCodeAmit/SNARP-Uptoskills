import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createStoryRouter } from './routes.js'

// ── Mock Pool & Test Harness for Task 5.2 ──────────────────────────────────
function createMockPool() {
  let nextStoryId = 500
  let nextReshareId = 1
  let nextNotifId = 1

  const users = new Map([
    [10, { id: 10, name: 'Alice Author', email: 'alice@example.com', profile_image_id: 101 }],
    [20, { id: 20, name: 'Bob Mentioned', email: 'bob@example.com', profile_image_id: 201 }],
    [30, { id: 30, name: 'Charlie Unmentioned', email: 'charlie@example.com', profile_image_id: null }],
  ])

  // Original Stories: 1 (photo), 2 (video), 3 (text), 4 (expired photo)
  const stories = new Map([
    ['1', {
      id: '1',
      user_id: 10,
      type: 'photo',
      content: 'Nature photo by Alice',
      background_style: 'gradient-sunset',
      original_story_id: null,
      created_at: new Date().toISOString(),
      expires_at: new Date(Date.now() + 86400000).toISOString(),
    }],
    ['2', {
      id: '2',
      user_id: 10,
      type: 'video',
      content: 'Robotics demo video by Alice',
      background_style: 'solid-dark',
      original_story_id: null,
      created_at: new Date().toISOString(),
      expires_at: new Date(Date.now() + 86400000).toISOString(),
    }],
    ['3', {
      id: '3',
      user_id: 10,
      type: 'text',
      content: 'Announcement text story by Alice',
      background_style: 'gradient-royal',
      original_story_id: null,
      created_at: new Date().toISOString(),
      expires_at: new Date(Date.now() + 86400000).toISOString(),
    }],
    ['4', {
      id: '4',
      user_id: 10,
      type: 'photo',
      content: 'Old photo by Alice',
      background_style: 'gradient-emerald',
      original_story_id: null,
      created_at: new Date(Date.now() - 172800000).toISOString(),
      expires_at: new Date(Date.now() - 86400000).toISOString(), // Expired
    }],
  ])

  // Media files stored as BYTEA in story_media
  const storyMedia = new Map([
    ['1', { id: '11111111-1111-1111-1111-111111111111', story_id: '1', media_type: 'photo', mime: 'image/jpeg', size_bytes: 2048, data: Buffer.alloc(2048) }],
    ['2', { id: '22222222-2222-2222-2222-222222222222', story_id: '2', media_type: 'video', mime: 'video/mp4', size_bytes: 10240, data: Buffer.alloc(10240) }],
  ])

  // Mentions: Bob (20) is mentioned in stories 1, 2, 3, and 4. Charlie (30) is NOT mentioned.
  const storyMentions = [
    { story_id: '1', user_id: 20 },
    { story_id: '2', user_id: 20 },
    { story_id: '3', user_id: 20 },
    { story_id: '4', user_id: 20 },
  ]

  const storyReshares = new Map()
  const notifications = []
  let txSnapshot = null

  const pool = {
    users,
    stories,
    storyMedia,
    storyMentions,
    storyReshares,
    notifications,
    async connect() {
      return {
        async query(sql, params) {
          return pool.query(sql, params)
        },
        release() {},
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

      // 1. Lock story FOR UPDATE
      if (normalized.includes('FROM stories') && normalized.includes('WHERE id = $1') && normalized.includes('FOR UPDATE')) {
        const s = stories.get(String(params[0]))
        if (s) return { rows: [{ ...s }] }
        return { rows: [] }
      }

      // 2. Check mentions authorization
      if (normalized.includes('FROM story_mentions') && normalized.includes('WHERE story_id = $1 AND user_id = $2')) {
        const isMentioned = storyMentions.some(
          (m) => String(m.story_id) === String(params[0]) && Number(m.user_id) === Number(params[1])
        )
        return { rows: isMentioned ? [{ '?column?': 1 }] : [] }
      }

      // 3. Check duplicate reshare
      if (normalized.startsWith('SELECT id FROM story_reshares WHERE reshared_by_user_id = $1 AND original_story_id = $2')) {
        const key = `${params[0]}:${params[1]}`
        const r = storyReshares.get(key)
        if (r) return { rows: [{ id: r.id }] }
        return { rows: [] }
      }

      // 4. Query story_media for story_id
      if (normalized.includes('FROM story_media WHERE story_id = $1')) {
        const sm = storyMedia.get(String(params[0]))
        if (sm) return { rows: [{ id: sm.id }] }
        return { rows: [] }
      }

      // 5. Query user details
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

      // 6. Insert new Story
      if (normalized.startsWith('INSERT INTO stories')) {
        const id = String(nextStoryId++)
        const expiresAt = new Date(Date.now() + 86400000).toISOString()
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

      // 7. Insert story_reshares
      if (normalized.startsWith('INSERT INTO story_reshares')) {
        const key = `${params[2]}:${params[0]}`
        if (storyReshares.has(key)) {
          const err = new Error('duplicate key')
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

      // 8. Insert notification
      if (normalized.startsWith('INSERT INTO notifications')) {
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

      // 9. GET /api/stories/media/:id endpoint query
      if (normalized.includes('FROM story_media sm') && normalized.includes('WHERE sm.id = $1')) {
        for (const [storyId, media] of storyMedia) {
          if (media.id === params[0]) {
            const origStory = stories.get(storyId)
            if (!origStory) return { rows: [] } // Deleted original story

            const isOrigActive = new Date(origStory.expires_at) > new Date()
            let hasActiveReshare = false
            for (const s of stories.values()) {
              if (s.original_story_id === storyId && new Date(s.expires_at) > new Date()) {
                hasActiveReshare = true
                break
              }
            }

            if (isOrigActive || hasActiveReshare) {
              return { rows: [{ ...media }] }
            }
            return { rows: [] }
          }
        }
        return { rows: [] }
      }

      // 10. Query user feed / stories
      if (normalized.includes('FROM stories s') && normalized.includes('WHERE s.user_id = $1')) {
        const targetUserId = Number(params[0])
        const res = []
        for (const s of stories.values()) {
          if (s.user_id === targetUserId && new Date(s.expires_at) > new Date()) {
            let mediaUrl = null
            if (s.original_story_id) {
              const origSm = storyMedia.get(s.original_story_id)
              if (origSm) mediaUrl = `/api/stories/media/${origSm.id}`
            } else {
              const sm = storyMedia.get(s.id)
              if (sm) mediaUrl = `/api/stories/media/${sm.id}`
            }

            res.push({
              id: s.id,
              type: s.type,
              content: s.content,
              background_style: s.background_style,
              original_story_id: s.original_story_id,
              media_url: mediaUrl,
              created_at: s.created_at,
              expires_at: s.expires_at,
              view_count: 0,
              my_reaction: null,
              reaction_count: 0,
              reply_count: 0,
            })
          }
        }
        return { rows: res }
      }

      // 11. Reshare attribution query
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

      return { rows: [] }
    },
  }

  return pool
}

function createDispatcher(pool, defaultUserId = 20) {
  const isPgId = (id) => /^[0-9]+$/.test(String(id))
  const upload = { single: () => (req, res, next) => next() }

  return async function dispatch(method, pathUrl, body = {}, userId = defaultUserId, headers = {}) {
    const auth = (req, res, next) => {
      if (userId === null) return res.status(401).json({ error: 'Unauthorized' })
      req.userId = userId
      next()
    }

    const router = createStoryRouter({ pool, auth, isPgId, upload })

    return new Promise((resolve) => {
      const req = {
        method,
        url: pathUrl,
        params: {},
        query: {},
        body: body || {},
        headers: { range: headers.range, ...headers },
        userId,
      }

      const res = {
        _status: 200,
        _headers: {},
        _data: null,
        status(code) {
          this._status = code
          return this
        },
        set(k, v) {
          if (typeof k === 'object') {
            Object.assign(this._headers, k)
          } else {
            this._headers[k] = v
          }
          return this
        },
        json(data) {
          this._data = data
          resolve({ status: this._status, headers: this._headers, body: data })
        },
        send(data) {
          this._data = data
          resolve({ status: this._status, headers: this._headers, body: data })
        },
        end(data) {
          this._data = data
          resolve({ status: this._status, headers: this._headers, body: data })
        },
      }

      const next = (err) => {
        if (err) {
          resolve({ status: err.status || 500, headers: res._headers, body: { error: err.message } })
        } else {
          resolve({ status: 404, headers: res._headers, body: { error: 'Not found' } })
        }
      }

      router(req, res, next)
    })
  }
}

// ── Tests: Task 5.2 Backend Requirements ───────────────────────────────────

test('Backend: Mentioned user (Bob) can reshare a photo story, preserving photo type and original media_url', async () => {
  const pool = createMockPool()
  const dispatch = createDispatcher(pool, 20) // Bob is mentioned in Story 1

  const initialMediaCount = pool.storyMedia.size
  const res = await dispatch('POST', '/1/reshare', { content: 'Check out Alice photo!' })

  assert.equal(res.status, 201)
  assert.equal(res.body.user_id, 20)
  assert.equal(res.body.type, 'photo', 'Reshared story must retain original type: photo')
  assert.equal(res.body.media_url, '/api/stories/media/11111111-1111-1111-1111-111111111111')
  assert.equal(res.body.content, 'Check out Alice photo!')
  assert.equal(res.body.original_story_id, '1')

  // Verify no duplicate BYTEA record was created
  assert.equal(pool.storyMedia.size, initialMediaCount, 'Zero BYTEA duplication: story_media count must not increase')
})

test('Backend: Mentioned user (Bob) can reshare a video story, preserving video type and original media_url', async () => {
  const pool = createMockPool()
  const dispatch = createDispatcher(pool, 20) // Bob is mentioned in Story 2

  const res = await dispatch('POST', '/2/reshare')
  assert.equal(res.status, 201)
  assert.equal(res.body.type, 'video', 'Reshared story must retain original type: video')
  assert.equal(res.body.media_url, '/api/stories/media/22222222-2222-2222-2222-222222222222')
  assert.equal(res.body.original_story_id, '2')
})

test('Backend: Unmentioned user (Charlie) receives 403 Forbidden', async () => {
  const pool = createMockPool()
  const dispatch = createDispatcher(pool, 30) // Charlie is NOT mentioned in Story 1

  const res = await dispatch('POST', '/1/reshare')
  assert.equal(res.status, 403)
  assert.equal(res.body.error, 'Only mentioned users can reshare this story')
})

test('Backend: Direct API call with POST /api/stories/reshare cannot bypass mention authorization', async () => {
  const pool = createMockPool()
  const dispatch = createDispatcher(pool, 30) // Charlie (unmentioned) calls /reshare body { storyId: 1 }

  const res = await dispatch('POST', '/reshare', { storyId: 1 })
  assert.equal(res.status, 403)
  assert.equal(res.body.error, 'Only mentioned users can reshare this story')
})

test('Backend: Self-reshare is rejected with 400', async () => {
  const pool = createMockPool()
  const dispatch = createDispatcher(pool, 10) // Alice (creator of Story 1) tries to reshare her own story

  const res = await dispatch('POST', '/1/reshare')
  assert.equal(res.status, 400)
  assert.equal(res.body.error, 'You cannot reshare your own story')
})

test('Backend: Expired Story is rejected with 400', async () => {
  const pool = createMockPool()
  const dispatch = createDispatcher(pool, 20) // Bob tries to reshare expired Story 4

  const res = await dispatch('POST', '/4/reshare')
  assert.equal(res.status, 400)
  assert.equal(res.body.error, 'Cannot reshare an expired story')
})

test('Backend: Duplicate reshare by same user is rejected with 409 Conflict', async () => {
  const pool = createMockPool()
  const dispatch = createDispatcher(pool, 20) // Bob reshares Story 1 twice

  const first = await dispatch('POST', '/1/reshare')
  assert.equal(first.status, 201)

  const second = await dispatch('POST', '/1/reshare')
  assert.equal(second.status, 409)
  assert.equal(second.body.error, 'You have already reshared this story')
})

test('Backend: Active reshare survives normal original expiry for media streaming', async () => {
  const pool = createMockPool()
  const dispatch = createDispatcher(pool, 20)

  // 1. Bob reshares photo story 1
  const reshare = await dispatch('POST', '/1/reshare')
  assert.equal(reshare.status, 201)

  // 2. Original story 1 expires
  const origStory = pool.stories.get('1')
  origStory.expires_at = new Date(Date.now() - 1000).toISOString() // now expired

  // 3. Media stream request for original media ID should STILL succeed because an active reshare exists
  const mediaRes = await dispatch('GET', '/media/11111111-1111-1111-1111-111111111111')
  assert.equal(mediaRes.status, 200, 'Media remains accessible while referenced by active reshare')
  assert.equal(mediaRes.headers['Content-Type'], 'image/jpeg')
})

test('Backend: Original creator manual deletion makes media inaccessible (404) immediately', async () => {
  const pool = createMockPool()
  const dispatch = createDispatcher(pool, 20)

  // 1. Bob reshares photo story 1
  const reshare = await dispatch('POST', '/1/reshare')
  assert.equal(reshare.status, 201)

  // 2. Alice manually deletes her story 1 (cascade deletes story_media)
  pool.stories.delete('1')
  pool.storyMedia.delete('1')

  // 3. Requesting media now returns 404
  const mediaRes = await dispatch('GET', '/media/11111111-1111-1111-1111-111111111111')
  assert.equal(mediaRes.status, 404, 'Deleting original story immediately makes media 404')
})

test('Backend: Video byte-range streaming functions properly for video reshares', async () => {
  const pool = createMockPool()
  const dispatch = createDispatcher(pool, 20)

  // Request byte range 0-1023 of the 10KB video
  const mediaRes = await dispatch(
    'GET',
    '/media/22222222-2222-2222-2222-222222222222',
    null,
    20,
    { range: 'bytes=0-1023' }
  )

  assert.equal(mediaRes.status, 206, 'Video range request returns 206 Partial Content')
  assert.equal(mediaRes.headers['Content-Range'], 'bytes 0-1023/10240')
  assert.equal(mediaRes.headers['Content-Length'], '1024')
  assert.equal(mediaRes.headers['Content-Type'], 'video/mp4')
})

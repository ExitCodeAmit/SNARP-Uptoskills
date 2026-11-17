import { test } from 'node:test'
import assert from 'node:assert/strict'
import { STORY_REACTION_TYPES, validateReactionType } from './validator.js'
import { createStoryRouter } from './routes.js'

// 1. Validator Tests
test('validateReactionType strictly allows all 5 approved reaction types', () => {
  assert.equal(STORY_REACTION_TYPES.length, 5)
  assert.deepEqual(STORY_REACTION_TYPES, ['love', 'haha', 'wow', 'sad', 'like'])

  for (const type of STORY_REACTION_TYPES) {
    assert.equal(validateReactionType(type), type)
    assert.equal(validateReactionType(`  ${type.toUpperCase()}  `), type)
  }
})

test('validateReactionType rejects invalid, empty, or unknown reaction types', () => {
  const invalid = ['', '  ', null, undefined, 'angry', 'dislike', 'fire', 'clap', 123, '<script>']
  for (const item of invalid) {
    assert.throws(
      () => validateReactionType(item),
      (err) => err.status === 400 && err.field === 'type'
    )
  }
})

// 2. Mock Pool & Route Integration Tests
function createMockPool() {
  const reactions = new Map() // key: `${storyId}:${userId}` -> { storyId, userId, type, createdAt }
  const stories = new Map([
    ['1', { id: '1', user_id: 10, type: 'text', content: 'Story 1', expires_at: new Date(Date.now() + 86400000) }],
    ['2', { id: '2', user_id: 20, type: 'photo', content: 'Story 2', expires_at: new Date(Date.now() - 1000) }], // expired
  ])
  const views = new Map() // key: `${storyId}:${viewerId}` -> { storyId, viewerId, viewedAt }
  const users = new Map([
    [10, { id: 10, name: 'Alice (Owner)', profile_image_id: null }],
    [20, { id: 20, name: 'Bob (Viewer)', profile_image_id: null }],
  ])

  return {
    stories,
    reactions,
    views,
    users,
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

      // Story owner check (for viewers list)
      if (normalized.startsWith('SELECT id, user_id FROM stories WHERE id = $1')) {
        const s = stories.get(String(params[0]))
        if (s) return { rows: [{ id: s.id, user_id: s.user_id }] }
        return { rows: [] }
      }

      // Insert view (with ON CONFLICT DO NOTHING)
      if (normalized.startsWith('INSERT INTO story_views (story_id, viewer_id) VALUES ($1, $2)')) {
        const key = `${params[0]}:${params[1]}`
        if (!views.has(key)) {
          views.set(key, { storyId: String(params[0]), viewerId: params[1], viewedAt: new Date() })
        }
        return { rowCount: 1 }
      }

      // View count query
      if (normalized.startsWith('SELECT count(*)::int AS view_count FROM story_views WHERE story_id = $1')) {
        let count = 0
        for (const v of views.values()) {
          if (v.storyId === String(params[0])) count += 1
        }
        return { rows: [{ view_count: count }] }
      }

      // Owner Viewers list query (joined with reactions)
      if (normalized.includes('FROM story_views sv JOIN users u ON u.id = sv.viewer_id LEFT JOIN story_reactions sr')) {
        const rows = []
        for (const v of views.values()) {
          if (v.storyId === String(params[0])) {
            const u = users.get(v.viewerId)
            const r = reactions.get(`${v.storyId}:${v.viewerId}`)
            rows.push({
              id: v.viewerId,
              name: u?.name || 'User',
              avatar_url: null,
              viewed_at: v.viewedAt,
              reaction_type: r?.type || null,
            })
          }
        }
        return { rows }
      }

      // Upsert reaction
      if (normalized.startsWith('INSERT INTO story_reactions (story_id, user_id, type) VALUES ($1, $2, $3) ON CONFLICT (story_id, user_id) DO UPDATE')) {
        const key = `${params[0]}:${params[1]}`
        reactions.set(key, { storyId: String(params[0]), userId: params[1], type: params[2], createdAt: new Date() })
        return { rows: [{ type: params[2] }] }
      }

      // Delete reaction
      if (normalized.startsWith('DELETE FROM story_reactions WHERE story_id = $1 AND user_id = $2')) {
        const key = `${params[0]}:${params[1]}`
        reactions.delete(key)
        return { rowCount: 1 }
      }

      // User reaction query (must be checked before generic count query)
      if (normalized.startsWith('SELECT type FROM story_reactions WHERE story_id = $1 AND user_id = $2')) {
        const key = `${params[0]}:${params[1]}`
        const r = reactions.get(key)
        return { rows: r ? [{ type: r.type }] : [] }
      }

      // Reaction counts
      if (normalized.includes('FROM story_reactions WHERE story_id = $1')) {
        let total = 0
        let love = 0, haha = 0, wow = 0, sad = 0, like = 0
        for (const r of reactions.values()) {
          if (r.storyId === String(params[0])) {
            total += 1
            if (r.type === 'love') love += 1
            if (r.type === 'haha') haha += 1
            if (r.type === 'wow') wow += 1
            if (r.type === 'sad') sad += 1
            if (r.type === 'like') like += 1
          }
        }
        return { rows: [{ total, love, haha, wow, sad, like }] }
      }

      return { rows: [] }
    },
  }
}

function mockReqRes({ method = 'GET', params = {}, body = {}, userId = 100 } = {}) {
  const req = { method, params, body, userId, headers: {} }
  const res = {
    statusCode: 200,
    headers: {},
    status(code) { this.statusCode = code; return this },
    json(data) { this.body = data; return this },
    end() { this.ended = true; return this },
    set(k, v) {
      if (typeof k === 'object') Object.assign(this.headers, k)
      else this.headers[k] = v
      return this
    },
  }
  return { req, res }
}

const mockAuth = (req, res, next) => {
  if (!req.userId) return res.status(401).json({ error: 'Unauthenticated' })
  next()
}
const isPgId = (id) => /^\d+$/.test(id)
const mockUpload = { single: () => (req, res, next) => next() }

function getRouteHandler(router, path, method) {
  const layer = router.stack.find((l) => l.route?.path === path && l.route?.methods[method.toLowerCase()])
  if (!layer) throw new Error(`Route not found: ${method} ${path}`)
  return layer.route.stack[layer.route.stack.length - 1].handle
}

test('POST /api/stories/:id/reactions adds and updates a reaction with duplicate prevention', async () => {
  const pool = createMockPool()
  const router = createStoryRouter({ pool, auth: mockAuth, isPgId, upload: mockUpload })
  const handler = getRouteHandler(router, '/:id/reactions', 'POST')

  // 1. Add reaction 'love' from user 100
  const { req: req1, res: res1 } = mockReqRes({ method: 'POST', params: { id: '1' }, body: { type: 'love' }, userId: 100 })
  await handler(req1, res1, () => {})
  assert.equal(res1.statusCode, 200)
  assert.equal(res1.body.success, true)
  assert.equal(res1.body.myReaction, 'love')
  assert.equal(res1.body.reactionCount, 1)
  assert.equal(res1.body.counts.love, 1)

  // 2. Change reaction from 'love' to 'haha' for the same user 100 (duplicate prevention test)
  const { req: req2, res: res2 } = mockReqRes({ method: 'POST', params: { id: '1' }, body: { type: 'haha' }, userId: 100 })
  await handler(req2, res2, () => {})
  assert.equal(res2.statusCode, 200)
  assert.equal(res2.body.myReaction, 'haha')
  assert.equal(res2.body.reactionCount, 1) // count remains 1, does not duplicate
  assert.equal(res2.body.counts.haha, 1)
  assert.equal(res2.body.counts.love, 0)

  // 3. Add second reaction from different user 200
  const { req: req3, res: res3 } = mockReqRes({ method: 'POST', params: { id: '1' }, body: { type: 'wow' }, userId: 200 })
  await handler(req3, res3, () => {})
  assert.equal(res3.statusCode, 200)
  assert.equal(res3.body.reactionCount, 2)
  assert.equal(res3.body.counts.wow, 1)
  assert.equal(res3.body.counts.haha, 1)
})

test('POST /api/stories/:id/reactions prevents story owner from reacting to their own story', async () => {
  const pool = createMockPool()
  const router = createStoryRouter({ pool, auth: mockAuth, isPgId, upload: mockUpload })
  const handler = getRouteHandler(router, '/:id/reactions', 'POST')

  // Story 1 owner is user 10
  const { req, res } = mockReqRes({ method: 'POST', params: { id: '1' }, body: { type: 'love' }, userId: 10 })
  await handler(req, res, () => {})
  assert.equal(res.statusCode, 400)
  assert.equal(res.body.error, 'Cannot react to your own story')
})

test('DELETE /api/stories/:id/reactions prevents story owner from calling delete reaction on own story', async () => {
  const pool = createMockPool()
  const router = createStoryRouter({ pool, auth: mockAuth, isPgId, upload: mockUpload })
  const handler = getRouteHandler(router, '/:id/reactions', 'DELETE')

  // Story 1 owner is user 10
  const { req, res } = mockReqRes({ method: 'DELETE', params: { id: '1' }, userId: 10 })
  await handler(req, res, () => {})
  assert.equal(res.statusCode, 400)
  assert.equal(res.body.error, 'Cannot react to your own story')
})

test('POST /api/stories/:id/reactions rejects invalid reaction type', async () => {
  const pool = createMockPool()
  const router = createStoryRouter({ pool, auth: mockAuth, isPgId, upload: mockUpload })
  const handler = getRouteHandler(router, '/:id/reactions', 'POST')

  const { req, res } = mockReqRes({ method: 'POST', params: { id: '1' }, body: { type: 'invalid_type' }, userId: 100 })
  await handler(req, res, () => {})
  assert.equal(res.statusCode, 400)
  assert.ok(res.body.error.includes('Invalid reaction type'))
})

test('POST /api/stories/:id/reactions rejects expired or non-existent story', async () => {
  const pool = createMockPool()
  const router = createStoryRouter({ pool, auth: mockAuth, isPgId, upload: mockUpload })
  const handler = getRouteHandler(router, '/:id/reactions', 'POST')

  // Non-existent story
  const { req: req1, res: res1 } = mockReqRes({ method: 'POST', params: { id: '9999' }, body: { type: 'love' }, userId: 100 })
  await handler(req1, res1, () => {})
  assert.equal(res1.statusCode, 404)

  // Expired story (id 2)
  const { req: req2, res: res2 } = mockReqRes({ method: 'POST', params: { id: '2' }, body: { type: 'love' }, userId: 100 })
  await handler(req2, res2, () => {})
  assert.equal(res2.statusCode, 404)
})

test('DELETE /api/stories/:id/reactions removes reaction and updates count', async () => {
  const pool = createMockPool()
  pool.reactions.set('1:100', { storyId: '1', userId: 100, type: 'love' })

  const router = createStoryRouter({ pool, auth: mockAuth, isPgId, upload: mockUpload })
  const handler = getRouteHandler(router, '/:id/reactions', 'DELETE')

  const { req, res } = mockReqRes({ method: 'DELETE', params: { id: '1' }, userId: 100 })
  await handler(req, res, () => {})
  assert.equal(res.statusCode, 200)
  assert.equal(res.body.success, true)
  assert.equal(res.body.myReaction, null)
  assert.equal(res.body.reactionCount, 0)
})

test('GET /api/stories/:id/reactions returns reaction summary and user reaction', async () => {
  const pool = createMockPool()
  pool.reactions.set('1:100', { storyId: '1', userId: 100, type: 'like' })

  const router = createStoryRouter({ pool, auth: mockAuth, isPgId, upload: mockUpload })
  const handler = getRouteHandler(router, '/:id/reactions', 'GET')

  const { req, res } = mockReqRes({ method: 'GET', params: { id: '1' }, userId: 100 })
  await handler(req, res, () => {})
  assert.equal(res.statusCode, 200)
  assert.equal(res.body.storyId, '1')
  assert.equal(res.body.myReaction, 'like')
  assert.equal(res.body.reactionCount, 1)
  assert.equal(res.body.counts.like, 1)
})

// 3. COMPLETE CROSS-ACCOUNT STORY FLOW: Account A (Owner 10) & Account B (Viewer 20)
test('Cross-Account Story Views & Reactions: Full E2E Journey between Account A and Account B', async () => {
  const pool = createMockPool()
  const router = createStoryRouter({ pool, auth: mockAuth, isPgId, upload: mockUpload })

  const viewHandler = getRouteHandler(router, '/:id/view', 'POST')
  const reactionPostHandler = getRouteHandler(router, '/:id/reactions', 'POST')
  const reactionDeleteHandler = getRouteHandler(router, '/:id/reactions', 'DELETE')
  const viewersGetHandler = getRouteHandler(router, '/:id/viewers', 'GET')

  // Step 1: Account A (Owner 10) views their own story (story 1)
  // Self-views must NOT increment view_count or be recorded in story_views
  const { req: aViewReq, res: aViewRes } = mockReqRes({ method: 'POST', params: { id: '1' }, userId: 10 })
  await viewHandler(aViewReq, aViewRes, () => {})
  assert.equal(aViewRes.statusCode, 200)
  assert.equal(aViewRes.body.selfView, true)
  assert.equal(aViewRes.body.viewCount, 0)
  assert.equal(pool.views.size, 0, 'Self-view must not be added to story_views table')

  // Step 2: Account A attempts to react to their own story -> must be rejected
  const { req: aReactReq, res: aReactRes } = mockReqRes({ method: 'POST', params: { id: '1' }, body: { type: 'love' }, userId: 10 })
  await reactionPostHandler(aReactReq, aReactRes, () => {})
  assert.equal(aReactRes.statusCode, 400)
  assert.equal(aReactRes.body.error, 'Cannot react to your own story')

  // Step 3: Account B (Viewer 20) views Account A's story (story 1)
  const { req: bViewReq, res: bViewRes } = mockReqRes({ method: 'POST', params: { id: '1' }, userId: 20 })
  await viewHandler(bViewReq, bViewRes, () => {})
  assert.equal(bViewRes.statusCode, 200)
  assert.equal(bViewRes.body.viewCount, 1)
  assert.equal(pool.views.has('1:20'), true, 'Account B view must be recorded')

  // Duplicate view by Account B must not double-count
  const { req: bViewReq2, res: bViewRes2 } = mockReqRes({ method: 'POST', params: { id: '1' }, userId: 20 })
  await viewHandler(bViewReq2, bViewRes2, () => {})
  assert.equal(bViewRes2.body.viewCount, 1, 'Duplicate view must not increase count')

  // Step 4: Account B reacts with 'love' ❤️
  const { req: bReactReq1, res: bReactRes1 } = mockReqRes({ method: 'POST', params: { id: '1' }, body: { type: 'love' }, userId: 20 })
  await reactionPostHandler(bReactReq1, bReactRes1, () => {})
  assert.equal(bReactRes1.statusCode, 200)
  assert.equal(bReactRes1.body.myReaction, 'love')
  assert.equal(bReactRes1.body.reactionCount, 1)

  // Step 5: Account A (Owner 10) checks the viewers drawer
  const { req: aViewersReq, res: aViewersRes } = mockReqRes({ method: 'GET', params: { id: '1' }, userId: 10 })
  await viewersGetHandler(aViewersReq, aViewersRes, () => {})
  assert.equal(aViewersRes.statusCode, 200)
  assert.equal(aViewersRes.body.viewCount, 1)
  assert.equal(aViewersRes.body.viewers.length, 1)
  assert.equal(aViewersRes.body.viewers[0].id, 20)
  assert.equal(aViewersRes.body.viewers[0].name, 'Bob (Viewer)')
  assert.equal(aViewersRes.body.viewers[0].reaction_type, 'love', 'Account B reaction emoji badge must be visible to owner')

  // Step 6: Account B attempts to access owner-only viewers drawer -> must be forbidden (403)
  const { req: bViewersReq, res: bViewersRes } = mockReqRes({ method: 'GET', params: { id: '1' }, userId: 20 })
  await viewersGetHandler(bViewersReq, bViewersRes, () => {})
  assert.equal(bViewersRes.statusCode, 403)
  assert.equal(bViewersRes.body.error, 'Only the story owner can view viewer analytics')

  // Step 7: Account B changes reaction to 'wow' 😮 (duplicate prevention)
  const { req: bReactReq2, res: bReactRes2 } = mockReqRes({ method: 'POST', params: { id: '1' }, body: { type: 'wow' }, userId: 20 })
  await reactionPostHandler(bReactReq2, bReactRes2, () => {})
  assert.equal(bReactRes2.statusCode, 200)
  assert.equal(bReactRes2.body.myReaction, 'wow')
  assert.equal(bReactRes2.body.reactionCount, 1) // count remains 1

  // Account A sees updated reaction 'wow' in viewers list
  const { req: aViewersReq2, res: aViewersRes2 } = mockReqRes({ method: 'GET', params: { id: '1' }, userId: 10 })
  await viewersGetHandler(aViewersReq2, aViewersRes2, () => {})
  assert.equal(aViewersRes2.body.viewers[0].reaction_type, 'wow')

  // Step 8: Account B removes reaction
  const { req: bDeleteReq, res: bDeleteRes } = mockReqRes({ method: 'DELETE', params: { id: '1' }, userId: 20 })
  await reactionDeleteHandler(bDeleteReq, bDeleteRes, () => {})
  assert.equal(bDeleteRes.statusCode, 200)
  assert.equal(bDeleteRes.body.myReaction, null)
  assert.equal(bDeleteRes.body.reactionCount, 0)

  // Account A still sees Account B as a viewer, with reaction_type null
  const { req: aViewersReq3, res: aViewersRes3 } = mockReqRes({ method: 'GET', params: { id: '1' }, userId: 10 })
  await viewersGetHandler(aViewersReq3, aViewersRes3, () => {})
  assert.equal(aViewersRes3.body.viewCount, 1)
  assert.equal(aViewersRes3.body.viewers[0].id, 20)
  assert.equal(aViewersRes3.body.viewers[0].reaction_type, null)
})

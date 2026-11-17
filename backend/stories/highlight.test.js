import { test } from 'node:test'
import assert from 'node:assert/strict'
import { MAX_HIGHLIGHT_TITLE_LENGTH, validateHighlightTitle } from './validator.js'
import { createStoryRouter } from './routes.js'

// 1. Validator Tests
test('MAX_HIGHLIGHT_TITLE_LENGTH is 60', () => {
  assert.equal(MAX_HIGHLIGHT_TITLE_LENGTH, 60)
})

test('validateHighlightTitle accepts valid title and trims whitespace', () => {
  assert.equal(validateHighlightTitle('   Summer Vacation   '), 'Summer Vacation')
  assert.equal(validateHighlightTitle('A'.repeat(60)), 'A'.repeat(60))
})

test('validateHighlightTitle rejects empty, non-string, or >60 chars title', () => {
  const invalid = ['', '   ', '\t\n', null, undefined, 123, {}, []]
  for (const item of invalid) {
    assert.throws(
      () => validateHighlightTitle(item),
      (err) => err.status === 400 && err.field === 'title'
    )
  }

  assert.throws(
    () => validateHighlightTitle('A'.repeat(61)),
    (err) => err.status === 400 && err.field === 'title' && err.message.includes('60')
  )
})

// 2. Mock Pool & Highlight Endpoints Test Harness
function createMockPool() {
  let nextHighlightId = 1
  let nextItemId = 1

  const users = new Map([
    [10, { id: 10, name: 'Alice (Owner)', profile_image_id: 101 }],
    [20, { id: 20, name: 'Bob (Viewer)', profile_image_id: 202 }],
  ])

  // Map<id, { id, user_id, type, content, background_style, created_at, expires_at }>
  const stories = new Map([
    ['1', { id: '1', user_id: 10, type: 'photo', content: 'Photo story by Alice', background_style: 'gradient-sunset', created_at: new Date(Date.now() - 3600000), expires_at: new Date(Date.now() + 86400000) }],
    ['2', { id: '2', user_id: 10, type: 'text', content: 'Text story by Alice', background_style: 'gradient-ocean', created_at: new Date(Date.now() - 7200000), expires_at: new Date(Date.now() + 86400000) }],
    ['3', { id: '3', user_id: 10, type: 'photo', content: 'Expired photo story by Alice (retained)', background_style: 'gradient-emerald', created_at: new Date(Date.now() - 90000000), expires_at: new Date(Date.now() - 3600000) }],
    ['4', { id: '4', user_id: 10, type: 'photo', content: 'Expired photo story by Alice (unretained)', background_style: 'solid-dark', created_at: new Date(Date.now() - 90000000), expires_at: new Date(Date.now() - 3600000) }],
    ['5', { id: '5', user_id: 20, type: 'text', content: 'Text story by Bob', background_style: 'gradient-amber', created_at: new Date(), expires_at: new Date(Date.now() + 86400000) }],
  ])

  // Map<id, { id, story_id, media_type, mime, size_bytes, data }>
  const storyMedia = new Map([
    ['m1', { id: '00000000-0000-0000-0000-000000000001', story_id: '1', mime: 'image/jpeg', size_bytes: 500, data: Buffer.from('photo1') }],
    ['m3', { id: '00000000-0000-0000-0000-000000000003', story_id: '3', mime: 'image/jpeg', size_bytes: 600, data: Buffer.from('photo3-expired-retained') }],
  ])

  // Map<id, { id, user_id, title, cover_story_id, display_order, created_at, updated_at }>
  const highlights = new Map()

  // Map<id, { id, highlight_id, story_id, display_order, created_at }>
  const highlightItems = new Map()

  // Pre-seed highlight 99 for Alice with story 3 to simulate retained expired story
  highlights.set('99', {
    id: '99',
    user_id: 10,
    title: 'Old Favorites',
    cover_story_id: '3',
    display_order: 0,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  })
  highlightItems.set('1', {
    id: '1',
    highlight_id: '99',
    story_id: '3',
    display_order: 0,
    created_at: new Date().toISOString(),
  })
  nextItemId = 2

  const pool = {
    users,
    stories,
    storyMedia,
    highlights,
    highlightItems,
    async connect() {
      return {
        async query(sql, params = []) {
          return pool.query(sql, params)
        },
        release() {},
      }
    },
    async query(sql, params = []) {
      const normalized = sql.replace(/\s+/g, ' ').trim()

      if (normalized === 'BEGIN' || normalized === 'COMMIT' || normalized === 'ROLLBACK') {
        return { rows: [] }
      }

      // 1. My candidate stories
      if (normalized.includes('FROM stories s LEFT JOIN story_media sm ON sm.story_id = s.id WHERE s.user_id = $1')) {
        const userId = params[0]
        const rows = []
        for (const s of stories.values()) {
          if (s.user_id !== userId) continue
          const is_active = s.expires_at > new Date()
          let isRetained = false
          for (const item of highlightItems.values()) {
            if (item.story_id === s.id) { isRetained = true; break }
          }
          if (is_active || isRetained) {
            rows.push({
              id: s.id,
              type: s.type,
              content: s.content,
              background_style: s.background_style,
              created_at: s.created_at,
              expires_at: s.expires_at,
              media_url: s.type === 'photo' ? `/api/stories/media/${s.id}` : null,
              is_active,
            })
          }
        }
        rows.sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
        return { rows }
      }

      // 2. Insert Highlight
      if (normalized.startsWith('INSERT INTO story_highlights (user_id, title) VALUES ($1, $2)')) {
        const id = String(nextHighlightId++)
        const row = {
          id,
          user_id: params[0],
          title: params[1],
          cover_story_id: null,
          display_order: 0,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        }
        highlights.set(id, row)
        return { rows: [row] }
      }

      // 3. Update cover story on highlight
      if (normalized.startsWith('UPDATE story_highlights SET cover_story_id = $1 WHERE id = $2')) {
        const h = highlights.get(String(params[1]))
        if (h) h.cover_story_id = String(params[0])
        return { rowCount: 1 }
      }

      // 4. Update highlight (title, cover, display_order)
      if (normalized.startsWith('UPDATE story_highlights SET title = $1, cover_story_id = $2, display_order = $3, updated_at = now() WHERE id = $4')) {
        const h = highlights.get(String(params[3]))
        if (h) {
          h.title = params[0]
          h.cover_story_id = params[1] ? String(params[1]) : null
          h.display_order = params[2]
          h.updated_at = new Date().toISOString()
          return { rows: [h] }
        }
        return { rows: [] }
      }

      // 5. Update updated_at only or cover
      if (normalized.startsWith('UPDATE story_highlights SET cover_story_id = $1, updated_at = now() WHERE id = $2')) {
        const h = highlights.get(String(params[1]))
        if (h) {
          h.cover_story_id = params[0] ? String(params[0]) : null
          h.updated_at = new Date().toISOString()
        }
        return { rowCount: 1 }
      }
      if (normalized.startsWith('UPDATE story_highlights SET updated_at = now() WHERE id = $1')) {
        const h = highlights.get(String(params[0]))
        if (h) h.updated_at = new Date().toISOString()
        return { rowCount: 1 }
      }

      // 6. Delete highlight
      if (normalized.startsWith('DELETE FROM story_highlights WHERE id = $1')) {
        const id = String(params[0])
        const existed = highlights.delete(id)
        for (const [key, item] of highlightItems.entries()) {
          if (item.highlight_id === id) {
            highlightItems.delete(key)
          }
        }
        return { rowCount: existed ? 1 : 0 }
      }

      // 7. Insert highlight item
      if (normalized.startsWith('INSERT INTO story_highlight_items (highlight_id, story_id, display_order)')) {
        const hid = String(params[0])
        const sid = String(params[1])
        const order = params[2]
        const id = String(nextItemId++)
        const row = { id, highlight_id: hid, story_id: sid, display_order: order, created_at: new Date().toISOString() }
        highlightItems.set(id, row)
        return { rows: [row] }
      }

      // 8. Delete story highlight item
      if (normalized.startsWith('DELETE FROM story_highlight_items WHERE highlight_id = $1 AND story_id = $2')) {
        const hid = String(params[0])
        const sid = String(params[1])
        let deleted = 0
        for (const [key, item] of highlightItems.entries()) {
          if (item.highlight_id === hid && item.story_id === sid) {
            highlightItems.delete(key)
            deleted += 1
          }
        }
        return { rowCount: deleted }
      }

      // 9. Check if story already in highlight
      if (normalized.startsWith('SELECT id FROM story_highlight_items WHERE highlight_id = $1 AND story_id = $2') ||
          normalized.startsWith('SELECT 1 FROM story_highlight_items WHERE highlight_id = $1 AND story_id = $2')) {
        for (const item of highlightItems.values()) {
          if (item.highlight_id === String(params[0]) && item.story_id === String(params[1])) {
            return { rows: [{ id: item.id }] }
          }
        }
        return { rows: [] }
      }

      // 10. Check if story is retained in ANY highlight
      if (normalized.startsWith('SELECT 1 FROM story_highlight_items WHERE story_id = $1 LIMIT 1')) {
        for (const item of highlightItems.values()) {
          if (item.story_id === String(params[0])) {
            return { rows: [{ exists: 1 }] }
          }
        }
        return { rows: [] }
      }

      // 11. Select next cover story for highlight
      if (normalized.startsWith('SELECT story_id FROM story_highlight_items WHERE highlight_id = $1 ORDER BY display_order ASC, created_at ASC LIMIT 1')) {
        const matches = []
        for (const item of highlightItems.values()) {
          if (item.highlight_id === String(params[0])) matches.push(item)
        }
        matches.sort((a, b) => a.display_order - b.display_order)
        return { rows: matches.length > 0 ? [{ story_id: matches[0].story_id }] : [] }
      }

      // 12. Check highlight existence & owner
      if (normalized.startsWith('SELECT id, user_id, cover_story_id FROM story_highlights WHERE id = $1') ||
          normalized.startsWith('SELECT id, user_id FROM story_highlights WHERE id = $1') ||
          normalized.startsWith('SELECT id, user_id, title, cover_story_id, display_order FROM story_highlights WHERE id = $1')) {
        const h = highlights.get(String(params[0]))
        if (h) return { rows: [{ id: h.id, user_id: h.user_id, title: h.title, cover_story_id: h.cover_story_id, display_order: h.display_order }] }
        return { rows: [] }
      }

      // 13. Select highlight details with owner
      if (normalized.includes('FROM story_highlights sh JOIN users u ON u.id = sh.user_id WHERE sh.id = $1')) {
        const h = highlights.get(String(params[0]))
        if (!h) return { rows: [] }
        const u = users.get(h.user_id)
        return {
          rows: [{
            id: h.id,
            user_id: h.user_id,
            title: h.title,
            cover_story_id: h.cover_story_id,
            display_order: h.display_order,
            created_at: h.created_at,
            updated_at: h.updated_at,
            user_name: u?.name || 'User',
            user_avatar_url: u?.profile_image_id ? `/api/images/${u.profile_image_id}` : null,
          }],
        }
      }

      // 14. Select stories for highlight details
      if (normalized.includes('FROM story_highlight_items shi JOIN stories s ON s.id = shi.story_id')) {
        const hid = String(params[0])
        const viewerId = params[1]
        const rows = []
        for (const item of highlightItems.values()) {
          if (item.highlight_id !== hid) continue
          const s = stories.get(item.story_id)
          if (!s) continue
          rows.push({
            id: s.id,
            type: s.type,
            content: s.content,
            background_style: s.background_style,
            created_at: s.created_at,
            expires_at: s.expires_at,
            media_url: s.type === 'photo' ? `/api/stories/media/${s.id}` : null,
            viewed: false,
            view_count: 0,
            my_reaction: null,
            reaction_count: 0,
            reply_count: 0,
            highlight_order: item.display_order,
          })
        }
        rows.sort((a, b) => a.highlight_order - b.highlight_order)
        return { rows }
      }

      // 15. Check story existence & ownership
      if (normalized.startsWith('SELECT id, user_id, expires_at FROM stories WHERE id = $1')) {
        const s = stories.get(String(params[0]))
        if (s) return { rows: [{ id: s.id, user_id: s.user_id, expires_at: s.expires_at }] }
        return { rows: [] }
      }

      // 16. Select highlights for user
      if (normalized.includes('FROM story_highlights sh LEFT JOIN story_highlight_items shi ON shi.highlight_id = sh.id WHERE sh.user_id = $1')) {
        const userId = Number(params[0])
        const list = []
        for (const h of highlights.values()) {
          if (h.user_id !== userId) continue
          let count = 0
          for (const item of highlightItems.values()) {
            if (item.highlight_id === h.id) count += 1
          }
          list.push({
            id: h.id,
            user_id: h.user_id,
            title: h.title,
            cover_story_id: h.cover_story_id,
            display_order: h.display_order,
            created_at: h.created_at,
            updated_at: h.updated_at,
            story_count: count,
            cover_media_url: h.cover_story_id ? `/api/stories/media/${h.cover_story_id}` : null,
            cover_type: 'photo',
            cover_background_style: 'gradient-sunset',
          })
        }
        list.sort((a, b) => a.display_order - b.display_order)
        return { rows: list }
      }

      // 17. User exists check
      if (normalized.startsWith('SELECT id FROM users WHERE id = $1')) {
        const u = users.get(Number(params[0]))
        return { rows: u ? [{ id: u.id }] : [] }
      }

      throw new Error(`Unhandled query in highlight mock: ${sql}`)
    },
  }

  return pool
}

function createTestApp(pool, currentUserId = 10) {
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

  return async function dispatch(method, urlPath, body = {}) {
    return new Promise((resolve) => {
      const parsedUrl = new URL(urlPath, 'http://localhost')
      const pathname = parsedUrl.pathname

      // Simple match dispatcher
      let match = null
      let routePath = pathname
      const req = {
        method,
        url: pathname,
        originalUrl: `/api/stories${pathname}`,
        params: {},
        body,
        headers: {},
      }

      if ((match = pathname.match(/^\/highlights\/items\/(\d+)$/))) {
        // none
      } else if ((match = pathname.match(/^\/highlights\/my-stories$/))) {
        routePath = '/highlights/my-stories'
      } else if ((match = pathname.match(/^\/highlights\/user\/(\d+)$/))) {
        routePath = '/highlights/user/:userId'
        req.params = { userId: match[1] }
      } else if ((match = pathname.match(/^\/highlights\/(\d+)\/items\/(\d+)$/))) {
        routePath = '/highlights/:highlightId/items/:storyId'
        req.params = { highlightId: match[1], storyId: match[2] }
      } else if ((match = pathname.match(/^\/highlights\/(\d+)\/items$/))) {
        routePath = '/highlights/:highlightId/items'
        req.params = { highlightId: match[1] }
      } else if ((match = pathname.match(/^\/highlights\/(\d+)$/))) {
        routePath = '/highlights/:highlightId'
        req.params = { highlightId: match[1] }
      } else if (pathname === '/highlights') {
        routePath = '/highlights'
      }

      const res = {
        statusCode: 200,
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

      router.handle(req, res, next)
    })
  }
}

// 3. Highlight Creation & Retrieval Tests
test('POST /api/stories/highlights returns 401 when unauthenticated', async () => {
  const pool = createMockPool()
  const dispatch = createTestApp(pool, null)

  const res = await dispatch('POST', '/highlights', { title: 'Trips' })
  assert.equal(res.status, 401)
})

test('POST /api/stories/highlights validates title length and boundaries', async () => {
  const pool = createMockPool()
  const dispatch = createTestApp(pool, 10)

  const emptyRes = await dispatch('POST', '/highlights', { title: '   ' })
  assert.equal(emptyRes.status, 400)
  assert.equal(emptyRes.body.field, 'title')

  const tooLongRes = await dispatch('POST', '/highlights', { title: 'X'.repeat(61) })
  assert.equal(tooLongRes.status, 400)
  assert.equal(tooLongRes.body.field, 'title')
})

test('POST /api/stories/highlights successfully creates a highlight with stories and cover', async () => {
  const pool = createMockPool()
  const dispatch = createTestApp(pool, 10) // Alice

  const res = await dispatch('POST', '/highlights', {
    title: 'Summer 2026',
    storyIds: ['1', '2'],
    coverStoryId: '1',
  })

  assert.equal(res.status, 201)
  assert.equal(res.body.success, true)
  assert.ok(res.body.highlight)
  assert.equal(res.body.highlight.title, 'Summer 2026')
  assert.equal(res.body.highlight.user_id, 10)
  assert.equal(res.body.highlight.cover_story_id, '1')

  // Verify items saved
  assert.equal(pool.highlightItems.size, 3) // preseeded 1 + 2 added
})

test('GET /api/stories/highlights/user/:userId returns public highlight list without private leaks', async () => {
  const pool = createMockPool()
  const dispatch = createTestApp(pool, 20) // Bob viewing Alice (10)

  const res = await dispatch('GET', '/highlights/user/10')
  assert.equal(res.status, 200)
  assert.ok(Array.isArray(res.body.highlights))
  assert.equal(res.body.highlights.length, 1)
  assert.equal(res.body.highlights[0].title, 'Old Favorites')
  assert.equal(res.body.highlights[0].story_count, 1)
})

test('GET /api/stories/highlights/:highlightId returns highlight details and associated stories', async () => {
  const pool = createMockPool()
  const dispatch = createTestApp(pool, 20)

  const res = await dispatch('GET', '/highlights/99')
  assert.equal(res.status, 200)
  assert.ok(res.body.highlight)
  assert.equal(res.body.highlight.title, 'Old Favorites')
  assert.equal(res.body.user.name, 'Alice (Owner)')
  assert.ok(Array.isArray(res.body.stories))
  assert.equal(res.body.stories.length, 1)
  assert.equal(res.body.stories[0].id, '3')
})

// 4. Update, Rename, Cover & Deletion Tests
test('PUT /api/stories/highlights/:highlightId rejects unauthorized non-owners with 403', async () => {
  const pool = createMockPool()
  const dispatch = createTestApp(pool, 20) // Bob trying to update Alice's highlight 99

  const res = await dispatch('PUT', '/highlights/99', { title: 'Hacked Title' })
  assert.equal(res.status, 403)
  assert.equal(res.body.error, 'Only the highlight owner can update it')
})

test('PUT /api/stories/highlights/:highlightId updates title and order for owner', async () => {
  const pool = createMockPool()
  const dispatch = createTestApp(pool, 10) // Alice

  const res = await dispatch('PUT', '/highlights/99', { title: 'Renamed Favorites', displayOrder: 5 })
  assert.equal(res.status, 200)
  assert.equal(res.body.success, true)
  assert.equal(res.body.highlight.title, 'Renamed Favorites')
  assert.equal(res.body.highlight.display_order, 5)
})

test('DELETE /api/stories/highlights/:highlightId allows only owner and cascades items', async () => {
  const pool = createMockPool()
  const bobDispatch = createTestApp(pool, 20)
  const aliceDispatch = createTestApp(pool, 10)

  // Bob fails
  const bobRes = await bobDispatch('DELETE', '/highlights/99')
  assert.equal(bobRes.status, 403)

  // Alice succeeds
  const aliceRes = await aliceDispatch('DELETE', '/highlights/99')
  assert.equal(aliceRes.status, 200)
  assert.equal(aliceRes.body.success, true)
  assert.equal(pool.highlights.has('99'), false)
  // Verify highlight items deleted as well
  assert.equal(pool.highlightItems.size, 0)
})

// 5. Add / Remove Item Tests & Duplicate / Cross-User Prevention
test('POST /api/stories/highlights/:id/items prevents adding another user\'s story (403)', async () => {
  const pool = createMockPool()
  const dispatch = createTestApp(pool, 10) // Alice owns highlight 99

  // Story 5 belongs to Bob (20)
  const res = await dispatch('POST', '/highlights/99/items', { storyId: '5' })
  assert.equal(res.status, 403)
  assert.equal(res.body.error, "Cannot add another user's story to your highlight")
})

test('POST /api/stories/highlights/:id/items prevents duplicate story in same highlight (400)', async () => {
  const pool = createMockPool()
  const dispatch = createTestApp(pool, 10)

  // Story 3 is already in highlight 99
  const res = await dispatch('POST', '/highlights/99/items', { storyId: '3' })
  assert.equal(res.status, 400)
  assert.equal(res.body.error, 'Story is already in this highlight')
})

test('POST /api/stories/highlights/:id/items rejects expired story that is unretained (400)', async () => {
  const pool = createMockPool()
  const dispatch = createTestApp(pool, 10)

  // Story 4 is expired and NOT in any highlight
  const res = await dispatch('POST', '/highlights/99/items', { storyId: '4' })
  assert.equal(res.status, 400)
  assert.ok(res.body.error.includes('Expired story cannot be added'))
})

test('POST /api/stories/highlights/:id/items adds active story and updates cover if needed', async () => {
  const pool = createMockPool()
  const dispatch = createTestApp(pool, 10)

  // Story 1 is active and belongs to Alice
  const res = await dispatch('POST', '/highlights/99/items', { storyId: '1' })
  assert.equal(res.status, 201)
  assert.equal(res.body.success, true)
  assert.equal(res.body.item.story_id, '1')
})

test('DELETE /api/stories/highlights/:id/items/:storyId removes story and updates cover', async () => {
  const pool = createMockPool()
  const dispatch = createTestApp(pool, 10)

  // Remove story 3 from highlight 99
  const res = await dispatch('DELETE', '/highlights/99/items/3')
  assert.equal(res.status, 200)
  assert.equal(res.body.success, true)

  // Verify removed from mock items
  let found = false
  for (const item of pool.highlightItems.values()) {
    if (item.highlight_id === '99' && item.story_id === '3') found = true
  }
  assert.equal(found, false)
})

// 6. 24-Hour Expiry Compatibility and Cleanup Retain Logic Test
test('24-Hour Expiry: Candidate stories endpoint returns active stories AND retained expired stories', async () => {
  const pool = createMockPool()
  const dispatch = createTestApp(pool, 10) // Alice

  const res = await dispatch('GET', '/highlights/my-stories')
  assert.equal(res.status, 200)
  assert.ok(Array.isArray(res.body.stories))

  const ids = res.body.stories.map((s) => s.id)
  // Stories 1 and 2 are active -> present
  assert.ok(ids.includes('1'))
  assert.ok(ids.includes('2'))
  // Story 3 is expired but retained in highlight 99 -> present
  assert.ok(ids.includes('3'))
  // Story 4 is expired and NOT in any highlight -> omitted!
  assert.equal(ids.includes('4'), false)
})

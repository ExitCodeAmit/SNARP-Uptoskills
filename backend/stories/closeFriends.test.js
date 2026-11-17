import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  STORY_AUDIENCES,
  validateStoryAudience,
  validateStoryInput,
  isAuthorizedForStory,
} from './validator.js'
import { createStoryRouter } from './routes.js'

// ── Mock Pool & Test Harness for Close Friends ──────────────────────────────
function createMockPool() {
  let nextStoryId = 1
  let nextReactionId = 1
  let nextReplyId = 1

  const users = new Map([
    [10, { id: 10, name: 'Alice Author', email: 'alice@example.com', profile_image_id: null }],
    [20, { id: 20, name: 'Bob Friend', email: 'bob@example.com', profile_image_id: 'img-200' }],
    [30, { id: 30, name: 'Charlie Peer', email: 'charlie@example.com', profile_image_id: null }],
    [40, { id: 40, name: 'David Colleague', email: 'david@example.com', profile_image_id: 'img-400' }],
  ])

  // Array of { user_id, friend_user_id, created_at }
  const closeFriends = []
  const stories = new Map()
  const storyMedia = new Map()
  const storyViews = []
  const storyReactions = []
  const storyReplies = []
  const storyPolls = new Map()
  const storyPollOptions = new Map()
  const storyPollVotes = []
  const storyQuestions = new Map()
  const storyQuestionResponses = []
  const storyQuizzes = new Map()
  const storyQuizOptions = new Map()
  const storyQuizAnswers = []
  const highlights = new Map()
  const highlightItems = new Map()
  const storyMentions = []
  const storyReshares = []
  const notifications = []

  const pool = {
    users,
    closeFriends,
    stories,
    storyMedia,
    storyViews,
    storyReactions,
    storyReplies,
    storyPolls,
    storyPollOptions,
    storyPollVotes,
    storyQuestions,
    storyQuestionResponses,
    storyQuizzes,
    storyQuizOptions,
    storyQuizAnswers,
    highlights,
    highlightItems,
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

      if (normalized.startsWith('BEGIN') || normalized.startsWith('COMMIT') || normalized.startsWith('ROLLBACK')) {
        return { rows: [], rowCount: 0 }
      }

      // 1. SELECT from close_friends for user (GET /close-friends)
      if (normalized.includes('FROM close_friends cf') && normalized.includes('JOIN users u ON u.id = cf.friend_user_id')) {
        const userId = Number(params[0])
        const friends = closeFriends
          .filter((cf) => cf.user_id === userId)
          .map((cf) => {
            const u = users.get(cf.friend_user_id)
            return {
              id: u.id,
              name: u.name,
              username: u.email.split('@')[0],
              avatar_url: u.profile_image_id ? `/api/images/${u.profile_image_id}` : null,
              created_at: cf.created_at,
            }
          })
        return { rows: friends, rowCount: friends.length }
      }

      // 2. Target user existence check
      if (normalized.includes('FROM users') && (normalized.includes('WHERE id = $1') || normalized.includes('WHERE u.id = $1'))) {
        const targetId = Number(params[0])
        const u = users.get(targetId)
        if (!u) return { rows: [], rowCount: 0 }
        return {
          rows: [
            {
              id: u.id,
              name: u.name,
              username: u.email.split('@')[0],
              avatar_url: u.profile_image_id ? `/api/images/${u.profile_image_id}` : null,
            },
          ],
          rowCount: 1,
        }
      }

      // 3. Existing Close Friends relationship check
      if (normalized.startsWith('SELECT 1 FROM close_friends WHERE user_id = $1 AND friend_user_id = $2')) {
        const userId = Number(params[0])
        const friendId = Number(params[1])
        const exists = closeFriends.some((cf) => cf.user_id === userId && cf.friend_user_id === friendId)
        return { rows: exists ? [{ '?column?': 1 }] : [], rowCount: exists ? 1 : 0 }
      }

      // 4. INSERT INTO close_friends
      if (normalized.startsWith('INSERT INTO close_friends')) {
        const userId = Number(params[0])
        const friendId = Number(params[1])
        const now = new Date().toISOString()
        closeFriends.push({ user_id: userId, friend_user_id: friendId, created_at: now })
        return { rows: [{ created_at: now }], rowCount: 1 }
      }

      // 5. DELETE FROM close_friends
      if (normalized.startsWith('DELETE FROM close_friends WHERE user_id = $1 AND friend_user_id = $2')) {
        const userId = Number(params[0])
        const friendId = Number(params[1])
        const idx = closeFriends.findIndex((cf) => cf.user_id === userId && cf.friend_user_id === friendId)
        if (idx !== -1) {
          closeFriends.splice(idx, 1)
          return { rows: [], rowCount: 1 }
        }
        return { rows: [], rowCount: 0 }
      }

      // 6. Check Close Friends count before story creation
      if (normalized.startsWith('SELECT 1 FROM close_friends WHERE user_id = $1 LIMIT 1')) {
        const userId = Number(params[0])
        const exists = closeFriends.some((cf) => cf.user_id === userId)
        return { rows: exists ? [{ '?column?': 1 }] : [], rowCount: exists ? 1 : 0 }
      }

      // 7. Audience lookup
      if (normalized.startsWith('SELECT audience FROM stories WHERE id = $1')) {
        const s = stories.get(String(params[0]))
        return { rows: s ? [{ audience: s.audience || 'everyone' }] : [], rowCount: s ? 1 : 0 }
      }

      // 8. Story lookup (generic / active)
      if (normalized.startsWith('SELECT id, user_id FROM stories WHERE id = $1') ||
          normalized.startsWith('SELECT id, user_id, expires_at FROM stories WHERE id = $1') ||
          normalized.startsWith('SELECT id, user_id, type, content') ||
          normalized.startsWith('SELECT id FROM stories WHERE id = $1')) {
        const s = stories.get(String(params[0]))
        if (!s) return { rows: [], rowCount: 0 }
        return { rows: [s], rowCount: 1 }
      }

      // 9. INSERT INTO stories with audience
      if (normalized.startsWith('INSERT INTO stories')) {
        const id = String(nextStoryId++)
        const story = {
          id,
          user_id: Number(params[0]),
          type: params[1],
          content: params[2],
          background_style: params[3],
          audience: params[4] || 'everyone',
          created_at: new Date().toISOString(),
          expires_at: new Date(Date.now() + 86400000).toISOString(),
        }
        stories.set(id, story)
        return { rows: [story], rowCount: 1 }
      }

      // 10. GET /users/:userId stories
      if (normalized.includes('s.audience') && normalized.includes('FROM stories s') && normalized.includes('WHERE s.user_id = $1')) {
        const targetUserId = Number(params[0])
        const viewerId = Number(params[1])
        const authorStories = Array.from(stories.values()).filter((s) => {
          if (Number(s.user_id) !== targetUserId) return false
          if (Number(s.user_id) === viewerId) return true
          if (s.audience === 'everyone') return true
          if (s.audience === 'close_friends') {
            return closeFriends.some((cf) => cf.user_id === Number(s.user_id) && cf.friend_user_id === viewerId)
          }
          return false
        })
        return { rows: authorStories, rowCount: authorStories.length }
      }

      // 11. Tray: My stories (pool.query)
      if (normalized.includes('FROM stories s') && normalized.includes('WHERE s.user_id = $1 AND s.expires_at > now()') && !normalized.includes('JOIN users')) {
        const userId = Number(params[0])
        const my = Array.from(stories.values()).filter((s) => Number(s.user_id) === userId)
        return { rows: my, rowCount: my.length }
      }

      // 11. Tray: Peer stories (pool.query)
      if (normalized.includes('FROM stories s') && normalized.includes('JOIN users u ON u.id = s.user_id') && normalized.includes('WHERE s.user_id <> $1')) {
        const viewerId = Number(params[0])
        const authorizedStories = Array.from(stories.values()).filter((s) => {
          if (Number(s.user_id) === viewerId) return false
          if (s.audience === 'everyone') return true
          if (s.audience === 'close_friends') {
            return closeFriends.some((cf) => cf.user_id === Number(s.user_id) && cf.friend_user_id === viewerId)
          }
          return false
        })

        // Group by user
        const grouped = new Map()
        for (const s of authorizedStories) {
          const uid = Number(s.user_id)
          if (!grouped.has(uid)) {
            const u = users.get(uid)
            grouped.set(uid, {
              user_id: uid,
              name: u.name,
              full_name: u.name,
              username: u.email.split('@')[0],
              avatar_url: u.profile_image_id ? `/api/images/${u.profile_image_id}` : null,
              has_unviewed: true,
              latest_created_at: s.created_at,
              story_count: 0,
            })
          }
          const entry = grouped.get(uid)
          entry.story_count += 1
          if (s.created_at > entry.latest_created_at) entry.latest_created_at = s.created_at
        }
        return { rows: Array.from(grouped.values()), rowCount: grouped.size }
      }

      // 12. GET /users/:userId stories
      if (normalized.includes('FROM stories s') && normalized.includes('WHERE s.user_id = $1') && normalized.includes('ORDER BY s.created_at ASC')) {
        const targetUserId = Number(params[0])
        const viewerId = Number(params[1])
        const authorStories = Array.from(stories.values()).filter((s) => {
          if (Number(s.user_id) !== targetUserId) return false
          if (Number(s.user_id) === viewerId) return true
          if (s.audience === 'everyone') return true
          if (s.audience === 'close_friends') {
            return closeFriends.some((cf) => cf.user_id === Number(s.user_id) && cf.friend_user_id === viewerId)
          }
          return false
        })
        return { rows: authorStories, rowCount: authorStories.length }
      }

      // 13. GET /media/:id
      if (normalized.includes('FROM story_media sm') && normalized.includes('JOIN stories s ON s.id = sm.story_id')) {
        const mediaId = String(params[0])
        const viewerId = Number(params[1])
        const m = storyMedia.get(mediaId)
        if (!m) return { rows: [], rowCount: 0 }
        const s = stories.get(String(m.story_id))
        if (!s) return { rows: [], rowCount: 0 }

        const isAuth = (
          Number(s.user_id) === viewerId ||
          s.audience === 'everyone' ||
          (s.audience === 'close_friends' && closeFriends.some((cf) => cf.user_id === Number(s.user_id) && cf.friend_user_id === viewerId))
        )
        if (!isAuth) return { rows: [], rowCount: 0 }
        return { rows: [{ mime: m.mime, size_bytes: m.size_bytes, data: m.data }], rowCount: 1 }
      }

      // 14. Views
      if (normalized.startsWith('INSERT INTO story_views')) {
        storyViews.push({ story_id: String(params[0]), viewer_id: Number(params[1]) })
        return { rows: [{ id: '1' }], rowCount: 1 }
      }

      // 15. Reactions
      if (normalized.startsWith('SELECT sr.type') || normalized.startsWith('SELECT id, type FROM story_reactions')) {
        const storyId = String(params[0])
        const uid = Number(params[1])
        const r = storyReactions.find((sr) => sr.story_id === storyId && sr.user_id === uid)
        return { rows: r ? [{ type: r.type, id: r.id }] : [], rowCount: r ? 1 : 0 }
      }
      if (normalized.startsWith('INSERT INTO story_reactions')) {
        const id = String(nextReactionId++)
        storyReactions.push({ id, story_id: String(params[0]), user_id: Number(params[1]), type: params[2] })
        return { rows: [{ id, story_id: params[0], user_id: params[1], type: params[2] }], rowCount: 1 }
      }
      if (normalized.startsWith('DELETE FROM story_reactions')) {
        const idx = storyReactions.findIndex((sr) => sr.story_id === String(params[0]) && sr.user_id === Number(params[1]))
        if (idx !== -1) storyReactions.splice(idx, 1)
        return { rows: [], rowCount: 1 }
      }
      if (normalized.includes('FROM story_reactions WHERE story_id = $1') && normalized.includes('GROUP BY type')) {
        return { rows: [], rowCount: 0 }
      }

      // 16. Replies
      if (normalized.startsWith('INSERT INTO story_replies')) {
        const id = String(nextReplyId++)
        const reply = { id, story_id: String(params[0]), user_id: Number(params[1]), text: params[2], created_at: new Date().toISOString() }
        storyReplies.push(reply)
        return { rows: [reply], rowCount: 1 }
      }

      // 17. Polls
      if (normalized.includes('FROM story_polls WHERE story_id = $1')) {
        const p = storyPolls.get(String(params[0]))
        return { rows: p ? [p] : [], rowCount: p ? 1 : 0 }
      }
      if (normalized.startsWith('SELECT id, option_text FROM story_poll_options WHERE id = $1 AND poll_id = $2') ||
          normalized.startsWith('SELECT id FROM story_poll_options WHERE id = $1 AND poll_id = $2')) {
        const opt = storyPollOptions.get(String(params[0]))
        return { rows: opt ? [opt] : [], rowCount: opt ? 1 : 0 }
      }
      if (normalized.startsWith('SELECT option_id FROM story_poll_votes WHERE poll_id = $1 AND user_id = $2')) {
        const v = storyPollVotes.find((vote) => vote.poll_id === String(params[0]) && vote.user_id === Number(params[1]))
        return { rows: v ? [v] : [], rowCount: v ? 1 : 0 }
      }
      if (normalized.startsWith('INSERT INTO story_poll_votes')) {
        storyPollVotes.push({ poll_id: String(params[0]), option_id: String(params[1]), user_id: Number(params[2]) })
        return { rows: [{ poll_id: params[0], option_id: params[1], user_id: params[2] }], rowCount: 1 }
      }

      // 18. Questions
      if (normalized.startsWith('SELECT id') && normalized.includes('FROM story_questions WHERE story_id = $1')) {
        const q = storyQuestions.get(String(params[0]))
        return { rows: q ? [q] : [], rowCount: q ? 1 : 0 }
      }
      if (normalized.startsWith('INSERT INTO story_question_responses')) {
        storyQuestionResponses.push({ question_id: String(params[0]), responder_id: Number(params[1]), response_text: params[2] })
        return { rows: [{ id: '1' }], rowCount: 1 }
      }

      // 19. Quizzes
      if (normalized.startsWith('SELECT id, correct_option_id, question_text FROM story_quizzes WHERE story_id = $1')) {
        const q = storyQuizzes.get(String(params[0]))
        return { rows: q ? [q] : [], rowCount: q ? 1 : 0 }
      }
      if (normalized.startsWith('SELECT id FROM story_quiz_options WHERE id = $1 AND quiz_id = $2')) {
        const opt = storyQuizOptions.get(String(params[0]))
        return { rows: opt ? [opt] : [], rowCount: opt ? 1 : 0 }
      }
      if (normalized.startsWith('INSERT INTO story_quiz_answers')) {
        storyQuizAnswers.push({ quiz_id: String(params[0]), option_id: String(params[1]), user_id: Number(params[2]) })
        return { rows: [{ id: '1' }], rowCount: 1 }
      }

      // 20. Reshare Mentions
      if (normalized.startsWith('SELECT 1 FROM story_mentions WHERE story_id = $1 AND user_id = $2')) {
        const sid = String(params[0])
        const uid = Number(params[1])
        const exists = storyMentions.some((m) => m.story_id === sid && m.user_id === uid)
        return { rows: exists ? [{ '?column?': 1 }] : [], rowCount: exists ? 1 : 0 }
      }
      if (normalized.startsWith('INSERT INTO story_reshares')) {
        storyReshares.push({ original_story_id: String(params[0]), reshared_story_id: String(params[1]), reshared_by_user_id: Number(params[2]) })
        return { rows: [{ id: '1' }], rowCount: 1 }
      }
      if (normalized.startsWith('INSERT INTO notifications')) {
        notifications.push({ user_id: params[0], actor_id: params[1], kind: params[2] })
        return { rows: [{ id: '1' }], rowCount: 1 }
      }

      // 21. Highlights
      if (normalized.startsWith('SELECT id, user_id, cover_story_id FROM story_highlights WHERE id = $1')) {
        const h = highlights.get(String(params[0]))
        return { rows: h ? [h] : [], rowCount: h ? 1 : 0 }
      }
      if (normalized.startsWith('INSERT INTO story_highlight_items')) {
        const item = { id: '1', highlight_id: String(params[0]), story_id: String(params[1]) }
        highlightItems.set(`${params[0]}_${params[1]}`, item)
        return { rows: [item], rowCount: 1 }
      }
      if (normalized.includes('FROM stories s') && normalized.includes('WHERE s.user_id = $1') && normalized.includes('audience')) {
        const uid = Number(params[0])
        const valid = Array.from(stories.values()).filter((s) => Number(s.user_id) === uid && (!s.audience || s.audience === 'everyone'))
        return { rows: valid, rowCount: valid.length }
      }

      return { rows: [], rowCount: 0 }
    },
  }

  return pool
}

// Helper to simulate mock express request through the story router
async function simulateRequest(router, { method, url, userId = 10, body = {}, params = {}, query = {}, headers = {}, file = null }) {
  return new Promise((resolve) => {
    let capturedStatus = 200
    let capturedBody = null
    const responseHeaders = {}

    const req = {
      method,
      url,
      userId,
      body,
      params,
      query,
      file,
      headers: { ...headers },
    }

    const res = {
      status(code) {
        capturedStatus = code
        return this
      },
      setHeader(name, val) {
        responseHeaders[name.toLowerCase()] = val
        return this
      },
      set(nameOrObj, val) {
        if (typeof nameOrObj === 'object') {
          for (const [k, v] of Object.entries(nameOrObj)) {
            responseHeaders[k.toLowerCase()] = v
          }
        } else {
          responseHeaders[nameOrObj.toLowerCase()] = val
        }
        return this
      },
      getHeader(name) {
        return responseHeaders[name.toLowerCase()]
      },
      json(data) {
        capturedBody = data
        resolve({ status: capturedStatus, body: capturedBody, headers: responseHeaders })
      },
      send(data) {
        capturedBody = data
        resolve({ status: capturedStatus, body: capturedBody, headers: responseHeaders })
      },
      end(data) {
        if (data !== undefined) capturedBody = data
        resolve({ status: capturedStatus, body: capturedBody, headers: responseHeaders })
      },
    }

    const next = (err) => {
      if (err) {
        resolve({ status: err.status || 500, body: { error: err.message, field: err.field }, headers: responseHeaders })
      } else {
        resolve({ status: 404, body: { error: 'Not found' }, headers: responseHeaders })
      }
    }

    router.handle(req, res, next)
  })
}

// ── 1. Unit Tests: Validator Functions ───────────────────────────────────────
test('Validator: STORY_AUDIENCES defines supported audiences', () => {
  assert.deepEqual(STORY_AUDIENCES, ['everyone', 'close_friends'])
})

test('Validator: validateStoryAudience handles default and valid values', () => {
  assert.equal(validateStoryAudience(undefined), 'everyone')
  assert.equal(validateStoryAudience(null), 'everyone')
  assert.equal(validateStoryAudience(''), 'everyone')
  assert.equal(validateStoryAudience('everyone'), 'everyone')
  assert.equal(validateStoryAudience('EVERYONE'), 'everyone')
  assert.equal(validateStoryAudience('  close_friends  '), 'close_friends')
  assert.equal(validateStoryAudience('CLOSE_FRIENDS'), 'close_friends')
})

test('Validator: validateStoryAudience rejects unsupported or non-string values', () => {
  assert.throws(
    () => validateStoryAudience('followers_only'),
    (err) => err.status === 400 && err.field === 'audience' && err.message.includes('Allowed values')
  )
  assert.throws(
    () => validateStoryAudience('private'),
    (err) => err.status === 400 && err.field === 'audience'
  )
  assert.throws(
    () => validateStoryAudience(123),
    (err) => err.status === 400 && err.field === 'audience' && err.message.includes('string')
  )
})

test('Validator: validateStoryInput sets audience to default "everyone"', () => {
  const result = validateStoryInput({ type: 'text', content: 'Hello universe' })
  assert.equal(result.audience, 'everyone')
})

test('Validator: validateStoryInput preserves valid "close_friends" audience', () => {
  const result = validateStoryInput({ type: 'text', content: 'Secret post', audience: 'close_friends' })
  assert.equal(result.audience, 'close_friends')
})

test('Validator: isAuthorizedForStory authorizes author regardless of audience', () => {
  const storyEveryone = { user_id: 10, audience: 'everyone' }
  const storyCF = { user_id: 10, audience: 'close_friends' }

  assert.equal(isAuthorizedForStory(storyEveryone, 10, false), true)
  assert.equal(isAuthorizedForStory(storyCF, 10, false), true)
  assert.equal(isAuthorizedForStory(storyCF, '10', false), true)
})

test('Validator: isAuthorizedForStory enforces close_friends relationship for peers', () => {
  const storyEveryone = { user_id: 10, audience: 'everyone' }
  const storyCF = { user_id: 10, audience: 'close_friends' }

  // Peer accessing 'everyone' story -> always authorized
  assert.equal(isAuthorizedForStory(storyEveryone, 20, false), true)
  assert.equal(isAuthorizedForStory(storyEveryone, 20, true), true)

  // Peer accessing 'close_friends' story without being close friend -> denied
  assert.equal(isAuthorizedForStory(storyCF, 20, false), false)

  // Peer accessing 'close_friends' story as confirmed close friend -> authorized
  assert.equal(isAuthorizedForStory(storyCF, 20, true), true)
})

// ── 2. Integration Tests: Close Friends Management Endpoints ────────────────
test('Close Friends API: GET /close-friends returns empty list initially', async () => {
  const pool = createMockPool()
  const router = createStoryRouter({
    pool,
    auth: (req, _res, next) => next(),
    isPgId: (v) => /^\d+$/.test(v) && Number(v) > 0,
    upload: { single: () => (_req, _res, next) => next() },
  })

  const res = await simulateRequest(router, {
    method: 'GET',
    url: '/close-friends',
    userId: 10,
  })

  assert.equal(res.status, 200)
  assert.deepEqual(res.body.closeFriends, [])
  assert.equal(res.body.count, 0)
})

test('Close Friends API: POST /close-friends adds a valid user to the list', async () => {
  const pool = createMockPool()
  const router = createStoryRouter({
    pool,
    auth: (req, _res, next) => next(),
    isPgId: (v) => /^\d+$/.test(v) && Number(v) > 0,
    upload: { single: () => (_req, _res, next) => next() },
  })

  const res = await simulateRequest(router, {
    method: 'POST',
    url: '/close-friends',
    userId: 10,
    body: { friendUserId: 20 },
  })

  assert.equal(res.status, 201)
  assert.equal(res.body.success, true)
  assert.equal(res.body.friend.id, 20)
  assert.equal(res.body.friend.name, 'Bob Friend')
  assert.equal(res.body.friend.username, 'bob')
  assert.equal(res.body.friend.avatar_url, '/api/images/img-200')
  assert.ok(res.body.friend.created_at)

  // Verify list retrieval contains the newly added friend
  const listRes = await simulateRequest(router, {
    method: 'GET',
    url: '/close-friends',
    userId: 10,
  })
  assert.equal(listRes.status, 200)
  assert.equal(listRes.body.count, 1)
  assert.equal(listRes.body.closeFriends[0].id, 20)
})

test('Close Friends API: POST /close-friends rejects self-addition with 400', async () => {
  const pool = createMockPool()
  const router = createStoryRouter({
    pool,
    auth: (req, _res, next) => next(),
    isPgId: (v) => /^\d+$/.test(v) && Number(v) > 0,
    upload: { single: () => (_req, _res, next) => next() },
  })

  const res = await simulateRequest(router, {
    method: 'POST',
    url: '/close-friends',
    userId: 10,
    body: { friendUserId: 10 },
  })

  assert.equal(res.status, 400)
  assert.match(res.body.error, /cannot add yourself/)
  assert.equal(res.body.field, 'friendUserId')
})

test('Close Friends API: POST /close-friends rejects invalid or malformed user IDs with 400', async () => {
  const pool = createMockPool()
  const router = createStoryRouter({
    pool,
    auth: (req, _res, next) => next(),
    isPgId: (v) => /^\d+$/.test(v) && Number(v) > 0,
    upload: { single: () => (_req, _res, next) => next() },
  })

  for (const badId of ['abc', -5, 0, null, undefined, '', '3.14']) {
    const res = await simulateRequest(router, {
      method: 'POST',
      url: '/close-friends',
      userId: 10,
      body: { friendUserId: badId },
    })
    assert.equal(res.status, 400)
    assert.match(res.body.error, /Valid friendUserId is required/)
  }
})

test('Close Friends API: POST /close-friends returns 404 for nonexistent user', async () => {
  const pool = createMockPool()
  const router = createStoryRouter({
    pool,
    auth: (req, _res, next) => next(),
    isPgId: (v) => /^\d+$/.test(v) && Number(v) > 0,
    upload: { single: () => (_req, _res, next) => next() },
  })

  const res = await simulateRequest(router, {
    method: 'POST',
    url: '/close-friends',
    userId: 10,
    body: { friendUserId: 999 },
  })

  assert.equal(res.status, 404)
  assert.match(res.body.error, /User not found/)
})

test('Close Friends API: POST /close-friends returns 409 for duplicate add', async () => {
  const pool = createMockPool()
  const router = createStoryRouter({
    pool,
    auth: (req, _res, next) => next(),
    isPgId: (v) => /^\d+$/.test(v) && Number(v) > 0,
    upload: { single: () => (_req, _res, next) => next() },
  })

  // First add
  const firstRes = await simulateRequest(router, {
    method: 'POST',
    url: '/close-friends',
    userId: 10,
    body: { friendUserId: 20 },
  })
  assert.equal(firstRes.status, 201)

  // Duplicate add
  const dupRes = await simulateRequest(router, {
    method: 'POST',
    url: '/close-friends',
    userId: 10,
    body: { friendUserId: 20 },
  })
  assert.equal(dupRes.status, 409)
  assert.match(dupRes.body.error, /already in your close friends list/)
})

test('Close Friends API: DELETE /close-friends/:friendUserId removes a user', async () => {
  const pool = createMockPool()
  const router = createStoryRouter({
    pool,
    auth: (req, _res, next) => next(),
    isPgId: (v) => /^\d+$/.test(v) && Number(v) > 0,
    upload: { single: () => (_req, _res, next) => next() },
  })

  // Add friend
  await simulateRequest(router, {
    method: 'POST',
    url: '/close-friends',
    userId: 10,
    body: { friendUserId: 20 },
  })

  // Remove friend
  const deleteRes = await simulateRequest(router, {
    method: 'DELETE',
    url: '/close-friends/20',
    params: { friendUserId: '20' },
    userId: 10,
  })
  assert.equal(deleteRes.status, 200)
  assert.equal(deleteRes.body.success, true)

  // Confirm friend is removed
  const listRes = await simulateRequest(router, {
    method: 'GET',
    url: '/close-friends',
    userId: 10,
  })
  assert.equal(listRes.body.count, 0)
})

test('Close Friends API: DELETE /close-friends/:friendUserId returns 404 if not in list', async () => {
  const pool = createMockPool()
  const router = createStoryRouter({
    pool,
    auth: (req, _res, next) => next(),
    isPgId: (v) => /^\d+$/.test(v) && Number(v) > 0,
    upload: { single: () => (_req, _res, next) => next() },
  })

  const deleteRes = await simulateRequest(router, {
    method: 'DELETE',
    url: '/close-friends/20',
    params: { friendUserId: '20' },
    userId: 10,
  })
  assert.equal(deleteRes.status, 404)
  assert.match(deleteRes.body.error, /not in your close friends list/)
})

// ── 3. Integration Tests: Story Creation with Audience ───────────────────────
test('Story Creation: Defaults audience to "everyone" when omitted', async () => {
  const pool = createMockPool()
  const router = createStoryRouter({
    pool,
    auth: (req, _res, next) => next(),
    isPgId: (v) => /^\d+$/.test(v) && Number(v) > 0,
    upload: { single: () => (_req, _res, next) => next() },
  })

  const res = await simulateRequest(router, {
    method: 'POST',
    url: '/',
    userId: 10,
    body: {
      type: 'text',
      content: 'Public announcement',
    },
  })

  assert.equal(res.status, 201)
  assert.equal(res.body.audience, 'everyone')
  assert.equal(res.body.content, 'Public announcement')
})

test('Story Creation: Rejects "close_friends" story when user has no Close Friends', async () => {
  const pool = createMockPool()
  const router = createStoryRouter({
    pool,
    auth: (req, _res, next) => next(),
    isPgId: (v) => /^\d+$/.test(v) && Number(v) > 0,
    upload: { single: () => (_req, _res, next) => next() },
  })

  const res = await simulateRequest(router, {
    method: 'POST',
    url: '/',
    userId: 10,
    body: {
      type: 'text',
      content: 'Secret with empty list',
      audience: 'close_friends',
    },
  })

  assert.equal(res.status, 400)
  assert.match(res.body.error, /Close Friends list is empty/)
  assert.equal(res.body.field, 'audience')
})

test('Story Creation: Successfully creates "close_friends" story when user has Close Friends', async () => {
  const pool = createMockPool()
  const router = createStoryRouter({
    pool,
    auth: (req, _res, next) => next(),
    isPgId: (v) => /^\d+$/.test(v) && Number(v) > 0,
    upload: { single: () => (_req, _res, next) => next() },
  })

  // Add a friend first
  await simulateRequest(router, {
    method: 'POST',
    url: '/close-friends',
    userId: 10,
    body: { friendUserId: 20 },
  })

  // Now create story targeted to close_friends
  const res = await simulateRequest(router, {
    method: 'POST',
    url: '/',
    userId: 10,
    body: {
      type: 'text',
      content: 'Only for my close friends',
      audience: 'close_friends',
    },
  })

  assert.equal(res.status, 201)
  assert.equal(res.body.audience, 'close_friends')
  assert.equal(res.body.content, 'Only for my close friends')
})

test('Story Creation: Rejects unsupported audience values with 400', async () => {
  const pool = createMockPool()
  const router = createStoryRouter({
    pool,
    auth: (req, _res, next) => next(),
    isPgId: (v) => /^\d+$/.test(v) && Number(v) > 0,
    upload: { single: () => (_req, _res, next) => next() },
  })

  const res = await simulateRequest(router, {
    method: 'POST',
    url: '/',
    userId: 10,
    body: {
      type: 'text',
      content: 'Testing invalid audience',
      audience: 'family_only',
    },
  })

  assert.equal(res.status, 400)
  assert.match(res.body.error, /Invalid audience/)
  assert.equal(res.body.field, 'audience')
})

// ── 4. Integration Tests: Audience Security Enforcement ──────────────────────
test('Audience Security: GET /api/stories/tray isolates Close Friends stories from non-members', async () => {
  const pool = createMockPool()
  const router = createStoryRouter({
    pool,
    auth: (req, _res, next) => next(),
    isPgId: (v) => /^\d+$/.test(v) && Number(v) > 0,
    upload: { single: () => (_req, _res, next) => next() },
  })

  // Alice (10) adds Bob (20) to Close Friends (Charlie 30 is NOT added)
  pool.closeFriends.push({ user_id: 10, friend_user_id: 20, created_at: new Date().toISOString() })

  // Alice posts a Close Friends story
  pool.stories.set('101', {
    id: '101',
    user_id: 10,
    type: 'text',
    content: 'Secret close friends story',
    background_style: 'gradient-sunset',
    audience: 'close_friends',
    created_at: new Date().toISOString(),
    expires_at: new Date(Date.now() + 86400000).toISOString(),
  })

  // 1. Bob (Close Friend) requests tray -> sees Alice's story
  const bobRes = await simulateRequest(router, {
    method: 'GET',
    url: '/tray',
    userId: 20,
  })
  assert.equal(bobRes.status, 200)
  const bobAliceTray = bobRes.body.users.find((u) => u.user_id === 10)
  assert.ok(bobAliceTray, 'Bob must see Alice in tray')
  assert.equal(bobAliceTray.story_count, 1)

  // 2. Charlie (Non-member) requests tray -> Alice is completely omitted (0 metadata leak)
  const charlieRes = await simulateRequest(router, {
    method: 'GET',
    url: '/tray',
    userId: 30,
  })
  assert.equal(charlieRes.status, 200)
  const charlieAliceTray = charlieRes.body.users.find((u) => u.user_id === 10)
  assert.equal(charlieAliceTray, undefined, 'Charlie must not see Alice in tray')
})

test('Audience Security: GET /api/stories/users/:userId filters Close Friends stories for non-members', async () => {
  const pool = createMockPool()
  const router = createStoryRouter({
    pool,
    auth: (req, _res, next) => next(),
    isPgId: (v) => /^\d+$/.test(v) && Number(v) > 0,
    upload: { single: () => (_req, _res, next) => next() },
  })

  // Alice adds Bob to Close Friends
  pool.closeFriends.push({ user_id: 10, friend_user_id: 20, created_at: new Date().toISOString() })

  // Alice has 1 public story and 1 Close Friends story
  pool.stories.set('101', {
    id: '101',
    user_id: 10,
    type: 'text',
    content: 'Public story',
    background_style: 'gradient-sunset',
    audience: 'everyone',
    created_at: new Date(Date.now() - 1000).toISOString(),
    expires_at: new Date(Date.now() + 86400000).toISOString(),
  })
  pool.stories.set('102', {
    id: '102',
    user_id: 10,
    type: 'text',
    content: 'Secret CF story',
    background_style: 'gradient-royal',
    audience: 'close_friends',
    created_at: new Date().toISOString(),
    expires_at: new Date(Date.now() + 86400000).toISOString(),
  })

  // Alice (Author) sees both stories
  const aliceRes = await simulateRequest(router, {
    method: 'GET',
    url: '/users/10',
    params: { userId: '10' },
    userId: 10,
  })
  assert.equal(aliceRes.status, 200)
  assert.equal(aliceRes.body.stories.length, 2)

  // Bob (Close Friend) sees both stories
  const bobRes = await simulateRequest(router, {
    method: 'GET',
    url: '/users/10',
    params: { userId: '10' },
    userId: 20,
  })
  assert.equal(bobRes.status, 200)
  assert.equal(bobRes.body.stories.length, 2)
  assert.equal(bobRes.body.stories[1].audience, 'close_friends')

  // Charlie (Non-member) sees ONLY public story
  const charlieRes = await simulateRequest(router, {
    method: 'GET',
    url: '/users/10',
    params: { userId: '10' },
    userId: 30,
  })
  assert.equal(charlieRes.status, 200)
  assert.equal(charlieRes.body.stories.length, 1)
  assert.equal(charlieRes.body.stories[0].id, '101')
  assert.equal(charlieRes.body.stories[0].audience, 'everyone')
})

test('Audience Security: GET /api/stories/media/:id denies streaming to unauthorized viewers (normal & byte-range)', async () => {
  const pool = createMockPool()
  const router = createStoryRouter({
    pool,
    auth: (req, _res, next) => next(),
    isPgId: (v) => /^\d+$/.test(v) && Number(v) > 0,
    upload: { single: () => (_req, _res, next) => next() },
  })

  // Alice adds Bob to Close Friends
  pool.closeFriends.push({ user_id: 10, friend_user_id: 20, created_at: new Date().toISOString() })

  // Alice creates Close Friends video story with media
  const mediaId = '11111111-2222-3333-4444-555555555555'
  const videoBuffer = Buffer.from('0123456789abcdefghijklmnopqrstuvwxyz')
  pool.stories.set('101', {
    id: '101',
    user_id: 10,
    type: 'video',
    content: 'Exclusive video',
    audience: 'close_friends',
    created_at: new Date().toISOString(),
    expires_at: new Date(Date.now() + 86400000).toISOString(),
  })
  pool.storyMedia.set(mediaId, {
    id: mediaId,
    story_id: '101',
    mime: 'video/mp4',
    size_bytes: videoBuffer.length,
    data: videoBuffer,
  })

  // 1. Full request by Bob (Close Friend) -> 200 OK
  const bobFullRes = await simulateRequest(router, {
    method: 'GET',
    url: `/media/${mediaId}`,
    params: { id: mediaId },
    userId: 20,
  })
  assert.equal(bobFullRes.status, 200)
  assert.ok(bobFullRes.body)

  // 2. Full request by Charlie (Non-member) -> 404 (does not leak existence)
  const charlieFullRes = await simulateRequest(router, {
    method: 'GET',
    url: `/media/${mediaId}`,
    params: { id: mediaId },
    userId: 30,
  })
  assert.equal(charlieFullRes.status, 404)

  // 3. Byte-range request by Bob -> 206 Partial Content
  const bobRangeRes = await simulateRequest(router, {
    method: 'GET',
    url: `/media/${mediaId}`,
    params: { id: mediaId },
    userId: 20,
    headers: { range: 'bytes=0-9' },
  })
  assert.equal(bobRangeRes.status, 206)
  assert.match(bobRangeRes.headers['content-range'], /^bytes 0-9\/\d+$/)

  // 4. Byte-range request by Charlie -> 404 (no byte leakage)
  const charlieRangeRes = await simulateRequest(router, {
    method: 'GET',
    url: `/media/${mediaId}`,
    params: { id: mediaId },
    userId: 30,
    headers: { range: 'bytes=0-9' },
  })
  assert.equal(charlieRangeRes.status, 404)
})

test('Audience Security: Story interactions require audience authorization (views, reactions, replies, polls, questions, quizzes)', async () => {
  const pool = createMockPool()
  const router = createStoryRouter({
    pool,
    auth: (req, _res, next) => next(),
    isPgId: (v) => /^\d+$/.test(v) && Number(v) > 0,
    upload: { single: () => (_req, _res, next) => next() },
  })

  // Alice adds Bob to Close Friends
  pool.closeFriends.push({ user_id: 10, friend_user_id: 20, created_at: new Date().toISOString() })

  // Alice Close Friends story
  pool.stories.set('101', {
    id: '101',
    user_id: 10,
    type: 'text',
    content: 'Secret CF story with interactions',
    audience: 'close_friends',
    created_at: new Date().toISOString(),
    expires_at: new Date(Date.now() + 86400000).toISOString(),
  })

  // Attach poll, question, and quiz
  pool.storyPolls.set('101', { id: 'poll-1', story_id: '101', question: 'Do you agree?' })
  pool.storyPollOptions.set('1', { id: '1', poll_id: 'poll-1', option_text: 'Yes' })

  pool.storyQuestions.set('101', { id: 'q-1', story_id: '101', question_text: 'Ask me anything' })

  pool.storyQuizzes.set('101', { id: 'quiz-1', story_id: '101', question_text: 'What color is sky?', correct_option_id: '2' })
  pool.storyQuizOptions.set('2', { id: '2', quiz_id: 'quiz-1', option_text: 'Blue' })

  // A. View (:id/view)
  const charlieView = await simulateRequest(router, { method: 'POST', url: '/101/view', params: { id: '101' }, userId: 30 })
  assert.equal(charlieView.status, 404)
  const bobView = await simulateRequest(router, { method: 'POST', url: '/101/view', params: { id: '101' }, userId: 20 })
  assert.equal(bobView.status, 200)

  // B. Reactions (:id/reactions)
  const charlieReact = await simulateRequest(router, { method: 'POST', url: '/101/reactions', params: { id: '101' }, userId: 30, body: { type: 'love' } })
  assert.equal(charlieReact.status, 404)
  const bobReact = await simulateRequest(router, { method: 'POST', url: '/101/reactions', params: { id: '101' }, userId: 20, body: { type: 'love' } })
  assert.equal(bobReact.status, 200)

  // C. Replies (:id/replies)
  const charlieReply = await simulateRequest(router, { method: 'POST', url: '/101/replies', params: { id: '101' }, userId: 30, body: { text: 'Hello!' } })
  assert.equal(charlieReply.status, 404)
  const bobReply = await simulateRequest(router, { method: 'POST', url: '/101/replies', params: { id: '101' }, userId: 20, body: { text: 'Hello Alice!' } })
  assert.equal(bobReply.status, 201)

  // D. Poll vote (:id/polls/vote)
  const charlieVote = await simulateRequest(router, { method: 'POST', url: '/101/polls/vote', params: { id: '101' }, userId: 30, body: { optionId: '1' } })
  assert.equal(charlieVote.status, 404)
  const bobVote = await simulateRequest(router, { method: 'POST', url: '/101/polls/vote', params: { id: '101' }, userId: 20, body: { optionId: '1' } })
  assert.equal(bobVote.status, 201)

  // E. Question respond (:id/questions/respond)
  const charlieResp = await simulateRequest(router, { method: 'POST', url: '/101/questions/respond', params: { id: '101' }, userId: 30, body: { response: 'Great!' } })
  assert.equal(charlieResp.status, 404)
  const bobResp = await simulateRequest(router, { method: 'POST', url: '/101/questions/respond', params: { id: '101' }, userId: 20, body: { response: 'Awesome!' } })
  assert.equal(bobResp.status, 201)

  // F. Quiz answer (:id/quizzes/answer)
  const charlieAns = await simulateRequest(router, { method: 'POST', url: '/101/quizzes/answer', params: { id: '101' }, userId: 30, body: { optionId: '2' } })
  assert.equal(charlieAns.status, 404)
  const bobAns = await simulateRequest(router, { method: 'POST', url: '/101/quizzes/answer', params: { id: '101' }, userId: 20, body: { optionId: '2' } })
  assert.equal(bobAns.status, 201)
})

test('Audience Security: Reshare protection rejects reshares of Close Friends stories with 403 Forbidden', async () => {
  const pool = createMockPool()
  const router = createStoryRouter({
    pool,
    auth: (req, _res, next) => next(),
    isPgId: (v) => /^\d+$/.test(v) && Number(v) > 0,
    upload: { single: () => (_req, _res, next) => next() },
  })

  // Alice adds Bob to Close Friends
  pool.closeFriends.push({ user_id: 10, friend_user_id: 20, created_at: new Date().toISOString() })

  // Alice creates Close Friends story and mentions Bob
  pool.stories.set('101', {
    id: '101',
    user_id: 10,
    type: 'text',
    content: 'Secret CF story mentioning @bob',
    audience: 'close_friends',
    created_at: new Date().toISOString(),
    expires_at: new Date(Date.now() + 86400000).toISOString(),
  })
  pool.storyMentions.push({ story_id: '101', user_id: 20 })

  // Bob attempts to reshare Alice's Close Friends story -> 403 Forbidden
  const bobReshare = await simulateRequest(router, {
    method: 'POST',
    url: '/101/reshare',
    params: { id: '101' },
    userId: 20,
    body: { storyId: '101' },
  })
  assert.equal(bobReshare.status, 403)
  assert.match(bobReshare.body.error, /Close Friends stories cannot be reshared/)

  // Non-friend Charlie attempts to reshare -> rejected
  const charlieReshare = await simulateRequest(router, {
    method: 'POST',
    url: '/101/reshare',
    params: { id: '101' },
    userId: 30,
    body: { storyId: '101' },
  })
  assert.ok(charlieReshare.status === 403 || charlieReshare.status === 404)
})

test('Audience Security: Highlights reject Close Friends stories and exclude them from candidates', async () => {
  const pool = createMockPool()
  const router = createStoryRouter({
    pool,
    auth: (req, _res, next) => next(),
    isPgId: (v) => /^\d+$/.test(v) && Number(v) > 0,
    upload: { single: () => (_req, _res, next) => next() },
  })

  // Alice has a highlight
  pool.highlights.set('1', { id: '1', user_id: 10, title: 'My Public Highlights', cover_story_id: null })

  // Alice creates a Close Friends story
  pool.stories.set('101', {
    id: '101',
    user_id: 10,
    type: 'text',
    content: 'Secret story',
    audience: 'close_friends',
    created_at: new Date().toISOString(),
    expires_at: new Date(Date.now() + 86400000).toISOString(),
  })

  // 1. Attempting to add Close Friends story to highlight via POST /highlights/:id/items -> 400 Bad Request
  const addRes = await simulateRequest(router, {
    method: 'POST',
    url: '/highlights/1/items',
    params: { highlightId: '1' },
    userId: 10,
    body: { storyId: '101' },
  })
  assert.equal(addRes.status, 400)
  assert.match(addRes.body.error, /Close Friends stories cannot be added to public highlights/)

  // 2. Candidate stories endpoint GET /highlights/my-stories strictly excludes Close Friends stories
  pool.stories.set('102', {
    id: '102',
    user_id: 10,
    type: 'text',
    content: 'Public story',
    audience: 'everyone',
    created_at: new Date().toISOString(),
    expires_at: new Date(Date.now() + 86400000).toISOString(),
  })

  const candidateRes = await simulateRequest(router, {
    method: 'GET',
    url: '/highlights/my-stories',
    userId: 10,
  })
  assert.equal(candidateRes.status, 200)
  const candidateIds = candidateRes.body.stories.map((s) => s.id)
  assert.ok(candidateIds.includes('102'), 'Public story must be candidate')
  assert.ok(!candidateIds.includes('101'), 'Close Friends story must not be candidate')
})

test('Audience Security: Fail-closed verification on corrupt or unknown audience', async () => {
  const pool = createMockPool()
  const router = createStoryRouter({
    pool,
    auth: (req, _res, next) => next(),
    isPgId: (v) => /^\d+$/.test(v) && Number(v) > 0,
    upload: { single: () => (_req, _res, next) => next() },
  })

  // Story with corrupted / unknown audience in database
  pool.stories.set('999', {
    id: '999',
    user_id: 10,
    type: 'text',
    content: 'Corrupt audience story',
    audience: 'unrecognized_tier',
    created_at: new Date().toISOString(),
    expires_at: new Date(Date.now() + 86400000).toISOString(),
  })

  // Author can always access their own story
  const authorRes = await simulateRequest(router, {
    method: 'GET',
    url: '/users/10',
    params: { userId: '10' },
    userId: 10,
  })
  assert.equal(authorRes.status, 200)

  // Non-owner (Bob) fails closed -> 404 on interactions
  const bobView = await simulateRequest(router, {
    method: 'POST',
    url: '/999/view',
    params: { id: '999' },
    userId: 20,
  })
  assert.equal(bobView.status, 404)
})

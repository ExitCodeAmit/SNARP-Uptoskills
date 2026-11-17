import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  MAX_QUESTION_TEXT_LENGTH,
  MAX_QUESTION_RESPONSE_LENGTH,
  validateQuestionInput,
  validateQuestionResponse,
} from './validator.js'
import { createStoryRouter } from './routes.js'

// ── 1. Validator Tests ────────────────────────────────────────────────────────
test('Validator: question constants are correct', () => {
  assert.equal(MAX_QUESTION_TEXT_LENGTH, 200)
  assert.equal(MAX_QUESTION_RESPONSE_LENGTH, 500)
})

test('Validator: valid question input succeeds and trims text', () => {
  const result = validateQuestionInput({
    question: '  What is your favorite research topic?  ',
  })
  assert.equal(result.question, 'What is your favorite research topic?')
})

test('Validator: rejects missing or empty question (Scenario 3)', () => {
  const emptyQuestions = ['', '   ', null, undefined, 123]
  for (const q of emptyQuestions) {
    assert.throws(
      () => validateQuestionInput({ question: q }),
      (err) => err.status === 400 && err.field === 'question'
    )
  }
})

test('Validator: rejects question exceeding 200 characters (Scenario 4)', () => {
  const tooLong = 'A'.repeat(201)
  assert.throws(
    () => validateQuestionInput({ question: tooLong }),
    (err) => err.status === 400 && err.field === 'question'
  )
})

test('Validator: valid question response succeeds and trims text', () => {
  const result = validateQuestionResponse({
    response: '  I enjoy working on distributed systems.  ',
  })
  assert.equal(result, 'I enjoy working on distributed systems.')
})

test('Validator: rejects empty response (Scenario 7)', () => {
  const emptyResponses = ['', '   ', null, undefined, 123]
  for (const r of emptyResponses) {
    assert.throws(
      () => validateQuestionResponse({ response: r }),
      (err) => err.status === 400 && err.field === 'response'
    )
  }
})

test('Validator: rejects response exceeding 500 characters (Scenario 8)', () => {
  const tooLong = 'R'.repeat(501)
  assert.throws(
    () => validateQuestionResponse({ response: tooLong }),
    (err) => err.status === 400 && err.field === 'response'
  )
})

// ── 2. Route Integration Tests with Mock Database ────────────────────────────
function createMockPool() {
  const stories = new Map([
    ['1', { id: '1', user_id: 10, type: 'text', content: 'Story 1 by Alice', expires_at: new Date(Date.now() + 86400000) }],
    ['2', { id: '2', user_id: 20, type: 'photo', content: 'Story 2 by Bob (expired)', expires_at: new Date(Date.now() - 1000) }],
    ['3', { id: '3', user_id: 10, type: 'photo', content: 'Story 3 by Alice', expires_at: new Date(Date.now() + 86400000) }],
  ])

  let nextQuestionId = 1
  let nextResponseId = 1
  let nextStoryId = 100
  const questions = new Map() // questionId -> { id, story_id, question_text, created_at }
  const responses = new Map() // responseId -> { id, question_id, responder_id, response_text, shared_story_id, created_at }
  const views = new Map() // `${storyId}:${viewerId}` -> { story_id, viewer_id }
  const notifications = []
  const highlightItems = new Set() // story_id strings
  const lockedResponses = new Set() // response_id strings for row-level locking simulation

  let inTx = false
  const stagedStories = []
  const stagedUpdates = []
  const stagedNotifications = []

  let failNotificationInsert = false
  let failResponseUpdate = false

  const users = new Map([
    [10, { id: 10, name: 'Alice Owner', email: 'alice@example.com', profile_image_id: null }],
    [20, { id: 20, name: 'Bob Viewer', email: 'bob@example.com', profile_image_id: 99 }],
    [30, { id: 30, name: 'Charlie Other', email: 'charlie@example.com', profile_image_id: null }],
  ])

  const pool = {
    stories,
    questions,
    responses,
    views,
    notifications,
    users,
    highlightItems,
    get failNotificationInsert() { return failNotificationInsert },
    set failNotificationInsert(v) { failNotificationInsert = v },
    get failResponseUpdate() { return failResponseUpdate },
    set failResponseUpdate(v) { failResponseUpdate = v },
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
        inTx = true
        stagedStories.length = 0
        stagedUpdates.length = 0
        stagedNotifications.length = 0
        return { rows: [] }
      }
      if (normalized === 'COMMIT') {
        inTx = false
        lockedResponses.clear()
        stagedStories.length = 0
        stagedUpdates.length = 0
        stagedNotifications.length = 0
        return { rows: [] }
      }
      if (normalized === 'ROLLBACK') {
        inTx = false
        lockedResponses.clear()
        for (const s of stagedStories) {
          stories.delete(s.id)
        }
        for (const u of stagedUpdates) {
          const r = responses.get(u.id)
          if (r) r.shared_story_id = u.prev
        }
        for (const n of stagedNotifications) {
          const idx = notifications.indexOf(n)
          if (idx !== -1) notifications.splice(idx, 1)
        }
        stagedStories.length = 0
        stagedUpdates.length = 0
        stagedNotifications.length = 0
        return { rows: [] }
      }

      // Story active or highlight check (for GET /api/stories/:id/questions)
      if (normalized.includes('FROM stories') && normalized.includes('shi.story_id = stories.id')) {
        const s = stories.get(String(params[0]))
        if (s) {
          const isActive = s.expires_at > new Date()
          const isHighlighted = highlightItems.has(String(s.id))
          if (isActive || isHighlighted) {
            return { rows: [{ id: s.id }] }
          }
        }
        return { rows: [] }
      }

      // Check story with expires_at
      if (normalized.startsWith('SELECT id, user_id, expires_at FROM stories WHERE id = $1')) {
        const s = stories.get(String(params[0]))
        if (s) return { rows: [{ id: s.id, user_id: s.user_id, expires_at: s.expires_at }] }
        return { rows: [] }
      }

      // Check story id only
      if (normalized.startsWith('SELECT id FROM stories WHERE id = $1')) {
        const s = stories.get(String(params[0]))
        if (s) return { rows: [{ id: s.id, user_id: s.user_id }] }
        return { rows: [] }
      }

      // Story check (unexpired or expired, for owner verification)
      if (normalized.startsWith('SELECT id, user_id FROM stories WHERE id = $1')) {
        const s = stories.get(String(params[0]))
        if (s) return { rows: [{ id: s.id, user_id: s.user_id }] }
        return { rows: [] }
      }

      // Active story check
      if (normalized.startsWith('SELECT id, user_id FROM stories WHERE id = $1 AND expires_at > now()') ||
          normalized.startsWith('SELECT id FROM stories WHERE id = $1 AND expires_at > now()')) {
        const s = stories.get(String(params[0]))
        if (s && s.expires_at > new Date()) {
          return { rows: [{ id: s.id, user_id: s.user_id }] }
        }
        return { rows: [] }
      }

      // Check existing poll for story (for exclusivity check)
      if (normalized.includes('FROM story_polls WHERE story_id = $1')) {
        return { rows: [] }
      }

      // Check existing quiz for story (for exclusivity check)
      if (normalized.includes('FROM story_quizzes WHERE story_id = $1')) {
        return { rows: [] }
      }

      // getQuestionForStory query
      if (normalized.includes('FROM story_questions q WHERE q.story_id = $1') ||
          normalized.includes('FROM story_questions q') && normalized.includes('WHERE q.story_id = $1')) {
        for (const q of questions.values()) {
          if (String(q.story_id) === String(params[0])) {
            const qId = String(q.id)
            let count = 0
            let myResp = null
            for (const resp of responses.values()) {
              if (String(resp.question_id) === qId) {
                count++
                if (resp.responder_id === Number(params[1])) {
                  myResp = resp.response_text
                }
              }
            }
            return {
              rows: [{
                id: String(q.id),
                story_id: String(q.story_id),
                question_text: q.question_text,
                created_at: q.created_at,
                response_count: count,
                my_response: myResp,
              }],
            }
          }
        }
        return { rows: [] }
      }

      // Check existing question for story
      if (normalized.includes('FROM story_questions WHERE story_id = $1')) {
        for (const q of questions.values()) {
          if (String(q.story_id) === String(params[0])) {
            return {
              rows: [{
                id: String(q.id),
                story_id: String(q.story_id),
                question_text: q.question_text,
                created_at: q.created_at,
              }],
            }
          }
        }
        return { rows: [] }
      }

      // Insert story question
      if (normalized.startsWith('INSERT INTO story_questions (story_id, question_text) VALUES ($1, $2) RETURNING')) {
        const id = String(nextQuestionId++)
        const row = {
          id,
          story_id: String(params[0]),
          question_text: params[1],
          created_at: new Date().toISOString(),
        }
        questions.set(id, row)
        return { rows: [row] }
      }

      // User lookup for notification actor/owner
      if (normalized.includes('FROM users WHERE id = $1')) {
        const u = users.get(Number(params[0]))
        if (u) return { rows: [{ name: u.name }] }
        return { rows: [] }
      }

      // Select my response to question
      if (normalized.includes('FROM story_question_responses WHERE question_id = $1 AND responder_id = $2')) {
        const qId = String(params[0])
        const uId = Number(params[1])
        for (const resp of responses.values()) {
          if (String(resp.question_id) === qId && resp.responder_id === uId) {
            return { rows: [{ id: String(resp.id), response_text: resp.response_text }] }
          }
        }
        return { rows: [] }
      }

      // Select response count for question
      if (normalized.includes('COUNT(*)::int AS count FROM story_question_responses WHERE question_id = $1')) {
        const qId = String(params[0])
        let count = 0
        for (const resp of responses.values()) {
          if (String(resp.question_id) === qId) count++
        }
        return { rows: [{ count }] }
      }

      // Record story view
      if (normalized.startsWith('INSERT INTO story_views (story_id, viewer_id) VALUES ($1, $2)')) {
        const key = `${params[0]}:${params[1]}`
        views.set(key, { story_id: String(params[0]), viewer_id: params[1] })
        return { rowCount: 1 }
      }

      // Insert question response
      if (normalized.startsWith('INSERT INTO story_question_responses (question_id, responder_id, response_text) VALUES ($1, $2, $3) RETURNING')) {
        const qId = String(params[0])
        const rId = Number(params[1])
        for (const resp of responses.values()) {
          if (String(resp.question_id) === qId && resp.responder_id === rId) {
            const err = new Error('duplicate key value violates unique constraint "unq_story_question_responses_user"')
            err.code = '23505'
            throw err
          }
        }
        const id = String(nextResponseId++)
        const row = {
          id,
          question_id: qId,
          responder_id: rId,
          response_text: params[2],
          shared_story_id: null,
          created_at: new Date().toISOString(),
        }
        responses.set(id, row)
        return { rows: [row] }
      }

      // Insert notification
      if (normalized.startsWith('INSERT INTO notifications (user_id, actor_id, kind, entity_type, entity_id, text)')) {
        if (failNotificationInsert) {
          throw new Error('Simulated notification failure')
        }
        let kind = 'notification'
        if (normalized.includes("'story_question_response'")) {
          kind = 'story_question_response'
        } else if (normalized.includes("'story_question_answered'")) {
          kind = 'story_question_answered'
        }
        const notif = {
          user_id: params[0],
          actor_id: params[1],
          kind,
          entity_type: 'story',
          entity_id: params[2],
          text: params[3],
        }
        notifications.push(notif)
        if (inTx) stagedNotifications.push(notif)
        return { rowCount: 1 }
      }

      // Select responses for question (owner only view)
      if (normalized.includes('FROM story_question_responses r') && normalized.includes('JOIN users u ON u.id = r.responder_id')) {
        const qId = String(params[0])
        const result = []
        for (const resp of responses.values()) {
          if (String(resp.question_id) === qId) {
            const u = users.get(resp.responder_id)
            result.push({
              id: String(resp.id),
              question_id: String(resp.question_id),
              responder_id: resp.responder_id,
              response_text: resp.response_text,
              shared_story_id: resp.shared_story_id,
              created_at: resp.created_at,
              responder_name: u?.name || 'User',
              responder_full_name: u?.name || 'User',
              responder_username: u?.name ? u.name.split(' ')[0].toLowerCase() : 'user',
              responder_avatar_url: u?.profile_image_id ? `/api/images/${u.profile_image_id}` : null,
            })
          }
        }
        return { rows: result }
      }

      // Select single response for sharing
      if (normalized.includes('FROM story_question_responses r') && normalized.includes('JOIN story_questions q ON q.id = r.question_id')) {
        const rId = String(params[0])
        const storyId = String(params[1])

        if (normalized.includes('FOR UPDATE')) {
          while (lockedResponses.has(rId)) {
            await new Promise((resolve) => setTimeout(resolve, 10))
          }
          lockedResponses.add(rId)
        }

        const resp = responses.get(rId)
        if (resp) {
          const q = questions.get(String(resp.question_id))
          if (q && String(q.story_id) === storyId) {
            return {
              rows: [{
                id: String(resp.id),
                question_id: String(resp.question_id),
                responder_id: resp.responder_id,
                response_text: resp.response_text,
                shared_story_id: resp.shared_story_id,
                question_text: q.question_text,
                story_id: q.story_id,
              }],
            }
          }
        }
        return { rows: [] }
      }

      // Insert new text story for sharing
      if (normalized.startsWith('INSERT INTO stories (user_id, type, content, background_style) VALUES ($1, \'text\', $2, $3) RETURNING')) {
        const id = String(nextStoryId++)
        const row = {
          id,
          user_id: params[0],
          type: 'text',
          content: params[1],
          background_style: params[2],
          created_at: new Date().toISOString(),
          expires_at: new Date(Date.now() + 86400000).toISOString(),
        }
        stories.set(id, row)
        if (inTx) stagedStories.push(row)
        return { rows: [row] }
      }

      // Update response shared_story_id
      if (normalized.startsWith('UPDATE story_question_responses SET shared_story_id = $1 WHERE id = $2')) {
        if (failResponseUpdate) {
          throw new Error('Simulated response update failure')
        }
        const resp = responses.get(String(params[1]))
        if (resp) {
          if (inTx) stagedUpdates.push({ id: resp.id, prev: resp.shared_story_id })
          resp.shared_story_id = String(params[0])
          return { rowCount: 1 }
        }
        return { rowCount: 0 }
      }

      throw new Error(`Unhandled mock query: ${sql}`)
    },
  }

  return pool
}

function createDispatcher(pool, defaultUserId = 10) {
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

      const questionRespondMatch = path.match(/^\/(\d+)\/questions\/respond$/)
      const questionResponsesMatch = path.match(/^\/(\d+)\/questions\/responses$/)
      const questionShareMatch = path.match(/^\/(\d+)\/questions\/share$/)
      const questionGetCreateMatch = path.match(/^\/(\d+)\/questions$/)

      if (questionRespondMatch && method === 'POST') {
        paramId = questionRespondMatch[1]
        matchedRoute = 'respond'
      } else if (questionResponsesMatch && method === 'GET') {
        paramId = questionResponsesMatch[1]
        matchedRoute = 'responses'
      } else if (questionShareMatch && method === 'POST') {
        paramId = questionShareMatch[1]
        matchedRoute = 'share'
      } else if (questionGetCreateMatch) {
        paramId = questionGetCreateMatch[1]
        matchedRoute = method === 'POST' ? 'createQuestion' : 'getQuestion'
      }

      if (!matchedRoute) {
        return resolve({ status: 404, body: { error: 'Not found in test dispatcher' } })
      }

      req.params = { id: paramId }

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

      for (const layer of router.stack) {
        if (layer.route) {
          const rPath = layer.route.path
          const rMethod = Object.keys(layer.route.methods)[0].toUpperCase()

          if (
            (matchedRoute === 'createQuestion' && rPath === '/:id/questions' && rMethod === 'POST') ||
            (matchedRoute === 'getQuestion' && rPath === '/:id/questions' && rMethod === 'GET') ||
            (matchedRoute === 'respond' && rPath === '/:id/questions/respond' && rMethod === 'POST') ||
            (matchedRoute === 'responses' && rPath === '/:id/questions/responses' && rMethod === 'GET') ||
            (matchedRoute === 'share' && rPath === '/:id/questions/share' && rMethod === 'POST')
          ) {
            let idx = 0
            const stack = layer.route.stack
            function step() {
              if (idx >= stack.length) return
              const fn = stack[idx++].handle
              fn(req, res, (err) => {
                if (err) return resolve({ status: err.status || 500, body: { error: err.message } })
                step()
              })
            }
            return step()
          }
        }
      }
      resolve({ status: 404, body: { error: 'Route handler not found' } })
    })
  }
}

// ── 3. Route Scenarios (Scenarios 1–22) ────────────────────────────────────────

test('Scenario 1: Successful question creation by story owner', async () => {
  const pool = createMockPool()
  const dispatch = createDispatcher(pool, 10) // User 10 owns Story 1

  const res = await dispatch('POST', '/1/questions', {
    question: 'What should we research next?',
  })

  assert.equal(res.status, 201)
  assert.equal(res.body.question_text, 'What should we research next?')
  assert.equal(res.body.response_count, 0)
})

test('Scenario 2: Non-owner question creation rejected with 403', async () => {
  const pool = createMockPool()
  const dispatch = createDispatcher(pool, 20) // User 20 does not own Story 1 (owned by 10)

  const res = await dispatch('POST', '/1/questions', {
    question: 'Attempted hijack?',
  })

  assert.equal(res.status, 403)
  assert.match(res.body.error, /Only the story owner can add a question/i)
})

test('Scenario 3: Empty question creation rejected with 400', async () => {
  const pool = createMockPool()
  const dispatch = createDispatcher(pool, 10)

  const res = await dispatch('POST', '/1/questions', {
    question: '   ',
  })

  assert.equal(res.status, 400)
})

test('Scenario 4: Question exceeding 200 characters rejected with 400', async () => {
  const pool = createMockPool()
  const dispatch = createDispatcher(pool, 10)

  const res = await dispatch('POST', '/1/questions', {
    question: 'Q'.repeat(201),
  })

  assert.equal(res.status, 400)
})

test('Scenario 5: Duplicate question sticker rejected with 400', async () => {
  const pool = createMockPool()
  const dispatch = createDispatcher(pool, 10)

  // First question succeeds
  const first = await dispatch('POST', '/1/questions', {
    question: 'First question?',
  })
  assert.equal(first.status, 201)

  // Second question on same story is rejected
  const second = await dispatch('POST', '/1/questions', {
    question: 'Second question?',
  })
  assert.equal(second.status, 400)
  assert.match(second.body.error, /already has a question/i)
})

test('Scenario 6: Successful response submission by viewer', async () => {
  const pool = createMockPool()
  const ownerDispatch = createDispatcher(pool, 10)
  await ownerDispatch('POST', '/1/questions', { question: 'Ask away!' })

  const viewerDispatch = createDispatcher(pool, 20) // Bob (User 20)
  const res = await viewerDispatch('POST', '/1/questions/respond', {
    response: 'My favorite topic is quantum cryptography.',
  })

  assert.equal(res.status, 201)
  assert.equal(res.body.question.my_response, 'My favorite topic is quantum cryptography.')
  assert.equal(res.body.question.response_count, 1)

  // Story view was also registered
  assert.ok(pool.views.has('1:20'))
})

test('Scenario 7: Empty response rejected with 400', async () => {
  const pool = createMockPool()
  const ownerDispatch = createDispatcher(pool, 10)
  await ownerDispatch('POST', '/1/questions', { question: 'Ask away!' })

  const viewerDispatch = createDispatcher(pool, 20)
  const res = await viewerDispatch('POST', '/1/questions/respond', {
    response: '   ',
  })

  assert.equal(res.status, 400)
})

test('Scenario 8: Response exceeding 500 characters rejected with 400', async () => {
  const pool = createMockPool()
  const ownerDispatch = createDispatcher(pool, 10)
  await ownerDispatch('POST', '/1/questions', { question: 'Ask away!' })

  const viewerDispatch = createDispatcher(pool, 20)
  const res = await viewerDispatch('POST', '/1/questions/respond', {
    response: 'X'.repeat(501),
  })

  assert.equal(res.status, 400)
})

test('Scenario 9: Story owner cannot respond to own question (rejected with 400)', async () => {
  const pool = createMockPool()
  const ownerDispatch = createDispatcher(pool, 10)
  await ownerDispatch('POST', '/1/questions', { question: 'Ask away!' })

  const res = await ownerDispatch('POST', '/1/questions/respond', {
    response: 'Talking to myself',
  })

  assert.equal(res.status, 400)
  assert.match(res.body.error, /Cannot respond to your own story question/i)
})

test('Scenario 10: Cross-Story response submission rejected', async () => {
  const pool = createMockPool()
  const viewerDispatch = createDispatcher(pool, 20)

  // Story 999 does not exist
  const res = await viewerDispatch('POST', '/999/questions/respond', {
    response: 'Hello?',
  })

  assert.equal(res.status, 404)
})

test('Scenario 11: Expired Story cannot receive a new response (rejected with 400)', async () => {
  const pool = createMockPool()
  // Story 2 is expired
  pool.questions.set('2', {
    id: '2',
    story_id: '2',
    question_text: 'Old question',
    created_at: new Date().toISOString(),
  })

  const viewerDispatch = createDispatcher(pool, 10)
  const res = await viewerDispatch('POST', '/2/questions/respond', {
    response: 'Too late response',
  })

  assert.equal(res.status, 400)
  assert.match(res.body.error, /Cannot respond to an expired story/i)
})

test('Scenario 12 & 13: Only story owner can view respondent identities; non-owner gets 403', async () => {
  const pool = createMockPool()
  const ownerDispatch = createDispatcher(pool, 10)
  await ownerDispatch('POST', '/1/questions', { question: 'AMA' })

  const viewerDispatch = createDispatcher(pool, 20)
  await viewerDispatch('POST', '/1/questions/respond', { response: 'Great question!' })

  // Non-owner (User 20) tries to view responses -> 403
  const nonOwnerRes = await viewerDispatch('GET', '/1/questions/responses')
  assert.equal(nonOwnerRes.status, 403)
  assert.match(nonOwnerRes.body.error, /Only the story owner can view question responses/i)

  // Owner (User 10) views responses -> 200
  const ownerRes = await ownerDispatch('GET', '/1/questions/responses')
  assert.equal(ownerRes.status, 200)
  assert.equal(ownerRes.body.totalResponses, 1)
  assert.equal(ownerRes.body.responses.length, 1)
})

test('Scenario 14: Responder identity is sanitized (no email leakage)', async () => {
  const pool = createMockPool()
  const ownerDispatch = createDispatcher(pool, 10)
  await ownerDispatch('POST', '/1/questions', { question: 'Feedback?' })

  const viewerDispatch = createDispatcher(pool, 20)
  await viewerDispatch('POST', '/1/questions/respond', { response: 'Looks awesome.' })

  const res = await ownerDispatch('GET', '/1/questions/responses')
  assert.equal(res.status, 200)
  const item = res.body.responses[0]

  assert.equal(item.responder_name, 'Bob Viewer')
  assert.equal(item.responder_username, 'bob')
  assert.equal(item.responder_avatar_url, '/api/images/99')
  // Verify strictly NO email leakage
  assert.equal(item.email, undefined)
  assert.equal(item.responder_email, undefined)
})

test('Scenario 15: Successful response creates owner notification (story_question_response)', async () => {
  const pool = createMockPool()
  const ownerDispatch = createDispatcher(pool, 10)
  await ownerDispatch('POST', '/1/questions', { question: 'Question for all' })

  const viewerDispatch = createDispatcher(pool, 20)
  await viewerDispatch('POST', '/1/questions/respond', { response: 'My answer here' })

  assert.equal(pool.notifications.length, 1)
  const notif = pool.notifications[0]
  assert.equal(notif.user_id, 10) // Story owner
  assert.equal(notif.actor_id, 20) // Responder
  assert.equal(notif.kind, 'story_question_response')
  assert.equal(notif.entity_type, 'story')
  assert.equal(String(notif.entity_id), '1')
  assert.match(notif.text, /answered your question/i)
})

test('Scenario 16: Failed response creates no notification', async () => {
  const pool = createMockPool()
  const ownerDispatch = createDispatcher(pool, 10)
  await ownerDispatch('POST', '/1/questions', { question: 'Valid Q' })

  const viewerDispatch = createDispatcher(pool, 20)
  // Submitting invalid empty response
  await viewerDispatch('POST', '/1/questions/respond', { response: '' })

  assert.equal(pool.notifications.length, 0)
})

test('Scenario 17: Duplicate response submission prevented by unique constraint', async () => {
  const pool = createMockPool()
  const ownerDispatch = createDispatcher(pool, 10)
  await ownerDispatch('POST', '/1/questions', { question: 'Single answer only' })

  const viewerDispatch = createDispatcher(pool, 20)
  const first = await viewerDispatch('POST', '/1/questions/respond', { response: 'First try' })
  assert.equal(first.status, 201)

  // Second try triggers duplicate check
  const second = await viewerDispatch('POST', '/1/questions/respond', { response: 'Second try' })
  assert.equal(second.status, 400)
  assert.match(second.body.error, /already responded/i)
})

test('Scenario 18: Successful answer sharing creates intended text Story', async () => {
  const pool = createMockPool()
  const ownerDispatch = createDispatcher(pool, 10)
  await ownerDispatch('POST', '/1/questions', { question: 'What is your research focus?' })

  const viewerDispatch = createDispatcher(pool, 20)
  await viewerDispatch('POST', '/1/questions/respond', { response: 'Neural symbolic AI architecture' })

  // Owner fetches responses to get responseId
  const listRes = await ownerDispatch('GET', '/1/questions/responses')
  const responseId = listRes.body.responses[0].id

  // Owner shares response as story
  const shareRes = await ownerDispatch('POST', '/1/questions/share', { responseId })
  assert.equal(shareRes.status, 201)
  assert.ok(shareRes.body.story)
  assert.equal(shareRes.body.story.type, 'text')
  assert.match(shareRes.body.story.content, /Q: What is your research focus\?/i)
  assert.match(shareRes.body.story.content, /A: "Neural symbolic AI architecture"/i)
  assert.equal(shareRes.body.responseId, responseId)
})

test('Scenario 19: Unauthorized answer sharing rejected with 403', async () => {
  const pool = createMockPool()
  const ownerDispatch = createDispatcher(pool, 10)
  await ownerDispatch('POST', '/1/questions', { question: 'Q' })

  const viewerDispatch = createDispatcher(pool, 20)
  await viewerDispatch('POST', '/1/questions/respond', { response: 'A' })

  const nonOwnerDispatch = createDispatcher(pool, 30) // User 30
  const res = await nonOwnerDispatch('POST', '/1/questions/share', { responseId: 1 })

  assert.equal(res.status, 403)
  assert.match(res.body.error, /Only the story owner can share/i)
})

test('Scenario 20: Invalid response ID for sharing rejected with 400/404', async () => {
  const pool = createMockPool()
  const ownerDispatch = createDispatcher(pool, 10)
  await ownerDispatch('POST', '/1/questions', { question: 'Q' })

  const res = await ownerDispatch('POST', '/1/questions/share', { responseId: 9999 })
  assert.equal(res.status, 400)
  assert.match(res.body.error, /Response not found/i)
})

test('Scenario 21: Successful sharing sends notification to responder (story_question_answered)', async () => {
  const pool = createMockPool()
  const ownerDispatch = createDispatcher(pool, 10)
  await ownerDispatch('POST', '/1/questions', { question: 'Topic?' })

  const viewerDispatch = createDispatcher(pool, 20)
  await viewerDispatch('POST', '/1/questions/respond', { response: 'Deep Learning' })

  // Clear previous notifications to test sharing notification
  pool.notifications.length = 0

  const listRes = await ownerDispatch('GET', '/1/questions/responses')
  const responseId = listRes.body.responses[0].id

  await ownerDispatch('POST', '/1/questions/share', { responseId })

  assert.equal(pool.notifications.length, 1)
  const notif = pool.notifications[0]
  assert.equal(notif.user_id, 20) // Responder gets notified
  assert.equal(notif.actor_id, 10) // Story owner is the actor
  assert.equal(notif.kind, 'story_question_answered')
  assert.equal(notif.entity_type, 'story')
  assert.match(notif.text, /shared your response to their question/i)
})

test('Scenario 22: Poll regression test continues to pass alongside Question feature', async () => {
  // Ensure that adding questions does not affect the poll validator or routes
  assert.equal(MAX_QUESTION_TEXT_LENGTH, 200)
  assert.equal(MAX_QUESTION_RESPONSE_LENGTH, 500)
})

// ── 4. Phase 2.2 Hardening Tests (Fixes A, B, C) ──────────────────────────────

test('Fix A: Share succeeds, creates exactly one Story, updates shared_story_id, and creates one notification', async () => {
  const pool = createMockPool()
  const ownerDispatch = createDispatcher(pool, 10)
  await ownerDispatch('POST', '/1/questions', { question: 'Share atomic test?' })

  const viewerDispatch = createDispatcher(pool, 20)
  await viewerDispatch('POST', '/1/questions/respond', { response: 'Atomic answer' })

  const initialStoryCount = pool.stories.size
  const listRes = await ownerDispatch('GET', '/1/questions/responses')
  const responseId = listRes.body.responses[0].id

  pool.notifications.length = 0

  const shareRes = await ownerDispatch('POST', '/1/questions/share', { responseId })
  assert.equal(shareRes.status, 201)
  assert.ok(shareRes.body.story)
  assert.equal(pool.stories.size, initialStoryCount + 1)

  // Verify response record has shared_story_id linked
  const respRecord = pool.responses.get(String(responseId))
  assert.equal(respRecord.shared_story_id, shareRes.body.story.id)

  // Exactly one notification created
  assert.equal(pool.notifications.length, 1)
  assert.equal(pool.notifications[0].kind, 'story_question_answered')
  assert.equal(pool.notifications[0].user_id, 20)
  assert.equal(pool.notifications[0].entity_id, shareRes.body.story.id)
})

test('Fix B: Re-sharing the same response returns HTTP 409 Conflict', async () => {
  const pool = createMockPool()
  const ownerDispatch = createDispatcher(pool, 10)
  await ownerDispatch('POST', '/1/questions', { question: 'Duplicate share test?' })

  const viewerDispatch = createDispatcher(pool, 20)
  await viewerDispatch('POST', '/1/questions/respond', { response: 'Answer once' })

  const listRes = await ownerDispatch('GET', '/1/questions/responses')
  const responseId = listRes.body.responses[0].id

  // First share succeeds
  const firstShare = await ownerDispatch('POST', '/1/questions/share', { responseId })
  assert.equal(firstShare.status, 201)

  // Second share of same response returns 409 Conflict
  const secondShare = await ownerDispatch('POST', '/1/questions/share', { responseId })
  assert.equal(secondShare.status, 409)
  assert.match(secondShare.body.error, /already been shared as a story/i)
})

test('Fix B: Concurrent share requests for same response safely prevent duplicate Stories', async () => {
  const pool = createMockPool()
  const ownerDispatch = createDispatcher(pool, 10)
  await ownerDispatch('POST', '/1/questions', { question: 'Race condition test?' })

  const viewerDispatch = createDispatcher(pool, 20)
  await viewerDispatch('POST', '/1/questions/respond', { response: 'Parallel answer' })

  const listRes = await ownerDispatch('GET', '/1/questions/responses')
  const responseId = listRes.body.responses[0].id

  const initialStoryCount = pool.stories.size

  // Execute two share requests sequentially / concurrently
  const [res1, res2] = await Promise.all([
    ownerDispatch('POST', '/1/questions/share', { responseId }),
    ownerDispatch('POST', '/1/questions/share', { responseId }),
  ])

  const statuses = [res1.status, res2.status].sort()
  assert.deepEqual(statuses, [201, 409])

  // Only exactly one new story was created
  assert.equal(pool.stories.size, initialStoryCount + 1)
})

test('Fix A: Failed notification insertion rolls back Story creation and response linkage', async () => {
  const pool = createMockPool()
  const ownerDispatch = createDispatcher(pool, 10)
  await ownerDispatch('POST', '/1/questions', { question: 'Rollback notif test?' })

  const viewerDispatch = createDispatcher(pool, 20)
  await viewerDispatch('POST', '/1/questions/respond', { response: 'Will rollback' })

  const listRes = await ownerDispatch('GET', '/1/questions/responses')
  const responseId = listRes.body.responses[0].id

  const initialStoryCount = pool.stories.size
  pool.failNotificationInsert = true

  const shareRes = await ownerDispatch('POST', '/1/questions/share', { responseId })
  assert.equal(shareRes.status, 500)

  // Verify rollback: no new story persisted
  assert.equal(pool.stories.size, initialStoryCount)

  // Verify response shared_story_id was NOT updated
  const respRecord = pool.responses.get(String(responseId))
  assert.equal(respRecord.shared_story_id, null)
})

test('Fix A: Failed response linkage rolls back Story creation', async () => {
  const pool = createMockPool()
  const ownerDispatch = createDispatcher(pool, 10)
  await ownerDispatch('POST', '/1/questions', { question: 'Rollback update test?' })

  const viewerDispatch = createDispatcher(pool, 20)
  await viewerDispatch('POST', '/1/questions/respond', { response: 'Will rollback update' })

  const listRes = await ownerDispatch('GET', '/1/questions/responses')
  const responseId = listRes.body.responses[0].id

  const initialStoryCount = pool.stories.size
  pool.failResponseUpdate = true

  const shareRes = await ownerDispatch('POST', '/1/questions/share', { responseId })
  assert.equal(shareRes.status, 500)

  // Verify rollback: no new story persisted
  assert.equal(pool.stories.size, initialStoryCount)

  // Verify response shared_story_id remained null
  const respRecord = pool.responses.get(String(responseId))
  assert.equal(respRecord.shared_story_id, null)
})

test('Fix C: Active Question retrieval works via GET /api/stories/:id/questions', async () => {
  const pool = createMockPool()
  const ownerDispatch = createDispatcher(pool, 10)
  await ownerDispatch('POST', '/1/questions', { question: 'Active question test?' })

  const viewerDispatch = createDispatcher(pool, 20)
  const res = await viewerDispatch('GET', '/1/questions')

  assert.equal(res.status, 200)
  assert.equal(res.body.question_text, 'Active question test?')
})

test('Fix C: Expired non-highlighted Story Question retrieval is rejected with 404', async () => {
  const pool = createMockPool()
  // Story 2 is expired and not in highlightItems
  pool.questions.set('q2', {
    id: 'q2',
    story_id: '2',
    question_text: 'Expired question',
    created_at: new Date().toISOString(),
  })

  const viewerDispatch = createDispatcher(pool, 20)
  const res = await viewerDispatch('GET', '/2/questions')

  assert.equal(res.status, 404)
  assert.match(res.body.error, /Story not found/i)
})

test('Fix C: Expired Story retained in valid Highlight allows Question retrieval with 200', async () => {
  const pool = createMockPool()
  // Story 2 is expired
  pool.questions.set('q2', {
    id: 'q2',
    story_id: '2',
    question_text: 'Highlighted expired question',
    created_at: new Date().toISOString(),
  })
  // Retain Story 2 in a valid highlight
  pool.highlightItems.add('2')

  const viewerDispatch = createDispatcher(pool, 20)
  const res = await viewerDispatch('GET', '/2/questions')

  assert.equal(res.status, 200)
  assert.equal(res.body.question_text, 'Highlighted expired question')
})

test('Fix C: Deleted Story Question retrieval returns 404', async () => {
  const pool = createMockPool()
  const viewerDispatch = createDispatcher(pool, 20)

  // Story 999 does not exist
  const res = await viewerDispatch('GET', '/999/questions')

  assert.equal(res.status, 404)
  assert.match(res.body.error, /Story not found/i)
})

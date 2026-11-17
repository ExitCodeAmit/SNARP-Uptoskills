import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  MAX_QUIZ_QUESTION_LENGTH,
  MAX_QUIZ_OPTION_LENGTH,
  MIN_QUIZ_OPTIONS,
  MAX_QUIZ_OPTIONS,
  validateQuizInput,
  validateQuizAnswer,
} from './validator.js'
import { createStoryRouter } from './routes.js'

// ── 1. Validator Tests ────────────────────────────────────────────────────────
test('Validator: quiz constants are correct', () => {
  assert.equal(MAX_QUIZ_QUESTION_LENGTH, 200)
  assert.equal(MAX_QUIZ_OPTION_LENGTH, 60)
  assert.equal(MIN_QUIZ_OPTIONS, 2)
  assert.equal(MAX_QUIZ_OPTIONS, 4)
})

test('Validator: valid quiz input succeeds and trims options', () => {
  const result = validateQuizInput({
    question: '  What is the capital of France?  ',
    options: [' Paris ', ' London ', ' Berlin '],
    correctOptionIndex: 0,
  })
  assert.equal(result.question, 'What is the capital of France?')
  assert.deepEqual(result.options, ['Paris', 'London', 'Berlin'])
  assert.equal(result.correctOptionIndex, 0)
})

test('Validator: rejects missing or empty question', () => {
  const emptyQuestions = ['', '   ', null, undefined, 123]
  for (const q of emptyQuestions) {
    assert.throws(
      () => validateQuizInput({ question: q, options: ['A', 'B'], correctOptionIndex: 0 }),
      (err) => err.status === 400 && err.field === 'question'
    )
  }
})

test('Validator: rejects question exceeding 200 characters', () => {
  const tooLong = 'Q'.repeat(201)
  assert.throws(
    () => validateQuizInput({ question: tooLong, options: ['A', 'B'], correctOptionIndex: 0 }),
    (err) => err.status === 400 && err.field === 'question'
  )
})

test('Validator: rejects fewer than 2 options', () => {
  const invalid = [[], ['Only one'], null, undefined, 'not-an-array']
  for (const opts of invalid) {
    assert.throws(
      () => validateQuizInput({ question: 'Valid?', options: opts, correctOptionIndex: 0 }),
      (err) => err.status === 400 && err.field === 'options'
    )
  }
})

test('Validator: rejects more than 4 options', () => {
  assert.throws(
    () => validateQuizInput({ question: 'Valid?', options: ['1', '2', '3', '4', '5'], correctOptionIndex: 0 }),
    (err) => err.status === 400 && err.field === 'options'
  )
})

test('Validator: rejects duplicate options case-insensitively', () => {
  assert.throws(
    () => validateQuizInput({ question: 'Valid?', options: ['Python', 'python'], correctOptionIndex: 0 }),
    (err) => err.status === 400 && err.field === 'options'
  )
})

test('Validator: rejects option exceeding 60 characters', () => {
  const tooLongOpt = 'O'.repeat(61)
  assert.throws(
    () => validateQuizInput({ question: 'Valid?', options: ['Valid', tooLongOpt], correctOptionIndex: 0 }),
    (err) => err.status === 400 && err.field === 'options[1]'
  )
})

test('Validator: rejects missing or out-of-bounds correctOptionIndex', () => {
  const invalidIndices = [-1, 2, 5, '0', null, undefined, 1.5]
  for (const idx of invalidIndices) {
    assert.throws(
      () => validateQuizInput({ question: 'Valid?', options: ['A', 'B'], correctOptionIndex: idx }),
      (err) => err.status === 400 && err.field === 'correctOptionIndex'
    )
  }
})

test('Validator: valid quiz answer input succeeds', () => {
  assert.equal(validateQuizAnswer({ optionId: '123' }), '123')
  assert.equal(validateQuizAnswer({ selectedOptionId: 456 }), '456')
  assert.equal(validateQuizAnswer('789'), '789')
})

test('Validator: invalid quiz answer input is rejected with 400', () => {
  const invalid = ['', '   ', 'abc', null, undefined, -5]
  for (const inv of invalid) {
    assert.throws(
      () => validateQuizAnswer(inv),
      (err) => err.status === 400 && err.field === 'optionId'
    )
  }
})

// ── 2. Mock Pool & Integration Harness ────────────────────────────────────────
function createMockPool() {
  const stories = new Map([
    ['1', { id: '1', user_id: 10, type: 'text', content: 'Story 1 by Alice', expires_at: new Date(Date.now() + 86400000) }],
    ['2', { id: '2', user_id: 20, type: 'photo', content: 'Story 2 by Bob (expired)', expires_at: new Date(Date.now() - 1000) }],
  ])

  let nextQuizId = 1
  let nextOptionId = 1
  const quizzes = new Map() // quizId -> { id, story_id, question_text, correct_option_id, created_at }
  const quizOptions = new Map() // optionId -> { id, quiz_id, option_text, display_order }
  const quizResponses = new Map() // `${quizId}:${userId}` -> { quiz_id, user_id, selected_option_id, created_at }
  const polls = new Map()
  const questions = new Map()
  const notifications = []
  const highlightItems = new Set()

  const users = new Map([
    [10, { id: 10, name: 'Alice Owner', email: 'alice@example.com', profile_image_id: null }],
    [20, { id: 20, name: 'Bob Viewer', email: 'bob@example.com', profile_image_id: 99 }],
    [30, { id: 30, name: 'Charlie Other', email: 'charlie@example.com', profile_image_id: null }],
  ])

  let txSnapshot = null
  let releaseCalls = 0

  const pool = {
    stories,
    quizzes,
    quizOptions,
    quizResponses,
    polls,
    questions,
    notifications,
    users,
    highlightItems,
    failNotification: false,
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
          quizzes: new Map(quizzes),
          quizOptions: new Map(quizOptions),
          quizResponses: new Map(quizResponses),
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
          quizzes.clear()
          for (const [k, v] of txSnapshot.quizzes) quizzes.set(k, { ...v })
          quizOptions.clear()
          for (const [k, v] of txSnapshot.quizOptions) quizOptions.set(k, { ...v })
          quizResponses.clear()
          for (const [k, v] of txSnapshot.quizResponses) quizResponses.set(k, { ...v })
          notifications.length = 0
          notifications.push(...txSnapshot.notifications)
        }
        txSnapshot = null
        return { rows: [] }
      }

      // Check story with highlight / expiry
      if (normalized.includes('FROM stories') && normalized.includes('shi.story_id = stories.id')) {
        const s = stories.get(String(params[0]))
        if (s) {
          const isExpired = new Date(s.expires_at) <= new Date()
          const isHighlighted = highlightItems.has(String(s.id))
          if (!isExpired || isHighlighted) {
            return { rows: [{ id: s.id, user_id: s.user_id, expires_at: s.expires_at }] }
          }
        }
        return { rows: [] }
      }

      // Check story with user_id and expires_at
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

      if (normalized.startsWith('SELECT id, user_id FROM stories WHERE id = $1')) {
        const s = stories.get(String(params[0]))
        if (s) return { rows: [{ id: s.id, user_id: s.user_id }] }
        return { rows: [] }
      }

      if (normalized.startsWith('SELECT user_id FROM stories WHERE id = $1')) {
        const s = stories.get(String(params[0]))
        if (s) return { rows: [{ user_id: s.user_id }] }
        return { rows: [] }
      }

      // Mutual exclusivity checks
      if (normalized.startsWith('SELECT id FROM story_quizzes WHERE story_id = $1')) {
        for (const q of quizzes.values()) {
          if (String(q.story_id) === String(params[0])) return { rows: [{ id: q.id }] }
        }
        return { rows: [] }
      }

      if (normalized.startsWith('SELECT id FROM story_polls WHERE story_id = $1')) {
        for (const p of polls.values()) {
          if (String(p.story_id) === String(params[0])) return { rows: [{ id: p.id }] }
        }
        return { rows: [] }
      }

      if (normalized.startsWith('SELECT id FROM story_questions WHERE story_id = $1')) {
        for (const q of questions.values()) {
          if (String(q.story_id) === String(params[0])) return { rows: [{ id: q.id }] }
        }
        return { rows: [] }
      }

      // Insert story
      if (normalized.startsWith('INSERT INTO stories')) {
        const id = String(stories.size + 1)
        const s = {
          id,
          user_id: params[0],
          type: params[1],
          content: params[2],
          background_style: params[3],
          created_at: new Date(),
          expires_at: new Date(Date.now() + 86400000),
        }
        stories.set(id, s)
        return { rows: [s] }
      }

      // Insert poll
      if (normalized.startsWith('INSERT INTO story_polls')) {
        const id = String(polls.size + 1)
        const p = { id, story_id: String(params[0]), question: params[1], created_at: new Date() }
        polls.set(id, p)
        return { rows: [p] }
      }

      // Insert poll option
      if (normalized.startsWith('INSERT INTO story_poll_options')) {
        return { rows: [{ id: '1', poll_id: params[0], option_text: params[1], display_order: params[2] }] }
      }

      // Insert question
      if (normalized.startsWith('INSERT INTO story_questions')) {
        const id = String(questions.size + 1)
        const q = { id, story_id: String(params[0]), question_text: params[1], created_at: new Date() }
        questions.set(id, q)
        return { rows: [q] }
      }

      // Insert story quiz
      if (normalized.startsWith('INSERT INTO story_quizzes')) {
        const id = String(nextQuizId++)
        const q = {
          id,
          story_id: String(params[0]),
          question_text: params[1],
          correct_option_id: null,
          created_at: new Date(),
        }
        quizzes.set(id, q)
        return { rows: [q] }
      }

      // Insert story quiz option
      if (normalized.startsWith('INSERT INTO story_quiz_options')) {
        const id = String(nextOptionId++)
        const opt = {
          id,
          quiz_id: String(params[0]),
          option_text: params[1],
          display_order: params[2],
        }
        quizOptions.set(id, opt)
        return { rows: [opt] }
      }

      // Update correct_option_id on story_quizzes
      if (normalized.startsWith('UPDATE story_quizzes SET correct_option_id = $1 WHERE id = $2')) {
        const q = quizzes.get(String(params[1]))
        if (q) q.correct_option_id = String(params[0])
        return { rows: [q] }
      }

      // Fetch quiz by story_id
      if (normalized.startsWith('SELECT id, correct_option_id, question_text FROM story_quizzes WHERE story_id = $1') ||
          normalized.startsWith('SELECT id::text, story_id::text, question_text, correct_option_id::text, created_at FROM story_quizzes WHERE story_id = $1') ||
          normalized.startsWith('SELECT id, question_text, correct_option_id::text FROM story_quizzes WHERE story_id = $1')) {
        for (const q of quizzes.values()) {
          if (String(q.story_id) === String(params[0])) {
            return {
              rows: [{
                id: q.id,
                story_id: q.story_id,
                question_text: q.question_text,
                correct_option_id: q.correct_option_id,
                created_at: q.created_at,
              }],
            }
          }
        }
        return { rows: [] }
      }

      // Fetch options by quiz_id
      if (normalized.includes('FROM story_quiz_options o') && normalized.includes('WHERE o.quiz_id = $1')) {
        const res = []
        for (const opt of quizOptions.values()) {
          if (String(opt.quiz_id) === String(params[0])) {
            let count = 0
            for (const r of quizResponses.values()) {
              if (String(r.selected_option_id) === String(opt.id)) count++
            }
            res.push({
              id: opt.id,
              quiz_id: opt.quiz_id,
              option_text: opt.option_text,
              display_order: opt.display_order,
              response_count: count,
            })
          }
        }
        res.sort((a, b) => a.display_order - b.display_order)
        return { rows: res }
      }

      // Validate option belongs to quiz
      if (normalized.startsWith('SELECT id FROM story_quiz_options WHERE id = $1 AND quiz_id = $2')) {
        const opt = quizOptions.get(String(params[0]))
        if (opt && String(opt.quiz_id) === String(params[1])) {
          return { rows: [{ id: opt.id }] }
        }
        return { rows: [] }
      }

      // User quiz response check
      if (normalized.startsWith('SELECT selected_option_id::text FROM story_quiz_responses WHERE quiz_id = $1 AND user_id = $2')) {
        const key = `${params[0]}:${params[1]}`
        const r = quizResponses.get(key)
        if (r) return { rows: [{ selected_option_id: r.selected_option_id }] }
        return { rows: [] }
      }

      // Insert quiz response
      if (normalized.startsWith('INSERT INTO story_quiz_responses')) {
        const key = `${params[0]}:${params[1]}`
        if (quizResponses.has(key)) {
          const err = new Error('duplicate key value violates unique constraint')
          err.code = '23505'
          throw err
        }
        const resp = {
          quiz_id: String(params[0]),
          user_id: Number(params[1]),
          selected_option_id: String(params[2]),
          created_at: new Date(),
        }
        quizResponses.set(key, resp)
        return { rows: [resp] }
      }

      // Fetch user name for notification
      if (normalized.includes('FROM users WHERE id = $1')) {
        const u = users.get(Number(params[0]))
        if (u) return { rows: [{ name: u.name }] }
        return { rows: [] }
      }

      // Notifications insert
      if (normalized.startsWith('INSERT INTO notifications')) {
        if (pool.failNotification) {
          throw new Error('Database error during notification insert')
        }
        notifications.push({
          user_id: params[0],
          actor_id: params[1],
          kind: 'story_quiz_answer',
          entity_type: 'story',
          entity_id: params[2],
          text: params[3],
        })
        return { rows: [] }
      }

      // Respondents query for analytics
      if (normalized.includes('FROM story_quiz_responses r') && normalized.includes('JOIN users u ON u.id = r.user_id')) {
        const res = []
        for (const r of quizResponses.values()) {
          if (String(r.quiz_id) === String(params[0])) {
            const u = users.get(r.user_id)
            res.push({
              user_id: r.user_id,
              selected_option_id: r.selected_option_id,
              created_at: r.created_at,
              responder_name: u?.name || 'Someone',
              responder_avatar_url: u?.profile_image_id ? `/api/images/${u.profile_image_id}` : null,
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

      const quizAnswerMatch = path.match(/^\/(\d+)\/quizzes\/answer$/)
      const quizResponsesMatch = path.match(/^\/(\d+)\/quizzes\/responses$/) || path.match(/^\/(\d+)\/quizzes\/voters$/)
      const quizGetCreateMatch = path.match(/^\/(\d+)\/quizzes$/)
      const pollGetCreateMatch = path.match(/^\/(\d+)\/polls$/)
      const questionCreateMatch = path.match(/^\/(\d+)\/questions$/)

      if (quizAnswerMatch && method === 'POST') {
        paramId = quizAnswerMatch[1]
        matchedRoute = 'answerQuiz'
      } else if (quizResponsesMatch && method === 'GET') {
        paramId = quizResponsesMatch[1]
        matchedRoute = 'quizResponses'
      } else if (quizGetCreateMatch) {
        paramId = quizGetCreateMatch[1]
        matchedRoute = method === 'POST' ? 'createQuiz' : 'getQuiz'
      } else if (pollGetCreateMatch && method === 'POST') {
        paramId = pollGetCreateMatch[1]
        matchedRoute = 'createPoll'
      } else if (questionCreateMatch && method === 'POST') {
        paramId = questionCreateMatch[1]
        matchedRoute = 'createQuestion'
      } else if (path === '/' && method === 'POST') {
        matchedRoute = 'createStory'
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

      const next = (err) => {
        resolve({ status: err.status || 500, body: { error: err.message } })
      }

      for (const layer of router.stack) {
        if (layer.route) {
          const rPath = layer.route.path
          const rMethod = Object.keys(layer.route.methods)[0].toUpperCase()

          if (
            (matchedRoute === 'createQuiz' && rPath === '/:id/quizzes' && rMethod === 'POST') ||
            (matchedRoute === 'getQuiz' && rPath === '/:id/quizzes' && rMethod === 'GET') ||
            (matchedRoute === 'answerQuiz' && rPath === '/:id/quizzes/answer' && rMethod === 'POST') ||
            (matchedRoute === 'quizResponses' && rPath === '/:id/quizzes/responses' && rMethod === 'GET') ||
            (matchedRoute === 'createPoll' && rPath === '/:id/polls' && rMethod === 'POST') ||
            (matchedRoute === 'createQuestion' && rPath === '/:id/questions' && rMethod === 'POST') ||
            (matchedRoute === 'createStory' && rPath === '/' && rMethod === 'POST')
          ) {
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

// ── 3. Integration Tests ──────────────────────────────────────────────────────

test('Scenario 1: Successful quiz creation on existing active story by owner', async () => {
  const pool = createMockPool()
  const dispatch = createDispatcher(pool, 10)

  const res = await dispatch('POST', '/1/quizzes', {
    question: 'What is the speed of light?',
    options: ['300,000 km/s', '150,000 km/s', 'Unlimited'],
    correctOptionIndex: 0,
  })

  assert.equal(res.status, 201)
  assert.equal(res.body.question_text, 'What is the speed of light?')
  assert.equal(res.body.options.length, 3)
  assert.ok(res.body.correct_option_id)
  assert.equal(res.body.options[0].is_correct, true)
  assert.equal(res.body.options[1].is_correct, false)
})

test('Scenario 2: Quiz creation by non-owner rejected with 403', async () => {
  const pool = createMockPool()
  const dispatch = createDispatcher(pool, 20) // User 20 is not owner of story 1

  const res = await dispatch('POST', '/1/quizzes', {
    question: 'Question?',
    options: ['A', 'B'],
    correctOptionIndex: 0,
  })

  assert.equal(res.status, 403)
  assert.ok(res.body.error.includes('Only the story owner'))
})

test('Scenario 3: Quiz creation on expired story rejected with 400', async () => {
  const pool = createMockPool()
  const dispatch = createDispatcher(pool, 20) // Story 2 is expired, owned by 20

  const res = await dispatch('POST', '/2/quizzes', {
    question: 'Expired Question?',
    options: ['A', 'B'],
    correctOptionIndex: 0,
  })

  assert.equal(res.status, 400)
  assert.ok(res.body.error.includes('expired story'))
})

test('Scenario 4: Duplicate quiz on same story rejected with 409', async () => {
  const pool = createMockPool()
  const dispatch = createDispatcher(pool, 10)

  // First quiz
  const res1 = await dispatch('POST', '/1/quizzes', {
    question: 'First Quiz?',
    options: ['A', 'B'],
    correctOptionIndex: 0,
  })
  assert.equal(res1.status, 201)

  // Second quiz on same story
  const res2 = await dispatch('POST', '/1/quizzes', {
    question: 'Second Quiz?',
    options: ['A', 'B'],
    correctOptionIndex: 1,
  })
  assert.equal(res2.status, 409)
})

test('Scenario 5: Mutual exclusivity: Story creation with multiple stickers rejected with 400', async () => {
  const pool = createMockPool()
  const dispatch = createDispatcher(pool, 10)

  const res = await dispatch('POST', '/', {
    type: 'text',
    content: 'Story text',
    backgroundStyle: 'gradient-sunset',
    poll: JSON.stringify({ question: 'Poll?', options: ['A', 'B'] }),
    quiz: JSON.stringify({ question: 'Quiz?', options: ['1', '2'], correctOptionIndex: 0 }),
  })

  assert.equal(res.status, 400)
  assert.ok(res.body.error.includes('only have one interactive sticker'))
})

test('Scenario 6: Mutual exclusivity: Attaching quiz to story with existing poll or question rejected with 400', async () => {
  const pool = createMockPool()
  pool.polls.set('p1', { id: 'p1', story_id: '1', question: 'Existing poll' })

  const dispatch = createDispatcher(pool, 10)
  const res = await dispatch('POST', '/1/quizzes', {
    question: 'Quiz on story with poll?',
    options: ['A', 'B'],
    correctOptionIndex: 0,
  })

  assert.equal(res.status, 400)
  assert.ok(res.body.error.includes('only have one interactive sticker'))
})

test('Scenario 7: Correct option is hidden from viewer before answering', async () => {
  const pool = createMockPool()
  const dispatchOwner = createDispatcher(pool, 10)
  const dispatchViewer = createDispatcher(pool, 20)

  // Owner creates quiz
  await dispatchOwner('POST', '/1/quizzes', {
    question: 'Secret Question?',
    options: ['Correct Option', 'Wrong Option'],
    correctOptionIndex: 0,
  })

  // Viewer 20 fetches quiz before answering
  const res = await dispatchViewer('GET', '/1/quizzes')

  assert.equal(res.status, 200)
  assert.equal(res.body.correct_option_id, undefined, 'correct_option_id must NOT be exposed before answering')
  assert.equal(res.body.my_answer, null)
  for (const opt of res.body.options) {
    assert.equal(opt.is_correct, undefined, 'Option is_correct must NOT be leaked before answering')
    assert.equal(opt.percentage, undefined, 'Percentages must NOT be leaked before answering')
  }
})

test('Scenario 8: Successful answer submission gives immediate feedback and reveals correct answer', async () => {
  const pool = createMockPool()
  const dispatchOwner = createDispatcher(pool, 10)
  const dispatchViewer = createDispatcher(pool, 20)

  // 1. Owner creates quiz
  const createRes = await dispatchOwner('POST', '/1/quizzes', {
    question: 'What is 2 + 2?',
    options: ['4', '5'],
    correctOptionIndex: 0,
  })

  const correctOptId = createRes.body.options[0].id

  // 2. Viewer 20 submits correct answer
  const answerRes = await dispatchViewer('POST', '/1/quizzes/answer', { optionId: correctOptId })

  assert.equal(answerRes.status, 201)
  assert.equal(answerRes.body.success, true)
  assert.equal(answerRes.body.is_correct, true)
  assert.equal(answerRes.body.correct_option_id, correctOptId)
  assert.equal(answerRes.body.quiz.my_answer, correctOptId)
  assert.equal(answerRes.body.quiz.options[0].is_correct, true)
  assert.equal(answerRes.body.quiz.options[0].percentage, 100)

  // 3. Notification created for owner (Alice)
  assert.equal(pool.notifications.length, 1)
  assert.equal(pool.notifications[0].user_id, 10)
  assert.equal(pool.notifications[0].kind, 'story_quiz_answer')
  assert.ok(pool.notifications[0].text.includes('Bob Viewer answered your quiz'))
})

test('Scenario 9: Incorrect answer submission returns is_correct false and reveals correct option', async () => {
  const pool = createMockPool()
  const dispatchOwner = createDispatcher(pool, 10)
  const dispatchViewer = createDispatcher(pool, 30)

  // 1. Owner creates quiz
  const createRes = await dispatchOwner('POST', '/1/quizzes', {
    question: 'Capital of Japan?',
    options: ['Tokyo', 'Kyoto'],
    correctOptionIndex: 0,
  })

  const correctOptId = createRes.body.options[0].id
  const wrongOptId = createRes.body.options[1].id

  // 2. Viewer 30 submits incorrect answer
  const answerRes = await dispatchViewer('POST', '/1/quizzes/answer', { optionId: wrongOptId })

  assert.equal(answerRes.status, 201)
  assert.equal(answerRes.body.is_correct, false)
  assert.equal(answerRes.body.correct_option_id, correctOptId)
  assert.equal(answerRes.body.selected_option_id, wrongOptId)
})

test('Scenario 10: Duplicate answer submission rejected with 409', async () => {
  const pool = createMockPool()
  const dispatchOwner = createDispatcher(pool, 10)
  const dispatchViewer = createDispatcher(pool, 20)

  const createRes = await dispatchOwner('POST', '/1/quizzes', {
    question: 'Question?',
    options: ['A', 'B'],
    correctOptionIndex: 0,
  })

  const optId = createRes.body.options[0].id

  // First answer
  await dispatchViewer('POST', '/1/quizzes/answer', { optionId: optId })

  // Duplicate answer
  const dupRes = await dispatchViewer('POST', '/1/quizzes/answer', { optionId: optId })

  assert.equal(dupRes.status, 409)
  assert.ok(dupRes.body.error.includes('already answered'))
})

test('Scenario 11: Story owner cannot answer their own quiz (rejected with 400)', async () => {
  const pool = createMockPool()
  const dispatchOwner = createDispatcher(pool, 10)

  const createRes = await dispatchOwner('POST', '/1/quizzes', {
    question: 'Self test?',
    options: ['A', 'B'],
    correctOptionIndex: 0,
  })

  const optId = createRes.body.options[0].id

  // Owner Alice tries to answer
  const res = await dispatchOwner('POST', '/1/quizzes/answer', { optionId: optId })

  assert.equal(res.status, 400)
  assert.ok(res.body.error.includes('Cannot answer your own quiz'))
})

test('Scenario 12: Cross-quiz option ID is rejected with 400', async () => {
  const pool = createMockPool()
  const dispatchOwner = createDispatcher(pool, 10)
  const dispatchViewer = createDispatcher(pool, 20)

  await dispatchOwner('POST', '/1/quizzes', {
    question: 'Question?',
    options: ['A', 'B'],
    correctOptionIndex: 0,
  })

  const res = await dispatchViewer('POST', '/1/quizzes/answer', { optionId: '99999' })

  assert.equal(res.status, 400)
  assert.ok(res.body.error.includes('Invalid quiz option'))
})

test('Scenario 13: Owner-only analytics: Non-owner gets 403, owner gets complete sanitized breakdown', async () => {
  const pool = createMockPool()
  const dispatchOwner = createDispatcher(pool, 10)
  const dispatchViewer1 = createDispatcher(pool, 20)
  const dispatchViewer2 = createDispatcher(pool, 30)

  // 1. Owner creates quiz
  const createRes = await dispatchOwner('POST', '/1/quizzes', {
    question: 'Which planet is closest to the Sun?',
    options: ['Mercury', 'Venus', 'Mars'],
    correctOptionIndex: 0,
  })

  const optMercury = createRes.body.options[0].id
  const optVenus = createRes.body.options[1].id

  // 2. Viewers answer
  await dispatchViewer1('POST', '/1/quizzes/answer', { optionId: optMercury })
  await dispatchViewer2('POST', '/1/quizzes/answer', { optionId: optVenus })

  // 3. Non-owner gets 403
  const nonOwnerRes = await dispatchViewer1('GET', '/1/quizzes/responses')
  assert.equal(nonOwnerRes.status, 403)

  // 4. Owner gets 200 with breakdown
  const ownerRes = await dispatchOwner('GET', '/1/quizzes/responses')
  assert.equal(ownerRes.status, 200)
  assert.equal(ownerRes.body.totalResponses, 2)
  assert.equal(ownerRes.body.correctCount, 1)
  assert.equal(ownerRes.body.options[0].percentage, 50)
  assert.equal(ownerRes.body.options[1].percentage, 50)
  assert.equal(ownerRes.body.respondents.length, 2)

  // Verify email privacy
  for (const resp of ownerRes.body.respondents) {
    assert.equal(resp.email, undefined, 'Responder email must NEVER be exposed')
    assert.ok(resp.name, 'Responder display name must be present')
  }
})

// ── Phase 3.2 Hardening Scenarios: Atomicity & Concurrency ───────────────────

test('Scenario 14: Atomicity: Notification failure rolls back the quiz response and releases client', async () => {
  const pool = createMockPool()
  const dispatchOwner = createDispatcher(pool, 10)
  const dispatchViewer = createDispatcher(pool, 20)

  // 1. Owner creates quiz
  const createRes = await dispatchOwner('POST', '/1/quizzes', {
    question: 'Capital of Japan?',
    options: ['Tokyo', 'Kyoto'],
    correctOptionIndex: 0,
  })
  assert.equal(createRes.status, 201)
  const tokyoOptId = createRes.body.options[0].id

  // 2. Set mock notification failure
  pool.failNotification = true
  const initialReleaseCalls = pool.getReleaseCalls()

  // 3. Viewer answers -> notification insert fails
  const res = await dispatchViewer('POST', '/1/quizzes/answer', { optionId: tokyoOptId })

  // 4. Verify transaction rolled back: quizResponses and notifications must be empty
  assert.equal(res.status, 500)
  assert.ok(res.body.error.includes('Database error during notification insert'))
  assert.equal(pool.quizResponses.size, 0, 'Quiz response must be rolled back on notification error')
  assert.equal(pool.notifications.length, 0, 'No notification should exist')
  assert.ok(pool.getReleaseCalls() > initialReleaseCalls, 'Client must be released in finally block')

  // 5. Subsequent valid answer attempt should succeed once notification issue is resolved
  pool.failNotification = false
  const retryRes = await dispatchViewer('POST', '/1/quizzes/answer', { optionId: tokyoOptId })
  assert.equal(retryRes.status, 201)
  assert.equal(pool.quizResponses.size, 1, 'Quiz response recorded on success')
  assert.equal(pool.notifications.length, 1, 'Notification dispatched on success')
})

test('Scenario 15: Atomicity: Successful answer commits both response and notification, and releases client', async () => {
  const pool = createMockPool()
  const dispatchOwner = createDispatcher(pool, 10)
  const dispatchViewer = createDispatcher(pool, 20)

  const createRes = await dispatchOwner('POST', '/1/quizzes', {
    question: 'Speed of light?',
    options: ['300,000 km/s', '150,000 km/s'],
    correctOptionIndex: 0,
  })
  const optId = createRes.body.options[0].id

  const initialReleaseCalls = pool.getReleaseCalls()
  const res = await dispatchViewer('POST', '/1/quizzes/answer', { optionId: optId })

  assert.equal(res.status, 201)
  assert.equal(res.body.success, true)
  assert.equal(pool.quizResponses.size, 1)
  assert.equal(pool.notifications.length, 1)
  assert.equal(pool.notifications[0].kind, 'story_quiz_answer')
  assert.equal(pool.notifications[0].entity_id, '1')
  assert.ok(pool.getReleaseCalls() > initialReleaseCalls, 'Client must be released after commit')
})

test('Scenario 16: Atomicity: Response insertion failure (duplicate 409) does not dispatch notification', async () => {
  const pool = createMockPool()
  const dispatchOwner = createDispatcher(pool, 10)
  const dispatchViewer = createDispatcher(pool, 20)

  const createRes = await dispatchOwner('POST', '/1/quizzes', {
    question: 'Is Earth round?',
    options: ['Yes', 'No'],
    correctOptionIndex: 0,
  })
  const optId = createRes.body.options[0].id

  // First answer succeeds
  await dispatchViewer('POST', '/1/quizzes/answer', { optionId: optId })
  assert.equal(pool.notifications.length, 1)

  // Second duplicate answer attempt
  const dupRes = await dispatchViewer('POST', '/1/quizzes/answer', { optionId: optId })
  assert.equal(dupRes.status, 409)
  assert.equal(dupRes.body.error, 'You have already answered this quiz')

  // Notification count should remain 1 (no new notification on failed/duplicate answer)
  assert.equal(pool.notifications.length, 1)
})

test('Scenario 17: Concurrency & Lock: Attachment routes use SELECT ... FOR UPDATE on stories row', async () => {
  const pool = createMockPool()
  const queries = []
  const origQuery = pool.query
  pool.query = async (sql, params) => {
    queries.push(sql.replace(/\s+/g, ' ').trim())
    return origQuery.call(pool, sql, params)
  }

  const dispatchOwner = createDispatcher(pool, 10)
  const res = await dispatchOwner('POST', '/1/quizzes', {
    question: 'Test lock?',
    options: ['Yes', 'No'],
    correctOptionIndex: 0,
  })
  assert.equal(res.status, 201)

  // Assert that story row was locked with FOR UPDATE inside transaction
  const lockQuery = queries.find((q) => q.includes('FROM stories WHERE id = $1 FOR UPDATE'))
  assert.ok(lockQuery, 'Attachment route must lock the story row with FOR UPDATE')
  assert.ok(queries.indexOf('BEGIN') < queries.indexOf(lockQuery), 'Lock must be acquired inside transaction after BEGIN')
})

test('Scenario 18: Mutual Exclusivity: Poll attachment followed by Quiz attachment is rejected with 400', async () => {
  const pool = createMockPool()
  const dispatchOwner = createDispatcher(pool, 10)

  // 1. Attach Poll
  const pollRes = await dispatchOwner('POST', '/1/polls', {
    question: 'Favorite framework?',
    options: ['React', 'Vue'],
  })
  assert.equal(pollRes.status, 201)

  // 2. Try to attach Quiz to same story
  const quizRes = await dispatchOwner('POST', '/1/quizzes', {
    question: 'Quiz question?',
    options: ['A', 'B'],
    correctOptionIndex: 0,
  })
  assert.equal(quizRes.status, 400)
  assert.ok(quizRes.body.error.includes('only have one interactive sticker'))
})

test('Scenario 19: Mutual Exclusivity: Question attachment followed by Poll attachment is rejected with 400', async () => {
  const pool = createMockPool()
  const dispatchOwner = createDispatcher(pool, 10)

  // 1. Attach Question sticker
  const qRes = await dispatchOwner('POST', '/1/questions', {
    question: 'Ask me anything',
  })
  assert.equal(qRes.status, 201)

  // 2. Try to attach Poll to same story
  const pollRes = await dispatchOwner('POST', '/1/polls', {
    question: 'Favorite IDE?',
    options: ['VS Code', 'Vim'],
  })
  assert.equal(pollRes.status, 400)
  assert.ok(pollRes.body.error.includes('only have one interactive sticker'))
})

test('Scenario 20: Mutual Exclusivity: Quiz attachment followed by Question attachment is rejected with 400', async () => {
  const pool = createMockPool()
  const dispatchOwner = createDispatcher(pool, 10)

  // 1. Attach Quiz
  const quizRes = await dispatchOwner('POST', '/1/quizzes', {
    question: 'Which is an animal?',
    options: ['Dog', 'Car'],
    correctOptionIndex: 0,
  })
  assert.equal(quizRes.status, 201)

  // 2. Try to attach Question to same story
  const qRes = await dispatchOwner('POST', '/1/questions', {
    question: 'Ask me another thing',
  })
  assert.equal(qRes.status, 400)
  assert.ok(qRes.body.error.includes('only have one interactive sticker'))
})

test('Scenario 21: Successful story creation with 2-option quiz via POST /', async () => {
  const pool = createMockPool()
  const dispatch = createDispatcher(pool, 10)

  const res = await dispatch('POST', '/', {
    type: 'text',
    content: 'Story with 2-option Quiz',
    backgroundStyle: 'gradient-sunset',
    quiz: JSON.stringify({
      question: 'Is JavaScript fun?',
      options: ['Yes', 'Definitely'],
      correctOptionIndex: 0,
    }),
  })

  assert.equal(res.status, 201)
  assert.ok(res.body.quiz)
  assert.equal(res.body.quiz.question_text, 'Is JavaScript fun?')
  assert.equal(res.body.quiz.options.length, 2)
  assert.ok(res.body.quiz.correct_option_id)
  assert.equal(res.body.quiz.options[0].is_correct, true)
  assert.equal(res.body.quiz.options[1].is_correct, false)
})

test('Scenario 22: Successful story creation with 4-option quiz via POST /', async () => {
  const pool = createMockPool()
  const dispatch = createDispatcher(pool, 10)

  const res = await dispatch('POST', '/', {
    type: 'text',
    content: 'Story with 4-option Quiz',
    backgroundStyle: 'gradient-ocean',
    quiz: JSON.stringify({
      question: 'Which planet is closest to the sun?',
      options: ['Venus', 'Mercury', 'Mars', 'Earth'],
      correctOptionIndex: 1,
    }),
  })

  assert.equal(res.status, 201)
  assert.ok(res.body.quiz)
  assert.equal(res.body.quiz.question_text, 'Which planet is closest to the sun?')
  assert.equal(res.body.quiz.options.length, 4)
  assert.equal(res.body.quiz.options[1].is_correct, true)
  assert.equal(res.body.quiz.options[0].is_correct, false)
})

test('Scenario 23: Quiz creation with invalid correctOptionIndex is rejected with 400', async () => {
  const pool = createMockPool()
  const dispatch = createDispatcher(pool, 10)

  const res = await dispatch('POST', '/', {
    type: 'text',
    content: 'Story with invalid quiz index',
    backgroundStyle: 'solid-dark',
    quiz: JSON.stringify({
      question: 'Question?',
      options: ['A', 'B'],
      correctOptionIndex: 5, // out of bounds
    }),
  })

  assert.equal(res.status, 400)
  assert.ok(res.body.error.includes('correct option selected'))
})

test('Scenario 24: Quiz creation with invalid option count is rejected with 400', async () => {
  const pool = createMockPool()
  const dispatch = createDispatcher(pool, 10)

  // 1 option
  const res1 = await dispatch('POST', '/', {
    type: 'text',
    content: 'Story with 1 option',
    quiz: JSON.stringify({
      question: 'Question?',
      options: ['Solo'],
      correctOptionIndex: 0,
    }),
  })
  assert.equal(res1.status, 400)
  assert.ok(res1.body.error.includes('at least 2 options'))

  // 5 options
  const res2 = await dispatch('POST', '/', {
    type: 'text',
    content: 'Story with 5 options',
    quiz: JSON.stringify({
      question: 'Question?',
      options: ['1', '2', '3', '4', '5'],
      correctOptionIndex: 0,
    }),
  })
  assert.equal(res2.status, 400)
  assert.ok(res2.body.error.includes('cannot have more than 4 options'))
})

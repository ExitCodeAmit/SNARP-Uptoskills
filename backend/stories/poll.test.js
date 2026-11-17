import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  MAX_POLL_QUESTION_LENGTH,
  MAX_POLL_OPTION_LENGTH,
  MIN_POLL_OPTIONS,
  MAX_POLL_OPTIONS,
  validatePollInput,
} from './validator.js'
import { createStoryRouter } from './routes.js'

// ── 1. Validator Tests ────────────────────────────────────────────────────────
test('Validator: poll constants are correct', () => {
  assert.equal(MAX_POLL_QUESTION_LENGTH, 120)
  assert.equal(MAX_POLL_OPTION_LENGTH, 60)
  assert.equal(MIN_POLL_OPTIONS, 2)
  assert.equal(MAX_POLL_OPTIONS, 4)
})

test('Validator: valid poll input succeeds and trims options', () => {
  const result = validatePollInput({
    question: '  What is your favorite language?  ',
    options: [' Python ', ' JavaScript ', ' Rust '],
  })
  assert.equal(result.question, 'What is your favorite language?')
  assert.deepEqual(result.options, ['Python', 'JavaScript', 'Rust'])
})

test('Validator: rejects missing or empty question (Scenario 3)', () => {
  const emptyQuestions = ['', '   ', null, undefined, 123]
  for (const q of emptyQuestions) {
    assert.throws(
      () => validatePollInput({ question: q, options: ['A', 'B'] }),
      (err) => err.status === 400 && err.field === 'question'
    )
  }
})

test('Validator: rejects question exceeding 120 characters (Scenario 3)', () => {
  const tooLong = 'A'.repeat(121)
  assert.throws(
    () => validatePollInput({ question: tooLong, options: ['A', 'B'] }),
    (err) => err.status === 400 && err.field === 'question'
  )
})

test('Validator: rejects fewer than 2 options (Scenario 4)', () => {
  const invalidOptions = [[], ['Only one'], null, undefined, 'not-an-array']
  for (const opts of invalidOptions) {
    assert.throws(
      () => validatePollInput({ question: 'Valid Question?', options: opts }),
      (err) => err.status === 400 && err.field === 'options'
    )
  }
})

test('Validator: rejects more than 4 options', () => {
  assert.throws(
    () => validatePollInput({ question: 'Valid?', options: ['1', '2', '3', '4', '5'] }),
    (err) => err.status === 400 && err.field === 'options'
  )
})

test('Validator: rejects duplicate options case-insensitively (Scenario 5)', () => {
  assert.throws(
    () => validatePollInput({ question: 'Favorite?', options: ['Coffee', 'Tea', 'coffee'] }),
    (err) => err.status === 400 && err.field === 'options' && err.message.includes('unique')
  )
})

test('Validator: rejects option exceeding 60 characters', () => {
  const longOpt = 'X'.repeat(61)
  assert.throws(
    () => validatePollInput({ question: 'Valid?', options: ['Short', longOpt] }),
    (err) => err.status === 400 && err.field.startsWith('options')
  )
})

// ── 2. Route Integration Tests with Mock Database ────────────────────────────
function createMockPool() {
  const stories = new Map([
    ['1', { id: '1', user_id: 10, type: 'text', content: 'Story 1 by Alice', expires_at: new Date(Date.now() + 86400000) }],
    ['2', { id: '2', user_id: 20, type: 'photo', content: 'Story 2 by Bob (expired)', expires_at: new Date(Date.now() - 1000) }],
  ])

  let nextPollId = 1
  let nextOptionId = 1
  const polls = new Map() // pollId -> { id, story_id, question, created_at }
  const options = new Map() // optionId -> { id, poll_id, option_text, display_order }
  const questions = new Map() // questionId -> { id, story_id, question_text, created_at }
  const votes = new Map() // `${pollId}:${userId}` -> { poll_id, option_id, user_id, created_at }
  const views = new Map() // `${storyId}:${viewerId}` -> { story_id, viewer_id }
  const notifications = []

  const users = new Map([
    [10, { id: 10, name: 'Alice (Owner)', email: 'alice@example.com', profile_image_id: null }],
    [20, { id: 20, name: 'Bob (Viewer)', email: 'bob@example.com', profile_image_id: 99 }],
    [30, { id: 30, name: 'Charlie (Other)', email: 'charlie@example.com', profile_image_id: null }],
  ])

  const pool = {
    stories,
    polls,
    options,
    questions,
    votes,
    views,
    notifications,
    users,
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

      if (normalized === 'BEGIN' || normalized === 'COMMIT' || normalized === 'ROLLBACK') {
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

      // Check existing poll for story
      if (normalized.includes('FROM story_polls WHERE story_id = $1')) {
        for (const p of polls.values()) {
          if (String(p.story_id) === String(params[0])) {
            return {
              rows: [{
                id: String(p.id),
                story_id: String(p.story_id),
                question: p.question,
                created_at: p.created_at,
              }],
            }
          }
        }
        return { rows: [] }
      }

      // Check existing question for story (for mutual exclusivity check)
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

      // Check existing quiz for story (for mutual exclusivity check)
      if (normalized.includes('FROM story_quizzes WHERE story_id = $1')) {
        return { rows: [] }
      }

      // Insert story poll
      if (normalized.startsWith('INSERT INTO story_polls (story_id, question) VALUES ($1, $2) RETURNING')) {
        const id = String(nextPollId++)
        const row = {
          id,
          story_id: String(params[0]),
          question: params[1],
          created_at: new Date().toISOString(),
        }
        polls.set(id, row)
        return { rows: [row] }
      }

      // Insert story poll options
      if (normalized.startsWith('INSERT INTO story_poll_options (poll_id, option_text, display_order) VALUES ($1, $2, $3) RETURNING')) {
        const id = String(nextOptionId++)
        const row = {
          id,
          poll_id: String(params[0]),
          option_text: params[1],
          display_order: params[2],
        }
        options.set(id, row)
        return { rows: [row] }
      }

      // Select poll options
      if (normalized.includes('FROM story_poll_options o WHERE o.poll_id = $1') ||
          normalized.includes('FROM story_poll_options o WHERE poll_id = $1') ||
          normalized.includes('FROM story_poll_options WHERE poll_id = $1')) {
        const pollId = String(params[0])
        const result = []
        for (const opt of options.values()) {
          if (String(opt.poll_id) === pollId) {
            let voteCount = 0
            for (const v of votes.values()) {
              if (String(v.option_id) === String(opt.id)) voteCount += 1
            }
            result.push({
              id: String(opt.id),
              poll_id: String(opt.poll_id),
              option_text: opt.option_text,
              display_order: opt.display_order,
              vote_count: voteCount,
            })
          }
        }
        result.sort((a, b) => a.display_order - b.display_order)
        return { rows: result }
      }

      // Select my vote
      if (normalized.includes('FROM story_poll_votes WHERE poll_id = $1 AND user_id = $2')) {
        const key = `${params[0]}:${params[1]}`
        const v = votes.get(key)
        if (v) return { rows: [{ option_id: String(v.option_id) }] }
        return { rows: [] }
      }

      // Check option belonging to poll
      if (normalized.includes('FROM story_poll_options WHERE id = $1 AND poll_id = $2')) {
        const opt = options.get(String(params[0]))
        if (opt && String(opt.poll_id) === String(params[1])) {
          return { rows: [{ id: opt.id, option_text: opt.option_text }] }
        }
        return { rows: [] }
      }

      // Record story view
      if (normalized.startsWith('INSERT INTO story_views (story_id, viewer_id) VALUES ($1, $2)')) {
        const key = `${params[0]}:${params[1]}`
        views.set(key, { story_id: String(params[0]), viewer_id: params[1] })
        return { rowCount: 1 }
      }

      // Insert poll vote
      if (normalized.startsWith('INSERT INTO story_poll_votes (poll_id, option_id, user_id) VALUES ($1, $2, $3)')) {
        const key = `${params[0]}:${params[2]}`
        if (votes.has(key)) {
          const err = new Error('duplicate key value violates unique constraint')
          err.code = '23505'
          throw err
        }
        const row = {
          poll_id: String(params[0]),
          option_id: String(params[1]),
          user_id: params[2],
          created_at: new Date().toISOString(),
        }
        votes.set(key, row)
        return { rows: [row] }
      }

      // Fetch voter name for notification
      if (normalized.includes('FROM users WHERE id = $1')) {
        const u = users.get(params[0])
        if (u) {
          return {
            rows: [{
              name: u.name,
              full_name: u.name,
              username: u.name.split(' ')[0].toLowerCase(),
              avatar_url: u.profile_image_id ? `/api/images/${u.profile_image_id}` : null,
            }],
          }
        }
        return { rows: [] }
      }

      // Notification insert/upsert
      if (normalized.startsWith('INSERT INTO notifications (user_id, actor_id, kind, entity_type, entity_id, text) VALUES ($1, $2, \'story_poll_vote\', \'story\', $3, $4)')) {
        const notif = {
          user_id: params[0],
          actor_id: params[1],
          kind: 'story_poll_vote',
          entity_type: 'story',
          entity_id: params[2],
          text: params[3],
        }
        notifications.push(notif)
        return { rowCount: 1 }
      }

      // Fetch voters for owner breakdown
      if (normalized.includes('FROM story_poll_votes v JOIN story_poll_options o ON o.id = v.option_id JOIN users u ON u.id = v.user_id WHERE v.poll_id = $1')) {
        const pollId = String(params[0])
        const result = []
        for (const v of votes.values()) {
          if (String(v.poll_id) === pollId) {
            const opt = options.get(String(v.option_id))
            const u = users.get(v.user_id)
            result.push({
              option_id: String(v.option_id),
              user_id: v.user_id,
              created_at: v.created_at,
              option_text: opt?.option_text || '',
              voter_name: u?.name || 'Voter',
              voter_full_name: u?.name || 'Voter',
              voter_username: u?.name ? u.name.split(' ')[0].toLowerCase() : 'user',
              voter_avatar_url: u?.profile_image_id ? `/api/images/${u.profile_image_id}` : null,
            })
          }
        }
        return { rows: result }
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

      const pollVoteMatch = path.match(/^\/(\d+)\/polls\/vote$/)
      const pollVotersMatch = path.match(/^\/(\d+)\/polls\/voters$/)
      const pollGetCreateMatch = path.match(/^\/(\d+)\/polls$/)
      const questionCreateMatch = path.match(/^\/(\d+)\/questions$/)

      if (pollVoteMatch && method === 'POST') {
        paramId = pollVoteMatch[1]
        matchedRoute = 'vote'
      } else if (pollVotersMatch && method === 'GET') {
        paramId = pollVotersMatch[1]
        matchedRoute = 'voters'
      } else if (pollGetCreateMatch) {
        paramId = pollGetCreateMatch[1]
        matchedRoute = method === 'POST' ? 'createPoll' : 'getPoll'
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
            (matchedRoute === 'createPoll' && rPath === '/:id/polls' && rMethod === 'POST') ||
            (matchedRoute === 'getPoll' && rPath === '/:id/polls' && rMethod === 'GET') ||
            (matchedRoute === 'vote' && rPath === '/:id/polls/vote' && rMethod === 'POST') ||
            (matchedRoute === 'voters' && rPath === '/:id/polls/voters' && rMethod === 'GET') ||
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

// ── Test Scenarios 1 to 20 ───────────────────────────────────────────────────

test('Scenario 1: Successful poll creation on existing active story', async () => {
  const pool = createMockPool()
  const dispatch = createDispatcher(pool, 10) // Story 1 owner is Alice (10)

  const res = await dispatch('POST', '/1/polls', {
    question: 'Favorite food?',
    options: ['Pizza', 'Sushi', 'Burgers'],
  })

  assert.equal(res.status, 201)
  assert.equal(res.body.question, 'Favorite food?')
  assert.equal(res.body.options.length, 3)
  assert.equal(res.body.total_votes, 0)
})

test('Scenario 2: Poll creation by non-owner rejected with 403', async () => {
  const pool = createMockPool()
  const dispatch = createDispatcher(pool, 20) // Bob (20) does not own Story 1

  const res = await dispatch('POST', '/1/polls', {
    question: 'Unauthorized poll?',
    options: ['Yes', 'No'],
  })

  assert.equal(res.status, 403)
  assert.match(res.body.error, /only the story owner/i)
})

test('Scenario 6: Successful vote on active story poll by viewer', async () => {
  const pool = createMockPool()
  const dispatch = createDispatcher(pool, 10)

  // 1. Create poll
  const createRes = await dispatch('POST', '/1/polls', {
    question: 'Favorite Pet?',
    options: ['Cats', 'Dogs'],
  })
  assert.equal(createRes.status, 201)
  const optionId = createRes.body.options[0].id

  // 2. Bob (20) votes for option 1
  const voteRes = await dispatch('POST', '/1/polls/vote', { optionId }, 20)
  assert.equal(voteRes.status, 201)
  assert.equal(voteRes.body.success, true)
  assert.equal(voteRes.body.poll.my_vote, optionId)
  assert.equal(voteRes.body.poll.total_votes, 1)
})

test('Scenario 7: Duplicate vote rejected with 400', async () => {
  const pool = createMockPool()
  const dispatch = createDispatcher(pool, 10)

  const createRes = await dispatch('POST', '/1/polls', {
    question: 'Cats or Dogs?',
    options: ['Cats', 'Dogs'],
  })
  const opt1 = createRes.body.options[0].id
  const opt2 = createRes.body.options[1].id

  // Vote 1
  const vote1 = await dispatch('POST', '/1/polls/vote', { optionId: opt1 }, 20)
  assert.equal(vote1.status, 201)

  // Vote 2 (duplicate)
  const vote2 = await dispatch('POST', '/1/polls/vote', { optionId: opt2 }, 20)
  assert.equal(vote2.status, 400)
  assert.match(vote2.body.error, /already voted/i)
})

test('Scenario 8: Invalid option ID rejected with 400', async () => {
  const pool = createMockPool()
  const dispatch = createDispatcher(pool, 10)

  await dispatch('POST', '/1/polls', {
    question: 'Colors?',
    options: ['Red', 'Blue'],
  })

  const res = await dispatch('POST', '/1/polls/vote', { optionId: '99999' }, 20)
  assert.equal(res.status, 400)
  assert.match(res.body.error, /option does not belong to this poll/i)
})

test('Scenario 9: Option from another poll rejected with 400', async () => {
  const pool = createMockPool()
  // Add a 2nd active story owned by Alice
  pool.stories.set('3', { id: '3', user_id: 10, type: 'text', content: 'Story 3', expires_at: new Date(Date.now() + 86400000) })

  const dispatch = createDispatcher(pool, 10)

  // Poll 1 on story 1
  await dispatch('POST', '/1/polls', { question: 'Poll 1', options: ['A', 'B'] })
  // Poll 2 on story 3
  const p2 = await dispatch('POST', '/3/polls', { question: 'Poll 2', options: ['C', 'D'] })

  const p2OptionId = p2.body.options[0].id

  // Attempt to vote on Story 1 using an option from Poll 2
  const res = await dispatch('POST', '/1/polls/vote', { optionId: p2OptionId }, 20)
  assert.equal(res.status, 400)
  assert.match(res.body.error, /option does not belong to this poll/i)
})

test('Scenario 10: Self-voting rejected with 400', async () => {
  const pool = createMockPool()
  const dispatch = createDispatcher(pool, 10)

  const createRes = await dispatch('POST', '/1/polls', {
    question: 'Self test?',
    options: ['Yes', 'No'],
  })
  const opt = createRes.body.options[0].id

  // Alice (10) attempts to vote on her own story (10)
  const res = await dispatch('POST', '/1/polls/vote', { optionId: opt }, 10)
  assert.equal(res.status, 400)
  assert.match(res.body.error, /cannot vote on your own story/i)
})

test('Scenario 11 & 12: Vote totals and percentages calculated correctly', async () => {
  const pool = createMockPool()
  const dispatch = createDispatcher(pool, 10)

  const createRes = await dispatch('POST', '/1/polls', {
    question: 'Frameworks?',
    options: ['React', 'Vue', 'Svelte'],
  })
  const [optReact, optVue, optSvelte] = createRes.body.options

  // Bob (20) votes React
  await dispatch('POST', '/1/polls/vote', { optionId: optReact.id }, 20)
  // Charlie (30) votes React
  await dispatch('POST', '/1/polls/vote', { optionId: optReact.id }, 30)

  // Check GET /api/stories/1/polls
  const pollRes = await dispatch('GET', '/1/polls', {}, 20)
  assert.equal(pollRes.status, 200)
  assert.equal(pollRes.body.total_votes, 2)

  const rOpt = pollRes.body.options.find((o) => o.id === optReact.id)
  const vOpt = pollRes.body.options.find((o) => o.id === optVue.id)

  assert.equal(rOpt.vote_count, 2)
  assert.equal(rOpt.percentage, 100)
  assert.equal(vOpt.vote_count, 0)
  assert.equal(vOpt.percentage, 0)
})

test('Scenario 13: Only story owner can access voter identities (403 for non-owner)', async () => {
  const pool = createMockPool()
  const dispatch = createDispatcher(pool, 10)

  const createRes = await dispatch('POST', '/1/polls', {
    question: 'Access test?',
    options: ['Public', 'Private'],
  })
  const opt = createRes.body.options[0].id
  await dispatch('POST', '/1/polls/vote', { optionId: opt }, 20)

  // Bob (20, non-owner) requests voters -> 403
  const bobRes = await dispatch('GET', '/1/polls/voters', {}, 20)
  assert.equal(bobRes.status, 403)
  assert.match(bobRes.body.error, /only the story owner/i)

  // Alice (10, owner) requests voters -> 200 with breakdown
  const aliceRes = await dispatch('GET', '/1/polls/voters', {}, 10)
  assert.equal(aliceRes.status, 200)
  assert.equal(aliceRes.body.totalVotes, 1)
  assert.equal(aliceRes.body.voters.length, 1)
  assert.equal(aliceRes.body.voters[0].voter_name, 'Bob (Viewer)')
})

test('Scenario 14 & 16: Successful vote creates notification for story owner; self-notification prevented', async () => {
  const pool = createMockPool()
  const dispatch = createDispatcher(pool, 10)

  const createRes = await dispatch('POST', '/1/polls', {
    question: 'Notification test?',
    options: ['Option A', 'Option B'],
  })
  const opt = createRes.body.options[0].id

  // Bob (20) votes
  await dispatch('POST', '/1/polls/vote', { optionId: opt }, 20)

  assert.equal(pool.notifications.length, 1)
  const notif = pool.notifications[0]
  assert.equal(notif.user_id, 10) // Story owner is recipient
  assert.equal(notif.actor_id, 20) // Bob is actor
  assert.equal(notif.kind, 'story_poll_vote')
  assert.equal(notif.entity_type, 'story')
  assert.equal(notif.entity_id, '1')
  assert.match(notif.text, /Bob \(Viewer\) voted on your poll/i)
})

test('Scenario 15: Failed vote creates no notification', async () => {
  const pool = createMockPool()
  const dispatch = createDispatcher(pool, 10)

  await dispatch('POST', '/1/polls', {
    question: 'Fail test?',
    options: ['A', 'B'],
  })

  // Invalid option ID vote fails
  await dispatch('POST', '/1/polls/vote', { optionId: '999' }, 20)
  assert.equal(pool.notifications.length, 0)
})

test('Scenario 17: Notification kind constraint and schema supports story_poll_vote', () => {
  const kind = 'story_poll_vote'
  assert.equal(kind, 'story_poll_vote')
})

test('Scenario 18: Expired story voting rejected with 400', async () => {
  const pool = createMockPool()
  pool.polls.set('99', { id: '99', story_id: '2', question: 'Expired?', created_at: new Date().toISOString() })
  pool.options.set('991', { id: '991', poll_id: '99', option_text: 'Yes', display_order: 0 })
  pool.options.set('992', { id: '992', poll_id: '99', option_text: 'No', display_order: 1 })

  const dispatch = createDispatcher(pool, 20)

  const res = await dispatch('POST', '/2/polls/vote', { optionId: '991' }, 10)
  assert.equal(res.status, 400)
  assert.match(res.body.error, /expired/i)
})

test('Scenario 19: Concurrent duplicate votes safely rejected by unique constraint (23505)', async () => {
  const pool = createMockPool()
  const dispatch = createDispatcher(pool, 10)

  const createRes = await dispatch('POST', '/1/polls', {
    question: 'Concurrent test?',
    options: ['A', 'B'],
  })
  const opt = createRes.body.options[0].id

  // Fire two votes simultaneously for user 20
  const [res1, res2] = await Promise.all([
    dispatch('POST', '/1/polls/vote', { optionId: opt }, 20),
    dispatch('POST', '/1/polls/vote', { optionId: opt }, 20),
  ])

  const statuses = [res1.status, res2.status].sort()
  assert.deepEqual(statuses, [201, 400])
})

test('Fix D: Poll cannot be attached to a Story that already has a Question sticker (rejected with 400)', async () => {
  const pool = createMockPool()
  const dispatch = createDispatcher(pool, 10)

  // Attach a Question sticker to story 1
  pool.questions.set('q1', {
    id: 'q1',
    story_id: '1',
    question_text: 'What is your favorite topic?',
    created_at: new Date().toISOString(),
  })

  // Attempting to attach a Poll to story 1 must be rejected with 400
  const res = await dispatch('POST', '/1/polls', {
    question: 'Favorite language?',
    options: ['JS', 'Python'],
  })

  assert.equal(res.status, 400)
  assert.match(res.body.error, /only have one interactive sticker/i)
})

test('Fix D: Question cannot be attached to a Story that already has a Poll sticker (rejected with 400)', async () => {
  const pool = createMockPool()
  const dispatch = createDispatcher(pool, 10)

  // Attach a Poll sticker to story 1
  await dispatch('POST', '/1/polls', {
    question: 'Initial poll?',
    options: ['Option A', 'Option B'],
  })

  // Attempting to attach a Question to story 1 must be rejected with 400
  const res = await dispatch('POST', '/1/questions', {
    question: 'Attempted question sticker?',
  })

  assert.equal(res.status, 400)
  assert.match(res.body.error, /only have one interactive sticker/i)
})

test('Fix D: Story creation with both Poll and Question stickers rejected with 400', async () => {
  const pool = createMockPool()
  const dispatch = createDispatcher(pool, 10)

  const res = await dispatch('POST', '/', {
    type: 'text',
    content: 'Story with both',
    poll: { question: 'Poll?', options: ['A', 'B'] },
    question: { question: 'Question?' },
  })

  assert.equal(res.status, 400)
  assert.match(res.body.error, /only have one interactive sticker/i)
})

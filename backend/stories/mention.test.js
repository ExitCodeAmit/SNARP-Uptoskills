import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createStoryRouter } from './routes.js'

// ── Mock Pool & Test Harness ──────────────────────────────────────────────────
function createMockPool() {
  let nextStoryId = 1
  let nextMentionId = 1
  let nextNotifId = 1

  const users = new Map([
    [10, { id: 10, name: 'Alice Author', email: 'alice@example.com', profile_image_id: null }],
    [20, { id: 20, name: 'Bob Friend', email: 'bob@example.com', profile_image_id: 200 }],
    [30, { id: 30, name: 'Charlie Colleague', email: 'charlie@example.com', profile_image_id: null }],
    [40, { id: 40, name: 'David Researcher', email: 'david@example.com', profile_image_id: 400 }],
    [50, { id: 50, name: 'Emma Scientist', email: 'emma@example.com', profile_image_id: 500 }],
    [60, { id: 60, name: 'Frank Scholar', email: 'frank@example.com', profile_image_id: null }],
  ])

  const stories = new Map()
  const storyMentions = []
  const notifications = []
  const polls = new Map()
  const pollOptions = new Map()
  const questions = new Map()
  const quizzes = new Map()
  const quizOptions = new Map()

  let txSnapshot = null
  let releaseCalls = 0

  const pool = {
    users,
    stories,
    storyMentions,
    notifications,
    polls,
    pollOptions,
    questions,
    quizzes,
    quizOptions,
    failNotification: false,
    failMention: false,
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
          storyMentions: [...storyMentions],
          notifications: [...notifications],
          polls: new Map(polls),
          pollOptions: new Map(pollOptions),
          questions: new Map(questions),
          quizzes: new Map(quizzes),
          quizOptions: new Map(quizOptions),
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
          storyMentions.length = 0
          storyMentions.push(...txSnapshot.storyMentions)
          notifications.length = 0
          notifications.push(...txSnapshot.notifications)
          polls.clear()
          for (const [k, v] of txSnapshot.polls) polls.set(k, { ...v })
          pollOptions.clear()
          for (const [k, v] of txSnapshot.pollOptions) pollOptions.set(k, { ...v })
          questions.clear()
          for (const [k, v] of txSnapshot.questions) questions.set(k, { ...v })
          quizzes.clear()
          for (const [k, v] of txSnapshot.quizzes) quizzes.set(k, { ...v })
          quizOptions.clear()
          for (const [k, v] of txSnapshot.quizOptions) quizOptions.set(k, { ...v })
        }
        txSnapshot = null
        return { rows: [] }
      }

      // 1. Insert into stories
      if (normalized.startsWith('INSERT INTO stories')) {
        const id = String(nextStoryId++)
        const story = {
          id,
          user_id: params[0],
          type: params[1],
          content: params[2],
          background_style: params[3],
          created_at: new Date().toISOString(),
          expires_at: new Date(Date.now() + 86400000).toISOString(),
        }
        stories.set(id, story)
        return { rows: [story] }
      }

      // 2. Select users by ANY array
      if (normalized.includes('FROM users u') && normalized.includes('WHERE u.id = ANY($1)')) {
        const targetIds = params[0] || []
        const found = []
        for (const id of targetIds) {
          const u = users.get(Number(id))
          if (u) {
            found.push({
              id: u.id,
              name: u.name,
              username: u.name.toLowerCase().replace(/\s+/g, '_'),
              avatar_url: u.profile_image_id ? `/api/images/${u.profile_image_id}` : null,
            })
          }
        }
        return { rows: found }
      }

      // 3. Select single user by id (for creator name)
      if (normalized.includes('FROM users WHERE id = $1')) {
        const u = users.get(Number(params[0]))
        if (u) {
          return { rows: [{ name: u.name }] }
        }
        return { rows: [] }
      }

      // 4. Insert into story_mentions
      if (normalized.startsWith('INSERT INTO story_mentions')) {
        if (pool.failMention) {
          throw new Error('Simulated database error during story_mentions insert')
        }
        const mention = {
          id: nextMentionId++,
          story_id: String(params[0]),
          user_id: Number(params[1]),
          created_at: new Date().toISOString(),
        }
        storyMentions.push(mention)
        return { rows: [mention] }
      }

      // 5. Insert into notifications
      if (normalized.startsWith('INSERT INTO notifications')) {
        if (pool.failNotification) {
          throw new Error('Simulated database error during notification insert')
        }
        const notif = {
          id: nextNotifId++,
          user_id: Number(params[0]),
          actor_id: Number(params[1]),
          kind: 'story_mention',
          entity_type: 'story',
          entity_id: String(params[2]),
          text: String(params[3]),
          created_at: new Date().toISOString(),
          read_at: null,
        }
        notifications.push(notif)
        return { rows: [notif] }
      }

      // 6. Interactive Stickers: Polls
      if (normalized.startsWith('INSERT INTO story_polls')) {
        const pId = 'poll_1'
        const p = { id: pId, story_id: String(params[0]), question: params[1], created_at: new Date().toISOString() }
        polls.set(pId, p)
        return { rows: [p] }
      }
      if (normalized.startsWith('INSERT INTO story_poll_options')) {
        const optId = `opt_${pollOptions.size + 1}`
        const opt = { id: optId, poll_id: String(params[0]), option_text: params[1], display_order: params[2] }
        pollOptions.set(optId, opt)
        return { rows: [opt] }
      }

      // 7. Interactive Stickers: Questions
      if (normalized.startsWith('INSERT INTO story_questions')) {
        const qId = 'q_1'
        const q = { id: qId, story_id: String(params[0]), question_text: params[1], created_at: new Date().toISOString() }
        questions.set(qId, q)
        return { rows: [q] }
      }

      // 8. Interactive Stickers: Quizzes
      if (normalized.startsWith('INSERT INTO story_quizzes')) {
        const quizId = 'quiz_1'
        const quiz = { id: quizId, story_id: String(params[0]), question_text: params[1], correct_option_id: null, created_at: new Date().toISOString() }
        quizzes.set(quizId, quiz)
        return { rows: [quiz] }
      }
      if (normalized.startsWith('INSERT INTO story_quiz_options')) {
        const optId = `quiz_opt_${quizOptions.size + 1}`
        const opt = { id: optId, quiz_id: String(params[0]), option_text: params[1], display_order: params[2] }
        quizOptions.set(optId, opt)
        return { rows: [opt] }
      }
      if (normalized.startsWith('UPDATE story_quizzes SET correct_option_id = $1 WHERE id = $2')) {
        const quiz = quizzes.get(String(params[1]))
        if (quiz) quiz.correct_option_id = String(params[0])
        return { rows: [] }
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
      if (path === '/' && method === 'POST') {
        matchedRoute = 'createStory'
      }

      if (!matchedRoute) {
        return resolve({ status: 404, body: { error: 'Not found in test dispatcher' } })
      }

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

          if (matchedRoute === 'createStory' && rPath === '/' && rMethod === 'POST') {
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

test('Scenario 1: Story creation without mentions still works', async () => {
  const pool = createMockPool()
  const dispatch = createDispatcher(pool, 10)

  const res = await dispatch('POST', '/', {
    type: 'text',
    content: 'Story without mentions',
    backgroundStyle: 'gradient-sunset',
  })

  assert.equal(res.status, 201)
  assert.equal(res.body.content, 'Story without mentions')
  assert.deepEqual(res.body.mentions, [])
  assert.equal(pool.storyMentions.length, 0)
  assert.equal(pool.notifications.length, 0)
})

test('Scenario 2: Story creation with one valid mention', async () => {
  const pool = createMockPool()
  const dispatch = createDispatcher(pool, 10) // Alice Author (id: 10)

  const res = await dispatch('POST', '/', {
    type: 'text',
    content: 'Story with Bob mentioned',
    backgroundStyle: 'gradient-sunset',
    mentions: [20], // Bob (id: 20)
  })

  assert.equal(res.status, 201)
  assert.equal(res.body.mentions.length, 1)
  assert.equal(res.body.mentions[0].id, 20)
  assert.equal(res.body.mentions[0].name, 'Bob Friend')

  // Verify story_mentions record
  assert.equal(pool.storyMentions.length, 1)
  assert.equal(pool.storyMentions[0].story_id, res.body.id)
  assert.equal(pool.storyMentions[0].user_id, 20)

  // Verify notification
  assert.equal(pool.notifications.length, 1)
  assert.equal(pool.notifications[0].user_id, 20)
  assert.equal(pool.notifications[0].actor_id, 10)
  assert.equal(pool.notifications[0].kind, 'story_mention')
  assert.equal(pool.notifications[0].entity_id, res.body.id)
  assert.match(pool.notifications[0].text, /Alice Author mentioned you in their story/i)
})

test('Scenario 3: Story creation with five valid mentions', async () => {
  const pool = createMockPool()
  const dispatch = createDispatcher(pool, 10) // Alice (id: 10)

  const res = await dispatch('POST', '/', {
    type: 'text',
    content: 'Story with 5 users mentioned',
    backgroundStyle: 'gradient-sunset',
    mentions: JSON.stringify([20, 30, 40, 50, 60]), // Exactly 5 valid users
  })

  assert.equal(res.status, 201)
  assert.equal(res.body.mentions.length, 5)
  assert.equal(pool.storyMentions.length, 5)
  assert.equal(pool.notifications.length, 5)

  const notifiedUserIds = pool.notifications.map((n) => n.user_id)
  assert.deepEqual(notifiedUserIds.sort(), [20, 30, 40, 50, 60])
})

test('Scenario 4: More than five mentions are rejected with 400', async () => {
  const pool = createMockPool()
  const dispatch = createDispatcher(pool, 10)

  const res = await dispatch('POST', '/', {
    type: 'text',
    content: 'Story with 6 users',
    backgroundStyle: 'gradient-sunset',
    mentions: [20, 30, 40, 50, 60, 70],
  })

  assert.equal(res.status, 400)
  assert.match(res.body.error, /Cannot mention more than 5 users/i)
  assert.equal(pool.stories.size, 0)
  assert.equal(pool.storyMentions.length, 0)
  assert.equal(pool.notifications.length, 0)
})

test('Scenario 5: Duplicate mention IDs are rejected with 400', async () => {
  const pool = createMockPool()
  const dispatch = createDispatcher(pool, 10)

  const res = await dispatch('POST', '/', {
    type: 'text',
    content: 'Duplicate mentions test',
    backgroundStyle: 'gradient-sunset',
    mentions: [20, 30, 20],
  })

  assert.equal(res.status, 400)
  assert.match(res.body.error, /Duplicate user mentions are not allowed/i)
  assert.equal(pool.stories.size, 0)
  assert.equal(pool.storyMentions.length, 0)
})

test('Scenario 6: Self-mention is rejected with 400', async () => {
  const pool = createMockPool()
  const dispatch = createDispatcher(pool, 10) // Alice (id: 10)

  const res = await dispatch('POST', '/', {
    type: 'text',
    content: 'Self mention test',
    backgroundStyle: 'gradient-sunset',
    mentions: [20, 10], // Includes self
  })

  assert.equal(res.status, 400)
  assert.match(res.body.error, /You cannot mention yourself in your story/i)
  assert.equal(pool.stories.size, 0)
  assert.equal(pool.storyMentions.length, 0)
})

test('Scenario 7: Invalid IDs (zero, negative, decimal, non-numeric) are rejected with 400', async () => {
  const pool = createMockPool()
  const dispatch = createDispatcher(pool, 10)

  const badInputs = [
    [0],
    [-5],
    [1.5],
    ['abc'],
    [null],
  ]

  for (const bad of badInputs) {
    const res = await dispatch('POST', '/', {
      type: 'text',
      content: 'Invalid ID test',
      backgroundStyle: 'gradient-sunset',
      mentions: bad,
    })
    assert.equal(res.status, 400)
    assert.match(res.body.error, /Invalid user ID/i)
  }
  assert.equal(pool.stories.size, 0)
})

test('Scenario 8: Nonexistent users are rejected with 400 and transaction rolled back', async () => {
  const pool = createMockPool()
  const dispatch = createDispatcher(pool, 10)

  const res = await dispatch('POST', '/', {
    type: 'text',
    content: 'Story with nonexistent user',
    backgroundStyle: 'gradient-sunset',
    mentions: [20, 9999], // 9999 does not exist in pool.users
  })

  assert.equal(res.status, 400)
  assert.match(res.body.error, /One or more mentioned users do not exist/i)

  // Verify complete rollback: no story, no mentions, no notifications created
  assert.equal(pool.stories.size, 0)
  assert.equal(pool.storyMentions.length, 0)
  assert.equal(pool.notifications.length, 0)
})

test('Scenario 9: Mention records are linked to the newly created Story in story_mentions', async () => {
  const pool = createMockPool()
  const dispatch = createDispatcher(pool, 10)

  const res = await dispatch('POST', '/', {
    type: 'text',
    content: 'Linking test',
    backgroundStyle: 'gradient-sunset',
    mentions: [20, 30],
  })

  assert.equal(res.status, 201)
  const storyId = res.body.id

  const linked = pool.storyMentions.filter((m) => m.story_id === storyId)
  assert.equal(linked.length, 2)
  assert.equal(linked[0].user_id, 20)
  assert.equal(linked[1].user_id, 30)
})

test('Scenario 10: Mention notifications are created for the correct users with kind story_mention', async () => {
  const pool = createMockPool()
  const dispatch = createDispatcher(pool, 10)

  const res = await dispatch('POST', '/', {
    type: 'text',
    content: 'Notification verification',
    backgroundStyle: 'gradient-sunset',
    mentions: [40, 50],
  })

  assert.equal(res.status, 201)
  assert.equal(pool.notifications.length, 2)

  for (const n of pool.notifications) {
    assert.equal(n.actor_id, 10)
    assert.equal(n.kind, 'story_mention')
    assert.equal(n.entity_type, 'story')
    assert.equal(n.entity_id, res.body.id)
    assert.match(n.text, /Alice Author mentioned you/i)
  }
})

test('Scenario 11: Story creator does not receive their own mention notification', async () => {
  const pool = createMockPool()
  const dispatch = createDispatcher(pool, 10)

  await dispatch('POST', '/', {
    type: 'text',
    content: 'No self-notification',
    backgroundStyle: 'gradient-sunset',
    mentions: [20],
  })

  // Only Bob (20) should be notified, never Alice (10)
  const aliceNotifs = pool.notifications.filter((n) => n.user_id === 10)
  assert.equal(aliceNotifs.length, 0)
})

test('Scenario 12: Notification insertion failure rolls back the Story and mention records', async () => {
  const pool = createMockPool()
  pool.failNotification = true // Simulate notification DB error

  const dispatch = createDispatcher(pool, 10)

  const res = await dispatch('POST', '/', {
    type: 'text',
    content: 'Notification failure test',
    backgroundStyle: 'gradient-sunset',
    mentions: [20],
  })

  assert.equal(res.status, 500)
  assert.match(res.body.error, /Simulated database error during notification insert/i)

  // Verify rollback: story and mentions must NOT be created
  assert.equal(pool.stories.size, 0)
  assert.equal(pool.storyMentions.length, 0)
  assert.equal(pool.notifications.length, 0)
  assert.ok(pool.getReleaseCalls() >= 1, 'Client must be released')
})

test('Scenario 13: Mention insertion failure rolls back the Story', async () => {
  const pool = createMockPool()
  pool.failMention = true // Simulate mention DB error

  const dispatch = createDispatcher(pool, 10)

  const res = await dispatch('POST', '/', {
    type: 'text',
    content: 'Mention failure test',
    backgroundStyle: 'gradient-sunset',
    mentions: [20],
  })

  assert.equal(res.status, 500)
  assert.match(res.body.error, /Simulated database error during story_mentions insert/i)

  // Verify rollback: story must NOT be created
  assert.equal(pool.stories.size, 0)
  assert.equal(pool.storyMentions.length, 0)
  assert.ok(pool.getReleaseCalls() >= 1, 'Client must be released')
})

test('Scenario 14: Existing Story creation with Poll, Question, and Quiz remains unaffected', async () => {
  const pool = createMockPool()
  const dispatch = createDispatcher(pool, 10)

  // Story with Poll + Mentions
  const pollRes = await dispatch('POST', '/', {
    type: 'text',
    content: 'Story with Poll and Mentions',
    backgroundStyle: 'gradient-sunset',
    poll: JSON.stringify({ question: 'Best language?', options: ['JavaScript', 'TypeScript'] }),
    mentions: [20],
  })
  assert.equal(pollRes.status, 201)
  assert.ok(pollRes.body.poll)
  assert.equal(pollRes.body.poll.question, 'Best language?')
  assert.equal(pollRes.body.mentions.length, 1)

  // Story with Question + Mentions
  const qRes = await dispatch('POST', '/', {
    type: 'text',
    content: 'Story with Question and Mentions',
    backgroundStyle: 'gradient-sunset',
    question: JSON.stringify({ question: 'Ask me anything?' }),
    mentions: [30],
  })
  assert.equal(qRes.status, 201)
  assert.ok(qRes.body.question)
  assert.equal(qRes.body.question.question_text, 'Ask me anything?')
  assert.equal(qRes.body.mentions.length, 1)

  // Story with Quiz + Mentions
  const quizRes = await dispatch('POST', '/', {
    type: 'text',
    content: 'Story with Quiz and Mentions',
    backgroundStyle: 'gradient-sunset',
    quiz: JSON.stringify({ question: '2 + 2?', options: ['3', '4', '5'], correctOptionIndex: 1 }),
    mentions: [40],
  })
  assert.equal(quizRes.status, 201)
  assert.ok(quizRes.body.quiz)
  assert.equal(quizRes.body.quiz.question_text, '2 + 2?')
  assert.equal(quizRes.body.mentions.length, 1)
})

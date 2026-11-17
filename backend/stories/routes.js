import { Router } from 'express'
import {
  validateStoryInput,
  parseRange,
  validateReactionType,
  validateStoryReply,
  validateHighlightTitle,
  validatePollInput,
  validateQuestionInput,
  validateQuestionResponse,
  validateQuizInput,
  validateQuizAnswer,
  validateStoryMentions,
  validateStoryReshare,
  isAuthorizedForStory,
  BACKGROUND_STYLES,
} from './validator.js'

/**
 * Creates the Express router for all /api/stories endpoints.
 */
export function createStoryRouter({ pool, auth, isPgId, upload }) {
  const router = Router()

  /**
   * Helper to verify if a viewer is authorized to access a story.
   * Enforces owner access, public 'everyone' access, and 'close_friends' membership.
   * Fails closed if not found or unauthorized.
   */
  async function isStoryAccessible(storyId, viewerId, clientOrPool = pool) {
    if (!isPgId(String(storyId))) {
      return { exists: false, authorized: false, story: null }
    }
    const { rows } = await clientOrPool.query(
      `SELECT s.id, s.user_id, s.audience, s.expires_at,
         EXISTS (
           SELECT 1 FROM close_friends cf
           WHERE cf.user_id = s.user_id AND cf.friend_user_id = $2
         ) AS is_close_friend
       FROM stories s
       WHERE s.id = $1`,
      [storyId, viewerId]
    )
    if (!rows[0]) return { exists: false, authorized: false, story: null }
    const story = rows[0]
    const authorized = isAuthorizedForStory(story, viewerId, story.is_close_friend)
    return { exists: true, authorized, story }
  }

  /**
   * Helper to verify if a viewer is authorized to access a story by authorId and storyId.
   * Enforces owner access, public 'everyone' access, and 'close_friends' membership.
   * Fails closed if unauthorized or unknown audience.
   */
  async function checkStoryAudienceAccess(storyId, authorId, viewerId, clientOrPool = pool) {
    if (Number(authorId) === Number(viewerId)) return true

    let audience = 'everyone'
    try {
      const { rows: audRows } = await clientOrPool.query(
        'SELECT audience FROM stories WHERE id = $1',
        [storyId]
      )
      audience = audRows[0]?.audience || 'everyone'
    } catch {
      // Fallback for legacy mocks/schemas without audience column
      audience = 'everyone'
    }

    if (audience === 'everyone') return true
    if (audience === 'close_friends') {
      try {
        const { rows: cfAuth } = await clientOrPool.query(
          'SELECT 1 FROM close_friends WHERE user_id = $1 AND friend_user_id = $2',
          [authorId, viewerId]
        )
        return Boolean(cfAuth && cfAuth[0])
      } catch {
        return false
      }
    }
    // Unknown audience fails closed
    return false
  }

  async function getPollForStory(storyId, currentUserId) {
    try {
      const { rows: pollRows } = await pool.query(
        'SELECT id::text, story_id::text, question, created_at FROM story_polls WHERE story_id = $1',
        [storyId]
      )
      if (!pollRows[0]) return null
      const poll = pollRows[0]

      const { rows: options } = await pool.query(
        `SELECT o.id::text, o.poll_id::text, o.option_text, o.display_order,
           (SELECT count(*)::int FROM story_poll_votes v WHERE v.option_id = o.id) AS vote_count
         FROM story_poll_options o
         WHERE o.poll_id = $1
         ORDER BY o.display_order ASC, o.id ASC`,
        [poll.id]
      )

      const { rows: voteRows } = await pool.query(
        'SELECT option_id::text FROM story_poll_votes WHERE poll_id = $1 AND user_id = $2',
        [poll.id, currentUserId]
      )

      const totalVotes = options.reduce((sum, opt) => sum + (Number(opt.vote_count) || 0), 0)
      const optionsWithPercent = options.map((opt) => {
        const count = Number(opt.vote_count) || 0
        return {
          ...opt,
          vote_count: count,
          percentage: totalVotes > 0 ? Math.round((count / totalVotes) * 100) : 0,
        }
      })

      return {
        ...poll,
        options: optionsWithPercent,
        total_votes: totalVotes,
        my_vote: voteRows[0]?.option_id || null,
      }
    } catch {
      return null
    }
  }

  async function getQuestionForStory(storyId, currentUserId) {
    try {
      const { rows: qRows } = await pool.query(
        `SELECT q.id::text, q.story_id::text, q.question_text, q.created_at,
           (SELECT count(*)::int FROM story_question_responses sqr WHERE sqr.question_id = q.id) AS response_count,
           (SELECT sqr2.response_text FROM story_question_responses sqr2 WHERE sqr2.question_id = q.id AND sqr2.responder_id = $2 LIMIT 1) AS my_response
         FROM story_questions q
         WHERE q.story_id = $1`,
        [storyId, currentUserId]
      )
      if (!qRows[0]) return null
      return qRows[0]
    } catch {
      return null
    }
  }

  async function getQuizForStory(storyId, currentUserId) {
    try {
      const { rows: quizRows } = await pool.query(
        'SELECT id::text, story_id::text, question_text, correct_option_id::text, created_at FROM story_quizzes WHERE story_id = $1',
        [storyId]
      )
      if (!quizRows[0]) return null
      const quiz = quizRows[0]

      const { rows: options } = await pool.query(
        `SELECT o.id::text, o.quiz_id::text, o.option_text, o.display_order,
           (SELECT count(*)::int FROM story_quiz_responses sqr WHERE sqr.selected_option_id = o.id) AS response_count
         FROM story_quiz_options o
         WHERE o.quiz_id = $1
         ORDER BY o.display_order ASC, o.id ASC`,
        [quiz.id]
      )

      const { rows: storyRows } = await pool.query(
        'SELECT user_id FROM stories WHERE id = $1',
        [storyId]
      )
      const isOwner = storyRows[0] && Number(storyRows[0].user_id) === Number(currentUserId)

      const { rows: respRows } = await pool.query(
        'SELECT selected_option_id::text FROM story_quiz_responses WHERE quiz_id = $1 AND user_id = $2',
        [quiz.id, currentUserId]
      )
      const myAnswer = respRows[0]?.selected_option_id || null
      const hasAnswered = myAnswer !== null

      const totalResponses = options.reduce((sum, opt) => sum + (Number(opt.response_count) || 0), 0)

      // PRIVACY ENFORCEMENT: Never expose correct_option_id, option counts, or correctness before viewer submits
      if (hasAnswered || isOwner) {
        const optionsWithPercent = options.map((opt) => ({
          id: opt.id,
          quiz_id: opt.quiz_id,
          option_text: opt.option_text,
          display_order: opt.display_order,
          response_count: Number(opt.response_count) || 0,
          percentage: totalResponses > 0 ? Math.round(((Number(opt.response_count) || 0) / totalResponses) * 100) : 0,
          is_correct: String(opt.id) === String(quiz.correct_option_id),
        }))

        return {
          id: quiz.id,
          story_id: quiz.story_id,
          question_text: quiz.question_text,
          correct_option_id: quiz.correct_option_id,
          created_at: quiz.created_at,
          options: optionsWithPercent,
          total_responses: totalResponses,
          my_answer: myAnswer,
          is_user_correct: hasAnswered ? (String(myAnswer) === String(quiz.correct_option_id)) : undefined,
        }
      } else {
        const sanitizedOptions = options.map((opt) => ({
          id: opt.id,
          quiz_id: opt.quiz_id,
          option_text: opt.option_text,
          display_order: opt.display_order,
        }))

        return {
          id: quiz.id,
          story_id: quiz.story_id,
          question_text: quiz.question_text,
          created_at: quiz.created_at,
          options: sanitizedOptions,
          total_responses: totalResponses,
          my_answer: null,
        }
      }
    } catch {
      return null
    }
  }

  async function getMentionsForStory(storyId) {
    try {
      const { rows } = await pool.query(
        `SELECT u.id,
           CASE
             WHEN u.name NOT LIKE '%@%' AND trim(u.name) <> '' THEN trim(u.name)
             ELSE split_part(COALESCE(NULLIF(trim(u.name), ''), u.email), '@', 1)
           END AS name,
           split_part(COALESCE(NULLIF(trim(u.name), ''), u.email), '@', 1) AS username,
           CASE WHEN u.profile_image_id IS NULL THEN NULL ELSE '/api/images/' || u.profile_image_id::text END AS avatar_url
         FROM story_mentions sm
         JOIN users u ON u.id = sm.user_id
         WHERE sm.story_id = $1
         ORDER BY sm.id ASC`,
        [storyId]
      )
      return rows
    } catch {
      return []
    }
  }

  async function getReshareAttributionForStory(originalStoryId) {
    if (!originalStoryId) return null
    try {
      const { rows } = await pool.query(
        `SELECT s.id::text, s.user_id, s.type, s.content, s.created_at, s.expires_at,
           s.expires_at > now() AS is_active,
           CASE
             WHEN u.name NOT LIKE '%@%' AND trim(u.name) <> '' THEN trim(u.name)
             ELSE split_part(COALESCE(NULLIF(trim(u.name), ''), u.email), '@', 1)
           END AS author_name,
           split_part(COALESCE(NULLIF(trim(u.name), ''), u.email), '@', 1) AS author_username,
           CASE WHEN u.profile_image_id IS NULL THEN NULL ELSE '/api/images/' || u.profile_image_id::text END AS author_avatar_url
         FROM stories s
         JOIN users u ON u.id = s.user_id
         WHERE s.id = $1`,
        [originalStoryId]
      )
      if (!rows[0]) {
        return {
          id: String(originalStoryId),
          unavailable: true,
          message: 'Original story is no longer available',
        }
      }
      return rows[0]
    } catch {
      return null
    }
  }

  // ── Close Friends Management ────────────────────────────────────────────────
  // GET /api/stories/close-friends: Returns authenticated user's Close Friends list
  router.get('/close-friends', auth, async (req, res, next) => {
    try {
      const { rows } = await pool.query(
        `SELECT u.id,
           CASE
             WHEN u.name NOT LIKE '%@%' AND trim(u.name) <> '' THEN trim(u.name)
             ELSE split_part(COALESCE(NULLIF(trim(u.name), ''), u.email), '@', 1)
           END AS name,
           split_part(COALESCE(NULLIF(trim(u.name), ''), u.email), '@', 1) AS username,
           CASE WHEN u.profile_image_id IS NULL THEN NULL ELSE '/api/images/' || u.profile_image_id::text END AS avatar_url,
           cf.created_at
         FROM close_friends cf
         JOIN users u ON u.id = cf.friend_user_id
         WHERE cf.user_id = $1
         ORDER BY cf.created_at DESC, u.id ASC`,
        [req.userId]
      )
      res.json({ closeFriends: rows, count: rows.length })
    } catch (err) {
      next(err)
    }
  })

  // POST /api/stories/close-friends: Adds a user to the authenticated user's Close Friends list
  router.post('/close-friends', auth, async (req, res, next) => {
    const rawFriendId = req.body?.friendUserId ?? req.body?.userId ?? req.body?.id
    if (!rawFriendId || !isPgId(String(rawFriendId))) {
      return res.status(400).json({ error: 'Valid friendUserId is required', field: 'friendUserId' })
    }
    const friendUserId = Number(rawFriendId)

    if (friendUserId === Number(req.userId)) {
      return res.status(400).json({ error: 'You cannot add yourself to your close friends list', field: 'friendUserId' })
    }

    try {
      // 1. Verify target user exists
      const { rows: targetUser } = await pool.query(
        `SELECT id,
           CASE
             WHEN name NOT LIKE '%@%' AND trim(name) <> '' THEN trim(name)
             ELSE split_part(COALESCE(NULLIF(trim(name), ''), email), '@', 1)
           END AS name,
           split_part(COALESCE(NULLIF(trim(name), ''), email), '@', 1) AS username,
           CASE WHEN profile_image_id IS NULL THEN NULL ELSE '/api/images/' || profile_image_id::text END AS avatar_url
         FROM users
         WHERE id = $1`,
        [friendUserId]
      )

      if (!targetUser[0]) {
        return res.status(404).json({ error: 'User not found' })
      }

      // 2. Check if already in Close Friends list
      const { rows: existing } = await pool.query(
        'SELECT 1 FROM close_friends WHERE user_id = $1 AND friend_user_id = $2',
        [req.userId, friendUserId]
      )
      if (existing[0]) {
        return res.status(409).json({ error: 'User is already in your close friends list' })
      }

      // 3. Insert relationship
      const { rows: inserted } = await pool.query(
        `INSERT INTO close_friends (user_id, friend_user_id)
         VALUES ($1, $2)
         RETURNING created_at`,
        [req.userId, friendUserId]
      )

      res.status(201).json({
        success: true,
        friend: {
          ...targetUser[0],
          created_at: inserted[0]?.created_at,
        },
      })
    } catch (err) {
      next(err)
    }
  })

  // DELETE /api/stories/close-friends/:friendUserId: Removes a user from Close Friends
  router.delete('/close-friends/:friendUserId', auth, async (req, res, next) => {
    if (!isPgId(req.params.friendUserId)) {
      return res.status(400).json({ error: 'Valid friendUserId is required' })
    }
    const friendUserId = Number(req.params.friendUserId)

    try {
      const { rowCount } = await pool.query(
        'DELETE FROM close_friends WHERE user_id = $1 AND friend_user_id = $2',
        [req.userId, friendUserId]
      )

      if (!rowCount || rowCount === 0) {
        return res.status(404).json({ error: 'User is not in your close friends list' })
      }

      res.json({ success: true, message: 'User removed from close friends' })
    } catch (err) {
      next(err)
    }
  })

  // 1. GET /api/stories/tray: Returns current user's stories and peer stories grouped by user
  router.get('/tray', auth, async (req, res, next) => {
    try {
      const [{ rows: myStories }, { rows: users }] = await Promise.all([
        pool.query(
          `SELECT s.id::text, s.type, s.content, s.background_style, s.created_at, s.expires_at,
            s.original_story_id::text,
            CASE
              WHEN sm.id IS NOT NULL THEN '/api/stories/media/' || sm.id::text
              WHEN osm.id IS NOT NULL THEN '/api/stories/media/' || osm.id::text
              ELSE NULL
            END AS media_url,
            (SELECT count(*)::int FROM story_views sv WHERE sv.story_id = s.id) AS view_count,
            (SELECT sr.type FROM story_reactions sr WHERE sr.story_id = s.id AND sr.user_id = $1) AS my_reaction,
            (SELECT count(*)::int FROM story_reactions sr WHERE sr.story_id = s.id) AS reaction_count,
            (SELECT count(*)::int FROM story_replies srep WHERE srep.story_id = s.id) AS reply_count
           FROM stories s
           LEFT JOIN story_media sm ON sm.story_id = s.id
           LEFT JOIN story_media osm ON osm.story_id = s.original_story_id
           WHERE s.user_id = $1 AND s.expires_at > now()
           ORDER BY s.created_at ASC, s.id ASC`,
          [req.userId]
        ),
        pool.query(
          `SELECT
            u.id AS user_id,
            CASE
              WHEN u.name NOT LIKE '%@%' AND trim(u.name) <> '' THEN trim(u.name)
              ELSE split_part(COALESCE(NULLIF(trim(u.name), ''), u.email), '@', 1)
            END AS name,
            CASE
              WHEN u.name NOT LIKE '%@%' AND trim(u.name) <> '' THEN trim(u.name)
              ELSE NULL
            END AS full_name,
            split_part(COALESCE(NULLIF(trim(u.name), ''), u.email), '@', 1) AS username,
            CASE WHEN u.profile_image_id IS NULL THEN NULL ELSE '/api/images/' || u.profile_image_id::text END AS avatar_url,
            EXISTS (
              SELECT 1 FROM stories us
              WHERE us.user_id = u.id
                AND us.expires_at > now()
                AND (us.audience = 'everyone' OR (us.audience = 'close_friends' AND EXISTS (SELECT 1 FROM close_friends cf WHERE cf.user_id = us.user_id AND cf.friend_user_id = $1)))
                AND NOT EXISTS (
                  SELECT 1 FROM story_views sv WHERE sv.story_id = us.id AND sv.viewer_id = $1
                )
            ) AS has_unviewed,
            max(s.created_at) AS latest_created_at,
            count(s.id)::int AS story_count
           FROM stories s
           JOIN users u ON u.id = s.user_id
           WHERE s.user_id <> $1 AND s.expires_at > now()
             AND (s.audience = 'everyone' OR (s.audience = 'close_friends' AND EXISTS (SELECT 1 FROM close_friends cf WHERE cf.user_id = s.user_id AND cf.friend_user_id = $1)))
           GROUP BY u.id, u.name, u.email, u.profile_image_id
           ORDER BY has_unviewed DESC, latest_created_at DESC, u.id DESC`,
          [req.userId]
        ),
      ])

      res.json({ myStories, users })
    } catch (err) {
      next(err)
    }
  })

  // 2. GET /api/stories/users/:userId: Returns all active stories for a specific user
  router.get('/users/:userId', auth, async (req, res, next) => {
    if (!isPgId(req.params.userId)) {
      return res.status(404).json({ error: 'User not found' })
    }

    try {
      const { rows: userRows } = await pool.query(
        `SELECT u.id,
          CASE
            WHEN u.name NOT LIKE '%@%' AND trim(u.name) <> '' THEN trim(u.name)
            ELSE split_part(COALESCE(NULLIF(trim(u.name), ''), u.email), '@', 1)
          END AS name,
          CASE
            WHEN u.name NOT LIKE '%@%' AND trim(u.name) <> '' THEN trim(u.name)
            ELSE NULL
          END AS full_name,
          split_part(COALESCE(NULLIF(trim(u.name), ''), u.email), '@', 1) AS username,
          CASE WHEN u.profile_image_id IS NULL THEN NULL ELSE '/api/images/' || u.profile_image_id::text END AS avatar_url
         FROM users u WHERE u.id = $1`,
        [req.params.userId]
      )

      if (!userRows[0]) {
        return res.status(404).json({ error: 'User not found' })
      }

      const { rows: stories } = await pool.query(
        `SELECT s.id::text, s.type, s.content, s.background_style, s.audience, s.created_at, s.expires_at,
          s.original_story_id::text,
          CASE
            WHEN sm.id IS NOT NULL THEN '/api/stories/media/' || sm.id::text
            WHEN osm.id IS NOT NULL THEN '/api/stories/media/' || osm.id::text
            ELSE NULL
          END AS media_url,
          EXISTS (SELECT 1 FROM story_views sv WHERE sv.story_id = s.id AND sv.viewer_id = $2) AS viewed,
          (SELECT count(*)::int FROM story_views sv WHERE sv.story_id = s.id) AS view_count,
          (SELECT sr.type FROM story_reactions sr WHERE sr.story_id = s.id AND sr.user_id = $2) AS my_reaction,
          (SELECT count(*)::int FROM story_reactions sr WHERE sr.story_id = s.id) AS reaction_count,
          (SELECT count(*)::int FROM story_replies srep WHERE srep.story_id = s.id) AS reply_count
         FROM stories s
         LEFT JOIN story_media sm ON sm.story_id = s.id
         LEFT JOIN story_media osm ON osm.story_id = s.original_story_id
         WHERE s.user_id = $1 AND s.expires_at > now()
           AND (
             s.user_id = $2
             OR s.audience = 'everyone'
             OR (s.audience = 'close_friends' AND EXISTS (SELECT 1 FROM close_friends cf WHERE cf.user_id = s.user_id AND cf.friend_user_id = $2))
           )
         ORDER BY s.created_at ASC, s.id ASC`,
        [req.params.userId, req.userId]
      )

      const storiesWithStickers = await Promise.all(
        stories.map(async (s) => ({
          ...s,
          poll: await getPollForStory(s.id, req.userId),
          question: await getQuestionForStory(s.id, req.userId),
          quiz: await getQuizForStory(s.id, req.userId),
          mentions: await getMentionsForStory(s.id),
          reshare: await getReshareAttributionForStory(s.original_story_id),
        }))
      )

      res.json({ user: userRows[0], stories: storiesWithStickers })
    } catch (err) {
      next(err)
    }
  })

  // 2b. GET /api/stories/:id: Returns a specific story by ID and the owner's active stories (for notifications)
  router.get('/:id', auth, async (req, res, next) => {
    if (!isPgId(req.params.id)) {
      return next()
    }

    try {
      const { rows: storyMeta } = await pool.query(
        'SELECT id, user_id, expires_at > now() AS is_active FROM stories WHERE id = $1',
        [req.params.id]
      )

      if (!storyMeta[0]) {
        return res.status(404).json({ error: 'Story not found' })
      }

      const storyOwnerId = storyMeta[0].user_id

      const authorized = await checkStoryAudienceAccess(req.params.id, storyOwnerId, req.userId)
      if (!authorized) {
        return res.status(404).json({ error: 'Story not found' })
      }

      const { rows: userRows } = await pool.query(
        `SELECT u.id,
          CASE
            WHEN u.name NOT LIKE '%@%' AND trim(u.name) <> '' THEN trim(u.name)
            ELSE split_part(COALESCE(NULLIF(trim(u.name), ''), u.email), '@', 1)
          END AS name,
          CASE
            WHEN u.name NOT LIKE '%@%' AND trim(u.name) <> '' THEN trim(u.name)
            ELSE NULL
          END AS full_name,
          split_part(COALESCE(NULLIF(trim(u.name), ''), u.email), '@', 1) AS username,
          CASE WHEN u.profile_image_id IS NULL THEN NULL ELSE '/api/images/' || u.profile_image_id::text END AS avatar_url
         FROM users u WHERE u.id = $1`,
        [storyOwnerId]
      )

      if (!userRows[0]) {
        return res.status(404).json({ error: 'Story owner not found' })
      }

      const { rows: stories } = await pool.query(
        `SELECT s.id::text, s.type, s.content, s.background_style, s.audience, s.created_at, s.expires_at,
          s.original_story_id::text,
          CASE
            WHEN sm.id IS NOT NULL THEN '/api/stories/media/' || sm.id::text
            WHEN osm.id IS NOT NULL THEN '/api/stories/media/' || osm.id::text
            ELSE NULL
          END AS media_url,
          EXISTS (SELECT 1 FROM story_views sv WHERE sv.story_id = s.id AND sv.viewer_id = $2) AS viewed,
          (SELECT count(*)::int FROM story_views sv WHERE sv.story_id = s.id) AS view_count,
          (SELECT sr.type FROM story_reactions sr WHERE sr.story_id = s.id AND sr.user_id = $2) AS my_reaction,
          (SELECT count(*)::int FROM story_reactions sr WHERE sr.story_id = s.id) AS reaction_count,
          (SELECT count(*)::int FROM story_replies srep WHERE srep.story_id = s.id) AS reply_count
         FROM stories s
         LEFT JOIN story_media sm ON sm.story_id = s.id
         LEFT JOIN story_media osm ON osm.story_id = s.original_story_id
         WHERE s.user_id = $1 AND (s.expires_at > now() OR s.id = $3)
           AND (
             s.user_id = $2
             OR s.audience = 'everyone'
             OR (s.audience = 'close_friends' AND EXISTS (SELECT 1 FROM close_friends cf WHERE cf.user_id = s.user_id AND cf.friend_user_id = $2))
           )
         ORDER BY s.created_at ASC, s.id ASC`,
        [storyOwnerId, req.userId, req.params.id]
      )

      const storiesWithStickers = await Promise.all(
        stories.map(async (s) => ({
          ...s,
          poll: await getPollForStory(s.id, req.userId),
          question: await getQuestionForStory(s.id, req.userId),
          quiz: await getQuizForStory(s.id, req.userId),
          mentions: await getMentionsForStory(s.id),
          reshare: await getReshareAttributionForStory(s.original_story_id),
        }))
      )

      const targetIdx = storiesWithStickers.findIndex((s) => String(s.id) === String(req.params.id))
      const initialIndex = targetIdx >= 0 ? targetIdx : 0

      res.json({
        success: true,
        user: userRows[0],
        stories: storiesWithStickers,
        initialIndex,
        isExpired: !storyMeta[0].is_active,
      })
    } catch (err) {
      next(err)
    }
  })

  // 3. POST /api/stories: Creates a text, photo, or video story atomically
  router.post('/', auth, upload.single('media'), async (req, res, next) => {
    let validated
    try {
      validated = validateStoryInput(req.body, req.file)
    } catch (err) {
      return res.status(400).json({ error: err.message, field: err.field })
    }

    const stickerCount = [req.body.poll, req.body.question, req.body.quiz].filter(Boolean).length
    if (stickerCount > 1) {
      return res.status(400).json({ error: 'A story can only have one interactive sticker (poll, question, or quiz)' })
    }

    let validatedPoll = null
    if (req.body.poll) {
      try {
        const rawPoll = typeof req.body.poll === 'string' ? JSON.parse(req.body.poll) : req.body.poll
        validatedPoll = validatePollInput(rawPoll)
      } catch (err) {
        return res.status(err.status || 400).json({ error: err.message, field: err.field })
      }
    }

    let validatedQuestion = null
    if (req.body.question) {
      try {
        const rawQ = typeof req.body.question === 'string' ? JSON.parse(req.body.question) : req.body.question
        validatedQuestion = validateQuestionInput(rawQ)
      } catch (err) {
        return res.status(err.status || 400).json({ error: err.message, field: err.field })
      }
    }

    let validatedQuiz = null
    if (req.body.quiz) {
      try {
        const rawQuiz = typeof req.body.quiz === 'string' ? JSON.parse(req.body.quiz) : req.body.quiz
        validatedQuiz = validateQuizInput(rawQuiz)
      } catch (err) {
        return res.status(err.status || 400).json({ error: err.message, field: err.field })
      }
    }

    let validatedMentions = []
    if (req.body.mentions !== undefined && req.body.mentions !== null && req.body.mentions !== '') {
      try {
        const rawMentions = typeof req.body.mentions === 'string' ? JSON.parse(req.body.mentions) : req.body.mentions
        validatedMentions = validateStoryMentions(rawMentions, req.userId)
      } catch (err) {
        return res.status(err.status || 400).json({ error: err.message, field: err.field || 'mentions' })
      }
    }

    let client
    let txStarted = false
    let rollbackErr = null

    try {
      client = await pool.connect()
      await client.query('BEGIN')
      txStarted = true

      // Check close friends if audience is 'close_friends'
      const storyAudience = validated.audience || 'everyone'
      if (storyAudience === 'close_friends') {
        const { rows: cfCheck } = await client.query(
          'SELECT 1 FROM close_friends WHERE user_id = $1 LIMIT 1',
          [req.userId]
        )
        if (!cfCheck || !cfCheck[0]) {
          await client.query('ROLLBACK')
          txStarted = false
          return res.status(400).json({
            error: 'Cannot share to Close Friends because your Close Friends list is empty',
            field: 'audience',
          })
        }
      }

      // Insert story metadata
      const { rows: storyRows } = await client.query(
        `INSERT INTO stories (user_id, type, content, background_style, audience)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING id::text, user_id, type, content, background_style, audience, created_at, expires_at`,
        [req.userId, validated.type, validated.content, validated.backgroundStyle, storyAudience]
      )
      const story = storyRows[0]

      // Insert media record if photo or video
      let mediaId = null
      if (validated.type !== 'text') {
        const { rows: mediaRows } = await client.query(
          `INSERT INTO story_media (story_id, media_type, mime, size_bytes, data)
           VALUES ($1, $2, $3, $4, $5)
           RETURNING id::text`,
          [story.id, validated.type, validated.mime, req.file.buffer.length, req.file.buffer]
        )
        mediaId = mediaRows[0].id
      }

      // Insert poll if provided
      let createdPoll = null
      if (validatedPoll) {
        const { rows: pollRows } = await client.query(
          `INSERT INTO story_polls (story_id, question)
           VALUES ($1, $2)
           RETURNING id::text, story_id::text, question, created_at`,
          [story.id, validatedPoll.question]
        )
        const poll = pollRows[0]
        const insertedOptions = []
        for (let i = 0; i < validatedPoll.options.length; i += 1) {
          const { rows: optRows } = await client.query(
            `INSERT INTO story_poll_options (poll_id, option_text, display_order)
             VALUES ($1, $2, $3)
             RETURNING id::text, poll_id::text, option_text, display_order`,
            [poll.id, validatedPoll.options[i], i]
          )
          insertedOptions.push({
            ...optRows[0],
            vote_count: 0,
            percentage: 0,
          })
        }
        createdPoll = {
          ...poll,
          options: insertedOptions,
          total_votes: 0,
          my_vote: null,
        }
      }

      // Insert question if provided
      let createdQuestion = null
      if (validatedQuestion) {
        const { rows: qRows } = await client.query(
          `INSERT INTO story_questions (story_id, question_text)
           VALUES ($1, $2)
           RETURNING id::text, story_id::text, question_text, created_at`,
          [story.id, validatedQuestion.question]
        )
        createdQuestion = {
          ...qRows[0],
          response_count: 0,
          my_response: null,
        }
      }

      // Insert quiz if provided
      let createdQuiz = null
      if (validatedQuiz) {
        const { rows: quizRows } = await client.query(
          `INSERT INTO story_quizzes (story_id, question_text)
           VALUES ($1, $2)
           RETURNING id::text, story_id::text, question_text, created_at`,
          [story.id, validatedQuiz.question]
        )
        const quiz = quizRows[0]
        const insertedOptions = []
        for (let i = 0; i < validatedQuiz.options.length; i += 1) {
          const { rows: optRows } = await client.query(
            `INSERT INTO story_quiz_options (quiz_id, option_text, display_order)
             VALUES ($1, $2, $3)
             RETURNING id::text, quiz_id::text, option_text, display_order`,
            [quiz.id, validatedQuiz.options[i], i]
          )
          insertedOptions.push(optRows[0])
        }
        const correctOption = insertedOptions[validatedQuiz.correctOptionIndex]
        await client.query(
          'UPDATE story_quizzes SET correct_option_id = $1 WHERE id = $2',
          [correctOption.id, quiz.id]
        )
        createdQuiz = {
          ...quiz,
          correct_option_id: correctOption.id,
          options: insertedOptions.map((opt) => ({
            ...opt,
            response_count: 0,
            percentage: 0,
            is_correct: opt.id === correctOption.id,
          })),
          total_responses: 0,
          my_answer: null,
        }
      }

      // Check mentioned users exist in database and insert mentions + notifications
      let createdMentions = []
      if (validatedMentions.length > 0) {
        const { rows: userRows } = await client.query(
          `SELECT u.id,
             CASE
               WHEN u.name NOT LIKE '%@%' AND trim(u.name) <> '' THEN trim(u.name)
               ELSE split_part(COALESCE(NULLIF(trim(u.name), ''), u.email), '@', 1)
             END AS name,
             split_part(COALESCE(NULLIF(trim(u.name), ''), u.email), '@', 1) AS username,
             CASE WHEN u.profile_image_id IS NULL THEN NULL ELSE '/api/images/' || u.profile_image_id::text END AS avatar_url
           FROM users u
           WHERE u.id = ANY($1)`,
          [validatedMentions]
        )
        if (userRows.length !== validatedMentions.length) {
          await client.query('ROLLBACK')
          txStarted = false
          return res.status(400).json({ error: 'One or more mentioned users do not exist', field: 'mentions' })
        }

        // Fetch creator name for notification
        const { rows: creatorRows } = await client.query(
          `SELECT
             CASE
               WHEN name NOT LIKE '%@%' AND trim(name) <> '' THEN trim(name)
               ELSE split_part(COALESCE(NULLIF(trim(name), ''), email), '@', 1)
             END AS name
           FROM users WHERE id = $1`,
          [req.userId]
        )
        const creatorName = creatorRows[0]?.name || 'Someone'
        const notifText = `${creatorName} mentioned you in their story`

        for (const u of userRows) {
          await client.query(
            `INSERT INTO story_mentions (story_id, user_id)
             VALUES ($1, $2)`,
            [story.id, u.id]
          )

          if (Number(u.id) !== Number(req.userId)) {
            await client.query(
              `INSERT INTO notifications (user_id, actor_id, kind, entity_type, entity_id, text)
               VALUES ($1, $2, 'story_mention', 'story', $3, $4)
               ON CONFLICT (user_id, actor_id, kind, entity_type, entity_id) WHERE kind = 'story_mention'
               DO UPDATE SET text = EXCLUDED.text, created_at = now(), read_at = NULL`,
              [u.id, req.userId, story.id, notifText]
            )
          }
        }

        createdMentions = userRows.map((u) => ({
          id: u.id,
          name: u.name,
          username: u.username,
          avatar_url: u.avatar_url,
        }))
      }

      await client.query('COMMIT')
      txStarted = false

      res.status(201).json({
        ...story,
        audience: story?.audience || storyAudience,
        media_url: mediaId ? `/api/stories/media/${mediaId}` : null,
        view_count: 0,
        viewed: false,
        poll: createdPoll,
        question: createdQuestion,
        quiz: createdQuiz,
        mentions: createdMentions,
      })
    } catch (err) {
      if (txStarted) {
        try {
          await client.query('ROLLBACK')
          txStarted = false
        } catch (rbErr) {
          rollbackErr = rbErr
        }
      }
      next(err)
    } finally {
      if (client) {
        if (rollbackErr) {
          client.release(rollbackErr)
        } else {
          client.release()
        }
      }
    }
  })

  // 4. DELETE /api/stories/:id: Deletes own story (cascades to media and views)
  router.delete('/:id', auth, async (req, res, next) => {
    if (!isPgId(req.params.id)) {
      return res.status(404).json({ error: 'Story not found' })
    }

    try {
      const { rows } = await pool.query(
        'DELETE FROM stories WHERE id = $1 AND user_id = $2 RETURNING id',
        [req.params.id, req.userId]
      )

      if (!rows[0]) {
        return res.status(404).json({ error: 'Story not found' })
      }

      res.status(204).end()
    } catch (err) {
      next(err)
    }
  })

  // 5. POST /api/stories/:id/view: Records view for a story
  router.post('/:id/view', auth, async (req, res, next) => {
    if (!isPgId(req.params.id)) {
      return res.status(404).json({ error: 'Story not found' })
    }

    try {
      const { rows: storyRows } = await pool.query(
        'SELECT id, user_id FROM stories WHERE id = $1 AND expires_at > now()',
        [req.params.id]
      )

      if (!storyRows[0]) {
        return res.status(404).json({ error: 'Story not found' })
      }

      const authorized = await checkStoryAudienceAccess(req.params.id, storyRows[0].user_id, req.userId)
      if (!authorized) {
        return res.status(404).json({ error: 'Story not found' })
      }

      // Do not record self-views
      if (Number(storyRows[0].user_id) === Number(req.userId)) {
        const { rows: countRows } = await pool.query(
          'SELECT count(*)::int AS view_count FROM story_views WHERE story_id = $1',
          [req.params.id]
        )
        return res.json({ success: true, viewCount: countRows[0]?.view_count ?? 0, selfView: true })
      }

      await pool.query(
        `INSERT INTO story_views (story_id, viewer_id)
         VALUES ($1, $2)
         ON CONFLICT (story_id, viewer_id) DO NOTHING`,
        [req.params.id, req.userId]
      )

      const { rows: countRows } = await pool.query(
        'SELECT count(*)::int AS view_count FROM story_views WHERE story_id = $1',
        [req.params.id]
      )

      res.json({ success: true, viewCount: countRows[0]?.view_count ?? 0 })
    } catch (err) {
      next(err)
    }
  })

  // 6. GET /api/stories/:id/viewers: Owner-only viewer list
  router.get('/:id/viewers', auth, async (req, res, next) => {
    if (!isPgId(req.params.id)) {
      return res.status(404).json({ error: 'Story not found' })
    }

    try {
      const { rows: storyRows } = await pool.query(
        'SELECT id, user_id FROM stories WHERE id = $1',
        [req.params.id]
      )

      if (!storyRows[0]) {
        return res.status(404).json({ error: 'Story not found' })
      }

      if (Number(storyRows[0].user_id) !== Number(req.userId)) {
        return res.status(403).json({ error: 'Only the story owner can view viewer analytics' })
      }

      const { rows: viewers } = await pool.query(
        `SELECT u.id,
          CASE
            WHEN u.name NOT LIKE '%@%' AND trim(u.name) <> '' THEN trim(u.name)
            ELSE split_part(COALESCE(NULLIF(trim(u.name), ''), u.email), '@', 1)
          END AS name,
          CASE
            WHEN u.name NOT LIKE '%@%' AND trim(u.name) <> '' THEN trim(u.name)
            ELSE NULL
          END AS full_name,
          split_part(COALESCE(NULLIF(trim(u.name), ''), u.email), '@', 1) AS username,
          CASE WHEN u.profile_image_id IS NULL THEN NULL ELSE '/api/images/' || u.profile_image_id::text END AS avatar_url,
          sv.viewed_at,
          sr.type AS reaction_type
         FROM story_views sv
         JOIN users u ON u.id = sv.viewer_id
         LEFT JOIN story_reactions sr ON sr.story_id = sv.story_id AND sr.user_id = sv.viewer_id
         WHERE sv.story_id = $1
         ORDER BY sv.viewed_at DESC`,
        [req.params.id]
      )

      res.json({
        storyId: req.params.id,
        viewCount: viewers.length,
        viewers,
      })
    } catch (err) {
      next(err)
    }
  })

  // 7. GET /api/stories/media/:id: Media delivery with HTTP 206/416 byte-range handling for MP4
  router.get('/media/:id', auth, async (req, res, next) => {
    if (!/^[0-9a-f-]{36}$/i.test(req.params.id)) {
      return res.status(404).end()
    }

    try {
      // Must belong to an active, unexpired story OR a story retained in highlights OR an active reshare,
      // and viewer must be authorized to access the parent story
      const { rows } = await pool.query(
        `SELECT sm.mime, sm.size_bytes, sm.data
         FROM story_media sm
         JOIN stories s ON s.id = sm.story_id
         WHERE sm.id = $1
           AND (
             s.expires_at > now()
             OR EXISTS (SELECT 1 FROM story_highlight_items shi WHERE shi.story_id = s.id)
             OR EXISTS (SELECT 1 FROM stories rs WHERE rs.original_story_id = s.id AND rs.expires_at > now())
           )
           AND (
             s.user_id = $2
             OR s.audience = 'everyone'
             OR (s.audience = 'close_friends' AND EXISTS (SELECT 1 FROM close_friends cf WHERE cf.user_id = s.user_id AND cf.friend_user_id = $2))
           )`,
        [req.params.id, req.userId]
      )

      const media = rows[0]
      if (!media) {
        return res.status(404).end()
      }

      const total = media.size_bytes
      const isVideo = media.mime.startsWith('video/')

      // Photos or standard delivery without range
      if (!isVideo) {
        res.set({
          'Content-Type': media.mime,
          'Content-Length': String(total),
          'Cache-Control': 'private, max-age=86400',
          'X-Content-Type-Options': 'nosniff',
        })
        return res.send(media.data)
      }

      const range = parseRange(req.headers.range, total)

      if (range?.status === 416) {
        res.set('Content-Range', `bytes */${total}`)
        return res.status(416).end()
      }

      // If video requested without Range header, send full video with Accept-Ranges
      if (!range) {
        res.set({
          'Content-Type': media.mime,
          'Content-Length': String(total),
          'Accept-Ranges': 'bytes',
          'Cache-Control': 'private, no-cache',
          'X-Content-Type-Options': 'nosniff',
        })
        return res.send(media.data)
      }

      const chunk = media.data.subarray(range.start, range.end + 1)
      res.status(206).set({
        'Content-Type': media.mime,
        'Content-Range': `bytes ${range.start}-${range.end}/${total}`,
        'Accept-Ranges': 'bytes',
        'Content-Length': String(range.chunkSize),
        'Cache-Control': 'private, no-cache',
        'X-Content-Type-Options': 'nosniff',
      })
      res.send(chunk)
    } catch (err) {
      next(err)
    }
  })

  // 8. POST /api/stories/:id/reactions: Add or update a reaction (love, haha, wow, sad, like)
  router.post('/:id/reactions', auth, async (req, res, next) => {
    if (!isPgId(req.params.id)) {
      return res.status(404).json({ error: 'Story not found' })
    }

    let type
    try {
      type = validateReactionType(req.body?.type)
    } catch (err) {
      return res.status(err.status || 400).json({ error: err.message, field: err.field })
    }

    try {
      // Story must exist and be active (unexpired)
      const { rows: storyRows } = await pool.query(
        'SELECT id, user_id FROM stories WHERE id = $1 AND expires_at > now()',
        [req.params.id]
      )

      if (!storyRows[0]) {
        return res.status(404).json({ error: 'Story not found' })
      }

      const authorized = await checkStoryAudienceAccess(req.params.id, storyRows[0].user_id, req.userId)
      if (!authorized) {
        return res.status(404).json({ error: 'Story not found' })
      }

      // Owner cannot react to their own story
      if (Number(storyRows[0].user_id) === Number(req.userId)) {
        return res.status(400).json({ error: 'Cannot react to your own story' })
      }

      // Ensure view is recorded for the reactor
      await pool.query(
        `INSERT INTO story_views (story_id, viewer_id)
         VALUES ($1, $2)
         ON CONFLICT (story_id, viewer_id) DO NOTHING`,
        [req.params.id, req.userId]
      )

      // Upsert user's reaction for this story
      await pool.query(
        `INSERT INTO story_reactions (story_id, user_id, type)
         VALUES ($1, $2, $3)
         ON CONFLICT (story_id, user_id)
         DO UPDATE SET type = EXCLUDED.type, created_at = now()`,
        [req.params.id, req.userId, type]
      )

      // Notify story owner if reactor is not the owner
      const storyOwnerId = Number(storyRows[0].user_id)
      if (storyOwnerId !== Number(req.userId)) {
        const { rows: actorRows } = await pool.query(
          `SELECT
            CASE
              WHEN name NOT LIKE '%@%' AND trim(name) <> '' THEN trim(name)
              ELSE split_part(COALESCE(NULLIF(trim(name), ''), email), '@', 1)
            END AS name
           FROM users WHERE id = $1`,
          [req.userId]
        )
        const actorName = actorRows[0]?.name || 'Someone'
        const notifText = `${actorName} reacted to your story`

        await pool.query(
          `INSERT INTO notifications (user_id, actor_id, kind, entity_type, entity_id, text)
           VALUES ($1, $2, 'story_reaction', 'story', $3, $4)
           ON CONFLICT (user_id, actor_id, kind, entity_type, entity_id) WHERE kind = 'story_reaction'
           DO UPDATE SET text = EXCLUDED.text, created_at = now(), read_at = NULL`,
          [storyOwnerId, req.userId, req.params.id, notifText]
        )
      }

      // Retrieve aggregated reaction counts
      const { rows: countRows } = await pool.query(
        `SELECT
          count(*)::int AS total,
          count(*) FILTER (WHERE type = 'love')::int AS love,
          count(*) FILTER (WHERE type = 'haha')::int AS haha,
          count(*) FILTER (WHERE type = 'wow')::int AS wow,
          count(*) FILTER (WHERE type = 'sad')::int AS sad,
          count(*) FILTER (WHERE type = 'like')::int AS like
         FROM story_reactions
         WHERE story_id = $1`,
        [req.params.id]
      )

      const counts = countRows[0] || { total: 0, love: 0, haha: 0, wow: 0, sad: 0, like: 0 }

      res.json({
        success: true,
        myReaction: type,
        reactionCount: counts.total,
        counts,
      })
    } catch (err) {
      next(err)
    }
  })

  // 9. DELETE /api/stories/:id/reactions: Remove user's reaction
  router.delete('/:id/reactions', auth, async (req, res, next) => {
    if (!isPgId(req.params.id)) {
      return res.status(404).json({ error: 'Story not found' })
    }

    try {
      // Story must exist and be active
      const { rows: storyRows } = await pool.query(
        'SELECT id, user_id FROM stories WHERE id = $1 AND expires_at > now()',
        [req.params.id]
      )

      if (!storyRows[0]) {
        return res.status(404).json({ error: 'Story not found' })
      }

      const authorized = await checkStoryAudienceAccess(req.params.id, storyRows[0].user_id, req.userId)
      if (!authorized) {
        return res.status(404).json({ error: 'Story not found' })
      }

      // Owner cannot react to their own story
      if (Number(storyRows[0].user_id) === Number(req.userId)) {
        return res.status(400).json({ error: 'Cannot react to your own story' })
      }

      // Delete the calling user's reaction
      await pool.query(
        'DELETE FROM story_reactions WHERE story_id = $1 AND user_id = $2',
        [req.params.id, req.userId]
      )

      // Remove unread reaction notification if reaction is removed
      const storyOwnerId = Number(storyRows[0].user_id)
      if (storyOwnerId !== Number(req.userId)) {
        await pool.query(
          `DELETE FROM notifications
           WHERE user_id = $1 AND actor_id = $2 AND kind = 'story_reaction' AND entity_type = 'story' AND entity_id = $3 AND read_at IS NULL`,
          [storyOwnerId, req.userId, req.params.id]
        )
      }

      // Retrieve updated counts
      const { rows: countRows } = await pool.query(
        `SELECT
          count(*)::int AS total,
          count(*) FILTER (WHERE type = 'love')::int AS love,
          count(*) FILTER (WHERE type = 'haha')::int AS haha,
          count(*) FILTER (WHERE type = 'wow')::int AS wow,
          count(*) FILTER (WHERE type = 'sad')::int AS sad,
          count(*) FILTER (WHERE type = 'like')::int AS like
         FROM story_reactions
         WHERE story_id = $1`,
        [req.params.id]
      )

      const counts = countRows[0] || { total: 0, love: 0, haha: 0, wow: 0, sad: 0, like: 0 }

      res.json({
        success: true,
        myReaction: null,
        reactionCount: counts.total,
        counts,
      })
    } catch (err) {
      next(err)
    }
  })

  // 10. GET /api/stories/:id/reactions: Get reaction summary & user's current reaction
  router.get('/:id/reactions', auth, async (req, res, next) => {
    if (!isPgId(req.params.id)) {
      return res.status(404).json({ error: 'Story not found' })
    }

    try {
      const { rows: storyRows } = await pool.query(
        'SELECT id, user_id FROM stories WHERE id = $1 AND expires_at > now()',
        [req.params.id]
      )

      if (!storyRows[0]) {
        return res.status(404).json({ error: 'Story not found' })
      }

      const authorized = await checkStoryAudienceAccess(req.params.id, storyRows[0].user_id, req.userId)
      if (!authorized) {
        return res.status(404).json({ error: 'Story not found' })
      }

      const [{ rows: countRows }, { rows: userReactionRows }] = await Promise.all([
        pool.query(
          `SELECT
            count(*)::int AS total,
            count(*) FILTER (WHERE type = 'love')::int AS love,
            count(*) FILTER (WHERE type = 'haha')::int AS haha,
            count(*) FILTER (WHERE type = 'wow')::int AS wow,
            count(*) FILTER (WHERE type = 'sad')::int AS sad,
            count(*) FILTER (WHERE type = 'like')::int AS like
           FROM story_reactions
           WHERE story_id = $1`,
          [req.params.id]
        ),
        pool.query(
          'SELECT type FROM story_reactions WHERE story_id = $1 AND user_id = $2',
          [req.params.id, req.userId]
        ),
      ])

      const counts = countRows[0] || { total: 0, love: 0, haha: 0, wow: 0, sad: 0, like: 0 }

      res.json({
        storyId: req.params.id,
        myReaction: userReactionRows[0]?.type || null,
        reactionCount: counts.total,
        counts,
      })
    } catch (err) {
      next(err)
    }
  })

  // 11. POST /api/stories/:id/replies: Send a reply to another user's active story
  router.post('/:id/replies', auth, async (req, res, next) => {
    if (!isPgId(req.params.id)) {
      return res.status(404).json({ error: 'Story not found' })
    }

    let replyText
    try {
      replyText = validateStoryReply(req.body?.text)
    } catch (err) {
      return res.status(err.status || 400).json({ error: err.message, field: err.field })
    }

    try {
      // Story must exist and be active (unexpired)
      const { rows: storyRows } = await pool.query(
        'SELECT id, user_id FROM stories WHERE id = $1 AND expires_at > now()',
        [req.params.id]
      )

      if (!storyRows[0]) {
        return res.status(404).json({ error: 'Story not found' })
      }

      const authorized = await checkStoryAudienceAccess(req.params.id, storyRows[0].user_id, req.userId)
      if (!authorized) {
        return res.status(404).json({ error: 'Story not found' })
      }

      const storyOwnerId = Number(storyRows[0].user_id)

      // Users cannot reply to their own stories
      if (storyOwnerId === Number(req.userId)) {
        return res.status(400).json({ error: 'Cannot reply to your own story' })
      }

      // Record view if not already recorded
      await pool.query(
        `INSERT INTO story_views (story_id, viewer_id)
         VALUES ($1, $2)
         ON CONFLICT (story_id, viewer_id) DO NOTHING`,
        [req.params.id, req.userId]
      )

      // Insert story reply
      const { rows: replyRows } = await pool.query(
        `INSERT INTO story_replies (story_id, sender_id, story_owner_id, text)
         VALUES ($1, $2, $3, $4)
         RETURNING id::text, story_id::text, sender_id, story_owner_id, text, created_at`,
        [req.params.id, req.userId, storyOwnerId, replyText]
      )

      // Fetch sender details
      const { rows: userRows } = await pool.query(
        `SELECT
          CASE
            WHEN name NOT LIKE '%@%' AND trim(name) <> '' THEN trim(name)
            ELSE split_part(COALESCE(NULLIF(trim(name), ''), email), '@', 1)
          END AS name,
          CASE
            WHEN name NOT LIKE '%@%' AND trim(name) <> '' THEN trim(name)
            ELSE NULL
          END AS full_name,
          split_part(COALESCE(NULLIF(trim(name), ''), email), '@', 1) AS username,
          CASE WHEN profile_image_id IS NULL THEN NULL ELSE '/api/images/' || profile_image_id::text END AS avatar_url
         FROM users WHERE id = $1`,
        [req.userId]
      )

      const reply = {
        ...replyRows[0],
        sender_name: userRows[0]?.name || 'User',
        sender_avatar_url: userRows[0]?.avatar_url || null,
      }

      // Notify story owner if sender is not the owner
      if (storyOwnerId !== Number(req.userId)) {
        const actorName = userRows[0]?.name || 'Someone'
        const snippet = replyText.length > 50 ? replyText.slice(0, 47) + '...' : replyText
        const notifText = `${actorName} replied to your story: "${snippet}"`

        await pool.query(
          `INSERT INTO notifications (user_id, actor_id, kind, entity_type, entity_id, text)
           VALUES ($1, $2, 'story_reply', 'story', $3, $4)
           ON CONFLICT (user_id, actor_id, kind, entity_type, entity_id) WHERE kind = 'story_reply'
           DO UPDATE SET text = EXCLUDED.text, created_at = now(), read_at = NULL`,
          [storyOwnerId, req.userId, req.params.id, notifText]
        )
      }

      res.status(201).json({
        success: true,
        reply,
      })
    } catch (err) {
      next(err)
    }
  })

  // 12. GET /api/stories/:id/replies: Owner-only list of replies received on a story
  router.get('/:id/replies', auth, async (req, res, next) => {
    if (!isPgId(req.params.id)) {
      return res.status(404).json({ error: 'Story not found' })
    }

    try {
      // Story must exist
      const { rows: storyRows } = await pool.query(
        'SELECT id, user_id FROM stories WHERE id = $1',
        [req.params.id]
      )

      if (!storyRows[0]) {
        return res.status(404).json({ error: 'Story not found' })
      }

      // Only the story owner can view replies received on their story
      if (Number(storyRows[0].user_id) !== Number(req.userId)) {
        return res.status(403).json({ error: 'Only the story owner can view replies' })
      }

      const { rows: replies } = await pool.query(
        `SELECT
          sr.id::text,
          sr.story_id::text,
          sr.sender_id,
          CASE
            WHEN u.name NOT LIKE '%@%' AND trim(u.name) <> '' THEN trim(u.name)
            ELSE split_part(COALESCE(NULLIF(trim(u.name), ''), u.email), '@', 1)
          END AS sender_name,
          CASE
            WHEN u.name NOT LIKE '%@%' AND trim(u.name) <> '' THEN trim(u.name)
            ELSE NULL
          END AS full_name,
          split_part(COALESCE(NULLIF(trim(u.name), ''), u.email), '@', 1) AS username,
          CASE WHEN u.profile_image_id IS NULL THEN NULL ELSE '/api/images/' || u.profile_image_id::text END AS sender_avatar_url,
          sr.text,
          sr.created_at
         FROM story_replies sr
         JOIN users u ON u.id = sr.sender_id
         WHERE sr.story_id = $1
         ORDER BY sr.created_at DESC, sr.id DESC`,
        [req.params.id]
      )

      res.json({
        storyId: req.params.id,
        count: replies.length,
        replies,
      })
    } catch (err) {
      next(err)
    }
  })

  // 13. POST /api/stories/:id/polls: Creates a poll for an existing story
  router.post('/:id/polls', auth, async (req, res, next) => {
    if (!isPgId(req.params.id)) {
      return res.status(404).json({ error: 'Story not found' })
    }

    let validated
    try {
      validated = validatePollInput(req.body)
    } catch (err) {
      return res.status(err.status || 400).json({ error: err.message, field: err.field })
    }

    let client
    let txStarted = false
    let rollbackErr = null

    try {
      client = await pool.connect()
      await client.query('BEGIN')
      txStarted = true

      // Lock the target story row to serialize concurrent sticker attachments
      const { rows: storyRows } = await client.query(
        'SELECT id, user_id, expires_at FROM stories WHERE id = $1 FOR UPDATE',
        [req.params.id]
      )

      if (!storyRows[0]) {
        await client.query('ROLLBACK')
        txStarted = false
        return res.status(404).json({ error: 'Story not found' })
      }

      const story = storyRows[0]
      if (Number(story.user_id) !== Number(req.userId)) {
        await client.query('ROLLBACK')
        txStarted = false
        return res.status(403).json({ error: 'Only the story owner can add a poll' })
      }

      // Check if a poll already exists on this story
      const { rows: existingPoll } = await client.query(
        'SELECT id FROM story_polls WHERE story_id = $1',
        [req.params.id]
      )
      if (existingPoll[0]) {
        await client.query('ROLLBACK')
        txStarted = false
        return res.status(409).json({ error: 'A poll already exists on this story' })
      }

      // Check if a question sticker already exists on this story (symmetric mutual exclusivity)
      const { rows: existingQuestion } = await client.query(
        'SELECT id FROM story_questions WHERE story_id = $1',
        [req.params.id]
      )
      if (existingQuestion[0]) {
        await client.query('ROLLBACK')
        txStarted = false
        return res.status(400).json({ error: 'A story can only have one interactive sticker (poll, question, or quiz)' })
      }

      // Check if a quiz sticker already exists on this story
      const { rows: existingQuiz } = await client.query(
        'SELECT id FROM story_quizzes WHERE story_id = $1',
        [req.params.id]
      )
      if (existingQuiz[0]) {
        await client.query('ROLLBACK')
        txStarted = false
        return res.status(400).json({ error: 'A story can only have one interactive sticker (poll, question, or quiz)' })
      }

      const { rows: pollRows } = await client.query(
        `INSERT INTO story_polls (story_id, question)
         VALUES ($1, $2)
         RETURNING id::text, story_id::text, question, created_at`,
        [req.params.id, validated.question]
      )
      const poll = pollRows[0]

      const insertedOptions = []
      for (let i = 0; i < validated.options.length; i += 1) {
        const { rows: optRows } = await client.query(
          `INSERT INTO story_poll_options (poll_id, option_text, display_order)
           VALUES ($1, $2, $3)
           RETURNING id::text, poll_id::text, option_text, display_order`,
          [poll.id, validated.options[i], i]
        )
        insertedOptions.push({
          ...optRows[0],
          vote_count: 0,
          percentage: 0,
        })
      }

      await client.query('COMMIT')
      txStarted = false

      res.status(201).json({
        ...poll,
        options: insertedOptions,
        total_votes: 0,
        my_vote: null,
      })
    } catch (err) {
      if (txStarted) {
        try {
          await client.query('ROLLBACK')
          txStarted = false
        } catch (rbErr) {
          rollbackErr = rbErr
        }
      }
      next(err)
    } finally {
      if (client) {
        if (rollbackErr) client.release(rollbackErr)
        else client.release()
      }
    }
  })

  // 14. GET /api/stories/:id/polls: Fetches poll details and aggregated results
  router.get('/:id/polls', auth, async (req, res, next) => {
    if (!isPgId(req.params.id)) {
      return res.status(404).json({ error: 'Story not found' })
    }

    try {
      const { rows: storyRows } = await pool.query(
        'SELECT id FROM stories WHERE id = $1',
        [req.params.id]
      )
      if (!storyRows[0]) {
        return res.status(404).json({ error: 'Story not found' })
      }

      const poll = await getPollForStory(req.params.id, req.userId)
      if (!poll) {
        return res.status(404).json({ error: 'No poll found for this story' })
      }

      res.json(poll)
    } catch (err) {
      next(err)
    }
  })

  // 15. POST /api/stories/:id/polls/vote: Submits a vote on a story poll
  router.post('/:id/polls/vote', auth, async (req, res, next) => {
    if (!isPgId(req.params.id)) {
      return res.status(404).json({ error: 'Story not found' })
    }

    const optionId = req.body?.optionId || req.body?.option_id
    if (!isPgId(optionId)) {
      return res.status(400).json({ error: 'Valid optionId is required', field: 'optionId' })
    }

    try {
      // 1. Story must exist and be active (not expired)
      const { rows: storyRows } = await pool.query(
        'SELECT id, user_id, expires_at FROM stories WHERE id = $1',
        [req.params.id]
      )

      if (!storyRows[0]) {
        return res.status(404).json({ error: 'Story not found' })
      }

      const story = storyRows[0]

      const authorized = await checkStoryAudienceAccess(req.params.id, story.user_id, req.userId)
      if (!authorized) {
        return res.status(404).json({ error: 'Story not found' })
      }

      // Expired check for active voting
      if (new Date(story.expires_at) <= new Date()) {
        return res.status(400).json({ error: 'Cannot vote on an expired story' })
      }

      // 2. Prevent self-voting
      if (Number(story.user_id) === Number(req.userId)) {
        return res.status(400).json({ error: 'Cannot vote on your own story poll' })
      }

      // 3. Story must have a poll
      const { rows: pollRows } = await pool.query(
        'SELECT id, question FROM story_polls WHERE story_id = $1',
        [req.params.id]
      )

      if (!pollRows[0]) {
        return res.status(404).json({ error: 'No poll found for this story' })
      }

      const poll = pollRows[0]

      // 4. Verify option belongs to this poll
      const { rows: optionRows } = await pool.query(
        'SELECT id, option_text FROM story_poll_options WHERE id = $1 AND poll_id = $2',
        [optionId, poll.id]
      )

      if (!optionRows[0]) {
        return res.status(400).json({ error: 'Option does not belong to this poll', field: 'optionId' })
      }

      // 5. Enforce single vote per user per poll
      const { rows: existingVote } = await pool.query(
        'SELECT option_id FROM story_poll_votes WHERE poll_id = $1 AND user_id = $2',
        [poll.id, req.userId]
      )

      if (existingVote[0]) {
        return res.status(400).json({ error: 'You have already voted on this poll' })
      }

      // 6. Record vote
      await pool.query(
        `INSERT INTO story_poll_votes (poll_id, option_id, user_id)
         VALUES ($1, $2, $3)`,
        [poll.id, optionId, req.userId]
      )

      // 7. Auto-record story view
      await pool.query(
        `INSERT INTO story_views (story_id, viewer_id)
         VALUES ($1, $2)
         ON CONFLICT (story_id, viewer_id) DO NOTHING`,
        [req.params.id, req.userId]
      )

      // 8. Fetch voter name to create in-app notification for story owner
      const { rows: userRows } = await pool.query(
        `SELECT
           CASE
             WHEN name NOT LIKE '%@%' AND trim(name) <> '' THEN trim(name)
             ELSE split_part(COALESCE(NULLIF(trim(name), ''), email), '@', 1)
           END AS name
         FROM users WHERE id = $1`,
        [req.userId]
      )

      const actorName = userRows[0]?.name || 'Someone'
      const notifText = `${actorName} voted on your poll: "${poll.question.length > 40 ? poll.question.slice(0, 37) + '...' : poll.question}"`

      await pool.query(
        `INSERT INTO notifications (user_id, actor_id, kind, entity_type, entity_id, text)
         VALUES ($1, $2, 'story_poll_vote', 'story', $3, $4)
         ON CONFLICT (user_id, actor_id, kind, entity_type, entity_id) WHERE kind = 'story_poll_vote'
         DO UPDATE SET text = EXCLUDED.text, created_at = now(), read_at = NULL`,
        [story.user_id, req.userId, story.id, notifText]
      )

      // 9. Return updated poll state
      const updatedPoll = await getPollForStory(req.params.id, req.userId)
      res.status(201).json({
        success: true,
        poll: updatedPoll,
      })
    } catch (err) {
      if (err.code === '23505') {
        return res.status(400).json({ error: 'You have already voted on this poll' })
      }
      next(err)
    }
  })

  // 16. GET /api/stories/:id/polls/voters: Story owner view of voter breakdown
  router.get('/:id/polls/voters', auth, async (req, res, next) => {
    if (!isPgId(req.params.id)) {
      return res.status(404).json({ error: 'Story not found' })
    }

    try {
      const { rows: storyRows } = await pool.query(
        'SELECT id, user_id FROM stories WHERE id = $1',
        [req.params.id]
      )

      if (!storyRows[0]) {
        return res.status(404).json({ error: 'Story not found' })
      }

      // Owner only authorization
      if (Number(storyRows[0].user_id) !== Number(req.userId)) {
        return res.status(403).json({ error: 'Only the story owner can view voter details' })
      }

      const { rows: pollRows } = await pool.query(
        'SELECT id, question FROM story_polls WHERE story_id = $1',
        [req.params.id]
      )

      if (!pollRows[0]) {
        return res.status(404).json({ error: 'No poll found for this story' })
      }

      const poll = pollRows[0]

      const { rows: options } = await pool.query(
        `SELECT o.id::text, o.option_text, o.display_order,
           (SELECT count(*)::int FROM story_poll_votes v WHERE v.option_id = o.id) AS vote_count
         FROM story_poll_options o
         WHERE o.poll_id = $1
         ORDER BY o.display_order ASC, o.id ASC`,
        [poll.id]
      )

      const { rows: voters } = await pool.query(
        `SELECT v.option_id::text, v.user_id, v.created_at,
           o.option_text,
           CASE
             WHEN u.name NOT LIKE '%@%' AND trim(u.name) <> '' THEN trim(u.name)
             ELSE split_part(COALESCE(NULLIF(trim(u.name), ''), u.email), '@', 1)
           END AS voter_name,
           CASE
             WHEN u.name NOT LIKE '%@%' AND trim(u.name) <> '' THEN trim(u.name)
             ELSE NULL
           END AS voter_full_name,
           split_part(COALESCE(NULLIF(trim(u.name), ''), u.email), '@', 1) AS voter_username,
           CASE WHEN u.profile_image_id IS NULL THEN NULL ELSE '/api/images/' || u.profile_image_id::text END AS voter_avatar_url
         FROM story_poll_votes v
         JOIN story_poll_options o ON o.id = v.option_id
         JOIN users u ON u.id = v.user_id
         WHERE v.poll_id = $1
         ORDER BY v.created_at DESC`,
        [poll.id]
      )

      const totalVotes = options.reduce((sum, opt) => sum + (Number(opt.vote_count) || 0), 0)
      const optionsWithBreakdown = options.map((opt) => {
        const count = Number(opt.vote_count) || 0
        const optVoters = voters.filter((v) => String(v.option_id) === String(opt.id))
        return {
          ...opt,
          vote_count: count,
          percentage: totalVotes > 0 ? Math.round((count / totalVotes) * 100) : 0,
          voters: optVoters,
        }
      })

      res.json({
        pollId: String(poll.id),
        storyId: req.params.id,
        question: poll.question,
        totalVotes,
        options: optionsWithBreakdown,
        voters,
      })
    } catch (err) {
      next(err)
    }
  })

  // 17. POST /api/stories/:id/questions: Adds a question sticker to an existing active story
  router.post('/:id/questions', auth, async (req, res, next) => {
    if (!isPgId(req.params.id)) {
      return res.status(404).json({ error: 'Story not found' })
    }

    let validated
    try {
      validated = validateQuestionInput(req.body)
    } catch (err) {
      return res.status(err.status || 400).json({ error: err.message, field: err.field })
    }

    let client
    let txStarted = false
    let rollbackErr = null

    try {
      client = await pool.connect()
      await client.query('BEGIN')
      txStarted = true

      // Lock the target story row to serialize concurrent sticker attachments
      const { rows: storyRows } = await client.query(
        'SELECT id, user_id, expires_at FROM stories WHERE id = $1 FOR UPDATE',
        [req.params.id]
      )

      if (!storyRows[0]) {
        await client.query('ROLLBACK')
        txStarted = false
        return res.status(404).json({ error: 'Story not found' })
      }

      const story = storyRows[0]

      if (new Date(story.expires_at) <= new Date()) {
        await client.query('ROLLBACK')
        txStarted = false
        return res.status(400).json({ error: 'Cannot add a question to an expired story' })
      }

      if (Number(story.user_id) !== Number(req.userId)) {
        await client.query('ROLLBACK')
        txStarted = false
        return res.status(403).json({ error: 'Only the story owner can add a question to this story' })
      }

      // Check for existing question
      const { rows: existingQ } = await client.query(
        'SELECT id FROM story_questions WHERE story_id = $1',
        [req.params.id]
      )
      if (existingQ[0]) {
        await client.query('ROLLBACK')
        txStarted = false
        return res.status(400).json({ error: 'Story already has a question sticker' })
      }

      // Check for existing poll
      const { rows: existingPoll } = await client.query(
        'SELECT id FROM story_polls WHERE story_id = $1',
        [req.params.id]
      )
      if (existingPoll[0]) {
        await client.query('ROLLBACK')
        txStarted = false
        return res.status(400).json({ error: 'A story can only have one interactive sticker (poll, question, or quiz)' })
      }

      // Check for existing quiz
      const { rows: existingQuiz } = await client.query(
        'SELECT id FROM story_quizzes WHERE story_id = $1',
        [req.params.id]
      )
      if (existingQuiz[0]) {
        await client.query('ROLLBACK')
        txStarted = false
        return res.status(400).json({ error: 'A story can only have one interactive sticker (poll, question, or quiz)' })
      }

      const { rows: qRows } = await client.query(
        `INSERT INTO story_questions (story_id, question_text)
         VALUES ($1, $2)
         RETURNING id::text, story_id::text, question_text, created_at`,
        [req.params.id, validated.question]
      )

      await client.query('COMMIT')
      txStarted = false

      res.status(201).json({
        ...qRows[0],
        response_count: 0,
        my_response: null,
      })
    } catch (err) {
      if (txStarted) {
        try {
          await client.query('ROLLBACK')
          txStarted = false
        } catch (rbErr) {
          rollbackErr = rbErr
        }
      }
      next(err)
    } finally {
      if (client) {
        if (rollbackErr) client.release(rollbackErr)
        else client.release()
      }
    }
  })

  // 18. GET /api/stories/:id/questions: Fetches question sticker details and viewer's response
  router.get('/:id/questions', auth, async (req, res, next) => {
    if (!isPgId(req.params.id)) {
      return res.status(404).json({ error: 'Story not found' })
    }

    try {
      const { rows: storyRows } = await pool.query(
        `SELECT id FROM stories
         WHERE id = $1 AND (expires_at > now() OR EXISTS (SELECT 1 FROM story_highlight_items shi WHERE shi.story_id = stories.id))`,
        [req.params.id]
      )
      if (!storyRows[0]) {
        return res.status(404).json({ error: 'Story not found' })
      }

      const question = await getQuestionForStory(req.params.id, req.userId)
      if (!question) {
        return res.status(404).json({ error: 'No question sticker found for this story' })
      }

      res.json(question)
    } catch (err) {
      next(err)
    }
  })

  // 19. POST /api/stories/:id/questions/respond: Submits a response to a story question
  router.post('/:id/questions/respond', auth, async (req, res, next) => {
    if (!isPgId(req.params.id)) {
      return res.status(404).json({ error: 'Story not found' })
    }

    let responseText
    try {
      responseText = validateQuestionResponse(req.body.response ?? req.body.text ?? req.body)
    } catch (err) {
      return res.status(err.status || 400).json({ error: err.message, field: err.field })
    }

    try {
      // 1. Story must exist and be active
      const { rows: storyRows } = await pool.query(
        'SELECT id, user_id, expires_at FROM stories WHERE id = $1',
        [req.params.id]
      )

      if (!storyRows[0]) {
        return res.status(404).json({ error: 'Story not found' })
      }

      const story = storyRows[0]

      const authorized = await checkStoryAudienceAccess(req.params.id, story.user_id, req.userId)
      if (!authorized) {
        return res.status(404).json({ error: 'Story not found' })
      }

      if (new Date(story.expires_at) <= new Date()) {
        return res.status(400).json({ error: 'Cannot respond to an expired story' })
      }

      // 2. Prevent self-responding
      if (Number(story.user_id) === Number(req.userId)) {
        return res.status(400).json({ error: 'Cannot respond to your own story question' })
      }

      // 3. Question must exist on this story
      const { rows: qRows } = await pool.query(
        'SELECT id, question_text FROM story_questions WHERE story_id = $1',
        [req.params.id]
      )

      if (!qRows[0]) {
        return res.status(404).json({ error: 'No question sticker found on this story' })
      }

      const question = qRows[0]

      // 4. Record response
      const { rows: respRows } = await pool.query(
        `INSERT INTO story_question_responses (question_id, responder_id, response_text)
         VALUES ($1, $2, $3)
         RETURNING id::text, question_id::text, responder_id, response_text, created_at`,
        [question.id, req.userId, responseText]
      )
      const createdResponse = respRows[0]

      // 5. Auto-record story view
      await pool.query(
        `INSERT INTO story_views (story_id, viewer_id)
         VALUES ($1, $2)
         ON CONFLICT (story_id, viewer_id) DO NOTHING`,
        [req.params.id, req.userId]
      )

      // 6. Fetch responder clean name and notify story owner
      const { rows: userRows } = await pool.query(
        `SELECT
           CASE
             WHEN name NOT LIKE '%@%' AND trim(name) <> '' THEN trim(name)
             ELSE split_part(COALESCE(NULLIF(trim(name), ''), email), '@', 1)
           END AS name
         FROM users WHERE id = $1`,
        [req.userId]
      )

      const actorName = userRows[0]?.name || 'Someone'
      const shortQ = question.question_text.length > 40
        ? question.question_text.slice(0, 37) + '...'
        : question.question_text
      const notifText = `${actorName} answered your question: "${shortQ}"`

      await pool.query(
        `INSERT INTO notifications (user_id, actor_id, kind, entity_type, entity_id, text)
         VALUES ($1, $2, 'story_question_response', 'story', $3, $4)
         ON CONFLICT (user_id, actor_id, kind, entity_type, entity_id) WHERE kind = 'story_question_response'
         DO UPDATE SET text = EXCLUDED.text, created_at = now(), read_at = NULL`,
        [story.user_id, req.userId, story.id, notifText]
      )

      res.status(201).json({
        success: true,
        response: createdResponse,
        question: await getQuestionForStory(req.params.id, req.userId),
      })
    } catch (err) {
      if (err.code === '23505') {
        return res.status(400).json({ error: 'You have already responded to this question' })
      }
      next(err)
    }
  })

  // 20. GET /api/stories/:id/questions/responses: Story owner view of all submitted responses
  router.get('/:id/questions/responses', auth, async (req, res, next) => {
    if (!isPgId(req.params.id)) {
      return res.status(404).json({ error: 'Story not found' })
    }

    try {
      const { rows: storyRows } = await pool.query(
        'SELECT id, user_id FROM stories WHERE id = $1',
        [req.params.id]
      )

      if (!storyRows[0]) {
        return res.status(404).json({ error: 'Story not found' })
      }

      if (Number(storyRows[0].user_id) !== Number(req.userId)) {
        return res.status(403).json({ error: 'Only the story owner can view question responses' })
      }

      const { rows: qRows } = await pool.query(
        'SELECT id, question_text FROM story_questions WHERE story_id = $1',
        [req.params.id]
      )

      if (!qRows[0]) {
        return res.status(404).json({ error: 'No question found for this story' })
      }

      const question = qRows[0]

      const { rows: responses } = await pool.query(
        `SELECT r.id::text, r.question_id::text, r.responder_id, r.response_text, r.shared_story_id::text, r.created_at,
           CASE
             WHEN u.name NOT LIKE '%@%' AND trim(u.name) <> '' THEN trim(u.name)
             ELSE split_part(COALESCE(NULLIF(trim(u.name), ''), u.email), '@', 1)
           END AS responder_name,
           CASE
             WHEN u.name NOT LIKE '%@%' AND trim(u.name) <> '' THEN trim(u.name)
             ELSE NULL
           END AS responder_full_name,
           split_part(COALESCE(NULLIF(trim(u.name), ''), u.email), '@', 1) AS responder_username,
           CASE WHEN u.profile_image_id IS NULL THEN NULL ELSE '/api/images/' || u.profile_image_id::text END AS responder_avatar_url
         FROM story_question_responses r
         JOIN users u ON u.id = r.responder_id
         WHERE r.question_id = $1
         ORDER BY r.created_at DESC`,
        [question.id]
      )

      res.json({
        questionId: String(question.id),
        storyId: req.params.id,
        question_text: question.question_text,
        totalResponses: responses.length,
        responses,
      })
    } catch (err) {
      next(err)
    }
  })

  // 21. POST /api/stories/:id/questions/share: Story owner shares a response as a new Story
  router.post('/:id/questions/share', auth, async (req, res, next) => {
    if (!isPgId(req.params.id)) {
      return res.status(404).json({ error: 'Story not found' })
    }

    const responseId = req.body?.responseId || req.body?.response_id
    if (!isPgId(responseId)) {
      return res.status(400).json({ error: 'Valid responseId is required', field: 'responseId' })
    }

    let client
    let txStarted = false
    let rollbackErr = null

    try {
      client = await pool.connect()
      await client.query('BEGIN')
      txStarted = true

      const { rows: storyRows } = await client.query(
        'SELECT id, user_id FROM stories WHERE id = $1',
        [req.params.id]
      )

      if (!storyRows[0]) {
        await client.query('ROLLBACK')
        txStarted = false
        return res.status(404).json({ error: 'Story not found' })
      }

      if (Number(storyRows[0].user_id) !== Number(req.userId)) {
        await client.query('ROLLBACK')
        txStarted = false
        return res.status(403).json({ error: 'Only the story owner can share responses' })
      }

      // Verify response belongs to this story's question with row-level locking
      const { rows: respRows } = await client.query(
        `SELECT r.id, r.question_id, r.responder_id, r.response_text, r.shared_story_id,
                q.question_text, q.story_id
         FROM story_question_responses r
         JOIN story_questions q ON q.id = r.question_id
         WHERE r.id = $1 AND q.story_id = $2
         FOR UPDATE OF r`,
        [responseId, req.params.id]
      )

      if (!respRows[0]) {
        await client.query('ROLLBACK')
        txStarted = false
        return res.status(400).json({ error: 'Response not found for this story question' })
      }

      const responseItem = respRows[0]

      // Fix B: Prevent duplicate sharing of the same response
      if (responseItem.shared_story_id) {
        await client.query('ROLLBACK')
        txStarted = false
        return res.status(409).json({ error: 'This response has already been shared as a story' })
      }

      const backgroundStyle = BACKGROUND_STYLES.includes(req.body.backgroundStyle)
        ? req.body.backgroundStyle
        : 'gradient-sunset'

      // Format shared Q&A quote content (capped at 500 chars to respect DB constraint)
      const qText = responseItem.question_text
      const rText = responseItem.response_text
      const maxQ = 200
      const maxR = 260
      const safeQ = qText.length > maxQ ? qText.slice(0, maxQ - 3) + '...' : qText
      const safeR = rText.length > maxR ? rText.slice(0, maxR - 3) + '...' : rText
      const sharedContent = `Q: ${safeQ}\n\nA: "${safeR}"`

      // Insert new story for the story owner
      const { rows: newStoryRows } = await client.query(
        `INSERT INTO stories (user_id, type, content, background_style)
         VALUES ($1, 'text', $2, $3)
         RETURNING id::text, user_id, type, content, background_style, created_at, expires_at`,
        [req.userId, sharedContent, backgroundStyle]
      )
      const newStory = newStoryRows[0]

      // Update response with reference to the shared story
      await client.query(
        'UPDATE story_question_responses SET shared_story_id = $1 WHERE id = $2',
        [newStory.id, responseItem.id]
      )

      // Notify the original responder
      const { rows: ownerRows } = await client.query(
        `SELECT
           CASE
             WHEN name NOT LIKE '%@%' AND trim(name) <> '' THEN trim(name)
             ELSE split_part(COALESCE(NULLIF(trim(name), ''), email), '@', 1)
           END AS name
         FROM users WHERE id = $1`,
        [req.userId]
      )

      const ownerName = ownerRows[0]?.name || 'Someone'
      const notifText = `${ownerName} shared your response to their question!`

      await client.query(
        `INSERT INTO notifications (user_id, actor_id, kind, entity_type, entity_id, text)
         VALUES ($1, $2, 'story_question_answered', 'story', $3, $4)
         ON CONFLICT (user_id, actor_id, kind, entity_type, entity_id) WHERE kind = 'story_question_answered'
         DO UPDATE SET text = EXCLUDED.text, created_at = now(), read_at = NULL`,
        [responseItem.responder_id, req.userId, newStory.id, notifText]
      )

      await client.query('COMMIT')
      txStarted = false

      res.status(201).json({
        success: true,
        story: newStory,
        responseId: String(responseItem.id),
      })
    } catch (err) {
      if (txStarted) {
        try {
          await client.query('ROLLBACK')
          txStarted = false
        } catch (rbErr) {
          rollbackErr = rbErr
        }
      }
      next(err)
    } finally {
      if (client) {
        if (rollbackErr) {
          client.release(rollbackErr)
        } else {
          client.release()
        }
      }
    }
  })

  // 22. POST /api/stories/:id/reshare: Reshares an eligible story as a new story with attribution
  router.post(['/:id/reshare', '/reshare'], auth, async (req, res, next) => {
    const rawId = req.params.id || req.body.storyId || req.body.originalStoryId || req.body.id
    let validated
    try {
      validated = validateStoryReshare(rawId)
    } catch (err) {
      return res.status(err.status || 400).json({ error: err.message, field: err.field })
    }

    let client
    let txStarted = false
    let rollbackErr = null

    try {
      client = await pool.connect()
      await client.query('BEGIN')
      txStarted = true

      // 1. Lock original story row for update
      const { rows: storyRows } = await client.query(
        `SELECT id, user_id, type, content, background_style, original_story_id, expires_at
         FROM stories
         WHERE id = $1
         FOR UPDATE`,
        [validated.storyId]
      )

      if (!storyRows[0]) {
        await client.query('ROLLBACK')
        txStarted = false
        return res.status(404).json({ error: 'Story not found' })
      }

      const originalStory = storyRows[0]

      // Audience check: Close Friends stories cannot be reshared
      let storyAudience = 'everyone'
      try {
        const { rows: audRows } = await client.query(
          'SELECT audience FROM stories WHERE id = $1',
          [originalStory.id]
        )
        storyAudience = audRows[0]?.audience || 'everyone'
      } catch {
        storyAudience = 'everyone'
      }
      if (storyAudience === 'close_friends') {
        await client.query('ROLLBACK')
        txStarted = false
        return res.status(403).json({ error: 'Close Friends stories cannot be reshared' })
      }

      const authorized = await checkStoryAudienceAccess(originalStory.id, originalStory.user_id, req.userId, client)
      if (!authorized) {
        await client.query('ROLLBACK')
        txStarted = false
        return res.status(404).json({ error: 'Story not found' })
      }

      // 2. Reject self-reshare
      if (Number(originalStory.user_id) === Number(req.userId)) {
        await client.query('ROLLBACK')
        txStarted = false
        return res.status(400).json({ error: 'You cannot reshare your own story' })
      }

      // 3. Reject expired original stories
      if (new Date(originalStory.expires_at) <= new Date()) {
        await client.query('ROLLBACK')
        txStarted = false
        return res.status(400).json({ error: 'Cannot reshare an expired story' })
      }

      // 4. Reject nested reshares (cannot reshare a reshared story)
      if (originalStory.original_story_id) {
        await client.query('ROLLBACK')
        txStarted = false
        return res.status(400).json({ error: 'Cannot reshare a reshared story' })
      }

      // 5. Strictly verify that req.userId is mentioned in story_mentions for originalStory.id
      const { rows: mentionRows } = await client.query(
        'SELECT 1 FROM story_mentions WHERE story_id = $1 AND user_id = $2',
        [originalStory.id, req.userId]
      )
      if (!mentionRows[0]) {
        await client.query('ROLLBACK')
        txStarted = false
        return res.status(403).json({ error: 'Only mentioned users can reshare this story' })
      }

      // 6. Reject duplicate reshares by the same user
      const { rows: existingReshares } = await client.query(
        'SELECT id FROM story_reshares WHERE reshared_by_user_id = $1 AND original_story_id = $2',
        [req.userId, originalStory.id]
      )
      if (existingReshares.length > 0) {
        await client.query('ROLLBACK')
        txStarted = false
        return res.status(409).json({ error: 'You have already reshared this story' })
      }

      // 7. Fetch original author public profile
      const { rows: authorRows } = await client.query(
        `SELECT u.id,
           CASE
             WHEN u.name NOT LIKE '%@%' AND trim(u.name) <> '' THEN trim(u.name)
             ELSE split_part(COALESCE(NULLIF(trim(u.name), ''), u.email), '@', 1)
           END AS name,
           split_part(COALESCE(NULLIF(trim(u.name), ''), u.email), '@', 1) AS username,
           CASE WHEN u.profile_image_id IS NULL THEN NULL ELSE '/api/images/' || u.profile_image_id::text END AS avatar_url
         FROM users u WHERE u.id = $1`,
        [originalStory.user_id]
      )
      const author = authorRows[0] || { id: originalStory.user_id, name: 'Someone', username: 'user', avatar_url: null }

      // 7. Fetch resharer public profile
      const { rows: resharerRows } = await client.query(
        `SELECT u.id,
           CASE
             WHEN u.name NOT LIKE '%@%' AND trim(u.name) <> '' THEN trim(u.name)
             ELSE split_part(COALESCE(NULLIF(trim(u.name), ''), u.email), '@', 1)
           END AS name,
           split_part(COALESCE(NULLIF(trim(u.name), ''), u.email), '@', 1) AS username,
           CASE WHEN u.profile_image_id IS NULL THEN NULL ELSE '/api/images/' || u.profile_image_id::text END AS avatar_url
         FROM users u WHERE u.id = $1`,
        [req.userId]
      )
      const resharer = resharerRows[0] || { id: req.userId, name: 'Someone', username: 'user', avatar_url: null }

      // 8. Prepare content and background style
      const customCaption = typeof req.body.content === 'string' ? req.body.content.trim() : ''
      const reshareContent = customCaption
        ? customCaption.slice(0, 500)
        : `Reshared from @${author.username || 'user'}`

      const backgroundStyle = (typeof req.body.backgroundStyle === 'string' && BACKGROUND_STYLES.includes(req.body.backgroundStyle))
        ? req.body.backgroundStyle
        : (originalStory.background_style && BACKGROUND_STYLES.includes(originalStory.background_style) ? originalStory.background_style : 'gradient-royal')

      // 9. Insert new Story record with fresh 24h lifetime retaining original type
      const reshareType = originalStory.type || 'text'
      const { rows: newStoryRows } = await client.query(
        `INSERT INTO stories (user_id, type, content, background_style, original_story_id, expires_at)
         VALUES ($1, $2, $3, $4, $5, now() + interval '24 hours')
         RETURNING id::text, user_id, type, content, background_style, original_story_id::text, created_at, expires_at`,
        [req.userId, reshareType, reshareContent, backgroundStyle, originalStory.id]
      )
      const newStory = newStoryRows[0]

      // Fetch original media id if original story has media
      let reshareMediaUrl = null
      if (reshareType !== 'text') {
        const { rows: mediaRows } = await client.query(
          'SELECT id::text FROM story_media WHERE story_id = $1',
          [originalStory.id]
        )
        if (mediaRows[0]) {
          reshareMediaUrl = `/api/stories/media/${mediaRows[0].id}`
        }
      }

      // 10. Insert story_reshares metadata
      let reshareRecord
      try {
        const { rows: reshareRows } = await client.query(
          `INSERT INTO story_reshares (original_story_id, reshared_story_id, reshared_by_user_id)
           VALUES ($1, $2, $3)
           RETURNING id::text, original_story_id::text, reshared_story_id::text, reshared_by_user_id, created_at`,
          [originalStory.id, newStory.id, req.userId]
        )
        reshareRecord = reshareRows[0]
      } catch (insertErr) {
        if (insertErr.code === '23505') {
          await client.query('ROLLBACK')
          txStarted = false
          return res.status(409).json({ error: 'You have already reshared this story' })
        }
        throw insertErr
      }

      // 11. Create in-app notification for original author
      const notifText = `${resharer.name} reshared your story`
      await client.query(
        `INSERT INTO notifications (user_id, actor_id, kind, entity_type, entity_id, text)
         VALUES ($1, $2, 'story_reshare', 'story', $3, $4)
         ON CONFLICT (user_id, actor_id, kind, entity_type, entity_id) WHERE kind = 'story_reshare'
         DO UPDATE SET text = EXCLUDED.text, created_at = now(), read_at = NULL`,
        [originalStory.user_id, req.userId, newStory.id, notifText]
      )

      await client.query('COMMIT')
      txStarted = false

      // 12. Return safe reshare summary
      res.status(201).json({
        ...newStory,
        media_url: reshareMediaUrl,
        view_count: 0,
        viewed: false,
        poll: null,
        question: null,
        quiz: null,
        mentions: [],
        reshare: {
          id: reshareRecord.id,
          original_story_id: String(originalStory.id),
          reshared_by_user_id: req.userId,
          original_author: {
            id: author.id,
            name: author.name,
            username: author.username,
            avatar_url: author.avatar_url,
          },
        },
      })
    } catch (err) {
      if (txStarted) {
        try {
          await client.query('ROLLBACK')
          txStarted = false
        } catch (rbErr) {
          rollbackErr = rbErr
        }
      }
      next(err)
    } finally {
      if (client) {
        if (rollbackErr) {
          client.release(rollbackErr)
        } else {
          client.release()
        }
      }
    }
  })

  // 13. GET /api/stories/highlights/my-stories: Candidate stories for current user to add to highlights
  router.get('/highlights/my-stories', auth, async (req, res, next) => {
    try {
      const { rows } = await pool.query(
        `SELECT s.id::text, s.type, s.content, s.background_style, s.created_at, s.expires_at,
          CASE WHEN sm.id IS NULL THEN NULL ELSE '/api/stories/media/' || sm.id::text END AS media_url,
          (s.expires_at > now()) AS is_active
         FROM stories s
         LEFT JOIN story_media sm ON sm.story_id = s.id
         WHERE s.user_id = $1
           AND (s.audience IS NULL OR s.audience = 'everyone')
           AND (s.expires_at > now() OR EXISTS (SELECT 1 FROM story_highlight_items shi WHERE shi.story_id = s.id))
         ORDER BY s.created_at DESC`,
        [req.userId]
      )
      res.json({ stories: rows })
    } catch (err) {
      next(err)
    }
  })

  // 14. GET /api/stories/highlights/user/:userId: Public highlight collections for a user profile
  router.get('/highlights/user/:userId', async (req, res, next) => {
    if (!isPgId(req.params.userId)) {
      return res.status(404).json({ error: 'User not found' })
    }

    try {
      const { rows: highlights } = await pool.query(
        `SELECT
          sh.id::text,
          sh.user_id,
          sh.title,
          sh.cover_story_id::text,
          sh.display_order,
          sh.created_at,
          sh.updated_at,
          count(shi.id)::int AS story_count,
          (
            SELECT CASE WHEN sm.id IS NULL THEN NULL ELSE '/api/stories/media/' || sm.id::text END
            FROM stories cs
            LEFT JOIN story_media sm ON sm.story_id = cs.id
            WHERE cs.id = COALESCE(sh.cover_story_id, (SELECT shi2.story_id FROM story_highlight_items shi2 WHERE shi2.highlight_id = sh.id ORDER BY shi2.display_order ASC, shi2.created_at ASC LIMIT 1))
          ) AS cover_media_url,
          (
            SELECT cs.type
            FROM stories cs
            WHERE cs.id = COALESCE(sh.cover_story_id, (SELECT shi2.story_id FROM story_highlight_items shi2 WHERE shi2.highlight_id = sh.id ORDER BY shi2.display_order ASC, shi2.created_at ASC LIMIT 1))
          ) AS cover_type,
          (
            SELECT cs.background_style
            FROM stories cs
            WHERE cs.id = COALESCE(sh.cover_story_id, (SELECT shi2.story_id FROM story_highlight_items shi2 WHERE shi2.highlight_id = sh.id ORDER BY shi2.display_order ASC, shi2.created_at ASC LIMIT 1))
          ) AS cover_background_style
         FROM story_highlights sh
         LEFT JOIN story_highlight_items shi ON shi.highlight_id = sh.id
         WHERE sh.user_id = $1
         GROUP BY sh.id
         ORDER BY sh.display_order ASC, sh.created_at DESC`,
        [req.params.userId]
      )

      res.json({ highlights })
    } catch (err) {
      next(err)
    }
  })

  // Also support /users/:userId/highlights for convenient caller access
  router.get('/users/:userId/highlights', async (req, res, next) => {
    if (!isPgId(req.params.userId)) {
      return res.status(404).json({ error: 'User not found' })
    }
    try {
      const { rows: highlights } = await pool.query(
        `SELECT
          sh.id::text,
          sh.user_id,
          sh.title,
          sh.cover_story_id::text,
          sh.display_order,
          sh.created_at,
          sh.updated_at,
          count(shi.id)::int AS story_count,
          (
            SELECT CASE WHEN sm.id IS NULL THEN NULL ELSE '/api/stories/media/' || sm.id::text END
            FROM stories cs
            LEFT JOIN story_media sm ON sm.story_id = cs.id
            WHERE cs.id = COALESCE(sh.cover_story_id, (SELECT shi2.story_id FROM story_highlight_items shi2 WHERE shi2.highlight_id = sh.id ORDER BY shi2.display_order ASC, shi2.created_at ASC LIMIT 1))
          ) AS cover_media_url,
          (
            SELECT cs.type
            FROM stories cs
            WHERE cs.id = COALESCE(sh.cover_story_id, (SELECT shi2.story_id FROM story_highlight_items shi2 WHERE shi2.highlight_id = sh.id ORDER BY shi2.display_order ASC, shi2.created_at ASC LIMIT 1))
          ) AS cover_type,
          (
            SELECT cs.background_style
            FROM stories cs
            WHERE cs.id = COALESCE(sh.cover_story_id, (SELECT shi2.story_id FROM story_highlight_items shi2 WHERE shi2.highlight_id = sh.id ORDER BY shi2.display_order ASC, shi2.created_at ASC LIMIT 1))
          ) AS cover_background_style
         FROM story_highlights sh
         LEFT JOIN story_highlight_items shi ON shi.highlight_id = sh.id
         WHERE sh.user_id = $1
         GROUP BY sh.id
         ORDER BY sh.display_order ASC, sh.created_at DESC`,
        [req.params.userId]
      )
      res.json({ highlights })
    } catch (err) {
      next(err)
    }
  })

  // 15. POST /api/stories/highlights: Create a new highlight collection
  router.post('/highlights', auth, async (req, res, next) => {
    let title
    try {
      title = validateHighlightTitle(req.body?.title)
    } catch (err) {
      return res.status(err.status || 400).json({ error: err.message, field: err.field })
    }

    const storyIds = Array.isArray(req.body?.storyIds) ? req.body.storyIds : []
    const coverStoryId = req.body?.coverStoryId ? String(req.body.coverStoryId) : null

    let client
    let txStarted = false
    try {
      client = await pool.connect()
      await client.query('BEGIN')
      txStarted = true

      // Create highlight
      const { rows: highlightRows } = await client.query(
        `INSERT INTO story_highlights (user_id, title)
         VALUES ($1, $2)
         RETURNING id::text, user_id, title, cover_story_id::text, display_order, created_at, updated_at`,
        [req.userId, title]
      )
      const highlight = highlightRows[0]

      // If initial storyIds provided, validate and add them
      let effectiveCoverId = null
      if (storyIds.length > 0) {
        for (let idx = 0; idx < storyIds.length; idx += 1) {
          const sId = storyIds[idx]
          if (!isPgId(sId)) continue

          // Verify ownership & validity
          const { rows: storyCheck } = await client.query(
            `SELECT id, user_id, expires_at FROM stories WHERE id = $1`,
            [sId]
          )
          if (!storyCheck[0] || Number(storyCheck[0].user_id) !== Number(req.userId)) {
            continue
          }

          // Close Friends stories cannot be added to public highlights
          let isCfStory = false
          try {
            const { rows: audRows } = await client.query(
              'SELECT audience FROM stories WHERE id = $1',
              [sId]
            )
            isCfStory = audRows[0]?.audience === 'close_friends'
          } catch {
            isCfStory = false
          }
          if (isCfStory) {
            continue
          }

          // If expired, must be retained in an existing highlight
          if (new Date(storyCheck[0].expires_at) <= new Date()) {
            const { rows: retained } = await client.query(
              `SELECT 1 FROM story_highlight_items WHERE story_id = $1 LIMIT 1`,
              [sId]
            )
            if (!retained[0]) continue
          }

          await client.query(
            `INSERT INTO story_highlight_items (highlight_id, story_id, display_order)
             VALUES ($1, $2, $3)
             ON CONFLICT (highlight_id, story_id) DO NOTHING`,
            [highlight.id, sId, idx]
          )

          if (!effectiveCoverId) {
            effectiveCoverId = sId
          }
        }
      }

      // Set cover
      const chosenCover = (coverStoryId && storyIds.includes(coverStoryId)) ? coverStoryId : effectiveCoverId
      if (chosenCover) {
        await client.query(
          `UPDATE story_highlights SET cover_story_id = $1 WHERE id = $2`,
          [chosenCover, highlight.id]
        )
        highlight.cover_story_id = chosenCover
      }

      await client.query('COMMIT')
      txStarted = false

      res.status(201).json({
        success: true,
        highlight,
      })
    } catch (err) {
      if (txStarted) {
        try { await client.query('ROLLBACK') } catch {}
      }
      next(err)
    } finally {
      if (client) client.release()
    }
  })

  // 16. POST /api/stories/highlights/:highlightId/items: Add story to highlight
  router.post('/highlights/:highlightId/items', auth, async (req, res, next) => {
    if (!isPgId(req.params.highlightId)) {
      return res.status(404).json({ error: 'Highlight not found' })
    }

    const storyId = req.body?.storyId || req.body?.story_id
    if (!isPgId(storyId)) {
      return res.status(400).json({ error: 'Valid storyId is required' })
    }

    try {
      // Highlight must exist and belong to user
      const { rows: hlRows } = await pool.query(
        'SELECT id, user_id, cover_story_id FROM story_highlights WHERE id = $1',
        [req.params.highlightId]
      )
      if (!hlRows[0]) {
        return res.status(404).json({ error: 'Highlight not found' })
      }
      if (Number(hlRows[0].user_id) !== Number(req.userId)) {
        return res.status(403).json({ error: 'Only the highlight owner can add stories' })
      }

      // Story must exist and belong to the same user
      const { rows: storyRows } = await pool.query(
        'SELECT id, user_id, expires_at FROM stories WHERE id = $1',
        [storyId]
      )
      if (!storyRows[0]) {
        return res.status(404).json({ error: 'Story not found' })
      }
      if (Number(storyRows[0].user_id) !== Number(req.userId)) {
        return res.status(403).json({ error: "Cannot add another user's story to your highlight" })
      }

      // Close Friends protection: Close Friends stories cannot be added to public highlights
      let isCfStory = false
      try {
        const { rows: audRows } = await pool.query(
          'SELECT audience FROM stories WHERE id = $1',
          [storyId]
        )
        isCfStory = audRows[0]?.audience === 'close_friends'
      } catch {
        isCfStory = false
      }
      if (isCfStory) {
        return res.status(400).json({ error: 'Close Friends stories cannot be added to public highlights' })
      }

      // If story is expired, it must already be safely retained in at least one highlight
      if (new Date(storyRows[0].expires_at) <= new Date()) {
        const { rows: retained } = await pool.query(
          'SELECT 1 FROM story_highlight_items WHERE story_id = $1 LIMIT 1',
          [storyId]
        )
        if (!retained[0]) {
          return res.status(400).json({ error: 'Expired story cannot be added because it is not retained in any highlight' })
        }
      }

      // Check if already in this highlight
      const { rows: existing } = await pool.query(
        'SELECT id FROM story_highlight_items WHERE highlight_id = $1 AND story_id = $2',
        [req.params.highlightId, storyId]
      )
      if (existing[0]) {
        return res.status(400).json({ error: 'Story is already in this highlight' })
      }

      // Insert item
      const { rows: itemRows } = await pool.query(
        `INSERT INTO story_highlight_items (highlight_id, story_id, display_order)
         VALUES ($1, $2, (SELECT COALESCE(MAX(display_order), 0) + 1 FROM story_highlight_items WHERE highlight_id = $1))
         RETURNING id::text, highlight_id::text, story_id::text, display_order, created_at`,
        [req.params.highlightId, storyId]
      )

      // Set cover if currently null
      if (!hlRows[0].cover_story_id) {
        await pool.query(
          'UPDATE story_highlights SET cover_story_id = $1, updated_at = now() WHERE id = $2',
          [storyId, req.params.highlightId]
        )
      } else {
        await pool.query('UPDATE story_highlights SET updated_at = now() WHERE id = $1', [req.params.highlightId])
      }

      res.status(201).json({
        success: true,
        item: itemRows[0],
      })
    } catch (err) {
      next(err)
    }
  })

  // 17. DELETE /api/stories/highlights/:highlightId/items/:storyId: Remove story from highlight
  router.delete('/highlights/:highlightId/items/:storyId', auth, async (req, res, next) => {
    if (!isPgId(req.params.highlightId) || !isPgId(req.params.storyId)) {
      return res.status(404).json({ error: 'Resource not found' })
    }

    try {
      const { rows: hlRows } = await pool.query(
        'SELECT id, user_id, cover_story_id FROM story_highlights WHERE id = $1',
        [req.params.highlightId]
      )
      if (!hlRows[0]) {
        return res.status(404).json({ error: 'Highlight not found' })
      }
      if (Number(hlRows[0].user_id) !== Number(req.userId)) {
        return res.status(403).json({ error: 'Only the highlight owner can remove stories' })
      }

      const { rowCount } = await pool.query(
        'DELETE FROM story_highlight_items WHERE highlight_id = $1 AND story_id = $2',
        [req.params.highlightId, req.params.storyId]
      )
      if (rowCount === 0) {
        return res.status(404).json({ error: 'Story not found in this highlight' })
      }

      // If removed story was the cover, update to next available story or NULL
      if (String(hlRows[0].cover_story_id) === String(req.params.storyId)) {
        const { rows: nextCover } = await pool.query(
          'SELECT story_id FROM story_highlight_items WHERE highlight_id = $1 ORDER BY display_order ASC, created_at ASC LIMIT 1',
          [req.params.highlightId]
        )
        const nextCoverId = nextCover[0]?.story_id || null
        await pool.query(
          'UPDATE story_highlights SET cover_story_id = $1, updated_at = now() WHERE id = $2',
          [nextCoverId, req.params.highlightId]
        )
      } else {
        await pool.query('UPDATE story_highlights SET updated_at = now() WHERE id = $1', [req.params.highlightId])
      }

      res.json({ success: true, message: 'Story removed from highlight' })
    } catch (err) {
      next(err)
    }
  })

  // 18. PUT /api/stories/highlights/:highlightId: Update highlight title, cover, or order
  router.put('/highlights/:highlightId', auth, async (req, res, next) => {
    if (!isPgId(req.params.highlightId)) {
      return res.status(404).json({ error: 'Highlight not found' })
    }

    try {
      const { rows: hlRows } = await pool.query(
        'SELECT id, user_id, title, cover_story_id, display_order FROM story_highlights WHERE id = $1',
        [req.params.highlightId]
      )
      if (!hlRows[0]) {
        return res.status(404).json({ error: 'Highlight not found' })
      }
      if (Number(hlRows[0].user_id) !== Number(req.userId)) {
        return res.status(403).json({ error: 'Only the highlight owner can update it' })
      }

      let newTitle = hlRows[0].title
      if (req.body?.title !== undefined) {
        try {
          newTitle = validateHighlightTitle(req.body.title)
        } catch (err) {
          return res.status(err.status || 400).json({ error: err.message, field: err.field })
        }
      }

      let newCoverId = hlRows[0].cover_story_id
      if (req.body?.coverStoryId !== undefined || req.body?.cover_story_id !== undefined) {
        const candidateCover = req.body.coverStoryId || req.body.cover_story_id
        if (candidateCover === null) {
          newCoverId = null
        } else if (isPgId(candidateCover)) {
          // Verify cover story is in this highlight
          const { rows: itemCheck } = await pool.query(
            'SELECT 1 FROM story_highlight_items WHERE highlight_id = $1 AND story_id = $2',
            [req.params.highlightId, candidateCover]
          )
          if (itemCheck[0]) {
            newCoverId = candidateCover
          }
        }
      }

      let newOrder = hlRows[0].display_order
      if (Number.isInteger(req.body?.displayOrder || req.body?.display_order)) {
        newOrder = req.body.displayOrder || req.body.display_order
      }

      const { rows: updatedRows } = await pool.query(
        `UPDATE story_highlights
         SET title = $1, cover_story_id = $2, display_order = $3, updated_at = now()
         WHERE id = $4
         RETURNING id::text, user_id, title, cover_story_id::text, display_order, created_at, updated_at`,
        [newTitle, newCoverId, newOrder, req.params.highlightId]
      )

      res.json({
        success: true,
        highlight: updatedRows[0],
      })
    } catch (err) {
      next(err)
    }
  })

  // 19. DELETE /api/stories/highlights/:highlightId: Delete highlight
  router.delete('/highlights/:highlightId', auth, async (req, res, next) => {
    if (!isPgId(req.params.highlightId)) {
      return res.status(404).json({ error: 'Highlight not found' })
    }

    try {
      const { rows: hlRows } = await pool.query(
        'SELECT id, user_id FROM story_highlights WHERE id = $1',
        [req.params.highlightId]
      )
      if (!hlRows[0]) {
        return res.status(404).json({ error: 'Highlight not found' })
      }
      if (Number(hlRows[0].user_id) !== Number(req.userId)) {
        return res.status(403).json({ error: 'Only the highlight owner can delete it' })
      }

      await pool.query('DELETE FROM story_highlights WHERE id = $1', [req.params.highlightId])

      res.json({ success: true, message: 'Highlight deleted' })
    } catch (err) {
      next(err)
    }
  })

  // 20. GET /api/stories/highlights/:highlightId: Get highlight details and its stories
  // (Also falls back to user highlights if :highlightId matches a user and not a highlight)
  router.get('/highlights/:highlightId', async (req, res, next) => {
    if (!isPgId(req.params.highlightId)) {
      return res.status(404).json({ error: 'Highlight not found' })
    }

    const currentUserId = req.userId || null

    try {
      const { rows: hlRows } = await pool.query(
        `SELECT sh.id::text, sh.user_id, sh.title, sh.cover_story_id::text, sh.display_order, sh.created_at, sh.updated_at,
          CASE
            WHEN u.name NOT LIKE '%@%' AND trim(u.name) <> '' THEN trim(u.name)
            ELSE split_part(COALESCE(NULLIF(trim(u.name), ''), u.email), '@', 1)
          END AS user_name,
          CASE
            WHEN u.name NOT LIKE '%@%' AND trim(u.name) <> '' THEN trim(u.name)
            ELSE NULL
          END AS full_name,
          split_part(COALESCE(NULLIF(trim(u.name), ''), u.email), '@', 1) AS username,
          CASE WHEN u.profile_image_id IS NULL THEN NULL ELSE '/api/images/' || u.profile_image_id::text END AS user_avatar_url
         FROM story_highlights sh
         JOIN users u ON u.id = sh.user_id
         WHERE sh.id = $1`,
        [req.params.highlightId]
      )

      if (hlRows[0]) {
        const highlight = hlRows[0]
        const { rows: stories } = await pool.query(
          `SELECT
            s.id::text, s.type, s.content, s.background_style, s.created_at, s.expires_at,
            CASE WHEN sm.id IS NULL THEN NULL ELSE '/api/stories/media/' || sm.id::text END AS media_url,
            EXISTS (SELECT 1 FROM story_views sv WHERE sv.story_id = s.id AND sv.viewer_id = $2) AS viewed,
            (SELECT count(*)::int FROM story_views sv WHERE sv.story_id = s.id) AS view_count,
            (SELECT sr.type FROM story_reactions sr WHERE sr.story_id = s.id AND sr.user_id = $2) AS my_reaction,
            (SELECT count(*)::int FROM story_reactions sr WHERE sr.story_id = s.id) AS reaction_count,
            (SELECT count(*)::int FROM story_replies srep WHERE srep.story_id = s.id) AS reply_count,
            shi.display_order AS highlight_order
           FROM story_highlight_items shi
           JOIN stories s ON s.id = shi.story_id
           LEFT JOIN story_media sm ON sm.story_id = s.id
           WHERE shi.highlight_id = $1
           ORDER BY shi.display_order ASC, shi.created_at ASC`,
          [req.params.highlightId, currentUserId]
        )

        return res.json({
          highlight,
          user: {
            id: highlight.user_id,
            name: highlight.user_name,
            avatar_url: highlight.user_avatar_url,
          },
          stories,
        })
      }

      // Fallback: If not a highlight ID, check if it was called as GET /highlights/:userId
      const { rows: userHighlights } = await pool.query(
        `SELECT
          sh.id::text,
          sh.user_id,
          sh.title,
          sh.cover_story_id::text,
          sh.display_order,
          sh.created_at,
          sh.updated_at,
          count(shi.id)::int AS story_count,
          (
            SELECT CASE WHEN sm.id IS NULL THEN NULL ELSE '/api/stories/media/' || sm.id::text END
            FROM stories cs
            LEFT JOIN story_media sm ON sm.story_id = cs.id
            WHERE cs.id = COALESCE(sh.cover_story_id, (SELECT shi2.story_id FROM story_highlight_items shi2 WHERE shi2.highlight_id = sh.id ORDER BY shi2.display_order ASC, shi2.created_at ASC LIMIT 1))
          ) AS cover_media_url,
          (
            SELECT cs.type
            FROM stories cs
            WHERE cs.id = COALESCE(sh.cover_story_id, (SELECT shi2.story_id FROM story_highlight_items shi2 WHERE shi2.highlight_id = sh.id ORDER BY shi2.display_order ASC, shi2.created_at ASC LIMIT 1))
          ) AS cover_type,
          (
            SELECT cs.background_style
            FROM stories cs
            WHERE cs.id = COALESCE(sh.cover_story_id, (SELECT shi2.story_id FROM story_highlight_items shi2 WHERE shi2.highlight_id = sh.id ORDER BY shi2.display_order ASC, shi2.created_at ASC LIMIT 1))
          ) AS cover_background_style
         FROM story_highlights sh
         LEFT JOIN story_highlight_items shi ON shi.highlight_id = sh.id
         WHERE sh.user_id = $1
         GROUP BY sh.id
         ORDER BY sh.display_order ASC, sh.created_at DESC`,
        [req.params.highlightId]
      )

      if (userHighlights.length > 0) {
        return res.json({ highlights: userHighlights })
      }

      // Check if user exists but has 0 highlights
      const { rows: userExists } = await pool.query('SELECT id FROM users WHERE id = $1', [req.params.highlightId])
      if (userExists[0]) {
        return res.json({ highlights: [] })
      }

      return res.status(404).json({ error: 'Highlight not found' })
    } catch (err) {
      next(err)
    }
  })

  // ── Quiz Endpoints (Phase 3) ────────────────────────────────────────────────

  // 22. POST /api/stories/:id/quizzes: Creator attaches a quiz to an existing active Story
  router.post('/:id/quizzes', auth, async (req, res, next) => {
    if (!isPgId(req.params.id)) {
      return res.status(404).json({ error: 'Story not found' })
    }

    let validated
    try {
      validated = validateQuizInput(req.body)
    } catch (err) {
      return res.status(err.status || 400).json({ error: err.message, field: err.field })
    }

    let client
    let txStarted = false
    let rollbackErr = null

    try {
      client = await pool.connect()
      await client.query('BEGIN')
      txStarted = true

      // Lock the target story row to serialize concurrent sticker attachments
      const { rows: storyRows } = await client.query(
        'SELECT id, user_id, expires_at FROM stories WHERE id = $1 FOR UPDATE',
        [req.params.id]
      )

      if (!storyRows[0]) {
        await client.query('ROLLBACK')
        txStarted = false
        return res.status(404).json({ error: 'Story not found' })
      }

      const story = storyRows[0]

      if (new Date(story.expires_at) <= new Date()) {
        await client.query('ROLLBACK')
        txStarted = false
        return res.status(400).json({ error: 'Cannot add a quiz to an expired story' })
      }

      if (Number(story.user_id) !== Number(req.userId)) {
        await client.query('ROLLBACK')
        txStarted = false
        return res.status(403).json({ error: 'Only the story owner can add a quiz to this story' })
      }

      // Mutual exclusivity checks
      const { rows: existingQuiz } = await client.query(
        'SELECT id FROM story_quizzes WHERE story_id = $1',
        [req.params.id]
      )
      if (existingQuiz[0]) {
        await client.query('ROLLBACK')
        txStarted = false
        return res.status(409).json({ error: 'A quiz already exists on this story' })
      }

      const { rows: existingPoll } = await client.query(
        'SELECT id FROM story_polls WHERE story_id = $1',
        [req.params.id]
      )
      if (existingPoll[0]) {
        await client.query('ROLLBACK')
        txStarted = false
        return res.status(400).json({ error: 'A story can only have one interactive sticker (poll, question, or quiz)' })
      }

      const { rows: existingQuestion } = await client.query(
        'SELECT id FROM story_questions WHERE story_id = $1',
        [req.params.id]
      )
      if (existingQuestion[0]) {
        await client.query('ROLLBACK')
        txStarted = false
        return res.status(400).json({ error: 'A story can only have one interactive sticker (poll, question, or quiz)' })
      }

      const { rows: quizRows } = await client.query(
        `INSERT INTO story_quizzes (story_id, question_text)
         VALUES ($1, $2)
         RETURNING id::text, story_id::text, question_text, created_at`,
        [req.params.id, validated.question]
      )
      const quiz = quizRows[0]

      const insertedOptions = []
      for (let i = 0; i < validated.options.length; i += 1) {
        const { rows: optRows } = await client.query(
          `INSERT INTO story_quiz_options (quiz_id, option_text, display_order)
           VALUES ($1, $2, $3)
           RETURNING id::text, quiz_id::text, option_text, display_order`,
          [quiz.id, validated.options[i], i]
        )
        insertedOptions.push(optRows[0])
      }

      const correctOption = insertedOptions[validated.correctOptionIndex]
      await client.query(
        'UPDATE story_quizzes SET correct_option_id = $1 WHERE id = $2',
        [correctOption.id, quiz.id]
      )

      await client.query('COMMIT')
      txStarted = false

      res.status(201).json({
        ...quiz,
        correct_option_id: correctOption.id,
        options: insertedOptions.map((opt) => ({
          ...opt,
          response_count: 0,
          percentage: 0,
          is_correct: opt.id === correctOption.id,
        })),
        total_responses: 0,
        my_answer: null,
      })
    } catch (err) {
      if (txStarted) {
        try {
          await client.query('ROLLBACK')
          txStarted = false
        } catch (rbErr) {
          rollbackErr = rbErr
        }
      }
      next(err)
    } finally {
      if (client) {
        if (rollbackErr) client.release(rollbackErr)
        else client.release()
      }
    }
  })

  // 23. GET /api/stories/:id/quizzes: Retrieve quiz for story
  router.get('/:id/quizzes', auth, async (req, res, next) => {
    if (!isPgId(req.params.id)) {
      return res.status(404).json({ error: 'Story not found' })
    }

    try {
      const { rows: storyRows } = await pool.query(
        `SELECT id FROM stories
         WHERE id = $1 AND (expires_at > now() OR EXISTS (SELECT 1 FROM story_highlight_items shi WHERE shi.story_id = stories.id))`,
        [req.params.id]
      )
      if (!storyRows[0]) {
        return res.status(404).json({ error: 'Story not found' })
      }

      const quiz = await getQuizForStory(req.params.id, req.userId)
      if (!quiz) {
        return res.status(404).json({ error: 'No quiz sticker found for this story' })
      }

      res.json(quiz)
    } catch (err) {
      next(err)
    }
  })

  // 24. POST /api/stories/:id/quizzes/answer: Submit answer to a quiz (atomic transaction)
  router.post('/:id/quizzes/answer', auth, async (req, res, next) => {
    if (!isPgId(req.params.id)) {
      return res.status(404).json({ error: 'Story not found' })
    }

    let optionId
    try {
      optionId = validateQuizAnswer(req.body)
    } catch (err) {
      return res.status(err.status || 400).json({ error: err.message, field: err.field })
    }

    let client
    let txStarted = false
    let rollbackErr = null

    try {
      client = await pool.connect()

      // 1. Story must exist and be active
      const { rows: storyRows } = await client.query(
        'SELECT id, user_id, expires_at FROM stories WHERE id = $1',
        [req.params.id]
      )
      if (!storyRows[0]) {
        return res.status(404).json({ error: 'Story not found' })
      }
      const story = storyRows[0]

      const authorized = await checkStoryAudienceAccess(req.params.id, story.user_id, req.userId, client)
      if (!authorized) {
        return res.status(404).json({ error: 'Story not found' })
      }
      if (new Date(story.expires_at) <= new Date()) {
        return res.status(400).json({ error: 'Cannot answer a quiz on an expired story' })
      }

      // 2. Prevent story owner from answering their own quiz
      if (Number(story.user_id) === Number(req.userId)) {
        return res.status(400).json({ error: 'Cannot answer your own quiz' })
      }

      // 3. Quiz must exist on this story
      const { rows: quizRows } = await client.query(
        'SELECT id, correct_option_id, question_text FROM story_quizzes WHERE story_id = $1',
        [req.params.id]
      )
      if (!quizRows[0]) {
        return res.status(404).json({ error: 'No quiz found for this story' })
      }
      const quiz = quizRows[0]

      // 4. Validate that selected option belongs to this quiz
      const { rows: optRows } = await client.query(
        'SELECT id FROM story_quiz_options WHERE id = $1 AND quiz_id = $2',
        [optionId, quiz.id]
      )
      if (!optRows[0]) {
        return res.status(400).json({ error: 'Invalid quiz option for this story quiz' })
      }

      // 5. Begin transaction: atomically insert response and dispatch notification
      await client.query('BEGIN')
      txStarted = true

      try {
        await client.query(
          `INSERT INTO story_quiz_responses (quiz_id, user_id, selected_option_id)
           VALUES ($1, $2, $3)`,
          [quiz.id, req.userId, optionId]
        )
      } catch (insertErr) {
        if (insertErr.code === '23505') {
          await client.query('ROLLBACK')
          txStarted = false
          return res.status(409).json({ error: 'You have already answered this quiz' })
        }
        throw insertErr
      }

      // 6. Notify story owner within the same transaction
      const { rows: userRows } = await client.query(
        `SELECT
           CASE
             WHEN name NOT LIKE '%@%' AND trim(name) <> '' THEN trim(name)
             ELSE split_part(COALESCE(NULLIF(trim(name), ''), email), '@', 1)
           END AS name
         FROM users WHERE id = $1`,
        [req.userId]
      )
      const actorName = userRows[0]?.name || 'Someone'
      const notifText = `${actorName} answered your quiz: "${quiz.question_text.length > 40 ? quiz.question_text.slice(0, 37) + '...' : quiz.question_text}"`

      await client.query(
        `INSERT INTO notifications (user_id, actor_id, kind, entity_type, entity_id, text)
         VALUES ($1, $2, 'story_quiz_answer', 'story', $3, $4)
         ON CONFLICT (user_id, actor_id, kind, entity_type, entity_id) WHERE kind = 'story_quiz_answer'
         DO UPDATE SET text = EXCLUDED.text, created_at = now(), read_at = NULL`,
        [story.user_id, req.userId, story.id, notifText]
      )

      await client.query('COMMIT')
      txStarted = false

      // 7. Return updated quiz state including revealed correct answer and is_correct flag
      const updatedQuiz = await getQuizForStory(req.params.id, req.userId)
      const isCorrect = String(optionId) === String(quiz.correct_option_id)

      res.status(201).json({
        success: true,
        is_correct: isCorrect,
        correct_option_id: String(quiz.correct_option_id),
        selected_option_id: String(optionId),
        quiz: updatedQuiz,
      })
    } catch (err) {
      if (txStarted) {
        try {
          await client.query('ROLLBACK')
          txStarted = false
        } catch (rbErr) {
          rollbackErr = rbErr
        }
      }
      next(err)
    } finally {
      if (client) {
        if (rollbackErr) client.release(rollbackErr)
        else client.release()
      }
    }
  })

  // 25. GET /api/stories/:id/quizzes/responses: Owner view of quiz analytics and respondents
  router.get('/:id/quizzes/responses', auth, async (req, res, next) => {
    if (!isPgId(req.params.id)) {
      return res.status(404).json({ error: 'Story not found' })
    }

    try {
      const { rows: storyRows } = await pool.query(
        'SELECT id, user_id FROM stories WHERE id = $1',
        [req.params.id]
      )
      if (!storyRows[0]) {
        return res.status(404).json({ error: 'Story not found' })
      }
      if (Number(storyRows[0].user_id) !== Number(req.userId)) {
        return res.status(403).json({ error: 'Only the story owner can view quiz analytics' })
      }

      const { rows: quizRows } = await pool.query(
        'SELECT id, question_text, correct_option_id::text FROM story_quizzes WHERE story_id = $1',
        [req.params.id]
      )
      if (!quizRows[0]) {
        return res.status(404).json({ error: 'No quiz found for this story' })
      }
      const quiz = quizRows[0]

      const { rows: options } = await pool.query(
        `SELECT o.id::text, o.option_text, o.display_order,
           (SELECT count(*)::int FROM story_quiz_responses r WHERE r.selected_option_id = o.id) AS response_count
         FROM story_quiz_options o
         WHERE o.quiz_id = $1
         ORDER BY o.display_order ASC, o.id ASC`,
        [quiz.id]
      )

      const { rows: respondents } = await pool.query(
        `SELECT r.user_id, r.selected_option_id::text, r.created_at,
           CASE
             WHEN u.name NOT LIKE '%@%' AND trim(u.name) <> '' THEN trim(u.name)
             ELSE split_part(COALESCE(NULLIF(trim(u.name), ''), u.email), '@', 1)
           END AS responder_name,
           CASE WHEN u.profile_image_id IS NULL THEN NULL ELSE '/api/images/' || u.profile_image_id::text END AS responder_avatar_url
         FROM story_quiz_responses r
         JOIN users u ON u.id = r.user_id
         WHERE r.quiz_id = $1
         ORDER BY r.created_at DESC`,
        [quiz.id]
      )

      const totalResponses = respondents.length
      const optionsWithPercent = options.map((opt) => ({
        ...opt,
        percentage: totalResponses > 0 ? Math.round(((Number(opt.response_count) || 0) / totalResponses) * 100) : 0,
        is_correct: opt.id === quiz.correct_option_id,
        respondents: respondents
          .filter((resp) => resp.selected_option_id === opt.id)
          .map((resp) => ({
            user_id: resp.user_id,
            name: resp.responder_name,
            avatar_url: resp.responder_avatar_url,
            created_at: resp.created_at,
          })),
      }))

      const correctCount = respondents.filter((r) => r.selected_option_id === quiz.correct_option_id).length

      res.json({
        quizId: String(quiz.id),
        storyId: req.params.id,
        question_text: quiz.question_text,
        correct_option_id: quiz.correct_option_id,
        totalResponses,
        correctCount,
        options: optionsWithPercent,
        respondents: respondents.map((r) => ({
          user_id: r.user_id,
          name: r.responder_name,
          avatar_url: r.responder_avatar_url,
          selected_option_id: r.selected_option_id,
          is_correct: r.selected_option_id === quiz.correct_option_id,
          created_at: r.created_at,
        })),
      })
    } catch (err) {
      next(err)
    }
  })

  // Alias /voters to /responses for consistency with Poll endpoint
  router.get('/:id/quizzes/voters', auth, async (req, res, next) => {
    req.url = `/${req.params.id}/quizzes/responses`
    router.handle(req, res, next)
  })

  return router
}

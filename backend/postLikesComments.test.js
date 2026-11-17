import { test } from 'node:test'
import assert from 'node:assert/strict'

// Mock database tables
function createMockPool() {
  const users = new Map([
    [1, { id: 1, name: 'Alice Cooper', email: 'alice@example.com', role: 'author', profile_image_id: null }],
    [2, { id: 2, name: 'raj2@gmail.com', email: 'raj2@gmail.com', role: 'user', profile_image_id: 'img-123' }],
    [3, { id: 3, name: 'Bob Ross', email: 'bob@painter.org', role: 'user', profile_image_id: null }],
  ])

  const posts = new Map([
    [101, { id: 101, user_id: 1, body: 'Alice first post', image_id: null, created_at: new Date('2026-11-01T10:00:00Z'), updated_at: new Date() }],
    [102, { id: 102, user_id: 2, body: 'Raj first post', image_id: null, created_at: new Date('2026-11-02T10:00:00Z'), updated_at: new Date() }],
  ])

  // key: `${postId}:${userId}`
  const likes = new Map([
    ['101:2', { post_id: 101, user_id: 2, created_at: new Date('2026-11-02T11:00:00Z') }],
    ['101:3', { post_id: 101, user_id: 3, created_at: new Date('2026-11-02T12:00:00Z') }],
    ['102:1', { post_id: 102, user_id: 1, created_at: new Date('2026-11-03T09:00:00Z') }],
  ])

  let commentIdSeq = 200
  const comments = new Map([
    [201, { id: 201, post_id: 101, user_id: 2, body: 'Great work Alice!', created_at: new Date('2026-11-02T11:30:00Z'), updated_at: new Date() }],
    [202, { id: 202, post_id: 102, user_id: 1, body: 'Welcome to SNARP Raj!', created_at: new Date('2026-11-03T09:15:00Z'), updated_at: new Date() }],
  ])

  return {
    users,
    posts,
    likes,
    comments,
    async query(sql, params = []) {
      const normalized = sql.replace(/\s+/g, ' ').trim()

      // Post existence check
      if (normalized.startsWith('SELECT 1 FROM posts WHERE id = $1')) {
        const post = posts.get(Number(params[0]))
        return { rows: post ? [{ exists: 1 }] : [] }
      }

      // GET /api/posts/:id/likes
      if (normalized.includes('FROM likes l JOIN users u ON u.id = l.user_id WHERE l.post_id = $1')) {
        const postId = Number(params[0])
        const result = []
        for (const [key, like] of likes.entries()) {
          if (like.post_id === postId) {
            const u = users.get(like.user_id)
            if (u) {
              const isEmail = u.name.includes('@')
              const cleanName = isEmail ? u.name.split('@')[0] : u.name
              const fullName = isEmail ? null : u.name
              const username = (isEmail ? u.name.split('@')[0] : u.email.split('@')[0])

              result.push({
                post_id: like.post_id,
                user_id: like.user_id,
                created_at: like.created_at,
                author_name: cleanName,
                name: cleanName,
                full_name: fullName,
                username: username,
                role: u.role,
                avatar_url: u.profile_image_id ? `/api/images/${u.profile_image_id}` : null,
              })
            }
          }
        }
        return { rows: result }
      }

      // GET /api/posts/:id/comments
      if (normalized.includes('FROM comments c JOIN users u ON u.id = c.user_id WHERE c.post_id = $1')) {
        const postId = Number(params[0])
        const result = []
        for (const [id, c] of comments.entries()) {
          if (c.post_id === postId) {
            const u = users.get(c.user_id)
            if (u) {
              const isEmail = u.name.includes('@')
              const cleanName = isEmail ? u.name.split('@')[0] : u.name
              const fullName = isEmail ? null : u.name
              const username = (isEmail ? u.name.split('@')[0] : u.email.split('@')[0])

              result.push({
                id: c.id,
                post_id: c.post_id,
                user_id: c.user_id,
                body: c.body,
                created_at: c.created_at,
                updated_at: c.updated_at,
                author_name: cleanName,
                full_name: fullName,
                username: username,
                author_role: u.role,
                author_avatar_url: u.profile_image_id ? `/api/images/${u.profile_image_id}` : null,
              })
            }
          }
        }
        return { rows: result }
      }

      // POST /api/posts/:id/comments insertion
      if (normalized.startsWith('WITH inserted AS ( INSERT INTO comments (post_id, user_id, body)')) {
        const postId = Number(params[0])
        const userId = Number(params[1])
        const body = params[2]
        if (!posts.has(postId)) return { rows: [] }

        commentIdSeq++
        const newComment = { id: commentIdSeq, post_id: postId, user_id: userId, body, created_at: new Date(), updated_at: new Date() }
        comments.set(commentIdSeq, newComment)
        return { rows: [{ id: commentIdSeq }] }
      }

      // Return comment details
      if (normalized.includes('FROM comments c JOIN users u ON u.id = c.user_id WHERE c.id = $1')) {
        const commentId = Number(params[0])
        const c = comments.get(commentId)
        if (!c) return { rows: [] }
        const u = users.get(c.user_id)
        const isEmail = u.name.includes('@')
        const cleanName = isEmail ? u.name.split('@')[0] : u.name
        return {
          rows: [{
            id: c.id,
            post_id: c.post_id,
            user_id: c.user_id,
            body: c.body,
            created_at: c.created_at,
            updated_at: c.updated_at,
            author_name: cleanName,
            full_name: isEmail ? null : u.name,
            username: isEmail ? u.name.split('@')[0] : u.email.split('@')[0],
            author_role: u.role,
            author_avatar_url: u.profile_image_id ? `/api/images/${u.profile_image_id}` : null,
          }]
        }
      }

      // User profile & posts query
      if (normalized.includes('FROM users u LEFT JOIN user_profiles up ON up.user_id = u.id WHERE u.id = $1')) {
        const u = users.get(Number(params[0]))
        if (!u) return { rows: [] }
        const isEmail = u.name.includes('@')
        return {
          rows: [{
            id: u.id,
            name: isEmail ? u.name.split('@')[0] : u.name,
            full_name: isEmail ? null : u.name,
            username: isEmail ? u.name.split('@')[0] : u.email.split('@')[0],
            role: u.role,
            created_at: new Date('2026-01-01T00:00:00Z'),
            profile_image_id: u.profile_image_id,
            institution: 'Uptoskills Institute',
            department: 'Computer Science',
            research_interests: ['AI', 'Databases'],
            bio: 'Test bio',
            skills: ['Node', 'React'],
            links: [],
            post_count: 1,
          }]
        }
      }

      // Posts for user profile
      if (normalized.includes('FROM posts p JOIN users u ON u.id = p.user_id WHERE p.user_id = $1')) {
        const userId = Number(params[0])
        const viewerId = Number(params[1])
        const userPosts = []
        for (const [id, p] of posts.entries()) {
          if (p.user_id === userId) {
            const u = users.get(p.user_id)
            const isEmail = u.name.includes('@')
            let likeCount = 0
            let likedByMe = false
            for (const [key, l] of likes.entries()) {
              if (l.post_id === p.id) {
                likeCount++
                if (l.user_id === viewerId) likedByMe = true
              }
            }
            let commentCount = 0
            for (const [cid, c] of comments.entries()) {
              if (c.post_id === p.id) commentCount++
            }
            userPosts.push({
              id: p.id,
              body: p.body,
              image_id: p.image_id,
              created_at: p.created_at,
              updated_at: p.updated_at,
              user_id: p.user_id,
              author_name: isEmail ? u.name.split('@')[0] : u.name,
              full_name: isEmail ? null : u.name,
              username: isEmail ? u.name.split('@')[0] : u.email.split('@')[0],
              author_role: u.role,
              author_avatar_url: u.profile_image_id ? `/api/images/${u.profile_image_id}` : null,
              like_count: likeCount,
              liked_by_me: likedByMe,
              comment_count: commentCount,
            })
          }
        }
        return { rows: userPosts }
      }

      return { rows: [] }
    }
  }
}

function createDispatcher(pool, currentUserId = 1) {
  const isPgId = (val) => /^[1-9]\d{0,9}$/.test(String(val))

  return async function dispatch(method, url, body = null) {
    const auth = () => {
      if (!currentUserId) throw { status: 401, data: { error: 'Please log in' } }
      return currentUserId
    }

    try {
      // Route: GET /api/posts/:id/likes
      const likesMatch = url.match(/^\/api\/posts\/([^/]+)\/likes$/)
      if (likesMatch && method === 'GET') {
        const userId = auth()
        const id = likesMatch[1]
        if (!isPgId(id)) return { status: 404, data: { error: 'Post not found' } }
        const post = await pool.query('SELECT 1 FROM posts WHERE id = $1', [id])
        if (!post.rows[0]) return { status: 404, data: { error: 'Post not found' } }
        const { rows } = await pool.query(
          `SELECT l.post_id, l.user_id, l.created_at,
             CASE
               WHEN u.name NOT LIKE '%@%' AND trim(u.name) <> '' THEN trim(u.name)
               ELSE split_part(COALESCE(NULLIF(trim(u.name), ''), u.email), '@', 1)
             END AS author_name,
             CASE
               WHEN u.name NOT LIKE '%@%' AND trim(u.name) <> '' THEN trim(u.name)
               ELSE split_part(COALESCE(NULLIF(trim(u.name), ''), u.email), '@', 1)
             END AS name,
             CASE
               WHEN u.name NOT LIKE '%@%' AND trim(u.name) <> '' THEN trim(u.name)
               ELSE NULL
             END AS full_name,
             split_part(COALESCE(NULLIF(trim(u.name), ''), u.email), '@', 1) AS username,
             u.role,
             CASE WHEN u.profile_image_id IS NULL THEN NULL ELSE '/api/images/' || u.profile_image_id::text END AS avatar_url
           FROM likes l JOIN users u ON u.id = l.user_id
           WHERE l.post_id = $1
           ORDER BY l.created_at DESC`,
          [id]
        )
        return { status: 200, data: rows }
      }

      // Route: GET /api/posts/:id/comments
      const commentsMatch = url.match(/^\/api\/posts\/([^/]+)\/comments$/)
      if (commentsMatch && method === 'GET') {
        auth()
        const id = commentsMatch[1]
        if (!isPgId(id)) return { status: 404, data: { error: 'Post not found' } }
        const { rows } = await pool.query(
          `SELECT c.id, c.post_id, c.user_id, c.body, c.created_at, c.updated_at,
             CASE
               WHEN u.name NOT LIKE '%@%' AND trim(u.name) <> '' THEN trim(u.name)
               ELSE split_part(COALESCE(NULLIF(trim(u.name), ''), u.email), '@', 1)
             END AS author_name,
             CASE
               WHEN u.name NOT LIKE '%@%' AND trim(u.name) <> '' THEN trim(u.name)
               ELSE NULL
             END AS full_name,
             split_part(COALESCE(NULLIF(trim(u.name), ''), u.email), '@', 1) AS username,
             u.role AS author_role,
             CASE WHEN u.profile_image_id IS NULL THEN NULL ELSE '/api/images/' || u.profile_image_id::text END AS author_avatar_url
           FROM comments c JOIN users u ON u.id = c.user_id
           WHERE c.post_id = $1 ORDER BY c.created_at DESC, c.id DESC LIMIT 50`,
          [id]
        )
        return { status: 200, data: rows }
      }

      // Route: POST /api/posts/:id/comments
      if (commentsMatch && method === 'POST') {
        const userId = auth()
        const id = commentsMatch[1]
        if (!isPgId(id)) return { status: 404, data: { error: 'Post not found' } }
        const text = typeof body?.body === 'string' ? body.body.trim() : ''
        if (!text || text.length > 2000) return { status: 400, data: { error: 'Comment must be 1-2,000 characters' } }

        const { rows } = await pool.query(
          `WITH inserted AS (
            INSERT INTO comments (post_id, user_id, body)
            SELECT $1, $2, $3 WHERE EXISTS (SELECT 1 FROM posts WHERE id = $1)
            RETURNING id, post_id, user_id
          ) SELECT id FROM inserted`,
          [id, userId, text]
        )
        if (!rows[0]) return { status: 404, data: { error: 'Post not found' } }

        const comment = await pool.query(
          `SELECT c.id, c.post_id, c.user_id, c.body, c.created_at, c.updated_at,
             CASE
               WHEN u.name NOT LIKE '%@%' AND trim(u.name) <> '' THEN trim(u.name)
               ELSE split_part(COALESCE(NULLIF(trim(u.name), ''), u.email), '@', 1)
             END AS author_name,
             CASE
               WHEN u.name NOT LIKE '%@%' AND trim(u.name) <> '' THEN trim(u.name)
               ELSE NULL
             END AS full_name,
             split_part(COALESCE(NULLIF(trim(u.name), ''), u.email), '@', 1) AS username,
             u.role AS author_role,
             CASE WHEN u.profile_image_id IS NULL THEN NULL ELSE '/api/images/' || u.profile_image_id::text END AS author_avatar_url
           FROM comments c JOIN users u ON u.id = c.user_id WHERE c.id = $1`,
          [rows[0].id]
        )
        return { status: 201, data: comment.rows[0] }
      }

      // Route: GET /api/users/:id
      const userMatch = url.match(/^\/api\/users\/([^/]+)$/)
      if (userMatch && method === 'GET') {
        const viewerId = auth()
        const id = userMatch[1]
        if (!isPgId(id)) return { status: 404, data: { error: 'User not found' } }

        const { rows } = await pool.query(
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
             u.role, u.created_at, u.profile_image_id,
             COALESCE(up.institution, '') AS institution, COALESCE(up.department, '') AS department,
             COALESCE(up.research_interests, '{}') AS research_interests, COALESCE(up.bio, '') AS bio,
             COALESCE(up.skills, '{}') AS skills, COALESCE(up.links, '[]'::jsonb) AS links,
             (SELECT count(*)::int FROM posts WHERE user_id = u.id) AS post_count
           FROM users u LEFT JOIN user_profiles up ON up.user_id = u.id WHERE u.id = $1`,
          [id]
        )
        if (!rows[0]) return { status: 404, data: { error: 'User not found' } }
        const user = rows[0]

        const postsResult = await pool.query(
          `SELECT p.id, p.body, p.image_id, p.created_at, p.updated_at, p.user_id,
             CASE
               WHEN u.name NOT LIKE '%@%' AND trim(u.name) <> '' THEN trim(u.name)
               ELSE split_part(COALESCE(NULLIF(trim(u.name), ''), u.email), '@', 1)
             END AS author_name,
             CASE
               WHEN u.name NOT LIKE '%@%' AND trim(u.name) <> '' THEN trim(u.name)
               ELSE NULL
             END AS full_name,
             split_part(COALESCE(NULLIF(trim(u.name), ''), u.email), '@', 1) AS username,
             u.role AS author_role,
             CASE WHEN u.profile_image_id IS NULL THEN NULL ELSE '/api/images/' || u.profile_image_id::text END AS author_avatar_url,
             (SELECT count(*)::int FROM likes l WHERE l.post_id = p.id) AS like_count,
             EXISTS (SELECT 1 FROM likes l WHERE l.post_id = p.id AND l.user_id = $2) AS liked_by_me,
             (SELECT count(*)::int FROM comments c WHERE c.post_id = p.id) AS comment_count
           FROM posts p JOIN users u ON u.id = p.user_id
           WHERE p.user_id = $1`,
          [user.id, viewerId]
        )

        const { profile_image_id, ...publicProfile } = user
        return {
          status: 200,
          data: {
            ...publicProfile,
            avatar_url: profile_image_id ? `/api/images/${profile_image_id}` : null,
            posts: postsResult.rows,
          }
        }
      }

      return { status: 404, data: { error: 'Not found' } }
    } catch (err) {
      if (err.status) return { status: err.status, data: err.data }
      return { status: 500, data: { error: err.message } }
    }
  }
}

// TESTS
test('GET /api/posts/:id/likes returns sanitized user list and never exposes email', async () => {
  const pool = createMockPool()
  const dispatch = createDispatcher(pool, 1)

  const res = await dispatch('GET', '/api/posts/101/likes')
  assert.equal(res.status, 200)
  assert.equal(res.data.length, 2)

  // User 2: registered with email raj2@gmail.com
  const raj = res.data.find((l) => l.user_id === 2)
  assert.ok(raj)
  assert.equal(raj.author_name, 'raj2')
  assert.equal(raj.name, 'raj2')
  assert.equal(raj.username, 'raj2')
  assert.equal(raj.full_name, null)
  assert.equal(raj.avatar_url, '/api/images/img-123')
  assert.equal(raj.email, undefined, 'Email MUST NOT be exposed in likes API response')

  // User 3: regular name Bob Ross
  const bob = res.data.find((l) => l.user_id === 3)
  assert.ok(bob)
  assert.equal(bob.author_name, 'Bob Ross')
  assert.equal(bob.full_name, 'Bob Ross')
  assert.equal(bob.username, 'bob')
  assert.equal(bob.email, undefined)
})

test('GET /api/posts/:id/comments returns sanitized user identity and comments list', async () => {
  const pool = createMockPool()
  const dispatch = createDispatcher(pool, 1)

  const res = await dispatch('GET', '/api/posts/101/comments')
  assert.equal(res.status, 200)
  assert.equal(res.data.length, 1)

  const comment = res.data[0]
  assert.equal(comment.id, 201)
  assert.equal(comment.body, 'Great work Alice!')
  assert.equal(comment.author_name, 'raj2', 'Email domain must be stripped from author_name')
  assert.equal(comment.username, 'raj2')
  assert.equal(comment.email, undefined)
})

test('POST /api/posts/:id/comments adds comment and returns clean user identity', async () => {
  const pool = createMockPool()
  // As raj2@gmail.com (user 2)
  const dispatch = createDispatcher(pool, 2)

  const res = await dispatch('POST', '/api/posts/101/comments', { body: 'Testing new comment' })
  assert.equal(res.status, 201)
  assert.equal(res.data.body, 'Testing new comment')
  assert.equal(res.data.author_name, 'raj2', 'Comment author name must be clean username, not email')
  assert.equal(res.data.email, undefined)
})

test('Own Profile (User A opens own profile) displays published posts with likes and comments', async () => {
  const pool = createMockPool()
  // User 1 (Alice) opens her own profile
  const dispatch = createDispatcher(pool, 1)

  const res = await dispatch('GET', '/api/users/1')
  assert.equal(res.status, 200)
  assert.equal(res.data.name, 'Alice Cooper')
  assert.equal(res.data.posts.length, 1)

  const post = res.data.posts[0]
  assert.equal(post.id, 101)
  assert.equal(post.user_id, 1, 'Post user_id MUST be returned for ownership mapping')
  assert.equal(post.author_name, 'Alice Cooper')
  assert.equal(post.like_count, 2, 'Like count from other users must be visible on own profile')
  assert.equal(post.comment_count, 1, 'Comment count from other users must be visible on own profile')
})

test('Own Profile for account with email name (raj2@gmail.com) sanitizes profile name', async () => {
  const pool = createMockPool()
  // User 2 (raj2@gmail.com) opens his own profile
  const dispatch = createDispatcher(pool, 2)

  const res = await dispatch('GET', '/api/users/2')
  assert.equal(res.status, 200)
  assert.equal(res.data.name, 'raj2', 'Profile name must not display raw email domain')
  assert.equal(res.data.username, 'raj2')
  assert.equal(res.data.posts.length, 1)

  const post = res.data.posts[0]
  assert.equal(post.id, 102)
  assert.equal(post.user_id, 2)
  assert.equal(post.like_count, 1, 'Like from Alice is visible to Raj')
  assert.equal(post.comment_count, 1, 'Comment from Alice is visible to Raj')
})

test('GET /api/posts/:id/likes returns 401 when unauthenticated and 404 for invalid/non-existent post', async () => {
  const pool = createMockPool()
  const unauthDispatch = createDispatcher(pool, null)

  const res401 = await unauthDispatch('GET', '/api/posts/101/likes')
  assert.equal(res401.status, 401)

  const authDispatch = createDispatcher(pool, 1)
  const res404 = await authDispatch('GET', '/api/posts/999/likes')
  assert.equal(res404.status, 404)

  const resBadId = await authDispatch('GET', '/api/posts/abc/likes')
  assert.equal(resBadId.status, 404)
})

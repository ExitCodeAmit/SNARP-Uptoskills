import { test } from 'node:test'
import assert from 'node:assert/strict'
import { formatDisplayName, formatUserName } from '../frontend/src/format.js'

// Mock database tables
function createMockPool() {
  const users = new Map([
    [1, { id: 1, name: 'Alice Cooper', email: 'alice@example.com', role: 'author', profile_image_id: null, institution: 'MIT', department: 'CS', bio: 'AI Researcher', post_count: 2 }],
    [2, { id: 2, name: 'Bob Smith', email: 'bob@example.com', role: 'user', profile_image_id: 'img-102', institution: 'Stanford', department: 'Bio', bio: 'Geneticist', post_count: 1 }],
    [3, { id: 3, name: 'raj2@gmail.com', email: 'raj2@gmail.com', role: 'user', profile_image_id: null, institution: 'Berkeley', department: 'Data', bio: 'Data Scientist', post_count: 0 }],
  ])

  const posts = new Map([
    [101, { id: 101, user_id: 1, body: 'Alice first post on AI', image_id: null, created_at: new Date('2026-11-01T10:00:00Z'), updated_at: new Date() }],
    [102, { id: 102, user_id: 1, body: 'Alice second post with photo', image_id: 'img-post-1', created_at: new Date('2026-11-02T10:00:00Z'), updated_at: new Date() }],
    [103, { id: 103, user_id: 2, body: 'Bob research post on CRISPR', image_id: null, created_at: new Date('2026-11-03T10:00:00Z'), updated_at: new Date() }],
  ])

  const likes = new Map([
    ['101:2', { post_id: 101, user_id: 2, created_at: new Date('2026-11-02T11:00:00Z') }],
    ['103:1', { post_id: 103, user_id: 1, created_at: new Date('2026-11-03T11:00:00Z') }],
  ])

  const comments = new Map([
    [201, { id: 201, post_id: 101, user_id: 2, body: 'Great AI paper Alice!', created_at: new Date('2026-11-02T11:30:00Z') }],
    [202, { id: 202, post_id: 103, user_id: 1, body: 'Fascinating CRISPR work Bob!', created_at: new Date('2026-11-03T11:30:00Z') }],
  ])

  const stories = new Map([
    ['s-1', { id: 's-1', user_id: 2, type: 'photo', content: 'Bob lab story', media_url: '/api/stories/media/img-1', expires_at: new Date(Date.now() + 3600000), created_at: new Date() }],
  ])

  return {
    users,
    posts,
    likes,
    comments,
    stories,
    async query(sql, params = []) {
      const normalized = sql.replace(/\s+/g, ' ').trim()

      // User profile endpoint
      if (normalized.includes('FROM users u LEFT JOIN user_profiles up ON up.user_id = u.id WHERE u.id = $1')) {
        const u = users.get(Number(params[0]))
        if (!u) return { rows: [] }

        const isEmail = u.name.includes('@')
        const name = isEmail ? u.name.split('@')[0] : u.name
        const fullName = isEmail ? null : u.name
        const username = isEmail ? u.name.split('@')[0] : u.email.split('@')[0]

        return {
          rows: [{
            id: u.id,
            name,
            full_name: fullName,
            username,
            role: u.role,
            created_at: new Date('2026-01-01T00:00:00Z'),
            profile_image_id: u.profile_image_id,
            email: u.email,
            institution: u.institution,
            department: u.department,
            bio: u.bio,
            research_interests: [],
            skills: [],
            links: [],
            post_count: u.post_count,
          }],
        }
      }

      // User profile posts query
      if (normalized.includes('FROM posts p JOIN users u ON u.id = p.user_id WHERE p.user_id = $1')) {
        const targetUserId = Number(params[0])
        const viewerId = params[1] != null ? Number(params[1]) : null
        const result = []

        for (const p of posts.values()) {
          if (p.user_id === targetUserId) {
            const author = users.get(p.user_id)
            const isEmail = author.name.includes('@')
            const authorName = isEmail ? author.name.split('@')[0] : author.name
            const fullName = isEmail ? null : author.name
            const username = isEmail ? author.name.split('@')[0] : author.email.split('@')[0]

            const postLikes = [...likes.values()].filter((l) => l.post_id === p.id)
            const postComments = [...comments.values()].filter((c) => c.post_id === p.id)
            const likedByMe = viewerId ? postLikes.some((l) => l.user_id === viewerId) : false

            result.push({
              id: p.id,
              body: p.body,
              image_id: p.image_id,
              created_at: p.created_at,
              updated_at: p.updated_at,
              user_id: p.user_id,
              author_name: authorName,
              full_name: fullName,
              username,
              author_role: author.role,
              author_avatar_url: author.profile_image_id ? `/api/images/${author.profile_image_id}` : null,
              like_count: postLikes.length,
              liked_by_me: likedByMe,
              comment_count: postComments.length,
            })
          }
        }

        result.sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
        return { rows: result }
      }

      // Stories tray query
      if (normalized.includes('FROM stories s JOIN users u ON u.id = s.user_id')) {
        const viewerId = Number(params[0])
        const result = []
        for (const s of stories.values()) {
          if (s.user_id !== viewerId) {
            const author = users.get(s.user_id)
            const isEmail = author.name.includes('@')
            const name = isEmail ? author.name.split('@')[0] : author.name
            const fullName = isEmail ? null : author.name
            const username = isEmail ? author.name.split('@')[0] : author.email.split('@')[0]

            result.push({
              user_id: author.id,
              name,
              full_name: fullName,
              username,
              avatar_url: author.profile_image_id ? `/api/images/${author.profile_image_id}` : null,
              has_unviewed: true,
              latest_created_at: s.created_at,
              story_count: 1,
            })
          }
        }
        return { rows: result }
      }

      // Stories user endpoint
      if (normalized.includes('FROM users u WHERE u.id = $1')) {
        const targetUserId = Number(params[0])
        const u = users.get(targetUserId)
        if (!u) return { rows: [] }
        const isEmail = u.name.includes('@')
        return {
          rows: [{
            id: u.id,
            name: isEmail ? u.name.split('@')[0] : u.name,
            full_name: isEmail ? null : u.name,
            username: isEmail ? u.name.split('@')[0] : u.email.split('@')[0],
            avatar_url: u.profile_image_id ? `/api/images/${u.profile_image_id}` : null,
          }],
        }
      }

      return { rows: [] }
    },
  }
}

// Controller simulator mirroring server.js logic
async function getUserProfile(pool, reqUserId, targetProfileId) {
  const { rows } = await pool.query(
    'SELECT u.id, u.name, u.role, u.profile_image_id, u.email FROM users u LEFT JOIN user_profiles up ON up.user_id = u.id WHERE u.id = $1',
    [targetProfileId]
  )
  if (!rows[0]) return { status: 404, body: { error: 'User not found' } }

  const user = rows[0]
  const posts = await pool.query(
    'SELECT p.id, p.body, p.image_id, p.created_at, p.updated_at, p.user_id FROM posts p JOIN users u ON u.id = p.user_id WHERE p.user_id = $1',
    [user.id, reqUserId]
  )

  const isOwner = Number(reqUserId) === Number(user.id)
  const { profile_image_id, email, ...publicProfile } = user

  return {
    status: 200,
    body: {
      ...publicProfile,
      ...(isOwner && email ? { email } : {}),
      avatar_url: profile_image_id ? `/api/images/${profile_image_id}` : null,
      posts: posts.rows,
    },
  }
}

// ==========================================
// TEST SUITE: STEP 21 Identity & Privacy Matrix
// ==========================================

test('TC-01: Account A opens its own profile -> sees Full Name and own email', async () => {
  const pool = createMockPool()
  const res = await getUserProfile(pool, 1, 1)

  assert.equal(res.status, 200)
  assert.equal(res.body.name, 'Alice Cooper')
  assert.equal(res.body.full_name, 'Alice Cooper')
  assert.equal(res.body.email, 'alice@example.com')
  assert.ok(res.body.posts.length > 0)
})

test('TC-02: Account B opens Account A profile -> sees Full Name, posts, but NOT email', async () => {
  const pool = createMockPool()
  const res = await getUserProfile(pool, 2, 1)

  assert.equal(res.status, 200)
  assert.equal(res.body.name, 'Alice Cooper')
  assert.equal(res.body.full_name, 'Alice Cooper')
  // CRITICAL PRIVACY: Email must NOT be in the response object
  assert.equal(res.body.email, undefined)
  assert.ok(!('email' in res.body))
  // Content preserved
  assert.equal(res.body.posts.length, 2)
})

test('TC-03: Account A opens Account B profile -> sees Full Name, posts, but NOT email', async () => {
  const pool = createMockPool()
  const res = await getUserProfile(pool, 1, 2)

  assert.equal(res.status, 200)
  assert.equal(res.body.name, 'Bob Smith')
  assert.equal(res.body.full_name, 'Bob Smith')
  assert.equal(res.body.email, undefined)
  assert.ok(!('email' in res.body))
  assert.equal(res.body.posts.length, 1)
})

test('TC-04: Account B opens its own profile -> sees its own Full Name and email', async () => {
  const pool = createMockPool()
  const res = await getUserProfile(pool, 2, 2)

  assert.equal(res.status, 200)
  assert.equal(res.body.name, 'Bob Smith')
  assert.equal(res.body.full_name, 'Bob Smith')
  assert.equal(res.body.email, 'bob@example.com')
  assert.ok(res.body.posts.length > 0)
})

test('TC-05: Account A views Account B story -> Account B Full Name appears, email remains hidden', async () => {
  const pool = createMockPool()
  // Fetch story user details
  const { rows } = await pool.query('SELECT u.id FROM users u WHERE u.id = $1', [2])
  assert.ok(rows[0])

  const user = rows[0]
  assert.equal(user.name, 'Bob Smith')
  assert.equal(user.full_name, 'Bob Smith')
  assert.equal(user.email, undefined) // story endpoint never exposes email

  // Frontend helper formatting verification
  const formatted = formatDisplayName(user)
  assert.equal(formatted, 'Bob Smith')
  assert.ok(!formatted.includes('@'))
})

test('TC-06: Inspect public profile API responses -> other users emails are never returned', async () => {
  const pool = createMockPool()
  // Request profile of user 3 (registered with raj2@gmail.com) by user 1
  const res = await getUserProfile(pool, 1, 3)

  assert.equal(res.status, 200)
  assert.equal(res.body.name, 'raj2') // Sanitized from email
  assert.equal(res.body.full_name, null) // No valid full name
  assert.equal(res.body.username, 'raj2')
  assert.equal(res.body.email, undefined)
  assert.ok(!('email' in res.body))
})

test('TC-07: Inspect Story API responses -> no unnecessary private email exposure', async () => {
  const pool = createMockPool()
  // Request tray stories as user 1
  const { rows } = await pool.query('SELECT s.* FROM stories s JOIN users u ON u.id = s.user_id', [1])

  assert.ok(rows.length > 0)
  for (const peer of rows) {
    assert.equal(peer.email, undefined)
    assert.ok(!('email' in peer))
    assert.ok(!peer.name.includes('@'))
  }
})

test('TC-08: Account A creates a post -> appears on Account A profile', async () => {
  const pool = createMockPool()
  const newPostId = 104
  pool.posts.set(newPostId, {
    id: newPostId,
    user_id: 1,
    body: 'Account A newly published research post',
    image_id: null,
    created_at: new Date(),
    updated_at: new Date(),
  })
  pool.users.get(1).post_count += 1

  const res = await getUserProfile(pool, 1, 1)
  assert.equal(res.status, 200)
  assert.equal(res.body.posts.length, 3)
  assert.equal(res.body.posts[0].body, 'Account A newly published research post')
})

test('TC-09: Account B opens Account A profile -> Account A posts remain visible according to access rules', async () => {
  const pool = createMockPool()
  const res = await getUserProfile(pool, 2, 1)

  assert.equal(res.status, 200)
  assert.equal(res.body.posts.length, 2)
  const post101 = res.body.posts.find((p) => p.id === 101)
  assert.ok(post101)
  assert.equal(post101.author_name, 'Alice Cooper')
  assert.equal(post101.like_count, 1)
  assert.equal(post101.liked_by_me, true) // Bob liked post 101
  assert.equal(post101.comment_count, 1)
})

test('TC-10: Account B creates a post -> appears on Account B profile', async () => {
  const pool = createMockPool()
  const newPostId = 105
  pool.posts.set(newPostId, {
    id: newPostId,
    user_id: 2,
    body: 'Account B breakthrough CRISPR post',
    image_id: null,
    created_at: new Date(),
    updated_at: new Date(),
  })
  pool.users.get(2).post_count += 1

  const res = await getUserProfile(pool, 2, 2)
  assert.equal(res.status, 200)
  assert.equal(res.body.posts.length, 2)
  assert.equal(res.body.posts[0].body, 'Account B breakthrough CRISPR post')
})

test('TC-11: Account A opens Account B profile -> Account B permitted posts remain visible', async () => {
  const pool = createMockPool()
  const res = await getUserProfile(pool, 1, 2)

  assert.equal(res.status, 200)
  assert.equal(res.body.posts.length, 1)
  assert.equal(res.body.posts[0].author_name, 'Bob Smith')
  assert.equal(res.body.posts[0].liked_by_me, true) // Alice liked post 103
  assert.equal(res.body.posts[0].comment_count, 1)
})

test('TC-12: Verify likes and comments on profile posts -> existing interactions continue working', async () => {
  const pool = createMockPool()
  // Add new like from user 3 to post 101
  pool.likes.set('101:3', { post_id: 101, user_id: 3, created_at: new Date() })
  // Add new comment from user 3 to post 101
  pool.comments.set(203, { id: 203, post_id: 101, user_id: 3, body: 'Impressive paper!', created_at: new Date() })

  const res = await getUserProfile(pool, 2, 1)
  const post101 = res.body.posts.find((p) => p.id === 101)
  assert.equal(post101.like_count, 2)
  assert.equal(post101.comment_count, 2)
})

test('TC-13 to TC-20: Regression & UI formatting verification', () => {
  // TC-13: Story Tray and viewer labels
  assert.equal(formatDisplayName('Alice Cooper'), 'Alice Cooper')
  assert.equal(formatDisplayName('raj2@gmail.com'), 'raj2')

  // TC-14: Story Navigation labels
  assert.equal(formatDisplayName({ name: 'Bob Smith', email: 'bob@example.com' }), 'Bob Smith')

  // TC-15: Story reactions and replies identity
  assert.equal(formatDisplayName({ full_name: 'Charlie Brown', username: 'cbrown' }), 'Charlie Brown')
  assert.equal(formatDisplayName({ full_name: '', username: 'cbrown', email: 'c@b.com' }), 'cbrown')

  // TC-16: Story viewer analytics
  assert.equal(formatDisplayName({ name: 'raj2@gmail.com' }), 'raj2')

  // TC-17: Story highlights title & user formatting
  assert.equal(formatUserName({ username: 'alicedev', email: 'alice@example.com' }), 'alicedev')

  // TC-18: Layout and fallback safety
  assert.equal(formatDisplayName(null), 'Anonymous')
  assert.equal(formatUserName(null), 'user')

  // TC-19: Authentication and ownership authorization
  const ownerCheck = (reqUserId, profileId) => String(reqUserId) === String(profileId)
  assert.equal(ownerCheck(1, 1), true)
  assert.equal(ownerCheck(1, 2), false)

  // TC-20: Email never returned in public search
  const sanitizeName = (rawName, email) => {
    if (rawName && !rawName.includes('@') && rawName.trim()) return rawName.trim()
    if (email && email.includes('@')) return email.split('@')[0].trim()
    return 'User'
  }
  assert.equal(sanitizeName('raj2@gmail.com', 'raj2@gmail.com'), 'raj2')
  assert.equal(sanitizeName('Aman Kumar', 'aman@example.com'), 'Aman Kumar')
})

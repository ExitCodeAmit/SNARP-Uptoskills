import assert from 'node:assert/strict'

const BASE = (process.argv[2] || process.env.SMOKE_BASE_URL || 'http://localhost:5000').replace(/\/$/, '')
const EXPECT_FRONTEND = process.env.SMOKE_EXPECT_FRONTEND === 'true'

async function call(method, path, { token, json, form } = {}) {
  const res = await fetch(BASE + path, {
    method,
    headers: { ...(json && { 'Content-Type': 'application/json' }), ...(token && { Authorization: `Bearer ${token}` }) },
    body: form ?? (json && JSON.stringify(json)),
  })
  const text = await res.text()
  let data = null
  try { data = text ? JSON.parse(text) : null } catch { data = text }
  return { status: res.status, headers: res.headers, data }
}

const steps = []
async function step(name, fn) {
  try {
    await fn()
    steps.push(name)
    console.log(`ok   ${name}`)
  } catch (err) {
    console.error(`FAIL ${name}\n     ${err.message}`)
    for (const left of [account, peerAccount].filter(Boolean)) console.error(`     Test account ${left} may be left behind; delete it from the users table.`)
    process.exit(1)
  }
}

const stamp = Date.now()
const email = `smoke-${stamp}@example.test`
const password = `smoke-pass-${stamp}`
const newPassword = `${password}-changed`
const peerEmail = `smoke-peer-${stamp}@example.test`
let token
let myId
let peer
let account = email
let peerAccount = null
let postId
let commentId

await step('health check reaches PostgreSQL', async () => {
  const r = await call('GET', '/api/health')
  assert.equal(r.status, 200)
  assert.equal(r.data.status, 'ok')
})

await step('security headers are set', async () => {
  const r = await call('GET', '/api/health')
  assert.equal(r.headers.get('x-content-type-options'), 'nosniff')
  assert.match(r.headers.get('content-security-policy') ?? '', /default-src 'self'/)
  assert.equal(r.headers.get('x-powered-by'), null)
})

await step('unknown API route returns JSON 404', async () => {
  const r = await call('GET', '/api/does-not-exist')
  assert.equal(r.status, 404)
  assert.equal(typeof r.data.error, 'string')
})

await step('protected route rejects anonymous requests', async () => {
  assert.equal((await call('GET', '/api/posts')).status, 401)
})

await step('sign up', async () => {
  const r = await call('POST', '/api/auth/signup', { json: { name: 'Smoke Test', email, password } })
  assert.equal(r.status, 201, JSON.stringify(r.data))
  assert.ok(!r.data.verification_required, 'Email verification is on. Start the server with REQUIRE_EMAIL_VERIFICATION=false for smoke tests (this left one unverified smoke-*@example.test account).')
  token = r.data.token
  myId = r.data.user.id
  assert.ok(token)
  assert.equal(r.data.user.password_hash, undefined)
})

await step('read own profile', async () => {
  const r = await call('GET', '/api/auth/me', { token })
  assert.equal(r.status, 200)
  assert.equal(r.data.email, email)
})

await step('create a post', async () => {
  const form = new FormData()
  form.append('body', 'Smoke test post')
  const r = await call('POST', '/api/posts', { token, form })
  assert.equal(r.status, 201, JSON.stringify(r.data))
  postId = r.data.id
})

await step('post appears in the feed', async () => {
  const r = await call('GET', '/api/posts', { token })
  assert.equal(r.status, 200)
  assert.ok(r.data.items.some((item) => String(item.id) === String(postId)))
})

await step('like and unlike', async () => {
  let r = await call('PUT', `/api/posts/${postId}/like`, { token, json: { liked: true } })
  assert.equal(r.status, 200)
  assert.equal(r.data.like_count, 1)
  r = await call('PUT', `/api/posts/${postId}/like`, { token, json: { liked: false } })
  assert.equal(r.data.like_count, 0)
})

await step('comment and list comments', async () => {
  const r = await call('POST', `/api/posts/${postId}/comments`, { token, json: { body: 'Smoke test comment' } })
  assert.equal(r.status, 201)
  commentId = r.data.id
  const list = await call('GET', `/api/posts/${postId}/comments`, { token })
  assert.ok(list.data.some((comment) => String(comment.id) === String(commentId)))
})

await step('delete comment', async () => {
  assert.equal((await call('DELETE', `/api/comments/${commentId}`, { token })).status, 204)
})

await step('second account signs up and posts', async () => {
  const r = await call('POST', '/api/auth/signup', { json: { name: 'Smoke Peer', email: peerEmail, password } })
  assert.equal(r.status, 201, JSON.stringify(r.data))
  peerAccount = peerEmail
  peer = { token: r.data.token, id: r.data.user.id }
  const form = new FormData()
  form.append('body', 'Smoke peer post')
  assert.equal((await call('POST', '/api/posts', { token: peer.token, form })).status, 201)
})

await step('follow a researcher', async () => {
  const r = await call('PUT', `/api/users/${peer.id}/follow`, { token, json: { following: true } })
  assert.equal(r.status, 200)
  assert.equal(r.data.followed_by_me, true)
  assert.equal(r.data.follower_count, 1)
  const profile = await call('GET', `/api/users/${peer.id}`, { token })
  assert.equal(profile.data.followed_by_me, true)
  const followers = await call('GET', `/api/users/${peer.id}/followers`, { token })
  assert.equal(followers.data.length, 1)
})

await step('following feed shows followed researchers only', async () => {
  const r = await call('GET', '/api/posts?scope=following', { token })
  assert.equal(r.status, 200)
  assert.ok(r.data.items.some((item) => item.body === 'Smoke peer post'))
  assert.ok(r.data.items.every((item) => [String(myId), String(peer.id)].includes(String(item.user_id))))
})

await step('followed researchers leave suggestions; following notifies them', async () => {
  const suggestions = await call('GET', '/api/users/suggestions', { token })
  assert.equal(suggestions.status, 200)
  assert.ok(!suggestions.data.some((person) => String(person.id) === String(peer.id)))
  const notifications = await call('GET', '/api/notifications', { token: peer.token })
  assert.ok(notifications.data.items.some((item) => item.kind === 'follow'))
})

await step('unfollow', async () => {
  const r = await call('PUT', `/api/users/${peer.id}/follow`, { token, json: { following: false } })
  assert.equal(r.data.followed_by_me, false)
  assert.equal(r.data.follower_count, 0)
})

await step('second account deletes itself', async () => {
  assert.equal((await call('DELETE', '/api/auth/me', { token: peer.token, json: { password } })).status, 204)
  peerAccount = null
})

await step('password change rejects a wrong current password', async () => {
  const r = await call('PUT', '/api/auth/me/password', { token, json: { currentPassword: 'wrong-password', newPassword } })
  assert.equal(r.status, 400)
})

await step('password change works and keeps this session', async () => {
  const r = await call('PUT', '/api/auth/me/password', { token, json: { currentPassword: password, newPassword } })
  assert.equal(r.status, 204)
  assert.equal((await call('GET', '/api/auth/me', { token })).status, 200)
})

await step('old password no longer logs in; new one does', async () => {
  assert.equal((await call('POST', '/api/auth/login', { json: { email, password } })).status, 401)
  const r = await call('POST', '/api/auth/login', { json: { email, password: newPassword } })
  assert.equal(r.status, 200)
})

await step('delete post', async () => {
  assert.equal((await call('DELETE', `/api/posts/${postId}`, { token })).status, 204)
})

await step('logout revokes the session', async () => {
  assert.equal((await call('POST', '/api/auth/logout', { token })).status, 204)
  assert.equal((await call('GET', '/api/auth/me', { token })).status, 401)
})

await step('delete the account, leaving no test data behind', async () => {
  token = (await call('POST', '/api/auth/login', { json: { email, password: newPassword } })).data.token
  assert.equal((await call('DELETE', '/api/auth/me', { token, json: { password: 'wrong-password' } })).status, 400)
  assert.equal((await call('DELETE', '/api/auth/me', { token, json: { password: newPassword } })).status, 204)
  assert.equal((await call('POST', '/api/auth/login', { json: { email, password: newPassword } })).status, 401)
  account = null
})

if (EXPECT_FRONTEND) {
  await step('frontend is served with client-side routes', async () => {
    for (const path of ['/', '/settings']) {
      const r = await call('GET', path)
      assert.equal(r.status, 200)
      assert.match(String(r.data), /<div id="root">/)
    }
  })
}

console.log(`\n${steps.length} checks passed against ${BASE}`)

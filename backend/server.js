import { appendFileSync } from 'node:fs'
import { randomBytes, randomUUID } from 'node:crypto'
import express from 'express'
import pg from 'pg'
import bcrypt from 'bcryptjs'
import multer from 'multer'
import { sniffImage } from './image.js'
import { DEFAULT_MAX_PDF_BYTES, validatePaperSubmission } from './paper.js'
import { createSessionToken, REMEMBERED_SESSION_SECONDS, TEMPORARY_SESSION_SECONDS, verifySessionToken } from './session.js'
import { runMigrations } from './migrate.js'
import { validateProfileUpdate } from './profile.js'
import { buildPaperDiscovery } from './paper-search.js'
import { validateCommunity, validateCommunityPost } from './community.js'
import { validateMessageBody, validateRecipientId } from './messaging.js'
import { validateEvent } from './event.js'
import { rateLimit } from 'express-rate-limit'

// Connection settings come from the standard PG* env vars (PGHOST, PGPORT, PGUSER, PGPASSWORD), see .env.example
const DB_NAME = process.env.PGDATABASE || 'snarp'
const PORT = process.env.PORT || 5000
const PG_POOL_MAX = Number.parseInt(process.env.PGPOOL_MAX || '10', 10)
if (!Number.isSafeInteger(PG_POOL_MAX) || PG_POOL_MAX < 1 || PG_POOL_MAX > 100) {
  throw new Error('PGPOOL_MAX must be an integer between 1 and 100')
}
const log = (level, event, fields = {}) => console.log(JSON.stringify({
  timestamp: new Date().toISOString(), level, event, ...fields,
}))
const configuredMaxPdfBytes = Number(process.env.PAPER_MAX_PDF_BYTES || '')
const MAX_PDF_BYTES = Number.isSafeInteger(configuredMaxPdfBytes) && configuredMaxPdfBytes > 0
  ? Math.min(configuredMaxPdfBytes, DEFAULT_MAX_PDF_BYTES)
  : DEFAULT_MAX_PDF_BYTES

// Local development can bootstrap a persistent secret. Production must receive
// its secret from the deployment environment or a secret manager.
if (!process.env.JWT_SECRET && process.env.NODE_ENV === 'production') {
  throw new Error('JWT_SECRET must be configured in production')
}
if (!process.env.JWT_SECRET) {
  process.env.JWT_SECRET = randomBytes(48).toString('hex')
  appendFileSync(new URL('.env', import.meta.url), `\nJWT_SECRET=${process.env.JWT_SECRET}\n`)
  log('info', 'development_secret_generated')
}
if (Buffer.byteLength(process.env.JWT_SECRET, 'utf8') < 32) {
  throw new Error('JWT_SECRET must be at least 32 bytes')
}
const JWT_SECRET = process.env.JWT_SECRET
// Unknown accounts still pay bcrypt's comparison cost to reduce timing-based enumeration.
const DUMMY_PASSWORD_HASH = await bcrypt.hash(randomBytes(32).toString('hex'), 10)
const isPgId = (value) => /^\d+$/.test(value) && Number(value) > 0 && Number(value) <= 2147483647
const isSafeId = (value) => /^\d+$/.test(value) && Number.isSafeInteger(Number(value)) && Number(value) > 0
const isPgBigId = (value) => {
  if (!/^\d+$/.test(value)) return false
  try { return BigInt(value) > 0n && BigInt(value) <= 9223372036854775807n } catch { return false }
}

// Creates the database on first run, then applies ordered SQL migrations.
async function setupDb() {
  const admin = new pg.Client({ database: 'postgres' })
  let adminConnected = false
  try {
    await admin.connect()
    adminConnected = true
    const { rowCount } = await admin.query('SELECT 1 FROM pg_database WHERE datname = $1', [DB_NAME])
    if (!rowCount) {
      try {
        await admin.query(`CREATE DATABASE "${DB_NAME.replaceAll('"', '""')}"`)
        log('info', 'database_created', { database: DB_NAME })
      } catch (err) {
        // Another server process may have created the database after our check.
        if (err.code !== '42P04') throw err
      }
    }
  } finally {
    if (adminConnected) await admin.end()
  }

  const pool = new pg.Pool({ database: DB_NAME, max: PG_POOL_MAX })
  try {
    await runMigrations(pool, new URL('./migrations/', import.meta.url))
  } catch (err) {
    await pool.end()
    throw err
  }
  return pool
}

const pool = await setupDb().catch((err) => {
  log('error', 'database_setup_failed', { code: err.code ?? 'unknown', message: err.message })
  console.error('Check PGHOST/PGPORT/PGUSER/PGPASSWORD in backend/.env')
  process.exit(1)
})

const app = express()
const trustProxyConfig = process.env.TRUST_PROXY?.trim()
if (trustProxyConfig) {
  if (/^(true|false)$/i.test(trustProxyConfig)) {
    throw new Error('TRUST_PROXY must be a hop count or a comma-separated list of trusted proxy IPs/CIDRs, not true/false')
  }
  const hopCount = Number(trustProxyConfig)
  app.set('trust proxy', Number.isSafeInteger(hopCount) && hopCount >= 0
    ? hopCount
    : trustProxyConfig.split(',').map((proxy) => proxy.trim()).filter(Boolean))
}
app.disable('x-powered-by')
app.use((_req, res, next) => {
  res.set({
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'SAMEORIGIN',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'Permissions-Policy': 'camera=(), geolocation=(), microphone=()',
  })
  next()
})
app.use(express.json({ limit: '100kb' }))

const signupLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  limit: 5,
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req, res) => {
    res.status(429).json({
      error: 'Too many signup attempts. Please try again later.',
    })
  },
})

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  limit: 10,
  skipSuccessfulRequests: true,
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req, res) => {
    res.status(429).json({
      error: 'Too many failed login attempts. Please try again later.',
    })
  },
})

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024, files: 1 } })
const paperUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: MAX_PDF_BYTES, files: 1 } })

const publicUser = ({
  id, name, email, role, created_at, profile_image_id,
  institution = '', department = '', research_interests = [], bio = '', skills = [], links = [],
}) => ({
  id,
  name,
  email,
  role,
  created_at,
  avatar_url: profile_image_id ? `/api/images/${profile_image_id}` : null,
  institution,
  department,
  research_interests,
  bio,
  skills,
  links,
})
async function issue(user, remember = true) {
  const sessionId = randomUUID()
  const expiresIn = remember ? REMEMBERED_SESSION_SECONDS : TEMPORARY_SESSION_SECONDS
  const expiresAt = new Date(Date.now() + expiresIn * 1000)
  await pool.query('DELETE FROM auth_sessions WHERE expires_at <= now() OR revoked_at < now() - interval \'30 days\'')
  await pool.query(
    'INSERT INTO auth_sessions (id, user_id, expires_at) VALUES ($1, $2, $3)',
    [sessionId, user.id, expiresAt]
  )
  const { token } = createSessionToken(user.id, sessionId, JWT_SECRET, remember)
  return { token, user: publicUser(user) }
}

async function auth(req, res, next) {
  const token = req.headers.authorization?.replace(/^Bearer /, '')
  let payload
  try {
    payload = verifySessionToken(token, JWT_SECRET)
  } catch {
    return res.status(401).json({ error: 'Please log in again' })
  }

  try {
    const { rows } = await pool.query(
      `SELECT u.role FROM auth_sessions s JOIN users u ON u.id = s.user_id
       WHERE s.id = $1 AND s.user_id = $2 AND s.revoked_at IS NULL AND s.expires_at > now()`,
      [payload.jti, payload.sub]
    )
    if (!rows[0]) return res.status(401).json({ error: 'Please log in again' })
    req.userId = payload.sub
    req.sessionId = payload.jti
    req.userRole = rows[0].role
    return next()
  } catch (err) {
    return next(err)
  }
}

function requireAuthor(req, res, next) {
  if (req.userRole !== 'author') return res.status(403).json({ error: 'Author access required' })
  next()
}

function requireModerator(req, res, next) {
  if (!['admin', 'moderator'].includes(req.userRole)) {
    return res.status(403).json({ error: 'Moderator or Admin access required' })
  }
  next()
}

function requireAdmin(req, res, next) {
  if (req.userRole !== 'admin') return res.status(403).json({ error: 'Admin access required' })
  next()
}

function requireEventOrganizer(req, res, next) {
  if (!['author', 'moderator', 'admin'].includes(req.userRole)) {
    return res.status(403).json({ error: 'Author, Moderator, or Admin access required to manage events' })
  }
  next()
}

app.post('/api/auth/signup', signupLimiter, async (req, res) => {
  const name = String(req.body?.name ?? '').trim()
  const email = String(req.body?.email ?? '').trim().toLowerCase()
  const password = String(req.body?.password ?? '')
  // Admin/Moderator are assigned by an admin, never self-selected
  const role = req.body?.role === 'author' ? 'author' : 'user'
  if (!name || name.length > 100) return res.status(400).json({ error: 'Enter your full name' })
  if (!/^\S+@\S+\.\S+$/.test(email) || email.length > 255) return res.status(400).json({ error: 'Enter a valid email address' })
  if (password.length < 8 || password.length > 72) return res.status(400).json({ error: 'Password must be 8-72 characters' })

  const hash = await bcrypt.hash(password, 10)
  try {
    const { rows } = await pool.query(
      'INSERT INTO users (name, email, password_hash, role) VALUES ($1, $2, $3, $4) RETURNING *',
      [name, email, hash, role]
    )
    res.status(201).json(await issue(rows[0]))
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'An account with this email already exists' })
    throw err
  }
})

app.post('/api/auth/login', loginLimiter, async (req, res) => {
  const email = String(req.body?.email ?? '').trim().toLowerCase()
  const password = String(req.body?.password ?? '')
  const { rows } = await pool.query('SELECT * FROM users WHERE email = $1', [email])
  const passwordMatches = await bcrypt.compare(password, rows[0]?.password_hash ?? DUMMY_PASSWORD_HASH)
  if (!rows[0] || !passwordMatches) {
    return res.status(401).json({ error: 'Incorrect email or password' })
  }
  const remember = req.body?.remember !== false
  res.json(await issue(rows[0], remember))
})

app.post('/api/auth/logout', auth, async (req, res) => {
  await pool.query('UPDATE auth_sessions SET revoked_at = now() WHERE id = $1 AND revoked_at IS NULL', [req.sessionId])
  res.status(204).end()
})

app.get('/api/auth/me', auth, async (req, res) => {
  const { rows } = await pool.query(
    `SELECT u.*, COALESCE(up.institution, '') AS institution, COALESCE(up.department, '') AS department,
      COALESCE(up.research_interests, '{}') AS research_interests, COALESCE(up.bio, '') AS bio,
      COALESCE(up.skills, '{}') AS skills, COALESCE(up.links, '[]'::jsonb) AS links,
      (SELECT count(*)::int FROM posts WHERE user_id = u.id) AS post_count
     FROM users u LEFT JOIN user_profiles up ON up.user_id = u.id WHERE u.id = $1`,
    [req.userId]
  )
  if (!rows[0]) return res.status(401).json({ error: 'Please log in again' })
  res.json({ ...publicUser(rows[0]), post_count: rows[0].post_count })
})

app.put('/api/auth/me', auth, async (req, res) => {
  let profile
  try {
    profile = validateProfileUpdate(req.body ?? {})
  } catch (err) {
    if (err.field) return res.status(400).json({ error: err.message, field: err.field })
    throw err
  }

  const client = await pool.connect()
  let transactionStarted = false
  try {
    await client.query('BEGIN')
    transactionStarted = true
    await client.query('UPDATE users SET name = $2 WHERE id = $1', [req.userId, profile.name])
    await client.query(
      `INSERT INTO user_profiles (user_id, institution, department, research_interests, bio, skills, links)
       VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb)
       ON CONFLICT (user_id) DO UPDATE SET institution = EXCLUDED.institution,
         department = EXCLUDED.department, research_interests = EXCLUDED.research_interests,
         bio = EXCLUDED.bio, skills = EXCLUDED.skills, links = EXCLUDED.links, updated_at = now()`,
      [req.userId, profile.institution, profile.department, profile.research_interests,
        profile.bio, profile.skills, JSON.stringify(profile.links)]
    )
    await client.query('COMMIT')
    transactionStarted = false
  } catch (err) {
    if (transactionStarted) await client.query('ROLLBACK')
    throw err
  } finally {
    client.release()
  }

  const { rows } = await pool.query(
    `SELECT u.*, up.institution, up.department, up.research_interests, up.bio, up.skills, up.links,
      (SELECT count(*)::int FROM posts WHERE user_id = u.id) AS post_count
     FROM users u JOIN user_profiles up ON up.user_id = u.id WHERE u.id = $1`,
    [req.userId]
  )
  res.json({ ...publicUser(rows[0]), post_count: rows[0].post_count })
})

app.get('/api/communities', auth, async (req, res) => {
  const page = Math.max(1, Math.min(10000, Number.parseInt(req.query.page, 10) || 1))
  const limit = Math.max(1, Math.min(50, Number.parseInt(req.query.limit, 10) || 20))
  const q = typeof req.query.q === 'string' ? req.query.q.trim().slice(0, 120) : ''
  const pattern = `%${q.replace(/[\\%_]/g, '\\$&')}%`
  const { rows } = await pool.query(`
    SELECT c.id, c.name, c.description, c.category, c.created_at, creator.name AS creator_name,
      (SELECT count(*)::int FROM community_members cm WHERE cm.community_id = c.id) AS member_count,
      EXISTS (SELECT 1 FROM community_members mine WHERE mine.community_id = c.id AND mine.user_id = $4) AS joined,
      (SELECT role FROM community_members mine WHERE mine.community_id = c.id AND mine.user_id = $4) AS membership_role,
      (SELECT count(*)::int FROM community_posts cp WHERE cp.community_id = c.id) AS post_count
    FROM communities c JOIN users creator ON creator.id = c.created_by
    WHERE $1 = '' OR c.name ILIKE $2 OR c.description ILIKE $2 OR c.category ILIKE $2
    ORDER BY c.created_at DESC, c.id DESC LIMIT $3 OFFSET $5`,
  [q, pattern, limit, req.userId, (page - 1) * limit])
  res.json({ items: rows, page, limit, hasMore: rows.length === limit })
})

app.post('/api/communities', auth, async (req, res) => {
  let community
  try { community = validateCommunity(req.body) } catch (err) {
    return res.status(400).json({ error: err.message, field: err.field })
  }
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const inserted = await client.query(`INSERT INTO communities (name, description, category, created_by)
      VALUES ($1, $2, $3, $4) RETURNING id, name, description, category, created_at`,
    [community.name, community.description, community.category, req.userId])
    await client.query("INSERT INTO community_members (community_id, user_id, role) VALUES ($1, $2, 'owner')", [inserted.rows[0].id, req.userId])
    await client.query('COMMIT')
    res.status(201).json({ ...inserted.rows[0], member_count: 1, joined: true, post_count: 0 })
  } catch (err) {
    await client.query('ROLLBACK')
    if (err.code === '23505') return res.status(409).json({ error: 'A community with this name already exists', field: 'name' })
    throw err
  } finally { client.release() }
})

app.get('/api/communities/:id', auth, async (req, res) => {
  if (!isPgBigId(req.params.id)) return res.status(404).json({ error: 'Community not found' })
  const { rows } = await pool.query(`SELECT c.id, c.name, c.description, c.category, c.created_at,
      creator.name AS creator_name,
      (SELECT count(*)::int FROM community_members cm WHERE cm.community_id = c.id) AS member_count,
      (SELECT count(*)::int FROM community_posts cp WHERE cp.community_id = c.id) AS post_count,
      (SELECT role FROM community_members mine WHERE mine.community_id = c.id AND mine.user_id = $2) AS membership_role
    FROM communities c JOIN users creator ON creator.id = c.created_by WHERE c.id = $1`, [req.params.id, req.userId])
  if (!rows[0]) return res.status(404).json({ error: 'Community not found' })
  res.json(rows[0])
})

app.get('/api/communities/:id/members', auth, async (req, res) => {
  if (!isPgBigId(req.params.id)) return res.status(404).json({ error: 'Community not found' })
  const { rows } = await pool.query(`SELECT cm.user_id, cm.role, cm.joined_at, u.name,
      u.profile_image_id
    FROM community_members cm JOIN users u ON u.id = cm.user_id
    WHERE cm.community_id = $1
    ORDER BY CASE cm.role WHEN 'owner' THEN 0 WHEN 'moderator' THEN 1 ELSE 2 END, cm.joined_at
    LIMIT 100`, [req.params.id])
  const exists = await pool.query('SELECT 1 FROM communities WHERE id = $1', [req.params.id])
  if (!exists.rowCount) return res.status(404).json({ error: 'Community not found' })
  res.json(rows.map(({ profile_image_id, ...member }) => ({
    ...member,
    avatar_url: profile_image_id ? `/api/images/${profile_image_id}` : null,
  })))
})

app.patch('/api/communities/:id/members/:userId/role', auth, async (req, res) => {
  if (!isPgBigId(req.params.id) || !isPgId(req.params.userId)) return res.status(404).json({ error: 'Community member not found' })
  const role = req.body?.role
  if (!['moderator', 'member'].includes(role)) return res.status(400).json({ error: 'Role must be moderator or member' })
  const { rows } = await pool.query(`
    WITH changed AS (
      UPDATE community_members cm SET role = $4
      WHERE cm.community_id = $1 AND cm.user_id = $2 AND cm.role <> 'owner'
        AND EXISTS (SELECT 1 FROM communities c WHERE c.id = $1 AND (c.created_by = $3 OR EXISTS (SELECT 1 FROM users u WHERE u.id = $3 AND u.role IN ('admin', 'moderator'))))
      RETURNING cm.community_id, cm.user_id, cm.role
    ), logged AS (
      INSERT INTO audit_logs (actor_id, action, target_type, target_id, details)
      SELECT $3, 'community.member_role_changed', 'community_member', user_id::text,
        jsonb_build_object('communityId', community_id, 'role', role) FROM changed RETURNING id
    ) SELECT * FROM changed`, [req.params.id, req.params.userId, req.userId, role])
  if (!rows[0]) {
    const { rows: membership } = await pool.query('SELECT role FROM community_members WHERE community_id = $1 AND user_id = $2', [req.params.id, req.params.userId])
    if (!membership[0]) return res.status(404).json({ error: 'Community member not found' })
    if (membership[0].role === 'owner') return res.status(409).json({ error: 'The community owner role cannot be changed here' })
    return res.status(403).json({ error: 'Only the community owner or a platform moderator can change roles' })
  }
  res.json(rows[0])
})

app.patch('/api/communities/:id', auth, async (req, res) => {
  if (!isPgBigId(req.params.id)) return res.status(404).json({ error: 'Community not found' })
  let community
  try { community = validateCommunity(req.body) } catch (err) {
    return res.status(400).json({ error: err.message, field: err.field })
  }
  const { rows } = await pool.query(`UPDATE communities c SET name = $3, description = $4, category = $5, updated_at = now()
    WHERE c.id = $1 AND (c.created_by = $2 OR EXISTS (SELECT 1 FROM users u WHERE u.id = $2 AND u.role IN ('admin', 'moderator')))
    RETURNING c.id, c.name, c.description, c.category, c.updated_at`,
  [req.params.id, req.userId, community.name, community.description, community.category])
  if (!rows[0]) {
    const exists = await pool.query('SELECT 1 FROM communities WHERE id = $1', [req.params.id])
    return res.status(exists.rowCount ? 403 : 404).json({ error: exists.rowCount ? 'Community owner or moderator access required' : 'Community not found' })
  }
  res.json(rows[0])
})

app.put('/api/communities/:id/membership', auth, async (req, res) => {
  if (!isPgBigId(req.params.id)) return res.status(404).json({ error: 'Community not found' })
  if (typeof req.body?.joined !== 'boolean') return res.status(400).json({ error: 'joined must be a boolean' })
  if (req.body.joined) {
    const { rows } = await pool.query(`INSERT INTO community_members (community_id, user_id)
      SELECT id, $2 FROM communities WHERE id = $1
      ON CONFLICT (community_id, user_id) DO UPDATE SET user_id = EXCLUDED.user_id
      RETURNING community_id`, [req.params.id, req.userId])
    if (!rows[0]) return res.status(404).json({ error: 'Community not found' })
    return res.json({ joined: true })
  }
  const { rows } = await pool.query(`DELETE FROM community_members
    WHERE community_id = $1 AND user_id = $2 AND role <> 'owner' RETURNING community_id`, [req.params.id, req.userId])
  if (rows[0]) return res.json({ joined: false })
  const { rows: communityRows } = await pool.query('SELECT 1 FROM communities WHERE id = $1', [req.params.id])
  if (!communityRows[0]) return res.status(404).json({ error: 'Community not found' })
  const { rows: memberRows } = await pool.query('SELECT role FROM community_members WHERE community_id = $1 AND user_id = $2', [req.params.id, req.userId])
  if (memberRows[0]?.role === 'owner') return res.status(409).json({ error: 'The community owner cannot leave before transferring ownership' })
  return res.json({ joined: false })
})

app.get('/api/communities/:id/posts', auth, async (req, res) => {
  if (!isPgBigId(req.params.id)) return res.status(404).json({ error: 'Community not found' })
  const page = Math.max(1, Math.min(10000, Number.parseInt(req.query.page, 10) || 1))
  const limit = Math.max(1, Math.min(50, Number.parseInt(req.query.limit, 10) || 20))
  const [{ rows }, countResult] = await Promise.all([
    pool.query(`SELECT cp.id, cp.community_id, cp.user_id, cp.body, cp.created_at, cp.updated_at,
        u.name AS author_name, u.profile_image_id,
        (SELECT count(*)::int FROM community_members cm WHERE cm.community_id = cp.community_id) AS member_count
      FROM community_posts cp JOIN users u ON u.id = cp.user_id
      WHERE cp.community_id = $1 ORDER BY cp.created_at DESC, cp.id DESC LIMIT $2 OFFSET $3`,
    [req.params.id, limit, (page - 1) * limit]),
    pool.query('SELECT count(*)::int AS total FROM community_posts WHERE community_id = $1', [req.params.id]),
  ])
  const exists = await pool.query('SELECT 1 FROM communities WHERE id = $1', [req.params.id])
  if (!exists.rowCount) return res.status(404).json({ error: 'Community not found' })
  res.json({ items: rows.map(({ profile_image_id, ...post }) => ({ ...post, author_avatar_url: profile_image_id ? `/api/images/${profile_image_id}` : null })), page, limit, total: countResult.rows[0].total, hasMore: page * limit < countResult.rows[0].total })
})

app.post('/api/communities/:id/posts', auth, async (req, res) => {
  if (!isPgBigId(req.params.id)) return res.status(404).json({ error: 'Community not found' })
  let body
  try { body = validateCommunityPost(req.body) } catch (err) {
    return res.status(400).json({ error: err.message, field: err.field })
  }
  const { rows } = await pool.query(`INSERT INTO community_posts (community_id, user_id, body)
    SELECT cm.community_id, cm.user_id, $3 FROM community_members cm WHERE cm.community_id = $1 AND cm.user_id = $2
    RETURNING id, community_id, user_id, body, created_at, updated_at`, [req.params.id, req.userId, body])
  if (rows[0]) return res.status(201).json(rows[0])
  const { rows: exists } = await pool.query('SELECT 1 FROM communities WHERE id = $1', [req.params.id])
  return res.status(exists[0] ? 403 : 404).json({ error: exists[0] ? 'Join the community to post' : 'Community not found' })
})

app.delete('/api/communities/:communityId/posts/:postId', auth, async (req, res) => {
  if (!isPgBigId(req.params.communityId) || !isPgBigId(req.params.postId)) return res.status(404).json({ error: 'Community post not found' })
  const { rows } = await pool.query(`DELETE FROM community_posts cp WHERE cp.id = $1 AND cp.community_id = $2
    AND (cp.user_id = $3 OR EXISTS (SELECT 1 FROM community_members cm WHERE cm.community_id = cp.community_id AND cm.user_id = $3 AND cm.role IN ('owner', 'moderator'))
      OR EXISTS (SELECT 1 FROM users u WHERE u.id = $3 AND u.role IN ('admin', 'moderator')))
    RETURNING cp.id`, [req.params.postId, req.params.communityId, req.userId])
  if (!rows[0]) return res.status(404).json({ error: 'Community post not found' })
  res.status(204).end()
})

app.get('/api/users/search', auth, async (req, res) => {
  const q = String(req.query.q ?? '').trim().slice(0, 100)
  if (!q) return res.json([])
  const pattern = `%${q.replace(/[\\%_]/g, '\\$&')}%`
  const { rows } = await pool.query(
    `SELECT u.id, u.name, u.role, u.profile_image_id,
      COALESCE(up.institution, '') AS institution, COALESCE(up.department, '') AS department
     FROM users u LEFT JOIN user_profiles up ON up.user_id = u.id
     WHERE u.name ILIKE $1 OR up.institution ILIKE $1 OR up.department ILIKE $1
       OR array_to_string(up.research_interests, ' ') ILIKE $1
     ORDER BY u.name LIMIT 20`,
    [pattern]
  )
  res.json(rows.map(({ profile_image_id, ...user }) => ({
    ...user,
    avatar_url: profile_image_id ? `/api/images/${profile_image_id}` : null,
  })))
})

app.get('/api/users/:id', auth, async (req, res) => {
  if (!isPgId(req.params.id)) return res.status(404).json({ error: 'User not found' })
  const { rows } = await pool.query(
    `SELECT u.id, u.name, u.role, u.created_at, u.profile_image_id,
      COALESCE(up.institution, '') AS institution, COALESCE(up.department, '') AS department,
      COALESCE(up.research_interests, '{}') AS research_interests, COALESCE(up.bio, '') AS bio,
      COALESCE(up.skills, '{}') AS skills, COALESCE(up.links, '[]'::jsonb) AS links,
      (SELECT count(*)::int FROM posts WHERE user_id = u.id) AS post_count
     FROM users u LEFT JOIN user_profiles up ON up.user_id = u.id WHERE u.id = $1`,
    [req.params.id]
  )
  if (!rows[0]) return res.status(404).json({ error: 'User not found' })
  const user = rows[0]
  const pinnedPostId = isPgId(req.query.post) ? req.query.post : null
  const posts = await pool.query(
    `SELECT p.id, p.body, p.image_id, p.created_at, p.updated_at,
      (SELECT count(*)::int FROM likes l WHERE l.post_id = p.id) AS like_count,
      EXISTS (SELECT 1 FROM likes l WHERE l.post_id = p.id AND l.user_id = $2) AS liked_by_me,
      (SELECT count(*)::int FROM comments c WHERE c.post_id = p.id) AS comment_count
     FROM posts p WHERE p.user_id = $1 AND (
       $3::integer IS NULL OR p.id = $3 OR p.id IN (
         SELECT recent.id FROM posts recent WHERE recent.user_id = $1
         ORDER BY recent.created_at DESC, recent.id DESC LIMIT 20
       )
     )
     ORDER BY CASE WHEN p.id = $3 THEN 0 ELSE 1 END, p.created_at DESC, p.id DESC LIMIT 20`,
    [user.id, req.userId, pinnedPostId]
  )
  const { profile_image_id, ...publicProfile } = user
  res.json({
    ...publicProfile,
    avatar_url: profile_image_id ? `/api/images/${profile_image_id}` : null,
    posts: posts.rows,
  })
})

app.put('/api/auth/me/photo', auth, upload.single('photo'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Choose a photo to upload' })
  const mime = sniffImage(req.file.buffer)
  if (!mime) return res.status(400).json({ error: 'Photo must be a JPEG, PNG, GIF or WebP image' })

  const client = await pool.connect()
  let transactionStarted = false
  try {
    await client.query('BEGIN')
    transactionStarted = true
    const { rows: users } = await client.query(
      'SELECT profile_image_id FROM users WHERE id = $1 FOR UPDATE',
      [req.userId]
    )
    if (!users[0]) {
      await client.query('ROLLBACK')
      transactionStarted = false
      return res.status(401).json({ error: 'Please log in again' })
    }

    const previousImageId = users[0].profile_image_id
    const { rows: images } = await client.query(
      'INSERT INTO images (user_id, mime, data) VALUES ($1, $2, $3) RETURNING id',
      [req.userId, mime, req.file.buffer]
    )
    const imageId = images[0].id
    await client.query('UPDATE users SET profile_image_id = $1 WHERE id = $2', [imageId, req.userId])
    if (previousImageId) {
      await client.query(
        `DELETE FROM images WHERE id = $1
          AND NOT EXISTS (SELECT 1 FROM posts WHERE image_id = $1)
          AND NOT EXISTS (SELECT 1 FROM users WHERE profile_image_id = $1)`,
        [previousImageId]
      )
    }
    await client.query('COMMIT')
    transactionStarted = false
    res.json({ avatar_url: `/api/images/${imageId}` })
  } catch (err) {
    if (transactionStarted) await client.query('ROLLBACK')
    throw err
  } finally {
    client.release()
  }
})

const POST_SELECT = `
  SELECT p.id, p.body, p.image_id, p.created_at, p.updated_at, p.user_id, u.name AS author_name, u.role AS author_role,
    CASE WHEN u.profile_image_id IS NULL THEN NULL ELSE '/api/images/' || u.profile_image_id::text END AS author_avatar_url,
    (SELECT count(*)::int FROM likes l WHERE l.post_id = p.id) AS like_count,
    EXISTS (SELECT 1 FROM likes l WHERE l.post_id = p.id AND l.user_id = $2) AS liked_by_me,
    (SELECT count(*)::int FROM comments c WHERE c.post_id = p.id) AS comment_count
  FROM posts p JOIN users u ON u.id = p.user_id`

// Mixed feed: social posts plus approved papers, newest first. Paper metadata is always read from PostgreSQL.
app.get('/api/events', auth, async (req, res) => {
  const page = Math.max(1, Math.min(10000, Number.parseInt(req.query.page, 10) || 1))
  const limit = Math.max(1, Math.min(50, Number.parseInt(req.query.limit, 10) || 20))
  const q = typeof req.query.q === 'string' ? req.query.q.trim().slice(0, 120) : ''
  const pattern = `%${q.replace(/[\\%_]/g, '\\$&')}%`
  const [{ rows }, countResult] = await Promise.all([
    pool.query(`SELECT e.id, e.title, e.description, e.kind, e.location, e.starts_at, e.ends_at,
        e.capacity, e.status, e.created_by, creator.name AS creator_name,
        (SELECT count(*)::int FROM event_registrations er WHERE er.event_id = e.id) AS registration_count,
        EXISTS (SELECT 1 FROM event_registrations mine WHERE mine.event_id = e.id AND mine.user_id = $3) AS registered,
        e.created_by = $3 AS is_organizer
      FROM events e JOIN users creator ON creator.id = e.created_by
      WHERE e.status = 'published' AND e.starts_at > now()
        AND ($1 = '' OR e.title ILIKE $2 OR e.description ILIKE $2 OR e.kind ILIKE $2 OR e.location ILIKE $2)
      ORDER BY e.starts_at, e.id LIMIT $4 OFFSET $5`, [q, pattern, req.userId, limit, (page - 1) * limit]),
    pool.query(`SELECT count(*)::int AS total FROM events e WHERE e.status = 'published' AND e.starts_at > now()
      AND ($1 = '' OR e.title ILIKE $2 OR e.description ILIKE $2 OR e.kind ILIKE $2 OR e.location ILIKE $2)`, [q, pattern]),
  ])
  res.json({ items: rows, page, limit, total: countResult.rows[0].total, hasMore: page * limit < countResult.rows[0].total })
})

app.post('/api/events', auth, requireEventOrganizer, async (req, res) => {
  let event
  try { event = validateEvent(req.body) } catch (err) {
    return res.status(400).json({ error: err.message, field: err.field })
  }
  const { rows } = await pool.query(`INSERT INTO events (title, description, kind, location, starts_at, ends_at, capacity, created_by)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id, title, description, kind, location, starts_at, ends_at, capacity, status, created_by, created_at`,
  [event.title, event.description, event.kind, event.location, event.startsAt, event.endsAt, event.capacity, req.userId])
  res.status(201).json({ ...rows[0], registration_count: 0, registered: false, is_organizer: true })
})

app.get('/api/events/:id', auth, async (req, res) => {
  if (!isPgBigId(req.params.id)) return res.status(404).json({ error: 'Event not found' })
  const { rows } = await pool.query(`SELECT e.id, e.title, e.description, e.kind, e.location, e.starts_at, e.ends_at,
      e.capacity, e.status, e.created_by, e.created_at, e.updated_at, creator.name AS creator_name,
      (SELECT count(*)::int FROM event_registrations er WHERE er.event_id = e.id) AS registration_count,
      EXISTS (SELECT 1 FROM event_registrations mine WHERE mine.event_id = e.id AND mine.user_id = $2) AS registered,
      (e.created_by = $2 OR EXISTS (SELECT 1 FROM users u WHERE u.id = $2 AND u.role IN ('admin', 'moderator'))) AS can_manage
    FROM events e JOIN users creator ON creator.id = e.created_by WHERE e.id = $1`, [req.params.id, req.userId])
  if (!rows[0]) return res.status(404).json({ error: 'Event not found' })
  res.json(rows[0])
})

app.patch('/api/events/:id', auth, requireEventOrganizer, async (req, res) => {
  if (!isPgBigId(req.params.id)) return res.status(404).json({ error: 'Event not found' })
  let event
  try { event = validateEvent(req.body) } catch (err) {
    return res.status(400).json({ error: err.message, field: err.field })
  }
  const { rows } = await pool.query(`WITH changed AS (
      UPDATE events e SET title = $3, description = $4, kind = $5, location = $6,
        starts_at = $7, ends_at = $8, capacity = $9, updated_at = now()
      WHERE e.id = $1 AND (e.created_by = $2 OR EXISTS (SELECT 1 FROM users u WHERE u.id = $2 AND u.role IN ('admin', 'moderator')))
        AND ($9::integer IS NULL OR $9::integer >= (SELECT count(*) FROM event_registrations er WHERE er.event_id = e.id))
      RETURNING e.id, e.title, e.description, e.kind, e.location, e.starts_at, e.ends_at, e.capacity, e.status, e.updated_at
    ), logged AS (
      INSERT INTO audit_logs (actor_id, action, target_type, target_id, details)
      SELECT $2, 'event.updated', 'event', id::text, jsonb_build_object('title', title) FROM changed RETURNING id
    ) SELECT * FROM changed`,
  [req.params.id, req.userId, event.title, event.description, event.kind, event.location, event.startsAt, event.endsAt, event.capacity])
  if (!rows[0]) {
    const exists = await pool.query(`SELECT e.created_by, (SELECT count(*)::int FROM event_registrations er WHERE er.event_id = e.id) AS registrations
      FROM events e WHERE e.id = $1`, [req.params.id])
    if (!exists.rowCount) return res.status(404).json({ error: 'Event not found' })
    if (exists.rows[0].created_by !== Number(req.userId) && !['admin', 'moderator'].includes(req.userRole)) {
      return res.status(403).json({ error: 'Event organizer access required' })
    }
    return res.status(409).json({ error: 'Capacity cannot be lower than the number of existing registrations' })
  }
  res.json(rows[0])
})

app.patch('/api/events/:id/cancel', auth, requireEventOrganizer, async (req, res) => {
  if (!isPgBigId(req.params.id)) return res.status(404).json({ error: 'Event not found' })
  const { rows } = await pool.query(`WITH changed AS (
      UPDATE events e SET status = 'cancelled', updated_at = now()
      WHERE e.id = $1 AND (e.created_by = $2 OR EXISTS (SELECT 1 FROM users u WHERE u.id = $2 AND u.role IN ('admin', 'moderator')))
      RETURNING e.id
    ), logged AS (
      INSERT INTO audit_logs (actor_id, action, target_type, target_id, details)
      SELECT $2, 'event.cancelled', 'event', id::text, '{}'::jsonb FROM changed RETURNING id
    ) SELECT id, 'cancelled'::text AS status FROM changed`, [req.params.id, req.userId])
  if (!rows[0]) {
    const exists = await pool.query('SELECT 1 FROM events WHERE id = $1', [req.params.id])
    return res.status(exists.rowCount ? 403 : 404).json({ error: exists.rowCount ? 'Event organizer access required' : 'Event not found' })
  }
  res.json(rows[0])
})

app.put('/api/events/:id/registration', auth, async (req, res) => {
  if (!isPgBigId(req.params.id)) return res.status(404).json({ error: 'Event not found' })
  if (typeof req.body?.registered !== 'boolean') return res.status(400).json({ error: 'registered must be a boolean' })
  const client = await pool.connect()
  let transactionStarted = false
  try {
    await client.query('BEGIN')
    transactionStarted = true
    const { rows: eventRows } = await client.query('SELECT id, capacity, status, starts_at FROM events WHERE id = $1 FOR UPDATE', [req.params.id])
    const event = eventRows[0]
    if (!event) {
      await client.query('ROLLBACK'); transactionStarted = false
      return res.status(404).json({ error: 'Event not found' })
    }
    if (!req.body.registered) {
      await client.query('DELETE FROM event_registrations WHERE event_id = $1 AND user_id = $2', [req.params.id, req.userId])
      await client.query('COMMIT'); transactionStarted = false
      return res.json({ registered: false })
    }
    if (event.status !== 'published' || new Date(event.starts_at).getTime() <= Date.now()) {
      await client.query('ROLLBACK'); transactionStarted = false
      return res.status(409).json({ error: 'Registration is closed for this event' })
    }
    const existing = await client.query('SELECT 1 FROM event_registrations WHERE event_id = $1 AND user_id = $2', [req.params.id, req.userId])
    if (!existing.rowCount && event.capacity !== null) {
      const count = await client.query('SELECT count(*)::int AS total FROM event_registrations WHERE event_id = $1', [req.params.id])
      if (count.rows[0].total >= event.capacity) {
        await client.query('ROLLBACK'); transactionStarted = false
        return res.status(409).json({ error: 'This event has reached capacity' })
      }
    }
    await client.query('INSERT INTO event_registrations (event_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [req.params.id, req.userId])
    await client.query('COMMIT'); transactionStarted = false
    res.json({ registered: true })
  } catch (err) {
    if (transactionStarted) await client.query('ROLLBACK')
    throw err
  } finally { client.release() }
})

app.get('/api/messages/conversations', auth, async (req, res) => {
  const { rows } = await pool.query(`SELECT c.id, other.id AS other_user_id, other.name,
      CASE WHEN other.profile_image_id IS NULL THEN NULL ELSE '/api/images/' || other.profile_image_id::text END AS avatar_url,
      latest.body AS last_message, latest.created_at AS last_message_at,
      (SELECT count(*)::int FROM messages unread WHERE unread.conversation_id = c.id
        AND unread.sender_id <> $1 AND unread.created_at > mine.last_read_at) AS unread_count
    FROM conversation_members mine JOIN conversations c ON c.id = mine.conversation_id
    JOIN users other ON other.id = CASE WHEN c.user_one = $1 THEN c.user_two ELSE c.user_one END
    LEFT JOIN LATERAL (SELECT body, created_at FROM messages m WHERE m.conversation_id = c.id
      ORDER BY m.created_at DESC, m.id DESC LIMIT 1) latest ON true
    WHERE mine.user_id = $1 ORDER BY latest.created_at DESC NULLS LAST, c.created_at DESC`, [req.userId])
  res.json(rows)
})

app.post('/api/messages/conversations', auth, async (req, res) => {
  let otherUserId
  try { otherUserId = validateRecipientId(req.body?.userId, req.userId) } catch (err) {
    return res.status(400).json({ error: err.message, field: err.field })
  }
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const target = await client.query('SELECT id FROM users WHERE id = $1', [otherUserId])
    if (!target.rows[0]) {
      await client.query('ROLLBACK')
      return res.status(404).json({ error: 'User not found' })
    }
    const userOne = Math.min(Number(req.userId), Number(otherUserId))
    const userTwo = Math.max(Number(req.userId), Number(otherUserId))
    const conversation = await client.query(`INSERT INTO conversations (user_one, user_two) VALUES ($1, $2)
      ON CONFLICT (user_one, user_two) DO UPDATE SET user_one = EXCLUDED.user_one RETURNING id`, [userOne, userTwo])
    await client.query(`INSERT INTO conversation_members (conversation_id, user_id)
      VALUES ($1, $2), ($1, $3) ON CONFLICT (conversation_id, user_id) DO NOTHING`,
    [conversation.rows[0].id, userOne, userTwo])
    await client.query('COMMIT')
    res.status(201).json({ id: conversation.rows[0].id, other_user_id: otherUserId })
  } catch (err) {
    await client.query('ROLLBACK')
    throw err
  } finally { client.release() }
})

app.get('/api/messages/conversations/:id/messages', auth, async (req, res) => {
  if (!isPgBigId(req.params.id)) return res.status(404).json({ error: 'Conversation not found' })
  const page = Math.max(1, Math.min(10000, Number.parseInt(req.query.page, 10) || 1))
  const limit = Math.max(1, Math.min(100, Number.parseInt(req.query.limit, 10) || 50))
  const member = await pool.query(`UPDATE conversation_members SET last_read_at = now()
    WHERE conversation_id = $1 AND user_id = $2 RETURNING conversation_id`, [req.params.id, req.userId])
  if (!member.rowCount) return res.status(404).json({ error: 'Conversation not found' })
  await pool.query(`UPDATE notifications SET read_at = now() WHERE user_id = $1 AND kind = 'message'
    AND entity_id = $2 AND read_at IS NULL`, [req.userId, req.params.id])
  const [{ rows }, countResult] = await Promise.all([
    pool.query(`SELECT recent.id, recent.conversation_id, recent.sender_id, recent.body, recent.created_at,
        u.name AS sender_name FROM (
          SELECT id, conversation_id, sender_id, body, created_at FROM messages
          WHERE conversation_id = $1 ORDER BY created_at DESC, id DESC LIMIT $2 OFFSET $3
        ) recent JOIN users u ON u.id = recent.sender_id ORDER BY recent.created_at ASC, recent.id ASC`,
    [req.params.id, limit, (page - 1) * limit]),
    pool.query('SELECT count(*)::int AS total FROM messages WHERE conversation_id = $1', [req.params.id]),
  ])
  res.json({ items: rows, page, limit, total: countResult.rows[0].total, hasMore: page * limit < countResult.rows[0].total })
})

app.post('/api/messages/conversations/:id/messages', auth, async (req, res) => {
  if (!isPgBigId(req.params.id)) return res.status(404).json({ error: 'Conversation not found' })
  let body
  try { body = validateMessageBody(req.body?.body) } catch (err) {
    return res.status(400).json({ error: err.message, field: err.field })
  }
  const { rows } = await pool.query(`WITH inserted AS (
      INSERT INTO messages (conversation_id, sender_id, body)
      SELECT cm.conversation_id, cm.user_id, $3 FROM conversation_members cm
      WHERE cm.conversation_id = $1 AND cm.user_id = $2
        AND EXISTS (SELECT 1 FROM conversation_members recipient WHERE recipient.conversation_id = cm.conversation_id AND recipient.user_id <> $2)
      RETURNING id, conversation_id, sender_id, body, created_at
    ), notified AS (
      INSERT INTO notifications (user_id, actor_id, kind, entity_type, entity_id, text)
      SELECT recipient.user_id, inserted.sender_id, 'message', 'conversation', inserted.conversation_id,
        actor.name || ' sent you a message'
      FROM inserted JOIN users actor ON actor.id = inserted.sender_id
      JOIN conversation_members recipient ON recipient.conversation_id = inserted.conversation_id
        AND recipient.user_id <> inserted.sender_id RETURNING id
    ) SELECT inserted.*, u.name AS sender_name FROM inserted JOIN users u ON u.id = inserted.sender_id`,
  [req.params.id, req.userId, body])
  if (!rows[0]) return res.status(404).json({ error: 'Conversation not found' })
  res.status(201).json(rows[0])
})

app.get('/api/notifications/unread-count', auth, async (req, res) => {
  const { rows } = await pool.query(`SELECT
    (SELECT count(*)::int FROM notifications WHERE user_id = $1 AND read_at IS NULL) AS notifications,
    (SELECT count(*)::int FROM messages m JOIN conversation_members cm ON cm.conversation_id = m.conversation_id AND cm.user_id = $1
      WHERE m.sender_id <> $1 AND m.created_at > cm.last_read_at) AS messages`, [req.userId])
  res.json(rows[0])
})

app.get('/api/notifications', auth, async (req, res) => {
  const page = Math.max(1, Math.min(10000, Number.parseInt(req.query.page, 10) || 1))
  const limit = Math.max(1, Math.min(100, Number.parseInt(req.query.limit, 10) || 30))
  const [{ rows }, countResult] = await Promise.all([
    pool.query(`SELECT n.id, n.kind, n.entity_type, n.entity_id, n.text, n.created_at, n.read_at,
        actor.id AS actor_id, actor.name AS actor_name
      FROM notifications n LEFT JOIN users actor ON actor.id = n.actor_id
      WHERE n.user_id = $1 ORDER BY n.created_at DESC, n.id DESC LIMIT $2 OFFSET $3`,
    [req.userId, limit, (page - 1) * limit]),
    pool.query('SELECT count(*)::int AS total FROM notifications WHERE user_id = $1', [req.userId]),
  ])
  res.json({ items: rows, page, limit, total: countResult.rows[0].total, hasMore: page * limit < countResult.rows[0].total })
})

app.put('/api/notifications/:id/read', auth, async (req, res) => {
  if (!isSafeId(req.params.id)) return res.status(404).json({ error: 'Notification not found' })
  const { rows } = await pool.query(`UPDATE notifications SET read_at = COALESCE(read_at, now())
    WHERE id = $1 AND user_id = $2 RETURNING id, read_at`, [req.params.id, req.userId])
  if (!rows[0]) return res.status(404).json({ error: 'Notification not found' })
  res.json(rows[0])
})

app.put('/api/notifications/read-all', auth, async (req, res) => {
  const { rowCount } = await pool.query('UPDATE notifications SET read_at = now() WHERE user_id = $1 AND read_at IS NULL', [req.userId])
  res.json({ updated: rowCount })
})

app.get('/api/posts', auth, async (req, res) => {
  const page = Math.max(1, Math.min(50000, Number.parseInt(req.query.page, 10) || 1))
  const limit = 20
  const offset = (page - 1) * limit
  const { rows } = await pool.query(`
    SELECT * FROM (
      SELECT 'post'::text AS type, p.id::text AS id, p.body, p.image_id::text AS image_id,
        p.created_at, p.updated_at, p.user_id, u.name AS author_name, u.role AS author_role,
        CASE WHEN u.profile_image_id IS NULL THEN NULL ELSE '/api/images/' || u.profile_image_id::text END AS author_avatar_url,
        (SELECT count(*)::int FROM likes l WHERE l.post_id = p.id) AS like_count,
        EXISTS (SELECT 1 FROM likes l WHERE l.post_id = p.id AND l.user_id = $3) AS liked_by_me,
        (SELECT count(*)::int FROM comments c WHERE c.post_id = p.id) AS comment_count,
        NULL::text AS title, NULL::text AS abstract, NULL::jsonb AS authors,
        NULL::text AS domain, NULL::text[] AS tags, NULL::text AS doi
      FROM posts p JOIN users u ON u.id = p.user_id
      UNION ALL
      SELECT 'paper'::text AS type, rp.id::text AS id, NULL::text AS body, NULL::text AS image_id,
        COALESCE(rp.reviewed_at, rp.created_at) AS created_at, rp.updated_at, rp.user_id, u.name AS author_name, u.role AS author_role,
        CASE WHEN u.profile_image_id IS NULL THEN NULL ELSE '/api/images/' || u.profile_image_id::text END AS author_avatar_url,
        0::int AS like_count, false AS liked_by_me, 0::int AS comment_count,
        rp.title, rp.abstract, rp.authors, rp.domain, rp.tags, rp.doi
      FROM papers rp JOIN users u ON u.id = rp.user_id
      WHERE rp.status = 'approved'
    ) feed ORDER BY created_at DESC, type ASC, id::bigint DESC LIMIT $1 OFFSET $2`,
  [limit + 1, offset, req.userId])
  const hasMore = rows.length > limit
  res.json({ items: rows.slice(0, limit), page, hasMore })
})

app.get('/api/posts/search', auth, async (req, res) => {
  const q = String(req.query.q ?? '').trim().slice(0, 200)
  if (!q) return res.json([])
  const pattern = `%${q.replace(/[\\%_]/g, '\\$&')}%`
  const { rows } = await pool.query(
    `SELECT p.id, p.body, p.image_id, p.created_at, p.updated_at, p.user_id,
      u.name AS author_name, u.role AS author_role,
      CASE WHEN u.profile_image_id IS NULL THEN NULL ELSE '/api/images/' || u.profile_image_id::text END AS author_avatar_url,
      (SELECT count(*)::int FROM likes l WHERE l.post_id = p.id) AS like_count,
      EXISTS (SELECT 1 FROM likes l WHERE l.post_id = p.id AND l.user_id = $2) AS liked_by_me,
      (SELECT count(*)::int FROM comments c WHERE c.post_id = p.id) AS comment_count
     FROM posts p JOIN users u ON u.id = p.user_id
     WHERE p.body ILIKE $1 OR u.name ILIKE $1
     ORDER BY p.created_at DESC, p.id DESC LIMIT 50`,
    [pattern, req.userId]
  )
  res.json(rows)
})

app.get('/api/papers/search', auth, async (req, res) => {
  const query = buildPaperDiscovery(req.query)
  const [{ rows: items }, { rows: counts }] = await Promise.all([
    pool.query(query.searchSql, query.values),
    pool.query(query.countSql, query.countValues),
  ])
  const total = counts[0].total
  res.json({ items, page: query.page, limit: query.limit, total, hasMore: query.page * query.limit < total })
})

app.get('/api/papers/categories', auth, async (_req, res) => {
  const { rows } = await pool.query(
    `SELECT DISTINCT domain FROM papers WHERE status = 'approved' ORDER BY lower(domain), domain`
  )
  res.json(rows.map(({ domain }) => domain))
})

app.get('/api/papers/:id', auth, async (req, res) => {
  if (!isSafeId(req.params.id)) return res.status(404).json({ error: 'Paper not found' })
  const { rows } = await pool.query(
    `SELECT p.id, p.title, p.abstract, p.doi, p.domain, p.tags, p.authors,
      p.reviewed_at, p.created_at, u.name AS submitter_name
     FROM papers p JOIN users u ON u.id = p.user_id
     WHERE p.id = $1 AND p.status = 'approved'`,
    [req.params.id]
  )
  if (!rows[0]) return res.status(404).json({ error: 'Paper not found' })
  res.json(rows[0])
})

// Multipart: "body" text plus an optional "image" file
app.post('/api/posts', auth, upload.single('image'), async (req, res) => {
  const body = String(req.body?.body ?? '').trim()
  const mime = req.file && sniffImage(req.file.buffer)
  if (req.file && !mime) return res.status(400).json({ error: 'Image must be a JPEG, PNG, GIF or WebP file' })
  if (!body && !req.file) return res.status(400).json({ error: 'Write something or add an image' })
  if (body.length > 5000) return res.status(400).json({ error: 'Post must be under 5000 characters' })

  // One statement, so the image and post are saved together or not at all
  const { rows } = await pool.query(
    `WITH img AS (INSERT INTO images (user_id, mime, data) SELECT $1, $3, $4 WHERE $4::bytea IS NOT NULL RETURNING id)
     INSERT INTO posts (user_id, body, image_id) VALUES ($1, $2, (SELECT id FROM img)) RETURNING id`,
    [req.userId, body, mime ?? null, req.file?.buffer ?? null]
  )
  const created = await pool.query(`${POST_SELECT} WHERE p.id = $1`, [rows[0].id, req.userId])
  res.status(201).json(created.rows[0])
})

app.patch('/api/posts/:id', auth, async (req, res) => {
  if (!isPgId(req.params.id)) return res.status(404).json({ error: 'Post not found' })
  if (typeof req.body?.body !== 'string') return res.status(400).json({ error: 'Post text is required', field: 'body' })
  const body = req.body.body.trim()
  if (body.length > 5000) return res.status(400).json({ error: 'Post must be under 5000 characters', field: 'body' })
  const existing = await pool.query('SELECT image_id FROM posts WHERE id = $1 AND user_id = $2', [req.params.id, req.userId])
  if (!existing.rows[0]) return res.status(404).json({ error: 'Post not found' })
  if (!body && !existing.rows[0].image_id) return res.status(400).json({ error: 'Write something or add an image', field: 'body' })
  const updated = await pool.query(
    `UPDATE posts SET body = $3, updated_at = now() WHERE id = $1 AND user_id = $2 RETURNING id`,
    [req.params.id, req.userId, body]
  )
  const result = await pool.query(`${POST_SELECT} WHERE p.id = $1`, [updated.rows[0].id, req.userId])
  res.json(result.rows[0])
})

app.put('/api/posts/:id/like', auth, async (req, res) => {
  if (!isPgId(req.params.id)) return res.status(404).json({ error: 'Post not found' })
  if (typeof req.body?.liked !== 'boolean') return res.status(400).json({ error: 'liked must be true or false' })
  const post = await pool.query('SELECT 1 FROM posts WHERE id = $1', [req.params.id])
  if (!post.rows[0]) return res.status(404).json({ error: 'Post not found' })
  if (req.body.liked) {
    await pool.query(`WITH inserted AS (
        INSERT INTO likes (post_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING RETURNING post_id, user_id
      ), notified AS (
        INSERT INTO notifications (user_id, actor_id, kind, entity_type, entity_id, text)
        SELECT p.user_id, inserted.user_id, 'like', 'post', p.id, actor.name || ' liked your post'
        FROM inserted JOIN posts p ON p.id = inserted.post_id JOIN users actor ON actor.id = inserted.user_id
        WHERE p.user_id <> inserted.user_id RETURNING id
      ) SELECT post_id FROM inserted`, [req.params.id, req.userId])
  } else {
    await pool.query('DELETE FROM likes WHERE post_id = $1 AND user_id = $2', [req.params.id, req.userId])
  }
  const { rows } = await pool.query(
    `SELECT count(*)::int AS like_count, EXISTS (
       SELECT 1 FROM likes WHERE post_id = $1 AND user_id = $2
     ) AS liked_by_me FROM likes WHERE post_id = $1`,
    [req.params.id, req.userId]
  )
  res.json(rows[0])
})

app.get('/api/posts/:id/comments', auth, async (req, res) => {
  if (!isPgId(req.params.id)) return res.status(404).json({ error: 'Post not found' })
  const { rows } = await pool.query(
    `SELECT * FROM (
       SELECT c.id, c.post_id, c.user_id, c.body, c.created_at, c.updated_at,
         u.name AS author_name, u.role AS author_role,
         CASE WHEN u.profile_image_id IS NULL THEN NULL ELSE '/api/images/' || u.profile_image_id::text END AS author_avatar_url
       FROM comments c JOIN users u ON u.id = c.user_id
       WHERE c.post_id = $1 ORDER BY c.created_at DESC, c.id DESC LIMIT 50
     ) recent_comments ORDER BY created_at, id`,
    [req.params.id]
  )
  res.json(rows)
})

app.post('/api/posts/:id/comments', auth, async (req, res) => {
  if (!isPgId(req.params.id)) return res.status(404).json({ error: 'Post not found' })
  const body = typeof req.body?.body === 'string' ? req.body.body.trim() : ''
  if (!body || body.length > 2000) return res.status(400).json({ error: 'Comment must be 1-2,000 characters', field: 'body' })
  const { rows } = await pool.query(`WITH inserted AS (
      INSERT INTO comments (post_id, user_id, body)
      SELECT $1, $2, $3 WHERE EXISTS (SELECT 1 FROM posts WHERE id = $1)
      RETURNING id, post_id, user_id
    ), notified AS (
      INSERT INTO notifications (user_id, actor_id, kind, entity_type, entity_id, text)
      SELECT p.user_id, inserted.user_id, 'comment', 'post', p.id, actor.name || ' commented on your post'
      FROM inserted JOIN posts p ON p.id = inserted.post_id JOIN users actor ON actor.id = inserted.user_id
      WHERE p.user_id <> inserted.user_id RETURNING id
    ) SELECT id FROM inserted`, [req.params.id, req.userId, body])
  if (!rows[0]) return res.status(404).json({ error: 'Post not found' })
  const comment = await pool.query(
    `SELECT c.id, c.post_id, c.user_id, c.body, c.created_at, c.updated_at,
      u.name AS author_name, u.role AS author_role,
      CASE WHEN u.profile_image_id IS NULL THEN NULL ELSE '/api/images/' || u.profile_image_id::text END AS author_avatar_url
     FROM comments c JOIN users u ON u.id = c.user_id WHERE c.id = $1`,
    [rows[0].id]
  )
  res.status(201).json(comment.rows[0])
})

app.delete('/api/comments/:id', auth, async (req, res) => {
  if (!isSafeId(req.params.id)) return res.status(404).json({ error: 'Comment not found' })
  const { rowCount } = await pool.query('DELETE FROM comments WHERE id = $1 AND user_id = $2', [req.params.id, req.userId])
  if (!rowCount) return res.status(404).json({ error: 'Comment not found' })
  res.status(204).end()
})

app.post('/api/posts/:id/report', auth, async (req, res) => {
  if (!isPgId(req.params.id)) return res.status(404).json({ error: 'Post not found' })
  const reason = typeof req.body?.reason === 'string' ? req.body.reason.trim() : ''
  if (reason.length < 5 || reason.length > 1000) return res.status(400).json({ error: 'Report reason must be 5-1,000 characters', field: 'reason' })
  const post = await pool.query('SELECT user_id FROM posts WHERE id = $1', [req.params.id])
  if (!post.rows[0]) return res.status(404).json({ error: 'Post not found' })
  if (String(post.rows[0].user_id) === String(req.userId)) return res.status(403).json({ error: 'You cannot report your own post' })
  const { rows } = await pool.query(
    `INSERT INTO reports (post_id, reported_by, reason)
     SELECT p.id, $2, $3 FROM posts p WHERE p.id = $1
     ON CONFLICT (post_id, reported_by) DO NOTHING RETURNING id`,
    [req.params.id, req.userId, reason]
  )
  if (!rows[0]) {
    const existing = await pool.query('SELECT 1 FROM posts WHERE id = $1', [req.params.id])
    if (!existing.rows[0]) return res.status(404).json({ error: 'Post not found' })
    return res.status(409).json({ error: 'You have already reported this post' })
  }
  res.status(201).json({ id: rows[0].id, status: 'pending' })
})

app.post('/api/papers/submit', auth, requireAuthor, paperUpload.single('pdf'), async (req, res) => {
  const idempotencyKey = req.get('Idempotency-Key') || null
  if (idempotencyKey && !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(idempotencyKey)) {
    return res.status(400).json({ error: 'Invalid Idempotency-Key' })
  }

  let paper
  try {
    paper = validatePaperSubmission(req.body ?? {}, req.file, MAX_PDF_BYTES)
  } catch (err) {
    if (err.field) return res.status(400).json({ error: err.message, field: err.field })
    throw err
  }

  const inserted = await pool.query(
    `INSERT INTO papers
       (user_id, title, abstract, doi, domain, tags, authors, pdf_data, pdf_filename,
        pdf_content_type, pdf_size, additional_notes, idempotency_key)
     VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8, $9, 'application/pdf', $10, $11, $12)
     ON CONFLICT (user_id, idempotency_key) DO NOTHING
     RETURNING id, title, status, created_at`,
    [
      req.userId,
      paper.title,
      paper.abstract,
      paper.doi,
      paper.domain,
      paper.tags,
      JSON.stringify(paper.authors),
      paper.pdfData,
      paper.filename,
      paper.pdfSize,
      paper.additionalNotes,
      idempotencyKey,
    ]
  )

  let result = inserted.rows[0]
  let statusCode = 201
  if (!result && idempotencyKey) {
    const existing = await pool.query(
      'SELECT id, title, status, created_at FROM papers WHERE user_id = $1 AND idempotency_key = $2',
      [req.userId, idempotencyKey]
    )
    result = existing.rows[0]
    statusCode = 200
  }
  if (!result) throw new Error('Paper submission could not be confirmed')

  res.status(statusCode).json({ id: result.id, title: result.title, status: result.status, submittedAt: result.created_at })
})

app.get('/api/papers/my-submissions', auth, async (req, res) => {
  const { rows } = await pool.query(`
    SELECT id, title, abstract, doi, domain, tags, authors, pdf_filename, pdf_size,
      status, rejection_reason, reviewed_at, created_at
    FROM papers WHERE user_id = $1 ORDER BY created_at DESC`, [req.userId])
  res.json(rows)
})

app.get('/api/moderation/papers', auth, requireModerator, async (req, res) => {
  const status = String(req.query.status ?? 'pending')
  if (!['pending', 'approved', 'rejected', 'reviewed'].includes(status)) {
    return res.status(400).json({ error: 'Status must be pending, approved, rejected, or reviewed' })
  }
  const page = Math.max(1, Math.min(10000, Number.parseInt(req.query.page, 10) || 1))
  const limit = Math.max(1, Math.min(50, Number.parseInt(req.query.limit, 10) || 20))
  const where = status === 'reviewed' ? "p.status IN ('approved', 'rejected')" : 'p.status = $1'
  const params = status === 'reviewed' ? [limit, (page - 1) * limit] : [status, limit, (page - 1) * limit]
  const limitParam = status === 'reviewed' ? '$1' : '$2'
  const offsetParam = status === 'reviewed' ? '$2' : '$3'
  const countParams = status === 'reviewed' ? [] : [status]
  const countWhere = status === 'reviewed' ? "status IN ('approved', 'rejected')" : 'status = $1'
  const [{ rows }, countResult] = await Promise.all([
    pool.query(`SELECT p.id, p.title, p.abstract, p.doi, p.domain, p.tags, p.authors, p.status,
      p.created_at, p.reviewed_at, p.rejection_reason, submitter.name AS submitter_name,
      submitter.email AS submitter_email, reviewer.name AS reviewer_name
      FROM papers p JOIN users submitter ON submitter.id = p.user_id
      LEFT JOIN users reviewer ON reviewer.id = p.reviewed_by
      WHERE ${where} ORDER BY COALESCE(p.reviewed_at, p.created_at) DESC
      LIMIT ${limitParam} OFFSET ${offsetParam}`, params),
    pool.query(`SELECT count(*)::int AS total FROM papers WHERE ${countWhere}`, countParams),
  ])
  res.json({ papers: rows, page, limit, total: countResult.rows[0].total })
})

app.get('/api/moderation/summary', auth, requireModerator, async (req, res) => {
  const { rows } = await pool.query(`
    SELECT
      (SELECT count(*)::int FROM users) AS users,
      (SELECT count(*)::int FROM papers WHERE status = 'pending') AS pending_papers,
      (SELECT count(*)::int FROM papers WHERE status IN ('approved', 'rejected')) AS reviewed_papers,
      (SELECT count(*)::int FROM reports WHERE status = 'pending') AS pending_reports,
      (SELECT count(*)::int FROM reports) AS total_reports`)
  const summary = rows[0]
  if (req.userRole !== 'admin') delete summary.users
  res.json(summary)
})

app.get('/api/moderation/reports', auth, requireModerator, async (req, res) => {
  const status = String(req.query.status ?? 'pending')
  if (!['pending', 'reviewed', 'dismissed'].includes(status)) {
    return res.status(400).json({ error: 'Status must be pending, reviewed, or dismissed' })
  }
  const page = Math.max(1, Math.min(10000, Number.parseInt(req.query.page, 10) || 1))
  const limit = Math.max(1, Math.min(50, Number.parseInt(req.query.limit, 10) || 20))
  const [{ rows }, countResult] = await Promise.all([
    pool.query(`SELECT r.id, r.post_id, r.reported_by, r.reason, r.status, r.created_at,
        reporter.name AS reporter_name, post.user_id AS post_author_id,
        author.name AS post_author_name, post.body AS post_body, post.image_id
      FROM reports r JOIN posts post ON post.id = r.post_id
      JOIN users reporter ON reporter.id = r.reported_by
      JOIN users author ON author.id = post.user_id
      WHERE r.status = $1 ORDER BY r.created_at DESC, r.id DESC LIMIT $2 OFFSET $3`,
    [status, limit, (page - 1) * limit]),
    pool.query('SELECT count(*)::int AS total FROM reports WHERE status = $1', [status]),
  ])
  res.json({ reports: rows, page, limit, total: countResult.rows[0].total })
})

app.patch('/api/moderation/reports/:id/:decision', auth, requireModerator, async (req, res) => {
  if (!isSafeId(req.params.id)) return res.status(404).json({ error: 'Report not found' })
  const decision = req.params.decision
  if (!['reviewed', 'dismissed'].includes(decision)) return res.status(400).json({ error: 'Decision must be reviewed or dismissed' })
  const { rows } = await pool.query(`
    WITH changed AS (
      UPDATE reports SET status = $2
      WHERE id = $1 AND status = 'pending'
      RETURNING id, status, post_id
    ), logged AS (
      INSERT INTO audit_logs (actor_id, action, target_type, target_id, details)
      SELECT $3, 'report.' || $2, 'report', id::text, jsonb_build_object('postId', post_id)
      FROM changed RETURNING id
    )
    SELECT changed.id, changed.status FROM changed`, [req.params.id, decision, req.userId])
  if (!rows[0]) {
    const exists = await pool.query('SELECT status FROM reports WHERE id = $1', [req.params.id])
    return res.status(exists.rowCount ? 409 : 404).json({ error: exists.rowCount ? 'Report has already been reviewed' : 'Report not found' })
  }
  res.json(rows[0])
})

app.get('/api/admin/audit-logs', auth, requireAdmin, async (req, res) => {
  const page = Math.max(1, Math.min(10000, Number.parseInt(req.query.page, 10) || 1))
  const limit = Math.max(1, Math.min(100, Number.parseInt(req.query.limit, 10) || 50))
  const [{ rows }, countResult] = await Promise.all([
    pool.query(`SELECT a.id, a.action, a.target_type, a.target_id, a.details, a.created_at,
        u.name AS actor_name, u.role AS actor_role
      FROM audit_logs a LEFT JOIN users u ON u.id = a.actor_id
      ORDER BY a.created_at DESC, a.id DESC LIMIT $1 OFFSET $2`, [limit, (page - 1) * limit]),
    pool.query('SELECT count(*)::int AS total FROM audit_logs'),
  ])
  res.json({ items: rows, page, limit, total: countResult.rows[0].total })
})

app.get('/api/moderation/papers/:id', auth, requireModerator, async (req, res) => {
  if (!/^\d+$/.test(req.params.id)) return res.status(404).json({ error: 'Paper not found' })
  const { rows } = await pool.query(`
    SELECT p.id, p.title, p.abstract, p.doi, p.domain, p.tags, p.authors, p.pdf_filename,
      p.pdf_size, p.additional_notes, p.status, p.rejection_reason, p.created_at, p.reviewed_at,
      submitter.name AS submitter_name, submitter.email AS submitter_email,
      reviewer.name AS reviewer_name,
      COALESCE((SELECT jsonb_agg(jsonb_build_object('id', pr.id, 'decision', pr.decision,
        'comment', pr.comment, 'created_at', pr.created_at, 'reviewer_name', review_user.name)
        ORDER BY pr.created_at DESC, pr.id DESC)
        FROM paper_reviews pr LEFT JOIN users review_user ON review_user.id = pr.reviewer_id
        WHERE pr.paper_id = p.id), '[]'::jsonb) AS review_history
    FROM papers p JOIN users submitter ON submitter.id = p.user_id
    LEFT JOIN users reviewer ON reviewer.id = p.reviewed_by WHERE p.id = $1`, [req.params.id])
  if (!rows[0]) return res.status(404).json({ error: 'Paper not found' })
  res.json(rows[0])
})

app.patch('/api/moderation/papers/:id/approve', auth, requireModerator, async (req, res) => {
  if (!/^\d+$/.test(req.params.id)) return res.status(404).json({ error: 'Paper not found' })
  const comment = typeof req.body?.comment === 'string' ? req.body.comment.trim() : ''
  if (comment.length > 2000) return res.status(400).json({ error: 'Review comment must be at most 2,000 characters', field: 'comment' })
  const { rows } = await pool.query(`
    WITH changed AS (
      UPDATE papers SET status = 'approved', reviewed_by = $2, reviewed_at = now(), rejection_reason = NULL, updated_at = now()
      WHERE id = $1 AND status = 'pending' RETURNING id, title, user_id, status, reviewed_by, reviewed_at
    ), review AS (
      INSERT INTO paper_reviews (paper_id, reviewer_id, decision, comment)
      SELECT id, $2, 'approved', $3 FROM changed RETURNING paper_id
    ), logged AS (
      INSERT INTO audit_logs (actor_id, action, target_type, target_id, details)
      SELECT $2, 'paper.approved', 'paper', id::text, jsonb_build_object('comment', $3) FROM changed RETURNING id
    ), notified AS (
      INSERT INTO notifications (user_id, actor_id, kind, entity_type, entity_id, text)
      SELECT user_id, $2, 'paper_review', 'paper', id, 'Your paper "' || title || '" was approved'
      FROM changed WHERE user_id <> $2 RETURNING id
    ) SELECT id, status, reviewed_by, reviewed_at FROM changed`, [req.params.id, req.userId, comment])
  if (!rows[0]) {
    const exists = await pool.query('SELECT 1 FROM papers WHERE id = $1', [req.params.id])
    return res.status(exists.rowCount ? 409 : 404).json({ error: exists.rowCount ? 'Paper has already been reviewed' : 'Paper not found' })
  }
  res.json(rows[0])
})

app.patch('/api/moderation/papers/:id/reject', auth, requireModerator, async (req, res) => {
  if (!/^\d+$/.test(req.params.id)) return res.status(404).json({ error: 'Paper not found' })
  const reason = typeof req.body?.reason === 'string' ? req.body.reason.trim() : ''
  if (reason.length < 5 || reason.length > 2000) return res.status(400).json({ error: 'Rejection reason must be 5 to 2,000 characters', field: 'reason' })
  const { rows } = await pool.query(`
    WITH changed AS (
      UPDATE papers SET status = 'rejected', reviewed_by = $2, reviewed_at = now(), rejection_reason = $3, updated_at = now()
      WHERE id = $1 AND status = 'pending' RETURNING id, title, user_id, status, reviewed_by, reviewed_at, rejection_reason
    ), review AS (
      INSERT INTO paper_reviews (paper_id, reviewer_id, decision, comment)
      SELECT id, $2, 'rejected', $3 FROM changed RETURNING paper_id
    ), logged AS (
      INSERT INTO audit_logs (actor_id, action, target_type, target_id, details)
      SELECT $2, 'paper.rejected', 'paper', id::text, jsonb_build_object('reason', $3) FROM changed RETURNING id
    ), notified AS (
      INSERT INTO notifications (user_id, actor_id, kind, entity_type, entity_id, text)
      SELECT user_id, $2, 'paper_review', 'paper', id, 'Your paper "' || title || '" was rejected'
      FROM changed WHERE user_id <> $2 RETURNING id
    ) SELECT id, status, reviewed_by, reviewed_at, rejection_reason FROM changed`, [req.params.id, req.userId, reason])
  if (!rows[0]) {
    const exists = await pool.query('SELECT 1 FROM papers WHERE id = $1', [req.params.id])
    return res.status(exists.rowCount ? 409 : 404).json({ error: exists.rowCount ? 'Paper has already been reviewed' : 'Paper not found' })
  }
  res.json(rows[0])
})

app.get('/api/papers/:id/pdf', auth, async (req, res) => {
  if (!/^\d+$/.test(req.params.id)) return res.status(404).json({ error: 'Paper not found' })
  const { rows } = await pool.query(
    'SELECT id, user_id, status, pdf_data, pdf_filename FROM papers WHERE id = $1',
    [req.params.id]
  )
  const paper = rows[0]
  if (!paper) return res.status(404).json({ error: 'Paper not found' })

  if (String(paper.user_id) !== String(req.userId) && paper.status !== 'approved') {
    const { rows: userRows } = await pool.query('SELECT role FROM users WHERE id = $1', [req.userId])
    if (!['admin', 'moderator'].includes(userRows[0]?.role)) {
      return res.status(404).json({ error: 'Paper not found' })
    }
  }

  const filename = paper.pdf_filename.replace(/[\r\n"\\]/g, '_')
  const asciiFilename = filename.replace(/[^\x20-\x7E]/g, '_')
  const encodedFilename = encodeURIComponent(filename).replace(/[!'()*]/g, (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`)
  res.set({
    'Content-Type': 'application/pdf',
    'Content-Length': String(paper.pdf_data.length),
    'Content-Disposition': `inline; filename="${asciiFilename}"; filename*=UTF-8''${encodedFilename}`,
    'Cache-Control': 'private, no-store',
    'X-Content-Type-Options': 'nosniff',
  })
  res.send(paper.pdf_data)
})

app.delete('/api/posts/:id', auth, async (req, res) => {
  const id = Number(req.params.id)
  if (!Number.isSafeInteger(id) || id <= 0 || id > 2147483647) return res.status(404).json({ error: 'Post not found' })
  const { rows } = await pool.query(
    `WITH d AS (DELETE FROM posts WHERE id = $1 AND user_id = $2 RETURNING image_id),
     di AS (DELETE FROM images WHERE id IN (SELECT image_id FROM d))
     SELECT count(*)::int AS n FROM d`,
    [id, req.userId]
  )
  if (!rows[0].n) return res.status(404).json({ error: 'Post not found' })
  res.status(204).end()
})

// Public by unguessable UUID so <img> tags work without auth headers
app.get('/api/images/:id', async (req, res) => {
  if (!/^[0-9a-f-]{36}$/i.test(req.params.id)) return res.status(404).end()
  const { rows } = await pool.query('SELECT mime, data FROM images WHERE id = $1', [req.params.id])
  if (!rows[0]) return res.status(404).end()
  res.set({ 'Content-Type': rows[0].mime, 'Cache-Control': 'public, max-age=31536000, immutable', 'X-Content-Type-Options': 'nosniff' })
  res.send(rows[0].data)
})

app.get('/api/health', async (_req, res) => {
  try {
    await pool.query('SELECT 1')
    res.json({ status: 'ok' })
  } catch {
    res.status(503).json({ status: 'unavailable' })
  }
})

// Express only treats 4-arg middleware as an error handler
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, _next) => {
  if (err instanceof multer.MulterError) {
    const error = err.code === 'LIMIT_FILE_SIZE'
      ? (err.field === 'pdf' ? `PDF must be ${Math.floor(MAX_PDF_BYTES / 1024 / 1024)} MB or smaller` : 'Image must be 5 MB or smaller')
      : err.message
    return res.status(400).json({ error, ...(err.field === 'pdf' ? { field: 'pdf' } : {}) })
  }
  log('error', 'request_failed', {
    method: req.method,
    path: req.path,
    status: err.status || 500,
    code: err.code ?? 'unknown',
  })
  res.status(err.status || 500).json({ error: err.status ? err.message : 'Server error' })
})

const server = app.listen(PORT, () => log('info', 'api_listening', { port: PORT, poolMax: PG_POOL_MAX }))
let shuttingDown = false
const shutdown = (signal) => {
  if (shuttingDown) return
  shuttingDown = true
  log('info', 'shutdown_started', { signal })
  const timeout = setTimeout(() => {
    log('error', 'shutdown_timeout')
    server.closeAllConnections?.()
  }, 15000)
  timeout.unref()
  server.close(async (err) => {
    clearTimeout(timeout)
    try {
      await pool.end()
      log(err ? 'error' : 'info', 'shutdown_complete', err ? { code: err.code ?? 'unknown' } : {})
      if (err) process.exitCode = 1
    } catch (closeError) {
      log('error', 'database_pool_close_failed', { code: closeError.code ?? 'unknown' })
      process.exitCode = 1
    }
  })
  server.closeIdleConnections?.()
}
process.on('SIGTERM', () => shutdown('SIGTERM'))
process.on('SIGINT', () => shutdown('SIGINT'))

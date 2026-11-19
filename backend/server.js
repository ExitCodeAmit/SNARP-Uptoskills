import { appendFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { validateCitationInput } from './citations.js'
import { extractReferenceMatches } from './reference-extractor.js'
import { randomBytes, randomUUID } from 'node:crypto'
import express from 'express'
import pg from 'pg'
import bcrypt from 'bcryptjs'
import multer from 'multer'
import { sniffImage } from './image.js'
import {
  groupStories, mp4Duration, parseOverlay, sniffVideo, splitVideo,
  STORY_ACTIVE_LIMIT, STORY_BACKGROUNDS, STORY_IMAGE_MAX_BYTES, STORY_KINDS, STORY_VIDEO_MAX_BYTES, STORY_VIDEO_MAX_SECONDS,
} from './story.js'
import { DEFAULT_MAX_PDF_BYTES, isPdf, validatePaperSubmission } from './paper.js'
import { analysePdf } from './pdf-analysis.js'
import { rankRecommendations } from './recommendations.js'
import { createSessionToken, REMEMBERED_SESSION_SECONDS, TEMPORARY_SESSION_SECONDS, verifySessionToken } from './session.js'
import { runMigrations } from './migrate.js'
import { validateProfileUpdate } from './profile.js'
import { buildPaperDiscovery } from './paper-search.js'
import { buildProfile, recommendPapers, relatedTopics, similarPapers, suggestTopics, topInterests } from './recommend.js'
import { validateCommunity, validateCommunityPost } from './community.js'
import { validateMessageBody, validateRecipientId } from './messaging.js'
import { validateEvent } from './event.js'
import { rateLimit } from 'express-rate-limit'
import { describeDevice, emailProblem, nameProblem, normalizeEmail, passwordProblem } from './credentials.js'
import { anonymise, average, CRITERIA, RECOMMENDATIONS, validateResubmission, validateReview } from './peer-review.js'
import { blockProblem, can, moderationProblem, nextStatus, overrideProblem, PAPER_STATUSES, requirePermission, roleChangeProblem } from './rbac.js'
import { deleteFile, fileDetails, imagekitConfig, isFileId, listReelFiles, parseReelOptions, parseReelSettings, REEL_FOLDER, reelCaptionProblem, reelFileProblem, uploadAuth } from './reel.js'
import { assistantConfig, loadGuide, selectGuide, splitGuide, streamAnswer, systemPrompt, validateChat } from './assistant.js'
import { attachCollaborationWebSocket, createCollaborationServer, flushCollaboration } from './collaboration.js'
import { createDocumentsRouter } from './documents.js'
import { extractPdfText as extractProfilePdfText } from './pdfExtractor.js'
import { generateWithGemini } from './gemini.js'
import { buildSessionAnswerMessages, buildStandaloneQueryMessages, normalizeChatTitle, parseChatQuestion } from './chatSession.js'
import { buildPaperAnswerMessages, canAccessPaperForChat } from './paperChat.js'
import { completeChat, indexPaper, indexPendingPapers, searchExcerpts } from './paper-chat.js'
import { createMailer, createVerificationToken, hashToken, isTokenShape, passwordResetEmail, RESET_TTL_MINUTES, VERIFICATION_TTL_HOURS, verificationEmail } from './mailer.js'
import { fileHash, contentHash, extractPdfText, normalizeDoi, checkDuplicate } from './dedup.js'

const FRONTEND_DIST = process.env.FRONTEND_DIST || fileURLToPath(new URL('../frontend/dist/', import.meta.url))
const SERVE_FRONTEND = process.env.SERVE_FRONTEND !== 'false' && existsSync(join(FRONTEND_DIST, 'index.html'))

const IS_PRODUCTION = process.env.NODE_ENV === 'production'
const DATABASE_URL = process.env.DATABASE_URL?.trim() || ''
const DB_NAME = process.env.PGDATABASE || 'snarp'
const dbConfig = DATABASE_URL ? { connectionString: DATABASE_URL } : { database: DB_NAME }
const DB_AUTO_CREATE = process.env.DB_AUTO_CREATE
  ? process.env.DB_AUTO_CREATE === 'true'
  : !IS_PRODUCTION && !DATABASE_URL
const PORT = process.env.PORT || 5000
const PG_POOL_MAX = Number.parseInt(process.env.PGPOOL_MAX || '10', 10)
if (!Number.isSafeInteger(PG_POOL_MAX) || PG_POOL_MAX < 1 || PG_POOL_MAX > 100) {
  throw new Error('PGPOOL_MAX must be an integer between 1 and 100')
}
const log = (level, event, fields = {}) => console.log(JSON.stringify({
  timestamp: new Date().toISOString(), level, event, ...fields,
}))
const REQUIRE_EMAIL_VERIFICATION = process.env.REQUIRE_EMAIL_VERIFICATION !== 'false'
const APP_URL = (process.env.APP_URL || '').trim().replace(/\/$/, '')
const mailer = createMailer({ log })
const configuredMaxPdfBytes = Number(process.env.PAPER_MAX_PDF_BYTES || '')
const MAX_PDF_BYTES = Number.isSafeInteger(configuredMaxPdfBytes) && configuredMaxPdfBytes > 0
  ? Math.min(configuredMaxPdfBytes, DEFAULT_MAX_PDF_BYTES)
  : DEFAULT_MAX_PDF_BYTES

if (!process.env.JWT_SECRET && IS_PRODUCTION) {
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
const BLOCKED_MESSAGE = 'This account has been suspended. Contact the platform administrator if you think this is a mistake.'
const DUMMY_PASSWORD_HASH = await bcrypt.hash(randomBytes(32).toString('hex'), 10)
const isPgId = (value) => /^\d+$/.test(value) && Number(value) > 0 && Number(value) <= 2147483647
const isSafeId = (value) => /^\d+$/.test(value) && Number.isSafeInteger(Number(value)) && Number(value) > 0
const isPgBigId = (value) => {
  if (!/^\d+$/.test(value)) return false
  try { return BigInt(value) > 0n && BigInt(value) <= 9223372036854775807n } catch { return false }
}

async function createDatabaseIfMissing() {
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
        if (err.code !== '42P04') throw err
      }
    }
  } finally {
    if (adminConnected) await admin.end()
  }
}

async function setupDb() {
  if (DB_AUTO_CREATE) await createDatabaseIfMissing()
  const pool = new pg.Pool({ ...dbConfig, max: PG_POOL_MAX })
  pool.on('error', (err) => log('error', 'database_pool_error', { code: err.code ?? 'unknown' }))
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
  console.error('Check DATABASE_URL or PGHOST/PGPORT/PGUSER/PGPASSWORD/PGDATABASE')
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
const IMAGEKIT = imagekitConfig()
const REEL_ORIGIN = IMAGEKIT ? ` ${IMAGEKIT.origin}` : ''
const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  `img-src 'self' data: blob:${REEL_ORIGIN}`,
  "font-src 'self' data:",
  `connect-src 'self'${IMAGEKIT ? ' https://upload.imagekit.io' : ''}`,
  `media-src 'self' blob:${REEL_ORIGIN}`,
  "frame-src 'self' blob:",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'self'",
].join('; ')
app.use((req, res, next) => {
  res.set({
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'SAMEORIGIN',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'Permissions-Policy': 'camera=(), geolocation=(), microphone=()',
    'Content-Security-Policy': CONTENT_SECURITY_POLICY,
    'Cross-Origin-Opener-Policy': 'same-origin',
  })
  if (IS_PRODUCTION && req.secure) res.set('Strict-Transport-Security', 'max-age=31536000; includeSubDomains')
  next()
})
app.use(express.json({ limit: '100kb' }))

const signupLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 5,
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req, res) => {
    res.status(429).json({
      error: 'Too many signup attempts. Please try again later.',
    })
  },
})

const accountLoginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 8,
  skipSuccessfulRequests: true,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => `login:${normalizeEmail(req.body?.email)}`,
  handler: (_req, res) => res.status(429).json({
    error: 'Too many failed attempts for this account. Wait 15 minutes, then try again.',
  }),
})

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
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

const resendLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 3,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => `resend:${normalizeEmail(req.body?.email)}`,
  handler: (_req, res) => res.status(429).json({ error: 'Too many emails requested. Wait 15 minutes, then try again.' }),
})

const verifyLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: true,
  legacyHeaders: false,
  handler: (_req, res) => res.status(429).json({ error: 'Too many attempts. Please try again later.' }),
})

const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: Number.parseInt(process.env.API_RATE_LIMIT, 10) || 1500,
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req) => req.path === '/health',
  handler: (_req, res) => res.status(429).json({ error: 'Too many requests. Please slow down and try again shortly.' }),
})
app.use('/api', apiLimiter)

const writeLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: Number.parseInt(process.env.WRITE_RATE_LIMIT, 10) || 30,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => `user:${req.userId}`,
  handler: (_req, res) => res.status(429).json({ error: 'You are doing that too often. Please wait a minute and try again.' }),
})

const passwordLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 5,
  skipSuccessfulRequests: true,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => `user:${req.userId}`,
  handler: (_req, res) => res.status(429).json({ error: 'Too many password attempts. Please try again later.' }),
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
async function issue(user, remember = true, req = null) {
  if (user.blocked_at) throw Object.assign(new Error(BLOCKED_MESSAGE), { status: 403 })
  const sessionId = randomUUID()
  const expiresIn = remember ? REMEMBERED_SESSION_SECONDS : TEMPORARY_SESSION_SECONDS
  const expiresAt = new Date(Date.now() + expiresIn * 1000)
  await pool.query('DELETE FROM auth_sessions WHERE expires_at <= now() OR revoked_at < now() - interval \'30 days\'')
  await pool.query(
    'INSERT INTO auth_sessions (id, user_id, expires_at, user_agent, remember) VALUES ($1, $2, $3, $4, $5)',
    [sessionId, user.id, expiresAt, String(req?.get('user-agent') ?? '').slice(0, 400), remember]
  )
  await pool.query('UPDATE users SET last_login_at = now() WHERE id = $1', [user.id])
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
      `SELECT u.role, u.blocked_at, s.revoked_at IS NULL AND s.expires_at > now() AS valid,
         s.last_seen_at < now() - interval '5 minutes' AS stale
       FROM auth_sessions s JOIN users u ON u.id = s.user_id
       WHERE s.id = $1 AND s.user_id = $2`,
      [payload.jti, payload.sub]
    )
    if (rows[0]?.blocked_at) {
      if (rows[0].valid) await pool.query('UPDATE auth_sessions SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL', [payload.sub])
      return res.status(403).json({ error: BLOCKED_MESSAGE, code: 'account_blocked' })
    }
    if (!rows[0]?.valid) return res.status(401).json({ error: 'Please log in again' })
    if (rows[0].stale) {
      pool.query('UPDATE auth_sessions SET last_seen_at = now() WHERE id = $1', [payload.jti])
        .catch((err) => log('error', 'session_touch_failed', { message: err.message }))
    }
    req.userId = payload.sub
    req.sessionId = payload.jti
    req.userRole = rows[0].role
    return next()
  } catch (err) {
    return next(err)
  }
}

const requireAuthor = requirePermission('papers.submit', 'Author access required')
const isModerator = (req) => can(req.userRole, 'papers.moderate')
const isSuperAdmin = (req) => can(req.userRole, 'admin.access')
const isReviewer = (req) => ['author', 'moderator', 'admin'].includes(req.userRole)
const requireModerator = requirePermission('papers.moderate', 'Moderator or Super Admin access required')
const requireAdmin = requirePermission('admin.access', 'Super Admin access required')

function requireEventOrganizer(req, res, next) {
  if (!['author', 'moderator', 'admin'].includes(req.userRole)) {
    return res.status(403).json({ error: 'Author, Moderator, or Admin access required to manage events' })
  }
  next()
}

app.post('/api/auth/signup', signupLimiter, async (req, res) => {
  const name = String(req.body?.name ?? '').trim().replace(/\s+/g, ' ')
  const email = normalizeEmail(req.body?.email)
  const password = String(req.body?.password ?? '')
  const role = req.body?.role === 'author' ? 'author' : 'user'
  const problem = [['name', nameProblem(name)], ['email', emailProblem(email)], ['password', passwordProblem(password, { email, name })]]
    .find(([, message]) => message)
  if (problem) return res.status(400).json({ error: problem[1], field: problem[0] })

  const hash = await bcrypt.hash(password, 10)
  try {
    const { rows } = await pool.query(
      `INSERT INTO users (name, email, password_hash, role, email_verified_at)
       VALUES ($1, $2, $3, $4, CASE WHEN $5 THEN NULL ELSE now() END) RETURNING *`,
      [name, email, hash, role, REQUIRE_EMAIL_VERIFICATION]
    )
    if (!REQUIRE_EMAIL_VERIFICATION) return res.status(201).json(await issue(rows[0], true, req))
    const emailSent = await sendVerification(rows[0], req)
    res.status(201).json({ verification_required: true, email, email_sent: emailSent })
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'An account with this email already exists. Log in instead?', field: 'email' })
    throw err
  }
})

app.post('/api/auth/login', loginLimiter, accountLoginLimiter, async (req, res) => {
  const email = normalizeEmail(req.body?.email)
  const password = String(req.body?.password ?? '')
  const { rows } = await pool.query('SELECT * FROM users WHERE email = $1', [email])
  const passwordMatches = await bcrypt.compare(password, rows[0]?.password_hash ?? DUMMY_PASSWORD_HASH)
  if (!rows[0] || !passwordMatches) {
    return res.status(401).json({ error: 'Incorrect email or password' })
  }
  if (!rows[0].email_verified_at) {
    return res.status(403).json({
      error: 'Confirm your email address first. We sent a link to your inbox when you signed up.',
      code: 'email_unverified',
    })
  }
  if (rows[0].blocked_at) return res.status(403).json({ error: BLOCKED_MESSAGE, code: 'account_blocked' })
  const remember = req.body?.remember !== false
  res.json(await issue(rows[0], remember, req))
})

app.post('/api/admin/login', loginLimiter, accountLoginLimiter, async (req, res) => {
  const email = normalizeEmail(req.body?.email)
  const password = String(req.body?.password ?? '')
  const { rows } = await pool.query('SELECT * FROM users WHERE email = $1', [email])
  const passwordMatches = await bcrypt.compare(password, rows[0]?.password_hash ?? DUMMY_PASSWORD_HASH)
  const user = rows[0]
  if (!user || !passwordMatches || !can(user.role, 'admin.access') || !user.email_verified_at) {
    return res.status(401).json({ error: 'These details do not open the admin desk' })
  }
  if (user.blocked_at) return res.status(403).json({ error: BLOCKED_MESSAGE, code: 'account_blocked' })
  const session = await issue(user, false, req)
  await audit(pool, user.id, 'admin.login', 'user', user.id, {})
  res.json(session)
})

async function sendVerification(user, req) {
  const { token, hash } = createVerificationToken()
  await pool.query('DELETE FROM email_verifications WHERE user_id = $1 AND used_at IS NULL', [user.id])
  await pool.query(
    `INSERT INTO email_verifications (token_hash, user_id, expires_at)
     VALUES ($1, $2, now() + make_interval(hours => $3))`,
    [hash, user.id, VERIFICATION_TTL_HOURS]
  )
  const base = APP_URL || (IS_PRODUCTION ? `http://localhost:${PORT}` : `${req.protocol}://${req.get('host')}`)
  const link = `${base}/verify-email?token=${token}`
  try {
    const { delivered } = await mailer.send({ to: user.email, ...verificationEmail({ name: user.name, link }) })
    return delivered
  } catch (err) {
    log('error', 'verification_email_failed', { userId: user.id, message: err.message })
    return false
  }
}

app.post('/api/auth/verify-email', verifyLimiter, async (req, res) => {
  const token = req.body?.token
  if (!isTokenShape(token)) return res.status(400).json({ error: 'This verification link is not valid.', code: 'invalid' })
  const hash = hashToken(token)
  const { rows } = await pool.query(
    `UPDATE email_verifications SET used_at = now()
     WHERE token_hash = $1 AND used_at IS NULL AND expires_at > now() RETURNING user_id`,
    [hash]
  )
  if (!rows[0]) {
    const { rows: known } = await pool.query(
      `SELECT v.used_at, v.expires_at <= now() AS expired, u.email_verified_at, u.email
       FROM email_verifications v JOIN users u ON u.id = v.user_id WHERE v.token_hash = $1`,
      [hash]
    )
    if (known[0]?.used_at || known[0]?.email_verified_at) {
      return res.status(410).json({ error: 'This link has already been used. Your email is confirmed, so you can log in.', code: 'already_verified' })
    }
    if (known[0]?.expired) {
      return res.status(410).json({ error: 'This verification link has expired. Request a new one below.', code: 'expired', email: known[0].email })
    }
    return res.status(400).json({ error: 'This verification link is not valid. Request a new one below.', code: 'invalid' })
  }
  const { rows: users } = await pool.query(
    'UPDATE users SET email_verified_at = COALESCE(email_verified_at, now()) WHERE id = $1 RETURNING *',
    [rows[0].user_id]
  )
  await pool.query('DELETE FROM email_verifications WHERE user_id = $1 AND used_at IS NULL', [rows[0].user_id])
  res.json(await issue(users[0], true, req))
})

app.post('/api/auth/forgot-password', verifyLimiter, resendLimiter, async (req, res) => {
  const email = normalizeEmail(req.body?.email)
  if (emailProblem(email)) return res.status(400).json({ error: 'Enter a valid email address', field: 'email' })
  const { rows } = await pool.query(
    `SELECT u.* FROM users u WHERE u.email = $1
     AND NOT EXISTS (SELECT 1 FROM password_resets r WHERE r.user_id = u.id AND r.created_at > now() - interval '60 seconds')`,
    [email]
  )
  const user = rows[0]
  if (user) {
    const { token, hash } = createVerificationToken()
    await pool.query('DELETE FROM password_resets WHERE user_id = $1 AND used_at IS NULL', [user.id])
    await pool.query(
      'INSERT INTO password_resets (token_hash, user_id, expires_at) VALUES ($1, $2, now() + make_interval(mins => $3))',
      [hash, user.id, RESET_TTL_MINUTES]
    )
    const base = APP_URL || (IS_PRODUCTION ? `http://localhost:${PORT}` : `${req.protocol}://${req.get('host')}`)
    try {
      await mailer.send({ to: user.email, ...passwordResetEmail({ name: user.name, link: `${base}/reset-password?token=${token}` }) })
    } catch (err) {
      log('error', 'password_reset_email_failed', { userId: user.id, message: err.message })
    }
  }
  res.json({ message: 'If an account uses that email, a link to reset the password is on its way. It works for 60 minutes.' })
})

app.post('/api/auth/reset-password', verifyLimiter, async (req, res) => {
  const token = req.body?.token
  const password = String(req.body?.password ?? '')
  if (!isTokenShape(token)) return res.status(400).json({ error: 'This reset link is not valid. Request a new one.', code: 'invalid' })
  const client = await pool.connect()
  let open = false
  try {
    await client.query('BEGIN')
    open = true
    const stop = async (status, body) => { await client.query('ROLLBACK'); open = false; return res.status(status).json(body) }
    const { rows } = await client.query(
      `SELECT r.user_id, r.used_at, r.expires_at <= now() AS expired, u.email, u.name
       FROM password_resets r JOIN users u ON u.id = r.user_id WHERE r.token_hash = $1 FOR UPDATE OF r`,
      [hashToken(token)]
    )
    const reset = rows[0]
    if (!reset) return await stop(400, { error: 'This reset link is not valid. Request a new one.', code: 'invalid' })
    if (reset.used_at) return await stop(410, { error: 'This reset link has already been used. Request a new one if you still need it.', code: 'used' })
    if (reset.expired) return await stop(410, { error: 'This reset link has expired. Request a new one.', code: 'expired' })
    const weakness = passwordProblem(password, reset)
    if (weakness) return await stop(400, { error: weakness, field: 'password' })
    await client.query(
      'UPDATE users SET password_hash = $2, email_verified_at = COALESCE(email_verified_at, now()) WHERE id = $1',
      [reset.user_id, await bcrypt.hash(password, 10)]
    )
    await client.query('UPDATE password_resets SET used_at = now() WHERE token_hash = $1', [hashToken(token)])
    await client.query('DELETE FROM password_resets WHERE user_id = $1 AND used_at IS NULL', [reset.user_id])
    await client.query('UPDATE auth_sessions SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL', [reset.user_id])
    await client.query(
      `INSERT INTO audit_logs (actor_id, action, target_type, target_id, details)
       VALUES ($1::int, 'account.password_reset', 'user', $1::text, '{"source": "email"}'::jsonb)`,
      [reset.user_id]
    )
    await client.query('COMMIT')
    open = false
    res.json({ message: 'Password changed. Log in with your new password.', email: reset.email })
  } catch (err) {
    if (open) await client.query('ROLLBACK')
    throw err
  } finally {
    client.release()
  }
})

app.post('/api/auth/resend-verification', verifyLimiter, resendLimiter, async (req, res) => {
  const email = normalizeEmail(req.body?.email)
  if (emailProblem(email)) return res.status(400).json({ error: 'Enter a valid email address', field: 'email' })
  if (REQUIRE_EMAIL_VERIFICATION) {
    const { rows } = await pool.query(
      `SELECT u.* FROM users u WHERE u.email = $1 AND u.email_verified_at IS NULL
       AND NOT EXISTS (SELECT 1 FROM email_verifications v WHERE v.user_id = u.id AND v.created_at > now() - interval '60 seconds')`,
      [email]
    )
    if (rows[0]) await sendVerification(rows[0], req)
  }
  res.json({ message: 'If that address has an account waiting for confirmation, a new link is on its way.' })
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
      (SELECT count(*)::int FROM posts WHERE user_id = u.id) AS post_count,
      (SELECT count(*)::int FROM papers p WHERE (p.user_id = u.id OR p.authors @> jsonb_build_array(jsonb_build_object('user_id', u.id))) AND p.status = 'published') AS paper_count,
      (SELECT count(*)::int FROM follows WHERE followee_id = u.id) AS follower_count,
      (SELECT count(*)::int FROM follows WHERE follower_id = u.id) AS following_count
     FROM users u LEFT JOIN user_profiles up ON up.user_id = u.id WHERE u.id = $1`,
    [req.userId]
  )
  if (!rows[0]) return res.status(401).json({ error: 'Please log in again' })
  const { post_count, paper_count, follower_count, following_count } = rows[0]
  res.json({ ...publicUser(rows[0]), post_count, paper_count, follower_count, following_count })
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

app.put('/api/auth/me/role', auth, writeLimiter, async (req, res) => {
  const role = req.body?.role
  if (!['user', 'author'].includes(role)) return res.status(400).json({ error: 'Account type must be member or author', field: 'role' })
  const { rows } = await pool.query(
    `WITH old AS (SELECT role FROM users WHERE id = $1),
      changed AS (
        UPDATE users SET role = $2 WHERE id = $1 AND role IN ('user', 'author') AND role <> $2 RETURNING role
      ), logged AS (
        INSERT INTO audit_logs (actor_id, action, target_type, target_id, details)
        SELECT $1, 'account.role_change', 'user', $1::text, jsonb_build_object('from', (SELECT role FROM old), 'to', $2::text)
        FROM changed RETURNING id
      )
     SELECT (SELECT role FROM old) AS before, (SELECT role FROM changed) AS after`,
    [req.userId, role]
  )
  const { before, after } = rows[0]
  if (!['user', 'author'].includes(before)) {
    return res.status(403).json({ error: 'Moderator and admin roles are managed by an administrator' })
  }
  res.json({ role: after ?? before })
})

app.put('/api/auth/me/password', auth, passwordLimiter, async (req, res) => {
  const currentPassword = String(req.body?.currentPassword ?? '')
  const newPassword = String(req.body?.newPassword ?? '')
  const { rows } = await pool.query('SELECT password_hash, email, name FROM users WHERE id = $1', [req.userId])
  const weakness = passwordProblem(newPassword, rows[0])
  if (weakness) return res.status(400).json({ error: weakness, field: 'newPassword' })
  if (!rows[0] || !await bcrypt.compare(currentPassword, rows[0].password_hash)) {
    return res.status(400).json({ error: 'Current password is incorrect', field: 'currentPassword' })
  }
  if (await bcrypt.compare(newPassword, rows[0].password_hash)) {
    return res.status(400).json({ error: 'Choose a password you have not used here before', field: 'newPassword' })
  }
  const hash = await bcrypt.hash(newPassword, 10)
  await pool.query(
    `WITH updated AS (UPDATE users SET password_hash = $2 WHERE id = $1 RETURNING id)
     UPDATE auth_sessions SET revoked_at = now()
     WHERE user_id IN (SELECT id FROM updated) AND id <> $3 AND revoked_at IS NULL`,
    [req.userId, hash, req.sessionId]
  )
  res.status(204).end()
})

app.get('/api/auth/sessions', auth, async (req, res) => {
  const { rows } = await pool.query(
    `SELECT id, created_at, last_seen_at, expires_at, user_agent, remember FROM auth_sessions
     WHERE user_id = $1 AND revoked_at IS NULL AND expires_at > now()
     ORDER BY (id = $2) DESC, last_seen_at DESC LIMIT 50`,
    [req.userId, req.sessionId]
  )
  res.json(rows.map(({ user_agent, ...session }) => ({
    ...session,
    device: describeDevice(user_agent),
    current: session.id === req.sessionId,
  })))
})

app.delete('/api/auth/sessions', auth, async (req, res) => {
  const { rowCount } = await pool.query(
    'UPDATE auth_sessions SET revoked_at = now() WHERE user_id = $1 AND id <> $2 AND revoked_at IS NULL',
    [req.userId, req.sessionId]
  )
  res.json({ revoked: rowCount })
})

app.delete('/api/auth/sessions/:id', auth, async (req, res) => {
  if (!/^[0-9a-f-]{36}$/i.test(req.params.id)) return res.status(404).json({ error: 'Session not found' })
  const { rowCount } = await pool.query(
    'UPDATE auth_sessions SET revoked_at = now() WHERE id = $1 AND user_id = $2 AND revoked_at IS NULL',
    [req.params.id, req.userId]
  )
  if (!rowCount) return res.status(404).json({ error: 'Session not found' })
  res.status(204).end()
})

app.delete('/api/auth/me', auth, passwordLimiter, async (req, res) => {
  const password = String(req.body?.password ?? '')
  const { rows } = await pool.query('SELECT password_hash, role FROM users WHERE id = $1', [req.userId])
  if (!rows[0] || !await bcrypt.compare(password, rows[0].password_hash)) {
    return res.status(400).json({ error: 'Password is incorrect', field: 'password' })
  }
  const client = await pool.connect()
  let transactionStarted = false
  try {
    await client.query('BEGIN')
    transactionStarted = true
    if (rows[0].role === 'admin') {
      await client.query('LOCK TABLE users IN SHARE ROW EXCLUSIVE MODE')
      const admins = await client.query("SELECT count(*)::int AS n FROM users WHERE role = 'admin' AND id <> $1", [req.userId])
      if (!admins.rows[0].n) {
        await client.query('ROLLBACK')
        transactionStarted = false
        return res.status(409).json({ error: 'Promote another admin before deleting the only admin account' })
      }
    }
    await client.query('DELETE FROM events WHERE created_by = $1', [req.userId])
    await client.query('DELETE FROM communities WHERE created_by = $1', [req.userId])
    await client.query(
      `INSERT INTO audit_logs (actor_id, action, target_type, target_id, details)
       VALUES (NULL, 'account.delete', 'user', $1::text, jsonb_build_object('role', $2::text))`,
      [req.userId, rows[0].role]
    )
    await client.query('DELETE FROM users WHERE id = $1', [req.userId])
    await client.query('COMMIT')
    transactionStarted = false
  } catch (err) {
    if (transactionStarted) await client.query('ROLLBACK')
    throw err
  } finally {
    client.release()
  }
  res.status(204).end()
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

app.post('/api/communities', auth, writeLimiter, async (req, res) => {
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

app.delete('/api/communities/:id', auth, async (req, res) => {
  if (!isPgBigId(req.params.id)) return res.status(404).json({ error: 'Community not found' })
  const { rows } = await pool.query(`
    WITH target AS (
      SELECT c.id, c.name, (SELECT count(*)::int FROM community_members cm WHERE cm.community_id = c.id) AS member_count
      FROM communities c
      WHERE c.id = $1 AND EXISTS (SELECT 1 FROM community_members cm WHERE cm.community_id = c.id AND cm.user_id = $2 AND cm.role = 'owner')
    ), logged AS (
      INSERT INTO audit_logs (actor_id, action, target_type, target_id, details)
      SELECT $2, 'community.disband', 'community', id::text, jsonb_build_object('name', name, 'memberCount', member_count) FROM target
    ), removed AS (
      DELETE FROM communities c USING target WHERE c.id = target.id RETURNING c.id
    ) SELECT id FROM removed`, [req.params.id, req.userId])
  if (rows[0]) return res.status(204).end()
  const exists = await pool.query('SELECT 1 FROM communities WHERE id = $1', [req.params.id])
  if (!exists.rowCount) return res.status(404).json({ error: 'Community not found' })
  res.status(403).json({ error: 'Only the community owner can disband it' })
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

app.post('/api/communities/:id/posts', auth, writeLimiter, async (req, res) => {
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
    `SELECT u.id, u.name, CASE WHEN u.role = 'admin' THEN 'author' ELSE u.role END AS role, u.profile_image_id,
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

app.get('/api/users/friends', auth, async (req, res) => {
  const q = typeof req.query.q === 'string' ? req.query.q.trim().slice(0, 80) : ''
  const { rows } = await pool.query(
    `SELECT u.id, u.name, CASE WHEN u.role = 'admin' THEN 'author' ELSE u.role END AS role, CASE WHEN u.profile_image_id IS NULL THEN NULL ELSE '/api/images/' || u.profile_image_id::text END AS avatar_url,
       COALESCE(up.institution, '') AS institution
     FROM follows mine JOIN follows theirs ON theirs.follower_id = mine.followee_id AND theirs.followee_id = mine.follower_id
     JOIN users u ON u.id = mine.followee_id LEFT JOIN user_profiles up ON up.user_id = u.id
     WHERE mine.follower_id = $1 AND ($2 = '' OR u.name ILIKE $3)
     ORDER BY lower(u.name) LIMIT 200`,
    [req.userId, q, `%${q.replace(/[\\%_]/g, '\\$&')}%`]
  )
  res.json(rows)
})

// Leaderboard (PR #18): points for posts (+3), likes received (+1), comments on other people's posts (+1)
// and published papers (+5) since the start of the week (Monday) or month, in India time.
const leaderboard = (unit) => async (_req, res) => {
  const { rows } = await pool.query(
    `WITH period AS (
       SELECT date_trunc($1, now() AT TIME ZONE 'Asia/Kolkata') AT TIME ZONE 'Asia/Kolkata' AS start_at
     ),
     post_scores AS (
       SELECT p.user_id, count(*)::int AS posts FROM posts p, period WHERE p.created_at >= period.start_at GROUP BY p.user_id
     ),
     like_scores AS (
       SELECT p.user_id, count(*)::int AS likes_received
       FROM likes l JOIN posts p ON p.id = l.post_id, period
       WHERE l.created_at >= period.start_at AND l.user_id <> p.user_id GROUP BY p.user_id
     ),
     comment_scores AS (
       SELECT c.user_id, count(*)::int AS comments
       FROM comments c JOIN posts p ON p.id = c.post_id, period
       WHERE c.created_at >= period.start_at AND c.user_id <> p.user_id GROUP BY c.user_id
     ),
     paper_scores AS (
       SELECT p.user_id, count(*)::int AS research_papers
       FROM papers p, period WHERE p.status = 'published' AND p.published_at >= period.start_at GROUP BY p.user_id
     ),
     totals AS (
       SELECT u.id, u.name,
         CASE WHEN u.profile_image_id IS NULL THEN NULL ELSE '/api/images/' || u.profile_image_id::text END AS avatar_url,
         COALESCE(ps.posts, 0) AS posts, COALESCE(ls.likes_received, 0) AS likes_received,
         COALESCE(cs.comments, 0) AS comments, COALESCE(rs.research_papers, 0) AS research_papers,
         COALESCE(ps.posts, 0) * 3 + COALESCE(ls.likes_received, 0) + COALESCE(cs.comments, 0) + COALESCE(rs.research_papers, 0) * 5 AS score
       FROM users u
       LEFT JOIN post_scores ps ON ps.user_id = u.id
       LEFT JOIN like_scores ls ON ls.user_id = u.id
       LEFT JOIN comment_scores cs ON cs.user_id = u.id
       LEFT JOIN paper_scores rs ON rs.user_id = u.id
       WHERE u.blocked_at IS NULL
     )
     SELECT row_number() OVER (ORDER BY score DESC, research_papers DESC, likes_received DESC, posts DESC, name ASC)::int AS rank,
       id, name, avatar_url, posts, likes_received, comments, research_papers, score
     FROM totals WHERE score > 0 ORDER BY rank LIMIT 50`,
    [unit],
  )
  res.json({ period: unit === 'week' ? 'weekly' : 'monthly', leaderboard: rows })
}
app.get('/api/leaderboard', auth, leaderboard('week'))
app.get('/api/leaderboard/monthly', auth, leaderboard('month'))

// Collections (PR #2): saved posts and papers in personal folders.
async function ensureUnsortedFolder(userId) {
  const { rows } = await pool.query(
    `INSERT INTO save_folders (user_id, name, is_default) VALUES ($1, 'Unsorted', true)
     ON CONFLICT (user_id) WHERE is_default DO UPDATE SET updated_at = save_folders.updated_at
     RETURNING id, name, is_default`, [userId]
  )
  return rows[0]
}

app.get('/api/saved/folders', auth, async (req, res) => {
  await ensureUnsortedFolder(req.userId)
  const { rows } = await pool.query(`
    SELECT f.id, f.name, f.is_default, f.created_at,
      count(si.id)::int AS item_count
    FROM save_folders f LEFT JOIN saved_items si ON si.folder_id = f.id
    WHERE f.user_id = $1 GROUP BY f.id ORDER BY f.is_default DESC, lower(f.name)`, [req.userId])
  res.json(rows)
})

app.post('/api/saved/folders', auth, async (req, res) => {
  const name = String(req.body?.name ?? '').trim()
  if (!name || name.length > 80) return res.status(400).json({ error: 'Folder name must be 1 to 80 characters' })
  try {
    const { rows } = await pool.query('INSERT INTO save_folders (user_id, name) VALUES ($1, $2) RETURNING id, name, is_default, created_at', [req.userId, name])
    res.status(201).json({ ...rows[0], item_count: 0 })
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'You already have a folder with this name' })
    throw err
  }
})

app.patch('/api/saved/folders/:id', auth, async (req, res) => {
  const name = String(req.body?.name ?? '').trim()
  if (!/^\d+$/.test(req.params.id)) return res.status(404).json({ error: 'Folder not found' })
  if (!name || name.length > 80) return res.status(400).json({ error: 'Folder name must be 1 to 80 characters' })
  try {
    const { rows } = await pool.query('UPDATE save_folders SET name = $1, updated_at = now() WHERE id = $2 AND user_id = $3 AND NOT is_default RETURNING id, name, is_default, updated_at', [name, req.params.id, req.userId])
    if (!rows[0]) return res.status(404).json({ error: 'Folder not found or cannot be renamed' })
    res.json(rows[0])
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'You already have a folder with this name' })
    throw err
  }
})

app.delete('/api/saved/folders/:id', auth, async (req, res) => {
  if (!/^\d+$/.test(req.params.id)) return res.status(404).json({ error: 'Folder not found' })
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const folder = await client.query('SELECT id, is_default FROM save_folders WHERE id = $1 AND user_id = $2 FOR UPDATE', [req.params.id, req.userId])
    if (!folder.rows[0] || folder.rows[0].is_default) {
      await client.query('ROLLBACK')
      return res.status(404).json({ error: 'Folder not found or cannot be deleted' })
    }
    const unsorted = await client.query('SELECT id FROM save_folders WHERE user_id = $1 AND is_default FOR UPDATE', [req.userId])
    await client.query(`DELETE FROM saved_items old WHERE old.folder_id = $1 AND EXISTS (
      SELECT 1 FROM saved_items existing WHERE existing.folder_id = $2
        AND ((old.post_id IS NOT NULL AND existing.post_id = old.post_id) OR (old.paper_id IS NOT NULL AND existing.paper_id = old.paper_id)))`, [req.params.id, unsorted.rows[0].id])
    await client.query('UPDATE saved_items SET folder_id = $1 WHERE folder_id = $2', [unsorted.rows[0].id, req.params.id])
    await client.query('DELETE FROM save_folders WHERE id = $1', [req.params.id])
    await client.query('COMMIT')
    res.status(204).end()
  } catch (err) { await client.query('ROLLBACK'); throw err } finally { client.release() }
})

const savedItemSelect = `
  SELECT si.id, si.folder_id, sf.name AS folder_name, si.created_at AS saved_at,
    CASE WHEN si.post_id IS NOT NULL THEN 'post' ELSE 'paper' END AS item_type,
    si.post_id, si.paper_id,
    CASE WHEN si.post_id IS NOT NULL THEN json_build_object('id', p.id, 'body', p.body, 'image_id', p.image_id, 'created_at', p.created_at, 'user_id', p.user_id, 'author_name', pu.name, 'author_role', pu.role)
      ELSE json_build_object('id', rp.id, 'title', rp.title, 'abstract', rp.abstract, 'authors', rp.authors, 'domain', rp.domain, 'tags', rp.tags, 'doi', rp.doi, 'created_at', rp.created_at, 'reviewed_at', rp.reviewed_at, 'published_at', rp.published_at, 'user_id', rp.user_id, 'author_name', ru.name, 'author_role', ru.role) END AS content
  FROM saved_items si JOIN save_folders sf ON sf.id = si.folder_id
  LEFT JOIN posts p ON p.id = si.post_id LEFT JOIN users pu ON pu.id = p.user_id
  LEFT JOIN papers rp ON rp.id = si.paper_id LEFT JOIN users ru ON ru.id = rp.user_id`

app.get('/api/saved/items', auth, async (req, res) => {
  await ensureUnsortedFolder(req.userId)
  const folder = req.query.folder && /^\d+$/.test(req.query.folder) ? req.query.folder : null
  const type = ['post', 'paper'].includes(req.query.type) ? req.query.type : null
  const { rows } = await pool.query(`${savedItemSelect}
    WHERE si.user_id = $1 ${folder ? 'AND si.folder_id = $2' : ''} ${type === 'post' ? 'AND si.post_id IS NOT NULL' : type === 'paper' ? 'AND si.paper_id IS NOT NULL' : ''}
    AND (si.post_id IS NOT NULL OR rp.status = 'published') ORDER BY si.created_at DESC LIMIT 200`, folder ? [req.userId, folder] : [req.userId])
  res.json(rows)
})

app.post('/api/saved/items', auth, async (req, res) => {
  const type = req.body?.item_type
  const itemId = String(req.body?.item_id ?? '')
  const folderId = String(req.body?.folder_id ?? '')
  if (!['post', 'paper'].includes(type) || !/^\d+$/.test(itemId) || !/^\d+$/.test(folderId)) return res.status(400).json({ error: 'Invalid saved item' })
  const owner = await pool.query('SELECT id FROM save_folders WHERE id = $1 AND user_id = $2', [folderId, req.userId])
  if (!owner.rows[0]) return res.status(404).json({ error: 'Folder not found' })
  const source = type === 'post'
    ? await pool.query('SELECT id FROM posts WHERE id = $1', [itemId])
    : await pool.query("SELECT id FROM papers WHERE id = $1 AND status = 'published'", [itemId])
  if (!source.rows[0]) return res.status(404).json({ error: 'Content not found' })
  const column = type === 'post' ? 'post_id' : 'paper_id'
  const { rows } = await pool.query(`INSERT INTO saved_items (user_id, folder_id, ${column}) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING RETURNING id`, [req.userId, folderId, itemId])
  const result = await pool.query(`${savedItemSelect} WHERE si.user_id = $1 AND si.id = $2`, [req.userId, rows[0]?.id ?? (await pool.query(`SELECT id FROM saved_items WHERE user_id = $1 AND folder_id = $2 AND ${column} = $3`, [req.userId, folderId, itemId])).rows[0].id])
  res.status(rows[0] ? 201 : 200).json(result.rows[0])
})

app.patch('/api/saved/items/:id', auth, async (req, res) => {
  if (!/^\d+$/.test(req.params.id) || !/^\d+$/.test(String(req.body?.folder_id ?? ''))) return res.status(400).json({ error: 'Invalid saved item or folder' })
  const { rows } = await pool.query(`UPDATE saved_items si SET folder_id = $1 FROM save_folders sf
    WHERE si.id = $2 AND si.user_id = $3 AND sf.id = $1 AND sf.user_id = $3 RETURNING si.id`, [req.body.folder_id, req.params.id, req.userId])
  if (!rows[0]) return res.status(404).json({ error: 'Saved item or folder not found' })
  const result = await pool.query(`${savedItemSelect} WHERE si.user_id = $1 AND si.id = $2`, [req.userId, req.params.id])
  res.json(result.rows[0])
})

app.delete('/api/saved/items/:id', auth, async (req, res) => {
  if (!/^\d+$/.test(req.params.id)) return res.status(404).json({ error: 'Saved item not found' })
  const { rowCount } = await pool.query('DELETE FROM saved_items WHERE id = $1 AND user_id = $2', [req.params.id, req.userId])
  if (!rowCount) return res.status(404).json({ error: 'Saved item not found' })
  res.status(204).end()
})

// Researcher matching (PR #24): AI smart-fill (Gemini, optional key), interests, matches and collaboration requests.
app.post('/api/researchers/profile/smart-fill', auth, async (req, res) => {
  try {
    // Fetch ALL papers uploaded by the logged-in researcher
    const { rows: papers } = await pool.query(
      `SELECT
         id, title, abstract, doi, domain, tags,
         authors, additional_notes, pdf_data
       FROM papers
       WHERE user_id = $1
       ORDER BY created_at DESC`,
      [req.userId]
    )

    if (papers.length === 0) {
      return res.status(400).json({
        error: 'Upload at least one research paper before using Smart Fill.'
      })
    }

    // Extract text from every uploaded PDF
    const paperInformation = []

    for (const paper of papers) {
      let extractedText = ''

      try {
        extractedText = await extractProfilePdfText(paper.pdf_data)
      } catch (error) {
        console.error(`PDF extraction failed for paper ${paper.id}:`, error.message)
      }

      paperInformation.push({
        title: paper.title,
        abstract: paper.abstract,
        doi: paper.doi,
        domain: paper.domain,
        tags: paper.tags,
        authors: paper.authors,
        additional_notes: paper.additional_notes,
        extracted_text: extractedText.slice(0, 10000)
      })
    }

    // Prepare information for Gemini
    const prompt = `
You are an AI research profile assistant.

Analyse the following research papers and suggest profile information
for the researcher.

PAPERS:
${JSON.stringify(paperInformation)}

Return ONLY a valid JSON object with these fields:

{
  "bio": "A concise professional researcher biography",
  "institution": "Institution only if explicitly supported by the papers, otherwise empty string",
  "research_domain": "Main research domain supported by the papers",
  "skills": ["Evidence-based technical and research skills"],
  "projects": "Research projects explicitly identified in the papers",
  "publications": "Titles and publication details supported by the paper information"
}

IMPORTANT RULES:
1. Do not invent qualifications, institutions, skills or experience.
2. Do not assume an author belongs to an institution unless clearly stated.
3. Do not describe pending or rejected submissions as published papers.
4. Do not invent project names or publication details.
5. Use empty strings or empty arrays when information is unavailable.
6. Base every suggestion on the supplied paper information.
7. Keep the biography concise and professional.
`

    const aiResponse = await generateWithGemini(prompt)

    // Convert Gemini's JSON response into an object
    const suggestions = JSON.parse(aiResponse)

    if (
      typeof suggestions !== 'object' ||
      suggestions === null ||
      Array.isArray(suggestions)
    ) {
      throw new Error('Gemini returned an invalid profile format')
    }

    res.json({
      message: 'Smart Fill suggestions generated successfully',
      paperCount: papers.length,
      suggestions
    })

  } catch (error) {
    console.error('Smart Fill error:', error)

    res.status(500).json({
      error: error.message || 'Unable to generate profile suggestions'
    })
  }
})

app.get('/api/researchers/interests', auth, async (req, res) => {
  const { rows } = await pool.query(
    `SELECT interest
     FROM research_interests
     WHERE user_id = $1
     ORDER BY interest`,
    [req.userId]
  )
  res.json(rows.map((row) => row.interest))
})

app.put('/api/researchers/interests', auth, async (req, res) => {
  const raw = req.body?.interests

  if (!Array.isArray(raw)) {
    return res.status(400).json({ error: 'Interests must be a list' })
  }

  if (raw.length > 30) {
    return res.status(400).json({ error: 'You can add up to 30 interests' })
  }

  const interests = [...new Set(
    raw
      .filter((item) => typeof item === 'string')
      .map((item) => item.trim().replace(/\s+/g, ' '))
      .filter((item) => item.length > 0)
      .map((item) => item.slice(0, 80))
      .map((item) => item.toLowerCase())
  )]

  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    await client.query(
      'DELETE FROM research_interests WHERE user_id = $1',
      [req.userId]
    )

    for (const interest of interests) {
      await client.query(
        'INSERT INTO research_interests (user_id, interest) VALUES ($1, $2)',
        [req.userId, interest]
      )
    }

    await client.query('COMMIT')
    res.json({ interests })
  } catch (err) {
    await client.query('ROLLBACK')
    throw err
  } finally {
    client.release()
  }
})

app.get('/api/researchers/matches', auth, async (req, res) => {
  const { rows } = await pool.query(
    `SELECT
       u.id,
       u.name,
       u.role,
       COALESCE(rp.institution, '') AS institution,
       COALESCE(rp.research_domain, '') AS research_domain,
       COALESCE(rp.availability, 'open') AS availability,
       COALESCE(rp.skills, '{}') AS skills,
       array_agg(ri.interest ORDER BY ri.interest) AS shared_interests,
       count(*)::int AS match_count
     FROM users u
     JOIN research_interests ri ON ri.user_id = u.id
     LEFT JOIN researcher_profiles rp ON rp.user_id = u.id
     WHERE u.id <> $1 AND u.blocked_at IS NULL
       AND lower(ri.interest) IN (
         SELECT lower(interest)
         FROM research_interests
         WHERE user_id = $1
       )
     GROUP BY
       u.id,
       u.name,
       u.role,
       rp.institution,
       rp.research_domain,
       rp.availability,
       rp.skills
     ORDER BY match_count DESC, u.name ASC
     LIMIT 100`,
    [req.userId]
  )

  res.json(rows)
})

app.get('/api/collaborations', auth, async (req, res) => {
  const { rows } = await pool.query(
    `SELECT
       cr.id,
       cr.sender_id,
       sender.name AS sender_name,
       cr.receiver_id,
       receiver.name AS receiver_name,
       cr.status,
       cr.created_at,
       cr.updated_at
     FROM collaboration_requests cr
     JOIN users sender ON sender.id = cr.sender_id
     JOIN users receiver ON receiver.id = cr.receiver_id
     WHERE cr.sender_id = $1 OR cr.receiver_id = $1
     ORDER BY cr.created_at DESC`,
    [req.userId]
  )

  res.json(rows)
})

app.post('/api/collaborations', auth, async (req, res) => {
  const receiverId = Number(req.body?.receiverId)

  if (!Number.isSafeInteger(receiverId) || receiverId <= 0) {
    return res.status(400).json({ error: 'A valid researcher ID is required' })
  }

  if (receiverId === Number(req.userId)) {
    return res.status(400).json({ error: 'You cannot request collaboration with yourself' })
  }

  const { rows: users } = await pool.query(
    'SELECT id FROM users WHERE id = $1',
    [receiverId]
  )
  if (!users[0]) {
    return res.status(404).json({ error: 'Researcher not found' })
  }

  const { rows: existing } = await pool.query(
    `SELECT id, status FROM collaboration_requests
     WHERE sender_id = $1 AND receiver_id = $2`,
    [req.userId, receiverId]
  )

  if (existing[0]) {
    return res.status(409).json({
      error: `A collaboration request already exists (${existing[0].status})`
    })
  }

  const { rows } = await pool.query(
    `INSERT INTO collaboration_requests (sender_id, receiver_id)
     VALUES ($1, $2)
     RETURNING id, sender_id, receiver_id, status, created_at`,
    [req.userId, receiverId]
  )

  res.status(201).json(rows[0])
})

app.patch('/api/collaborations/:id', auth, async (req, res) => {
  const id = Number(req.params.id)
  const status = req.body?.status

  if (!Number.isSafeInteger(id) || id <= 0) {
    return res.status(404).json({ error: 'Collaboration request not found' })
  }

  if (!['accepted', 'rejected'].includes(status)) {
    return res.status(400).json({ error: 'Status must be accepted or rejected' })
  }

  const { rows } = await pool.query(
    `UPDATE collaboration_requests
     SET status = $1, updated_at = now()
     WHERE id = $2
       AND receiver_id = $3
       AND status = 'pending'
     RETURNING id, sender_id, receiver_id, status, updated_at`,
    [status, id, req.userId]
  )

  if (!rows[0]) {
    return res.status(404).json({
      error: 'Pending collaboration request not found'
    })
  }

  res.json(rows[0])
})

app.get('/api/researchers/profile', auth, async (req, res) => {
  const { rows } = await pool.query(
    `SELECT
       u.id AS user_id,
       u.name,
       u.role,
       COALESCE(rp.bio, '') AS bio,
       COALESCE(rp.institution, '') AS institution,
       COALESCE(rp.research_domain, '') AS research_domain,
       COALESCE(rp.skills, '{}') AS skills,
       COALESCE(rp.projects, '') AS projects,
       COALESCE(rp.publications, '') AS publications,
       COALESCE(rp.availability, 'open') AS availability
     FROM users u
     LEFT JOIN researcher_profiles rp ON rp.user_id = u.id
     WHERE u.id = $1`,
    [req.userId]
  )

  res.json(rows[0])
})

app.put('/api/researchers/profile', auth, async (req, res) => {
  const {
    bio = '',
    institution = '',
    research_domain = '',
    skills = [],
    projects = '',
    publications = '',
    availability = 'open'
  } = req.body || {}

  if (
    typeof bio !== 'string' ||
    typeof institution !== 'string' ||
    typeof research_domain !== 'string' ||
    typeof projects !== 'string' ||
    typeof publications !== 'string'
  ) {
    return res.status(400).json({ error: 'Invalid profile details' })
  }

  if (!Array.isArray(skills) || skills.length > 30) {
    return res.status(400).json({ error: 'Add up to 30 skills' })
  }

  if (!skills.every(skill => typeof skill === 'string')) {
    return res.status(400).json({ error: 'Skills must be text values' })
  }

  if (!['open', 'busy', 'unavailable'].includes(availability)) {
    return res.status(400).json({ error: 'Invalid availability status' })
  }

  const cleanSkills = [...new Set(
    skills
      .map(skill => skill.trim())
      .filter(Boolean)
      .map(skill => skill.slice(0, 60))
  )]

  const values = [
    bio.trim().slice(0, 1000),
    institution.trim().slice(0, 200),
    research_domain.trim().slice(0, 150),
    cleanSkills,
    projects.trim().slice(0, 3000),
    publications.trim().slice(0, 3000),
    availability
  ]

  const { rows } = await pool.query(
    `INSERT INTO researcher_profiles
       (user_id, bio, institution, research_domain, skills,
        projects, publications, availability, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, now())
     ON CONFLICT (user_id)
     DO UPDATE SET
       bio = EXCLUDED.bio,
       institution = EXCLUDED.institution,
       research_domain = EXCLUDED.research_domain,
       skills = EXCLUDED.skills,
       projects = EXCLUDED.projects,
       publications = EXCLUDED.publications,
       availability = EXCLUDED.availability,
       updated_at = now()
     RETURNING *`,
    [req.userId, ...values]
  )

  res.json(rows[0])
})

app.get('/api/researchers/:id/profile', auth, async (req, res) => {
  const researcherId = Number(req.params.id)

  if (!Number.isSafeInteger(researcherId) || researcherId <= 0) {
    return res.status(400).json({ error: 'Invalid researcher ID' })
  }

  const { rows } = await pool.query(
    `SELECT
       u.id AS user_id,
       u.name,
       u.role,
       COALESCE(rp.bio, '') AS bio,
       COALESCE(rp.institution, '') AS institution,
       COALESCE(rp.research_domain, '') AS research_domain,
       COALESCE(rp.skills, '{}') AS skills,
       COALESCE(rp.projects, '') AS projects,
       COALESCE(rp.publications, '') AS publications,
       COALESCE(rp.availability, 'open') AS availability
     FROM users u
     LEFT JOIN researcher_profiles rp ON rp.user_id = u.id
     WHERE u.id = $1`,
    [researcherId]
  )

  if (!rows[0]) {
    return res.status(404).json({ error: 'Researcher not found' })
  }

  res.json(rows[0])
})

// Paper chat (PR #19): saved chat sessions that answer only from passages of published papers.
// Every query is scoped to the signed-in user's own sessions.
const CHAT_SESSION_COLUMNS = `s.id, s.title, s.paper_id, p.title AS paper_title, s.created_at, s.updated_at`
const chatLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => `paper-chat:${req.userId}`,
  handler: (_req, res) => res.status(429).json({ error: 'You are asking very quickly. Please wait a minute and try again.' }),
})
const isUuid = (value) => /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(value))
const ownSession = async (sessionId, userId) => (isUuid(sessionId)
  ? (await pool.query(`SELECT ${CHAT_SESSION_COLUMNS} FROM chat_sessions s LEFT JOIN papers p ON p.id = s.paper_id WHERE s.id = $1 AND s.user_id = $2`, [sessionId, userId])).rows[0]
  : null)

app.get('/api/chat/sessions', auth, async (req, res) => {
  const { rows } = await pool.query(
    `SELECT ${CHAT_SESSION_COLUMNS} FROM chat_sessions s LEFT JOIN papers p ON p.id = s.paper_id
     WHERE s.user_id = $1 ORDER BY s.updated_at DESC LIMIT 100`,
    [req.userId],
  )
  res.json(rows)
})

app.post('/api/chat/sessions', auth, writeLimiter, async (req, res) => {
  let paperId = null
  if (req.body?.paperId != null) {
    if (!isPgBigId(String(req.body.paperId))) return res.status(400).json({ error: 'paperId must be a valid paper ID.' })
    const { rows } = await pool.query('SELECT id, user_id, status FROM papers WHERE id = $1', [req.body.paperId])
    if (!canAccessPaperForChat({ paper: rows[0], userId: req.userId, userRole: req.userRole })) return res.status(404).json({ error: 'Paper not found' })
    paperId = rows[0].id
    indexPaper(pool, paperId).catch((err) => log('error', 'paper_index_failed', { paperId, message: err.message }))
  }
  const { rows } = await pool.query('INSERT INTO chat_sessions (user_id, paper_id) VALUES ($1, $2) RETURNING id', [req.userId, paperId])
  res.status(201).json(await ownSession(rows[0].id, req.userId))
})

app.get('/api/chat/sessions/:id', auth, async (req, res) => {
  const session = await ownSession(req.params.id, req.userId)
  if (!session) return res.status(404).json({ error: 'Chat not found' })
  const { rows } = await pool.query(
    'SELECT id, role, content, sources, created_at FROM chat_messages WHERE session_id = $1 ORDER BY created_at, id LIMIT 500',
    [session.id],
  )
  res.json({ ...session, messages: rows })
})

app.patch('/api/chat/sessions/:id', auth, writeLimiter, async (req, res) => {
  if (!await ownSession(req.params.id, req.userId)) return res.status(404).json({ error: 'Chat not found' })
  const title = normalizeChatTitle(req.body?.title, 'New chat')
  await pool.query('UPDATE chat_sessions SET title = $2, updated_at = now() WHERE id = $1', [req.params.id, title])
  res.json(await ownSession(req.params.id, req.userId))
})

app.delete('/api/chat/sessions/:id', auth, async (req, res) => {
  if (!isUuid(req.params.id)) return res.status(404).json({ error: 'Chat not found' })
  const { rowCount } = await pool.query('DELETE FROM chat_sessions WHERE id = $1 AND user_id = $2', [req.params.id, req.userId])
  if (!rowCount) return res.status(404).json({ error: 'Chat not found' })
  res.status(204).end()
})

app.post('/api/chat/sessions/:id/messages', auth, chatLimiter, async (req, res) => {
  const session = await ownSession(req.params.id, req.userId)
  if (!session) return res.status(404).json({ error: 'Chat not found' })
  let question
  try { question = parseChatQuestion(req.body?.question) } catch (err) { return res.status(err.status || 400).json({ error: err.message }) }

  // Save the question first, so a failed answer can be retried without asking twice.
  let userMessageId = isUuid(req.body?.retryMessageId) ? req.body.retryMessageId : null
  if (userMessageId) {
    const retry = await pool.query("SELECT id FROM chat_messages WHERE id = $1 AND session_id = $2 AND role = 'user'", [userMessageId, session.id])
    if (!retry.rows[0]) userMessageId = null
  }
  if (!userMessageId) {
    userMessageId = (await pool.query("INSERT INTO chat_messages (session_id, role, content) VALUES ($1, 'user', $2) RETURNING id", [session.id, question])).rows[0].id
  }
  try {
    const history = (await pool.query(
      `SELECT role, content FROM (
         SELECT role, content, created_at, id FROM chat_messages WHERE session_id = $1 AND id <> $2 ORDER BY created_at DESC, id DESC LIMIT 8
       ) recent ORDER BY created_at, id`,
      [session.id, userMessageId],
    )).rows
    await indexPendingPapers(pool, 5).catch(() => 0)
    const searchText = history.length
      ? await completeChat(buildStandaloneQueryMessages({ history, question, paperTitle: session.paper_title }), { maxTokens: 120 }).catch(() => question)
      : question
    const excerpts = await searchExcerpts(pool, { query: `${searchText} ${question}`, paperId: session.paper_id })
    const answer = session.paper_id
      ? await completeChat(buildPaperAnswerMessages({ question, paperTitle: session.paper_title, excerpts: excerpts.map((e) => e.content) }))
      : await completeChat(buildSessionAnswerMessages({ history, question, excerpts: excerpts.map((e) => ({ title: e.title, paperId: e.paper_id, content: e.content })) }))
    const sources = [...new Map(excerpts.map((e) => [String(e.paper_id), { paperId: Number(e.paper_id), title: e.title }])).values()]
    const saved = (await pool.query(
      "INSERT INTO chat_messages (session_id, role, content, sources) VALUES ($1, 'assistant', $2, $3::jsonb) RETURNING id, role, content, sources, created_at",
      [session.id, answer || 'I could not find an answer in the available papers.', JSON.stringify(sources)],
    )).rows[0]
    const title = session.title === 'New chat' ? normalizeChatTitle(question, question) : session.title
    await pool.query('UPDATE chat_sessions SET title = $2, updated_at = now() WHERE id = $1', [session.id, title])
    res.status(201).json({ ...saved, userMessageId, session: await ownSession(session.id, req.userId) })
  } catch (err) {
    log('error', 'paper_chat_failed', { message: err.message })
    res.status(err.status && err.status < 600 ? err.status : 502).json({ error: err.message || 'The AI could not answer right now.', userMessageId })
  }
})

// Index newly published papers in the background (at start-up and hourly).
setTimeout(() => indexPendingPapers(pool, 50).catch((err) => log('error', 'paper_index_failed', { message: err.message })), 5000).unref()
setInterval(() => indexPendingPapers(pool, 50).catch(() => {}), 60 * 60 * 1000).unref()

app.get('/api/users/suggestions', auth, async (req, res) => {
  const { rows } = await pool.query(
    `WITH me AS (SELECT COALESCE(research_interests, '{}') AS interests FROM user_profiles WHERE user_id = $1)
     SELECT u.id, u.name, CASE WHEN u.role = 'admin' THEN 'author' ELSE u.role END AS role, CASE WHEN u.profile_image_id IS NULL THEN NULL ELSE '/api/images/' || u.profile_image_id::text END AS avatar_url,
       COALESCE(up.institution, '') AS institution,
       (SELECT count(*)::int FROM unnest(COALESCE(up.research_interests, '{}')) AS theirs(value)
         WHERE lower(theirs.value) IN (SELECT lower(mine.value) FROM me, unnest(me.interests) AS mine(value))) AS shared_interests,
       (SELECT count(*)::int FROM follows f WHERE f.followee_id = u.id) AS follower_count
     FROM users u LEFT JOIN user_profiles up ON up.user_id = u.id
     WHERE u.id <> $1 AND NOT EXISTS (SELECT 1 FROM follows f WHERE f.follower_id = $1 AND f.followee_id = u.id)
     ORDER BY shared_interests DESC, follower_count DESC, u.created_at DESC
     LIMIT 5`,
    [req.userId]
  )
  res.json(rows)
})

app.put('/api/users/:id/follow', auth, writeLimiter, async (req, res) => {
  if (!isPgId(req.params.id)) return res.status(404).json({ error: 'User not found' })
  if (typeof req.body?.following !== 'boolean') return res.status(400).json({ error: 'following must be true or false' })
  if (String(req.params.id) === String(req.userId)) return res.status(400).json({ error: 'You cannot follow yourself' })
  const target = await pool.query('SELECT 1 FROM users WHERE id = $1', [req.params.id])
  if (!target.rows[0]) return res.status(404).json({ error: 'User not found' })
  if (req.body.following) {
    await pool.query(`WITH inserted AS (
        INSERT INTO follows (follower_id, followee_id) VALUES ($2, $1) ON CONFLICT DO NOTHING RETURNING follower_id, followee_id
      ), notified AS (
        INSERT INTO notifications (user_id, actor_id, kind, entity_type, entity_id, text)
        SELECT inserted.followee_id, inserted.follower_id, 'follow', 'user', inserted.follower_id, actor.name || ' started following you'
        FROM inserted JOIN users actor ON actor.id = inserted.follower_id RETURNING id
      ) SELECT 1 FROM inserted`, [req.params.id, req.userId])
  } else {
    await pool.query('DELETE FROM follows WHERE follower_id = $2 AND followee_id = $1', [req.params.id, req.userId])
  }
  const { rows } = await pool.query(
    `SELECT (SELECT count(*)::int FROM follows WHERE followee_id = $1) AS follower_count,
       EXISTS (SELECT 1 FROM follows WHERE follower_id = $2 AND followee_id = $1) AS followed_by_me`,
    [req.params.id, req.userId]
  )
  res.json(rows[0])
})

for (const [path, joinColumn, matchColumn] of [['followers', 'follower_id', 'followee_id'], ['following', 'followee_id', 'follower_id']]) {
  app.get(`/api/users/:id/${path}`, auth, async (req, res) => {
    if (!isPgId(req.params.id)) return res.status(404).json({ error: 'User not found' })
    const { rows } = await pool.query(
      `SELECT u.id, u.name, CASE WHEN u.role = 'admin' THEN 'author' ELSE u.role END AS role, CASE WHEN u.profile_image_id IS NULL THEN NULL ELSE '/api/images/' || u.profile_image_id::text END AS avatar_url, COALESCE(up.institution, '') AS institution,
         EXISTS (SELECT 1 FROM follows mine WHERE mine.follower_id = $2 AND mine.followee_id = u.id) AS followed_by_me
       FROM follows f JOIN users u ON u.id = f.${joinColumn} LEFT JOIN user_profiles up ON up.user_id = u.id
       WHERE f.${matchColumn} = $1 ORDER BY f.created_at DESC LIMIT 100`,
      [req.params.id, req.userId]
    )
    res.json(rows)
  })
}

app.get('/api/users/:id', auth, async (req, res) => {
  if (!isPgId(req.params.id)) return res.status(404).json({ error: 'User not found' })
  const { rows } = await pool.query(
    `SELECT u.id, u.name, CASE WHEN u.role = 'admin' THEN 'author' ELSE u.role END AS role, u.created_at, u.profile_image_id,
      COALESCE(up.institution, '') AS institution, COALESCE(up.department, '') AS department,
      COALESCE(up.research_interests, '{}') AS research_interests, COALESCE(up.bio, '') AS bio,
      COALESCE(up.skills, '{}') AS skills, COALESCE(up.links, '[]'::jsonb) AS links,
      (SELECT count(*)::int FROM posts WHERE user_id = u.id) AS post_count,
      (SELECT count(*)::int FROM papers p WHERE (p.user_id = u.id OR p.authors @> jsonb_build_array(jsonb_build_object('user_id', u.id))) AND p.status = 'published') AS paper_count,
      (SELECT count(*)::int FROM follows WHERE followee_id = u.id) AS follower_count,
      (SELECT count(*)::int FROM follows WHERE follower_id = u.id) AS following_count,
      EXISTS (SELECT 1 FROM follows WHERE follower_id = $2 AND followee_id = u.id) AS followed_by_me
     FROM users u LEFT JOIN user_profiles up ON up.user_id = u.id WHERE u.id = $1`,
    [req.params.id, req.userId]
  )
  if (!rows[0]) return res.status(404).json({ error: 'User not found' })
  const user = rows[0]
  const pinnedPostId = isPgId(req.query.post) ? req.query.post : null
  const posts = await pool.query(
    `SELECT p.id, p.user_id, p.body, p.image_id, p.created_at, p.updated_at,
      (SELECT count(*)::int FROM likes l WHERE l.post_id = p.id) AS like_count, (SELECT count(*)::int FROM post_views pv WHERE pv.post_id = p.id) AS view_count,
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
  const papers = await pool.query(
    `SELECT p.id, p.title, p.domain, p.tags, COALESCE(p.published_at, p.created_at) AS published_at,
       (SELECT count(*)::int FROM paper_likes pl WHERE pl.paper_id = p.id) AS like_count, (SELECT count(*)::int FROM paper_views pw WHERE pw.paper_id = p.id) AS view_count,
       (SELECT count(*)::int FROM paper_comments pc WHERE pc.paper_id = p.id) AS comment_count
       , p.user_id <> $1 AS coauthored
     FROM papers p WHERE (p.user_id = $1 OR p.authors @> jsonb_build_array(jsonb_build_object('user_id', $1::int))) AND p.status = 'published'
     ORDER BY COALESCE(p.published_at, p.created_at) DESC, p.id DESC LIMIT 20`,
    [user.id]
  )
  const { profile_image_id, ...publicProfile } = user
  res.json({
    ...publicProfile,
    avatar_url: profile_image_id ? `/api/images/${profile_image_id}` : null,
    posts: posts.rows,
    papers: papers.rows,
  })
})

app.put('/api/auth/me/photo', auth, writeLimiter, upload.single('photo'), async (req, res) => {
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
  SELECT p.id, p.body, p.image_id, p.created_at, p.updated_at, p.user_id, u.name AS author_name, CASE WHEN u.role = 'admin' THEN 'author' ELSE u.role END AS author_role,
    CASE WHEN u.profile_image_id IS NULL THEN NULL ELSE '/api/images/' || u.profile_image_id::text END AS author_avatar_url,
    (SELECT count(*)::int FROM likes l WHERE l.post_id = p.id) AS like_count, (SELECT count(*)::int FROM post_views pv WHERE pv.post_id = p.id) AS view_count,
    EXISTS (SELECT 1 FROM likes l WHERE l.post_id = p.id AND l.user_id = $2) AS liked_by_me,
    (SELECT count(*)::int FROM comments c WHERE c.post_id = p.id) AS comment_count
  FROM posts p JOIN users u ON u.id = p.user_id`

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

app.post('/api/events', auth, requireEventOrganizer, writeLimiter, async (req, res) => {
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

app.post('/api/messages/conversations', auth, writeLimiter, async (req, res) => {
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

app.post('/api/messages/conversations/:id/messages', auth, writeLimiter, async (req, res) => {
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
  const followingOnly = req.query.scope === 'following'
  const { rows } = await pool.query(`
    WITH visible AS (
      SELECT $3::integer AS user_id
      UNION ALL SELECT followee_id FROM follows WHERE follower_id = $3 AND $4::boolean
    )
    SELECT * FROM (
      SELECT 'post'::text AS type, p.id::text AS id, p.body, p.image_id::text AS image_id,
        p.created_at, p.updated_at, p.user_id, u.name AS author_name, CASE WHEN u.role = 'admin' THEN 'author' ELSE u.role END AS author_role,
        CASE WHEN u.profile_image_id IS NULL THEN NULL ELSE '/api/images/' || u.profile_image_id::text END AS author_avatar_url,
        (SELECT count(*)::int FROM likes l WHERE l.post_id = p.id) AS like_count, (SELECT count(*)::int FROM post_views pv WHERE pv.post_id = p.id) AS view_count,
        EXISTS (SELECT 1 FROM likes l WHERE l.post_id = p.id AND l.user_id = $3) AS liked_by_me,
        (SELECT count(*)::int FROM comments c WHERE c.post_id = p.id) AS comment_count,
        false AS saved_by_me,
        (SELECT si.id FROM saved_items si WHERE si.user_id = $3 AND si.post_id = p.id ORDER BY si.created_at DESC LIMIT 1) AS saved_item_id,
        (SELECT si.folder_id FROM saved_items si WHERE si.user_id = $3 AND si.post_id = p.id ORDER BY si.created_at DESC LIMIT 1) AS saved_folder_id,
        NULL::text AS title, NULL::text AS abstract, NULL::jsonb AS authors,
        NULL::text AS domain, NULL::text[] AS tags, NULL::text AS doi, NULL::text AS publication_date,
        NULL::text AS pdf_filename, NULL::int AS pdf_size
      FROM posts p JOIN users u ON u.id = p.user_id
      WHERE NOT $4::boolean OR p.user_id IN (SELECT user_id FROM visible)
      UNION ALL
      SELECT 'paper'::text AS type, rp.id::text AS id, NULL::text AS body, NULL::text AS image_id,
        COALESCE(rp.published_at, rp.created_at) AS created_at, rp.updated_at, rp.user_id, u.name AS author_name, CASE WHEN u.role = 'admin' THEN 'author' ELSE u.role END AS author_role,
        CASE WHEN u.profile_image_id IS NULL THEN NULL ELSE '/api/images/' || u.profile_image_id::text END AS author_avatar_url,
        (SELECT count(*)::int FROM paper_likes pl WHERE pl.paper_id = rp.id) AS like_count, (SELECT count(*)::int FROM paper_views pw WHERE pw.paper_id = rp.id) AS view_count,
        EXISTS (SELECT 1 FROM paper_likes pl WHERE pl.paper_id = rp.id AND pl.user_id = $3) AS liked_by_me,
        (SELECT count(*)::int FROM paper_comments pc WHERE pc.paper_id = rp.id) AS comment_count,
        EXISTS (SELECT 1 FROM paper_saves ps WHERE ps.paper_id = rp.id AND ps.user_id = $3) AS saved_by_me,
        (SELECT si.id FROM saved_items si WHERE si.user_id = $3 AND si.paper_id = rp.id ORDER BY si.created_at DESC LIMIT 1) AS saved_item_id,
        (SELECT si.folder_id FROM saved_items si WHERE si.user_id = $3 AND si.paper_id = rp.id ORDER BY si.created_at DESC LIMIT 1) AS saved_folder_id,
        rp.title, rp.abstract, rp.authors, rp.domain, rp.tags, rp.doi, rp.publication_date::text AS publication_date,
        rp.pdf_filename, rp.pdf_size
      FROM papers rp JOIN users u ON u.id = rp.user_id
      WHERE rp.status = 'published' AND (NOT $4::boolean OR rp.user_id IN (SELECT user_id FROM visible))
    ) feed ORDER BY created_at DESC, type ASC, id::bigint DESC LIMIT $1 OFFSET $2`,
  [limit + 1, offset, req.userId, followingOnly])
  const hasMore = rows.length > limit
  res.json({ items: rows.slice(0, limit), page, hasMore })
})

app.get('/api/posts/search', auth, async (req, res) => {
  const q = String(req.query.q ?? '').trim().slice(0, 200)
  if (!q) return res.json([])
  const pattern = `%${q.replace(/[\\%_]/g, '\\$&')}%`
  const { rows } = await pool.query(
    `SELECT p.id, p.body, p.image_id, p.created_at, p.updated_at, p.user_id,
      u.name AS author_name, CASE WHEN u.role = 'admin' THEN 'author' ELSE u.role END AS author_role,
      CASE WHEN u.profile_image_id IS NULL THEN NULL ELSE '/api/images/' || u.profile_image_id::text END AS author_avatar_url,
      (SELECT count(*)::int FROM likes l WHERE l.post_id = p.id) AS like_count, (SELECT count(*)::int FROM post_views pv WHERE pv.post_id = p.id) AS view_count,
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
    `SELECT domain FROM papers WHERE status = 'published' GROUP BY domain ORDER BY lower(domain), domain`
  )
  res.json(rows.map(({ domain }) => domain))
})

// Paper of the Day (PR #23): each day one published paper is featured, picked by the most likes and saves
// in the last 7 days among papers not featured before. An advisory lock stops two requests picking two papers.
const FEATURED_COLUMNS = `p.id, p.title, p.abstract, p.authors, p.domain, p.tags, p.doi, p.created_at, p.published_at,
  history.featured_date, submitter.name AS submitter_name,
  (SELECT count(*)::int FROM paper_likes l WHERE l.paper_id = p.id) AS like_count,
  (SELECT count(*)::int FROM paper_saves s WHERE s.paper_id = p.id) AS save_count`

async function getDailyFeaturedPaper(userId) {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    await client.query("SELECT pg_advisory_xact_lock(hashtext('snarp-paper-of-the-day'))")
    const featured = await client.query('SELECT paper_id FROM paper_of_the_day WHERE featured_date = CURRENT_DATE')
    if (!featured.rows[0]) {
      const candidate = await client.query(
        `SELECT p.id FROM papers p
         WHERE p.status = 'published'
           AND NOT EXISTS (SELECT 1 FROM paper_of_the_day history WHERE history.paper_id = p.id)
         ORDER BY
           (SELECT count(*) FROM paper_likes l WHERE l.paper_id = p.id AND l.created_at >= now() - interval '7 days') +
           (SELECT count(*) FROM paper_saves s WHERE s.paper_id = p.id AND s.created_at >= now() - interval '7 days') DESC,
           COALESCE(p.published_at, p.created_at) DESC, p.id ASC
         LIMIT 1`,
      )
      if (candidate.rows[0]) {
        await client.query('INSERT INTO paper_of_the_day (paper_id, featured_date) VALUES ($1, CURRENT_DATE) ON CONFLICT DO NOTHING', [candidate.rows[0].id])
      }
    }
    const { rows } = await client.query(
      `SELECT ${FEATURED_COLUMNS},
         EXISTS (SELECT 1 FROM paper_likes l WHERE l.paper_id = p.id AND l.user_id = $1) AS liked_by_me,
         EXISTS (SELECT 1 FROM paper_saves s WHERE s.paper_id = p.id AND s.user_id = $1) AS saved_by_me
       FROM paper_of_the_day history
       JOIN papers p ON p.id = history.paper_id
       JOIN users submitter ON submitter.id = p.user_id
       WHERE history.featured_date = CURRENT_DATE AND p.status = 'published'`,
      [userId],
    )
    await client.query('COMMIT')
    return rows[0] ?? null
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {})
    throw err
  } finally {
    client.release()
  }
}

app.get('/api/papers/featured', auth, async (req, res) => {
  res.json(await getDailyFeaturedPaper(req.userId))
})

app.get('/api/papers/past-picks', auth, async (_req, res) => {
  const { rows } = await pool.query(
    `SELECT ${FEATURED_COLUMNS}
     FROM paper_of_the_day history
     JOIN papers p ON p.id = history.paper_id
     JOIN users submitter ON submitter.id = p.user_id
     WHERE history.featured_date < CURRENT_DATE AND p.status = 'published'
     ORDER BY history.featured_date DESC LIMIT 30`,
  )
  res.json(rows)
})

app.get('/api/papers/trending-tags', auth, async (_req, res) => {
  const { rows } = await pool.query(
    `SELECT min(tag) AS tag, count(*)::int AS paper_count
     FROM papers p, unnest(p.tags) AS t(tag)
     WHERE p.status = 'published' AND COALESCE(p.published_at, p.created_at) > now() - interval '180 days'
     GROUP BY lower(tag) ORDER BY paper_count DESC, lower(tag) LIMIT 8`
  )
  res.json(rows)
})

const RECOMMEND_COLUMNS = `p.id, p.title, p.abstract, p.doi, p.domain, p.tags, p.authors, p.user_id,
  p.reviewed_at, p.published_at, p.created_at, u.name AS submitter_name,
  (SELECT count(*)::int FROM paper_likes pl WHERE pl.paper_id = p.id) AS like_count, (SELECT count(*)::int FROM paper_views pw WHERE pw.paper_id = p.id) AS view_count,
  (SELECT count(*)::int FROM paper_saves ps WHERE ps.paper_id = p.id) AS save_count`

const loadCandidates = async () => (await pool.query(
  `SELECT ${RECOMMEND_COLUMNS} FROM papers p JOIN users u ON u.id = p.user_id
   WHERE p.status = 'published' ORDER BY COALESCE(p.published_at, p.created_at) DESC LIMIT 500`
)).rows

async function loadInterestProfile(userId) {
  const [{ rows: profiles }, { rows: engaged }, { rows: follows }] = await Promise.all([
    pool.query('SELECT research_interests FROM user_profiles WHERE user_id = $1', [userId]),
    pool.query(
      `SELECT DISTINCT ON (p.id) p.id, p.title, p.domain, p.tags, e.kind
       FROM (
         SELECT id AS paper_id, 'own' AS kind, 1 AS rank FROM papers
           WHERE user_id = $1::int OR authors @> jsonb_build_array(jsonb_build_object('user_id', $1::int))
         UNION ALL SELECT paper_id, 'saved', 2 FROM paper_saves WHERE user_id = $1::int
         UNION ALL SELECT paper_id, 'liked', 3 FROM paper_likes WHERE user_id = $1::int
         UNION ALL SELECT paper_id, 'commented', 4 FROM paper_comments WHERE user_id = $1::int
       ) e JOIN papers p ON p.id = e.paper_id
       ORDER BY p.id, e.rank LIMIT 300`,
      [userId]
    ),
    pool.query('SELECT followee_id FROM follows WHERE follower_id = $1', [userId]),
  ])
  return {
    profile: buildProfile({
      interests: profiles[0]?.research_interests ?? [],
      engaged: engaged.map(({ kind, ...paper }) => ({ paper, kind })),
      followedIds: follows.map((row) => row.followee_id),
    }),
    seen: engaged.filter((row) => row.kind !== 'commented').map((row) => String(row.id)),
    hasInterests: (profiles[0]?.research_interests ?? []).length > 0,
  }
}

app.get('/api/papers/recommendations', auth, async (req, res) => {
  const limit = Math.max(1, Math.min(12, Number.parseInt(req.query.limit, 10) || 6))
  const [{ profile, seen, hasInterests }, candidates] = await Promise.all([loadInterestProfile(req.userId), loadCandidates()])
  res.json({
    personalised: !profile.empty,
    hasInterests,
    basedOn: topInterests(profile, 5),
    items: recommendPapers(profile, candidates, { exclude: seen, limit }),
    topics: relatedTopics(profile, candidates, { limit: 8 }),
  })
})

app.get('/api/search/suggest', auth, async (req, res) => {
  const q = String(req.query.q ?? '').trim().slice(0, 100)
  if (q.length < 2) return res.json({ topics: [], papers: [], people: [] })
  const pattern = `%${q.replace(/[\\%_]/g, '\\$&')}%`
  const [candidates, { rows: papers }, { rows: people }] = await Promise.all([
    loadCandidates(),
    pool.query(
      `SELECT p.id, p.title, p.domain FROM papers p
       WHERE p.status = 'published' AND (p.title ILIKE $1 OR array_to_string(p.tags, ' ') ILIKE $1)
       ORDER BY (p.title ILIKE $2) DESC, COALESCE(p.published_at, p.created_at) DESC LIMIT 4`,
      [pattern, `${q.replace(/[\\%_]/g, '\\$&')}%`]
    ),
    pool.query(
      `SELECT u.id, u.name, u.profile_image_id, COALESCE(up.institution, '') AS institution
       FROM users u LEFT JOIN user_profiles up ON up.user_id = u.id
       WHERE u.email_verified_at IS NOT NULL AND (u.name ILIKE $1 OR array_to_string(up.research_interests, ' ') ILIKE $1)
       ORDER BY (u.name ILIKE $2) DESC, u.name LIMIT 4`,
      [pattern, `${q.replace(/[\\%_]/g, '\\$&')}%`]
    ),
  ])
  res.json({
    topics: suggestTopics(q, candidates, { limit: 5 }),
    papers,
    people: people.map(({ profile_image_id, ...person }) => ({ ...person, avatar_url: profile_image_id ? `/api/images/${profile_image_id}` : null })),
  })
})

app.get('/api/papers/:id/related', auth, async (req, res) => {
  if (!isPgBigId(req.params.id)) return res.status(404).json({ error: 'Paper not found' })
  const { rows } = await pool.query(
    `SELECT ${RECOMMEND_COLUMNS} FROM papers p JOIN users u ON u.id = p.user_id WHERE p.id = $1 AND p.status = 'published'`,
    [req.params.id]
  )
  if (!rows[0]) return res.status(404).json({ error: 'Paper not found' })
  res.json(similarPapers(rows[0], await loadCandidates(), { limit: 4 }))
})

app.get('/api/papers/saved', auth, async (req, res) => {
  const { rows } = await pool.query(
    `SELECT p.id, p.title, p.abstract, p.doi, p.domain, p.tags, p.authors, p.user_id, p.reviewed_at, p.published_at, p.created_at,
       u.name AS submitter_name, ps.created_at AS saved_at
     FROM paper_saves ps JOIN papers p ON p.id = ps.paper_id JOIN users u ON u.id = p.user_id
     WHERE ps.user_id = $1 AND p.status = 'published'
     ORDER BY ps.created_at DESC LIMIT 200`,
    [req.userId]
  )
  res.json(rows)
})

app.get('/api/papers/my-submissions', auth, async (req, res) => {
  const { rows } = await pool.query(`
    SELECT papers.id, title, abstract, doi, domain, tags, authors, pdf_filename, pdf_size,
      status, rejection_reason, revision_note, round, resubmitted_at, reviewed_at, published_at, papers.created_at,
      papers.user_id <> $1 AS coauthored, submitter.name AS submitter_name,
      (SELECT count(*)::int FROM peer_reviews r WHERE r.paper_id = papers.id AND r.round = papers.round) AS review_count,
      (SELECT count(*)::int FROM jsonb_array_elements(papers.authors) WITH ORDINALITY AS a(v, i) WHERE i > 1 AND v ? 'user_id') AS coauthor_count,
      (SELECT count(*)::int FROM coauthor_checks c WHERE c.paper_id = papers.id AND c.round = papers.round
        AND c.draft = papers.draft AND c.decision = 'approve') AS coauthor_approvals,
      (SELECT c.decision FROM coauthor_checks c WHERE c.paper_id = papers.id AND c.round = papers.round
        AND c.draft = papers.draft AND c.user_id = $1) AS my_check
    FROM papers JOIN users submitter ON submitter.id = papers.user_id
    WHERE papers.user_id = $1 OR papers.authors @> jsonb_build_array(jsonb_build_object('user_id', $1::int))
    ORDER BY COALESCE(resubmitted_at, papers.created_at) DESC`, [req.userId])
  res.json(rows)
})

// Papers matching the viewer's saved research interests, with a score and the matching signals.
app.get('/api/papers/interest-matches', auth, async (req, res) => {
  const profile = await pool.query('SELECT research_interests FROM user_profiles WHERE user_id = $1', [req.userId])
  const interests = profile.rows[0]?.research_interests ?? []
  if (!interests.length) return res.json([])

  const { rows } = await pool.query(`
    SELECT p.id, p.user_id, p.status, p.title, p.abstract, p.domain, p.tags, p.authors, p.doi,
      p.publication_date::text AS publication_date,
      p.reviewed_at, p.published_at, p.created_at
    FROM papers p
    WHERE p.status = 'published'
      AND p.user_id <> $1
      AND EXISTS (
        SELECT 1
        FROM unnest($2::text[]) AS user_interest(interest)
        WHERE trim(user_interest.interest) <> ''
          AND (
            EXISTS (
              SELECT 1
              FROM unnest(COALESCE(p.tags, '{}'::text[])) AS paper_tag(tag)
              WHERE lower(trim(paper_tag.tag)) = lower(trim(user_interest.interest))
            )
            OR position(lower(trim(user_interest.interest)) IN lower(p.domain)) > 0
            OR position(lower(trim(user_interest.interest)) IN lower(p.title)) > 0
            OR position(lower(trim(user_interest.interest)) IN lower(p.abstract)) > 0
          )
      )
    ORDER BY COALESCE(p.publication_date, p.published_at::date, p.created_at::date) DESC, p.id DESC
    LIMIT 200`, [req.userId, interests])
  res.json(rankRecommendations(rows, interests, req.userId))
})

app.get('/api/papers/:id', auth, async (req, res) => {
  if (!isSafeId(req.params.id)) return res.status(404).json({ error: 'Paper not found' })
  const { rows } = await pool.query(
    `SELECT p.id, p.title, p.abstract, p.doi, p.domain, p.tags, p.authors,
      p.publication_date::text AS publication_date, p.reviewed_at, p.published_at, p.created_at, p.user_id, u.name AS submitter_name, p.round, p.pdf_filename, p.pdf_size,
      (SELECT count(DISTINCT r.reviewer_id)::int FROM peer_reviews r WHERE r.paper_id = p.id) AS reviewer_count,
      (SELECT round(avg(r.overall_rating), 1)::float FROM peer_reviews r WHERE r.paper_id = p.id AND r.round = p.round) AS avg_rating,
      (SELECT count(*)::int FROM paper_likes pl WHERE pl.paper_id = p.id) AS like_count, (SELECT count(*)::int FROM paper_views pw WHERE pw.paper_id = p.id) AS view_count,
      EXISTS (SELECT 1 FROM paper_likes pl WHERE pl.paper_id = p.id AND pl.user_id = $2) AS liked_by_me,
      (SELECT count(*)::int FROM paper_comments pc WHERE pc.paper_id = p.id) AS comment_count,
      EXISTS (SELECT 1 FROM paper_saves ps WHERE ps.paper_id = p.id AND ps.user_id = $2) AS saved_by_me
     FROM papers p JOIN users u ON u.id = p.user_id
     WHERE p.id = $1 AND p.status = 'published'`,
    [req.params.id, req.userId]
  )
  if (!rows[0]) return res.status(404).json({ error: 'Paper not found' })
  res.json(rows[0])
})

const approvedPaperExists = async (id) => (await pool.query("SELECT 1 FROM papers WHERE id = $1 AND status = 'published'", [id])).rowCount > 0

app.put('/api/papers/:id/like', auth, async (req, res) => {
  if (!isPgBigId(req.params.id)) return res.status(404).json({ error: 'Paper not found' })
  if (typeof req.body?.liked !== 'boolean') return res.status(400).json({ error: 'liked must be true or false' })
  if (!await approvedPaperExists(req.params.id)) return res.status(404).json({ error: 'Paper not found' })
  if (req.body.liked) {
    await pool.query(`WITH inserted AS (
        INSERT INTO paper_likes (paper_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING RETURNING paper_id, user_id
      ), notified AS (
        INSERT INTO notifications (user_id, actor_id, kind, entity_type, entity_id, text)
        SELECT p.user_id, inserted.user_id, 'paper_like', 'paper', p.id, actor.name || ' liked your paper "' || left(p.title, 80) || '"'
        FROM inserted JOIN papers p ON p.id = inserted.paper_id JOIN users actor ON actor.id = inserted.user_id
        WHERE p.user_id <> inserted.user_id RETURNING id
      ) SELECT 1 FROM inserted`, [req.params.id, req.userId])
  } else {
    await pool.query('DELETE FROM paper_likes WHERE paper_id = $1 AND user_id = $2', [req.params.id, req.userId])
  }
  const { rows } = await pool.query(
    `SELECT count(*)::int AS like_count, EXISTS (
       SELECT 1 FROM paper_likes WHERE paper_id = $1 AND user_id = $2
     ) AS liked_by_me FROM paper_likes WHERE paper_id = $1`,
    [req.params.id, req.userId]
  )
  res.json(rows[0])
})

app.put('/api/papers/:id/save', auth, async (req, res) => {
  if (!isPgBigId(req.params.id)) return res.status(404).json({ error: 'Paper not found' })
  if (typeof req.body?.saved !== 'boolean') return res.status(400).json({ error: 'saved must be true or false' })
  if (!await approvedPaperExists(req.params.id)) return res.status(404).json({ error: 'Paper not found' })
  if (req.body.saved) {
    await pool.query('INSERT INTO paper_saves (user_id, paper_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [req.userId, req.params.id])
  } else {
    await pool.query('DELETE FROM paper_saves WHERE user_id = $1 AND paper_id = $2', [req.userId, req.params.id])
  }
  res.json({ saved_by_me: req.body.saved })
})

const PAPER_COMMENT_COLUMNS = `c.id, c.paper_id, c.user_id, c.body, c.created_at,
  u.name AS author_name, CASE WHEN u.role = 'admin' THEN 'author' ELSE u.role END AS author_role, CASE WHEN u.profile_image_id IS NULL THEN NULL ELSE '/api/images/' || u.profile_image_id::text END AS author_avatar_url`

app.get('/api/papers/:id/comments', auth, async (req, res) => {
  if (!isPgBigId(req.params.id)) return res.status(404).json({ error: 'Paper not found' })
  if (!await approvedPaperExists(req.params.id)) return res.status(404).json({ error: 'Paper not found' })
  const { rows } = await pool.query(
    `SELECT * FROM (
       SELECT ${PAPER_COMMENT_COLUMNS} FROM paper_comments c JOIN users u ON u.id = c.user_id
       WHERE c.paper_id = $1 ORDER BY c.created_at DESC, c.id DESC LIMIT 100
     ) recent ORDER BY created_at, id`,
    [req.params.id]
  )
  res.json(rows)
})

app.post('/api/papers/:id/comments', auth, writeLimiter, async (req, res) => {
  if (!isPgBigId(req.params.id)) return res.status(404).json({ error: 'Paper not found' })
  const body = typeof req.body?.body === 'string' ? req.body.body.trim() : ''
  if (!body || body.length > 2000) return res.status(400).json({ error: 'Comment must be 1-2,000 characters', field: 'body' })
  const { rows } = await pool.query(`WITH inserted AS (
      INSERT INTO paper_comments (paper_id, user_id, body)
      SELECT $1, $2, $3 WHERE EXISTS (SELECT 1 FROM papers WHERE id = $1 AND status = 'published')
      RETURNING id, paper_id, user_id
    ), notified AS (
      INSERT INTO notifications (user_id, actor_id, kind, entity_type, entity_id, text)
      SELECT p.user_id, inserted.user_id, 'paper_comment', 'paper', p.id, actor.name || ' commented on your paper "' || left(p.title, 80) || '"'
      FROM inserted JOIN papers p ON p.id = inserted.paper_id JOIN users actor ON actor.id = inserted.user_id
      WHERE p.user_id <> inserted.user_id RETURNING id
    ) SELECT id FROM inserted`, [req.params.id, req.userId, body])
  if (!rows[0]) return res.status(404).json({ error: 'Paper not found' })
  const comment = await pool.query(
    `SELECT ${PAPER_COMMENT_COLUMNS} FROM paper_comments c JOIN users u ON u.id = c.user_id WHERE c.id = $1`,
    [rows[0].id]
  )
  res.status(201).json(comment.rows[0])
})

app.delete('/api/paper-comments/:id', auth, async (req, res) => {
  if (!isSafeId(req.params.id)) return res.status(404).json({ error: 'Comment not found' })
  const { rows } = await pool.query(
    `WITH d AS (
       DELETE FROM paper_comments c USING papers p
       WHERE c.id = $1 AND p.id = c.paper_id AND (c.user_id = $2 OR p.user_id = $2 OR $3)
       RETURNING c.id, c.paper_id, c.user_id, p.user_id AS submitter_id
     ), logged AS (
       INSERT INTO audit_logs (actor_id, action, target_type, target_id, details)
       SELECT $2, 'paper_comment.remove', 'paper_comment', d.id::text, jsonb_build_object('paperId', d.paper_id, 'authorId', d.user_id)
       FROM d WHERE d.user_id <> $2 AND d.submitter_id <> $2
     )
     SELECT count(*)::int AS n FROM d`,
    [req.params.id, req.userId, isModerator(req)]
  )
  if (!rows[0].n) return res.status(404).json({ error: 'Comment not found' })
  res.status(204).end()
})

app.post('/api/posts', auth, writeLimiter, upload.single('image'), async (req, res) => {
  const body = String(req.body?.body ?? '').trim()
  const mime = req.file && sniffImage(req.file.buffer)
  if (req.file && !mime) return res.status(400).json({ error: 'Image must be a JPEG, PNG, GIF or WebP file' })
  if (!body && !req.file) return res.status(400).json({ error: 'Write something or add an image' })
  if (body.length > 5000) return res.status(400).json({ error: 'Post must be under 5000 characters' })

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

const STORY_SELECT = `SELECT s.id, s.user_id, s.kind, s.audience, s.caption, s.created_at, s.expires_at, s.clip_start, s.clip_end, s.part, s.parts, s.background, s.overlay,
    '/api/images/' || s.image_id::text AS image_url, '/api/story-media/' || s.media_id::text AS media_url,
    u.name, CASE WHEN u.profile_image_id IS NULL THEN NULL ELSE '/api/images/' || u.profile_image_id::text END AS avatar_url,
    EXISTS (SELECT 1 FROM story_views v WHERE v.story_id = s.id AND v.viewer_id = $1) AS seen,
    CASE WHEN s.user_id = $1 THEN (SELECT count(*)::int FROM story_views v WHERE v.story_id = s.id AND v.viewer_id <> s.user_id) END AS view_count
  FROM stories s JOIN users u ON u.id = s.user_id`
const STORY_VISIBLE = `s.expires_at > now() AND u.blocked_at IS NULL
  AND (s.user_id = $1 OR (EXISTS (SELECT 1 FROM follows f WHERE f.follower_id = $1 AND f.followee_id = s.user_id)
    AND (s.audience = 'followers' OR EXISTS (SELECT 1 FROM follows back WHERE back.follower_id = s.user_id AND back.followee_id = $1))))`
const storyUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: STORY_VIDEO_MAX_BYTES, files: 1, fields: 10, fieldSize: 64 * 1024 } })

app.get('/api/stories', auth, async (req, res) => {
  const { rows } = await pool.query(`${STORY_SELECT} WHERE ${STORY_VISIBLE} ORDER BY s.created_at DESC, s.part NULLS FIRST LIMIT 300`, [req.userId])
  res.json(groupStories(rows, req.userId))
})

app.post('/api/stories', auth, writeLimiter, (req, res, next) => storyUpload.single('media')(req, res, (err) => {
  if (err?.code === 'LIMIT_FILE_SIZE') return res.status(413).json({ error: 'Videos must be 40 MB or smaller and photos 5 MB or smaller', field: 'media' })
  return next(err)
}), async (req, res) => {
  const kind = String(req.body?.kind ?? (req.file ? 'image' : ''))
  if (!STORY_KINDS.includes(kind)) return res.status(400).json({ error: 'Choose a photo or video, or write some text' })
  const overlay = parseOverlay(req.body?.overlay)
  if (overlay.error) return res.status(400).json({ error: overlay.error, field: 'overlay' })
  const audience = req.body?.audience === undefined || req.body.audience === '' ? 'followers' : String(req.body.audience)
  if (!['followers', 'friends'].includes(audience)) return res.status(400).json({ error: 'Choose who can see your story', field: 'audience' })

  let mime = null
  let parts = [null]
  let background = null
  if (kind === 'text') {
    background = String(req.body?.background ?? '')
    if (!STORY_BACKGROUNDS.includes(background)) return res.status(400).json({ error: 'Choose a background for your text story' })
    if (!overlay.layers.length) return res.status(400).json({ error: 'Write something for your text story' })
  } else {
    if (!req.file) return res.status(400).json({ error: kind === 'video' ? 'Choose a video for your story' : 'Choose a photo for your story', field: 'media' })
    if (kind === 'image') {
      mime = sniffImage(req.file.buffer)
      if (!mime) return res.status(400).json({ error: 'Photo must be a JPEG, PNG, GIF or WebP image', field: 'media' })
      if (req.file.size > STORY_IMAGE_MAX_BYTES) return res.status(413).json({ error: 'Photos must be 5 MB or smaller', field: 'media' })
    } else {
      mime = sniffVideo(req.file.buffer)
      if (!mime) return res.status(400).json({ error: 'Video must be an MP4, MOV or WebM file', field: 'media' })
      const reported = Number(req.body?.duration)
      const duration = (mime === 'video/webm' ? null : mp4Duration(req.file.buffer)) ?? (Number.isFinite(reported) && reported > 0 ? reported : null)
      if (!duration) return res.status(400).json({ error: 'This video could not be read. Try another one.', field: 'media' })
      if (duration > STORY_VIDEO_MAX_SECONDS + 0.5) return res.status(400).json({ error: `Videos can be up to ${STORY_VIDEO_MAX_SECONDS} seconds long`, field: 'media' })
      parts = splitVideo(Math.min(duration, STORY_VIDEO_MAX_SECONDS))
    }
  }

  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    let mentioned = []
    if (overlay.mentionIds.length) {
      const friends = await client.query(
        `SELECT u.id, u.name FROM users u
         WHERE u.id = ANY($2::int[]) AND u.blocked_at IS NULL
           AND EXISTS (SELECT 1 FROM follows a WHERE a.follower_id = $1 AND a.followee_id = u.id)
           AND EXISTS (SELECT 1 FROM follows b WHERE b.follower_id = u.id AND b.followee_id = $1)`,
        [req.userId, overlay.mentionIds]
      )
      if (friends.rows.length !== overlay.mentionIds.length) {
        await client.query('ROLLBACK')
        return res.status(400).json({ error: 'You can only mention friends: people you follow who follow you back', field: 'overlay' })
      }
      mentioned = friends.rows
    }
    const names = new Map(mentioned.map((friend) => [friend.id, friend.name]))
    const layers = overlay.layers.map((layer) => (layer.type === 'mention' ? { ...layer, name: names.get(layer.user_id) } : layer))

    const active = await client.query('SELECT count(*)::int AS n FROM stories WHERE user_id = $1 AND expires_at > now()', [req.userId])
    if (active.rows[0].n + parts.length > STORY_ACTIVE_LIMIT) {
      await client.query('ROLLBACK')
      const left = Math.max(0, STORY_ACTIVE_LIMIT - active.rows[0].n)
      return res.status(400).json({
        error: parts.length > 1
          ? `This video makes ${parts.length} stories but you have room for ${left}. You can have ${STORY_ACTIVE_LIMIT} stories at a time.`
          : `You can have ${STORY_ACTIVE_LIMIT} stories at a time. Delete one or wait for it to expire.`,
      })
    }

    let imageId = null
    let mediaId = null
    if (kind === 'image') {
      imageId = (await client.query('INSERT INTO images (user_id, mime, data) VALUES ($1, $2, $3) RETURNING id', [req.userId, mime, req.file.buffer])).rows[0].id
    } else if (kind === 'video') {
      mediaId = (await client.query('INSERT INTO story_media (user_id, mime, data, duration) VALUES ($1, $2, $3, $4) RETURNING id',
        [req.userId, mime, req.file.buffer, parts[parts.length - 1].end])).rows[0].id
    }
    const ids = []
    for (const [index, part] of parts.entries()) {
      const { rows } = await client.query(
        `INSERT INTO stories (user_id, kind, image_id, media_id, clip_start, clip_end, part, parts, background, overlay, audience)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb, $11) RETURNING id`,
        [req.userId, kind, imageId, mediaId, part?.start ?? null, part?.end ?? null, part ? index + 1 : null, part ? parts.length : null, background, JSON.stringify(layers), audience]
      )
      ids.push(rows[0].id)
    }
    if (mentioned.length) {
      await client.query('INSERT INTO story_mentions (story_id, user_id) SELECT $1::bigint, unnest($2::int[]) ON CONFLICT DO NOTHING', [ids[0], mentioned.map((friend) => friend.id)])
      await client.query(
        `INSERT INTO notifications (user_id, actor_id, kind, entity_type, entity_id, text)
         SELECT unnest($2::int[]), actor.id, 'story_mention', 'story', actor.id, actor.name || ' mentioned you in their story'
         FROM users actor WHERE actor.id = $1::int`,
        [req.userId, mentioned.map((friend) => friend.id)]
      )
    }
    await client.query('COMMIT')
    const created = await pool.query(`${STORY_SELECT} WHERE s.id = ANY($2::bigint[])`, [req.userId, ids])
    res.status(201).json({ items: groupStories(created.rows, req.userId)[0]?.items ?? [] })
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {})
    throw err
  } finally {
    client.release()
  }
})

// Video bytes for stories. Supports byte ranges so browsers can stream and seek to each 15 second part.
app.get('/api/story-media/:id', async (req, res) => {
  if (!/^[0-9a-f-]{36}$/i.test(req.params.id)) return res.status(404).end()
  const { rows } = await pool.query('SELECT mime, octet_length(data)::bigint AS size FROM story_media WHERE id = $1', [req.params.id])
  if (!rows[0]) return res.status(404).end()
  const size = Number(rows[0].size)
  const headers = { 'Content-Type': rows[0].mime, 'Accept-Ranges': 'bytes', 'Cache-Control': 'private, max-age=86400', 'Cross-Origin-Resource-Policy': 'same-origin' }
  const match = /^bytes=(\d*)-(\d*)$/.exec(String(req.headers.range ?? '').trim())
  let start = 0
  let end = size - 1
  if (match && (match[1] || match[2])) {
    if (match[1] === '') start = Math.max(0, size - Number(match[2]))
    else {
      start = Number(match[1])
      if (match[2]) end = Math.min(Number(match[2]), size - 1)
    }
    if (start > end || start >= size) return res.status(416).set({ ...headers, 'Content-Range': `bytes */${size}` }).end()
    end = Math.min(end, start + 4 * 1024 * 1024 - 1)
  }
  const length = end - start + 1
  const chunk = await pool.query('SELECT substring(data FROM $2 FOR $3) AS bytes FROM story_media WHERE id = $1', [req.params.id, start + 1, length])
  if (!chunk.rows[0]) return res.status(404).end()
  res.status(match && (match[1] || match[2]) ? 206 : 200).set({
    ...headers,
    'Content-Length': String(length),
    ...(match && (match[1] || match[2]) ? { 'Content-Range': `bytes ${start}-${end}/${size}` } : {}),
  }).end(chunk.rows[0].bytes)
})

app.get('/api/stories/:id/viewers', auth, async (req, res) => {
  if (!/^\d{1,18}$/.test(req.params.id)) return res.status(404).json({ error: 'Story not found' })
  const story = await pool.query('SELECT user_id FROM stories WHERE id = $1', [req.params.id])
  if (!story.rows[0] || String(story.rows[0].user_id) !== String(req.userId)) return res.status(404).json({ error: 'Story not found' })
  const { rows } = await pool.query(
    `SELECT u.id, u.name, v.viewed_at,
       CASE WHEN u.profile_image_id IS NULL THEN NULL ELSE '/api/images/' || u.profile_image_id::text END AS avatar_url,
       EXISTS (SELECT 1 FROM follows f WHERE f.follower_id = $2 AND f.followee_id = u.id) AS followed_by_me
     FROM story_views v JOIN users u ON u.id = v.viewer_id
     WHERE v.story_id = $1 AND v.viewer_id <> $2 AND u.blocked_at IS NULL
     ORDER BY v.viewed_at DESC LIMIT 500`,
    [req.params.id, req.userId],
  )
  res.json(rows)
})

// Changes who can see a story; all parts of a split video change together.
app.put('/api/stories/:id/audience', auth, writeLimiter, async (req, res) => {
  if (!/^\d{1,18}$/.test(req.params.id)) return res.status(404).json({ error: 'Story not found' })
  const audience = String(req.body?.audience ?? '')
  if (!['followers', 'friends'].includes(audience)) return res.status(400).json({ error: 'Choose who can see your story', field: 'audience' })
  const { rows } = await pool.query(
    `UPDATE stories s SET audience = $3
     FROM stories target
     WHERE target.id = $1 AND target.user_id = $2 AND s.user_id = $2
       AND (s.id = target.id OR (target.media_id IS NOT NULL AND s.media_id = target.media_id))
     RETURNING s.id`,
    [req.params.id, req.userId, audience],
  )
  if (!rows.length) return res.status(404).json({ error: 'Story not found' })
  res.json({ audience, ids: rows.map((row) => String(row.id)) })
})

app.post('/api/stories/:id/view', auth, async (req, res) => {
  if (!/^\d{1,18}$/.test(req.params.id)) return res.status(404).json({ error: 'Story not found' })
  const { rowCount } = await pool.query(
    `INSERT INTO story_views (story_id, viewer_id)
     SELECT s.id, $1 FROM stories s JOIN users u ON u.id = s.user_id WHERE s.id = $2 AND ${STORY_VISIBLE}
     ON CONFLICT DO NOTHING`,
    [req.userId, req.params.id]
  )
  const exists = rowCount || (await pool.query('SELECT 1 FROM story_views WHERE story_id = $1 AND viewer_id = $2', [req.params.id, req.userId])).rowCount
  if (!exists) return res.status(404).json({ error: 'Story not found' })
  res.status(204).end()
})

const removeUnusedStoryMedia = (db) => db.query(
  `DELETE FROM story_media m WHERE m.created_at < now() - interval '10 minutes' AND NOT EXISTS (SELECT 1 FROM stories s WHERE s.media_id = m.id)`
)

app.delete('/api/stories/:id', auth, async (req, res) => {
  if (!/^\d{1,18}$/.test(req.params.id)) return res.status(404).json({ error: 'Story not found' })
  const { rows } = await pool.query(
    `WITH gone AS (DELETE FROM stories WHERE id = $1 AND user_id = $2 RETURNING image_id, media_id),
     images_gone AS (DELETE FROM images WHERE id IN (SELECT image_id FROM gone WHERE image_id IS NOT NULL))
     SELECT media_id FROM gone`,
    [req.params.id, req.userId]
  )
  if (!rows[0]) return res.status(404).json({ error: 'Story not found' })
  if (rows[0].media_id) {
    await pool.query('DELETE FROM story_media m WHERE m.id = $1 AND NOT EXISTS (SELECT 1 FROM stories s WHERE s.media_id = m.id)', [rows[0].media_id])
  }
  res.status(204).end()
})

const removeExpiredStories = () => pool.query(
  `WITH gone AS (DELETE FROM stories WHERE expires_at < now() - interval '1 hour' RETURNING image_id)
   DELETE FROM images WHERE id IN (SELECT image_id FROM gone WHERE image_id IS NOT NULL)`
).then(() => removeUnusedStoryMedia(pool))
  .catch((err) => log('error', 'story_cleanup_failed', { code: err.code ?? 'unknown' }))
setInterval(removeExpiredStories, 60 * 60 * 1000).unref()

// Reels: short vertical videos. Browsers upload the file straight to ImageKit with a short-lived signature,
// then publish it here; the server re-reads the file from ImageKit and only trusts what ImageKit reports.
const REEL_PAGE = 8
const REEL_COLUMNS = `r.id, r.user_id, r.caption, r.video_url, r.mime, r.duration, r.width, r.height,
  CASE WHEN r.cover_image_id IS NULL THEN r.thumbnail_url ELSE '/api/images/' || r.cover_image_id::text END AS thumbnail_url,
  r.trim_start, r.trim_end, r.crop, r.filter, r.audio_muted, r.hide_counts, r.comments_off, r.alt_text, r.location,
  CASE WHEN r.user_id = $1 THEN r.view_count END AS view_count, r.created_at, u.name AS author_name,
  CASE WHEN u.profile_image_id IS NULL THEN NULL ELSE '/api/images/' || u.profile_image_id::text END AS author_avatar_url,
  CASE WHEN r.hide_counts AND r.user_id <> $1 THEN NULL
    ELSE (SELECT count(*)::int FROM reel_likes l WHERE l.reel_id = r.id) END AS like_count,
  EXISTS (SELECT 1 FROM reel_likes l WHERE l.reel_id = r.id AND l.user_id = $1) AS liked_by_me,
  (SELECT count(*)::int FROM reel_comments c WHERE c.reel_id = r.id) AS comment_count,
  EXISTS (SELECT 1 FROM reel_saves s WHERE s.reel_id = r.id AND s.user_id = $1) AS saved_by_me,
  EXISTS (SELECT 1 FROM follows f WHERE f.follower_id = $1 AND f.followee_id = r.user_id) AS following_author,
  COALESCE((SELECT json_agg(json_build_object('id', tu.id, 'name', tu.name) ORDER BY lower(tu.name))
    FROM reel_tags t JOIN users tu ON tu.id = t.user_id WHERE t.reel_id = r.id AND tu.blocked_at IS NULL), '[]') AS tags`
const REEL_COMMENT_COLUMNS = `c.id, c.reel_id, c.user_id, c.body, c.created_at, u.name AS author_name,
  CASE WHEN u.profile_image_id IS NULL THEN NULL ELSE '/api/images/' || u.profile_image_id::text END AS author_avatar_url`
const reelsOff = (res) => res.status(503).json({ error: 'Reels uploads are not set up on this server yet' })

const removeReelFile = async (fileId) => {
  if (!IMAGEKIT) return
  try {
    if (await deleteFile(IMAGEKIT, fileId)) return
  } catch { /* retried below */ }
  await pool.query('INSERT INTO reel_file_trash (file_id) VALUES ($1) ON CONFLICT DO NOTHING', [fileId])
}

app.get('/api/reels/config', auth, (_req, res) => {
  res.json({ enabled: !!IMAGEKIT, max_bytes: 100 * 1024 * 1024, max_seconds: 180 })
})

app.get('/api/reels/upload-auth', auth, writeLimiter, (_req, res) => {
  if (!IMAGEKIT) return reelsOff(res)
  res.set('Cache-Control', 'no-store').json(uploadAuth(IMAGEKIT))
})

app.get('/api/reels', auth, async (req, res) => {
  const values = [req.userId]
  const where = ['u.blocked_at IS NULL']
  const userId = typeof req.query.user === 'string' && isPgId(req.query.user) ? req.query.user : null
  if (userId) where.push(`r.user_id = $${values.push(userId)}`)
  if (req.query.saved === '1') where.push('EXISTS (SELECT 1 FROM reel_saves s WHERE s.reel_id = r.id AND s.user_id = $1)')
  const first = typeof req.query.first === 'string' && isPgBigId(req.query.first) ? req.query.first : null
  if (first) where.push(`r.id <> $${values.push(first)}`)
  const cursor = typeof req.query.after === 'string' ? /^(\d{4}-\d\d-\d\dT[\d:.]+Z)_(\d{1,18})$/.exec(req.query.after) : null
  if (cursor && !Number.isNaN(Date.parse(cursor[1]))) {
    where.push(`(r.created_at, r.id) < ($${values.push(cursor[1])}::timestamptz, $${values.push(cursor[2])}::bigint)`)
  }
  const { rows } = await pool.query(
    `SELECT ${REEL_COLUMNS} FROM reels r JOIN users u ON u.id = r.user_id
     WHERE ${where.join(' AND ')} ORDER BY r.created_at DESC, r.id DESC LIMIT ${REEL_PAGE + 1}`,
    values,
  )
  const items = rows.slice(0, REEL_PAGE)
  if (first && !cursor) {
    const pinned = await pool.query(
      `SELECT ${REEL_COLUMNS} FROM reels r JOIN users u ON u.id = r.user_id WHERE r.id = $2 AND u.blocked_at IS NULL`,
      [req.userId, first],
    )
    if (pinned.rows[0]) items.unshift(pinned.rows[0])
  }
  const last = rows.length > REEL_PAGE ? rows[REEL_PAGE - 1] : null
  res.json({ items, next: last ? `${new Date(last.created_at).toISOString()}_${last.id}` : null })
})

const reelForm = multer({ storage: multer.memoryStorage(), limits: { fileSize: 2 * 1024 * 1024, files: 1, fields: 30 } })
const reelOne = (viewerId, id) => pool.query(`SELECT ${REEL_COLUMNS} FROM reels r JOIN users u ON u.id = r.user_id WHERE r.id = $2`, [viewerId, id])

app.post('/api/reels', auth, writeLimiter, (req, res, next) => reelForm.single('cover')(req, res, (err) => {
  if (err) return res.status(400).json({ error: err.code === 'LIMIT_FILE_SIZE' ? 'The cover photo must be 2 MB or smaller' : 'The reel could not be read', field: 'cover' })
  next()
}), async (req, res) => {
  if (!IMAGEKIT) return reelsOff(res)
  const fileId = req.body?.fileId
  const caption = typeof req.body?.caption === 'string' ? req.body.caption.replace(/\r\n?/g, '\n').trim() : ''
  const captionError = reelCaptionProblem(req.body?.caption)
  if (captionError) return res.status(400).json({ error: captionError, field: 'caption' })
  if (!isFileId(fileId)) return res.status(400).json({ error: 'Upload the video first' })
  const coverMime = req.file ? sniffImage(req.file.buffer) : null
  if (req.file && !['image/jpeg', 'image/png', 'image/webp'].includes(coverMime)) return res.status(400).json({ error: 'The cover photo must be a JPEG, PNG or WebP image', field: 'cover' })
  let file
  try { file = await fileDetails(IMAGEKIT, fileId) } catch (err) {
    log('error', 'reel_details_failed', { message: err.message })
    return res.status(502).json({ error: 'Could not reach the video service. Please try again.' })
  }
  const problem = reelFileProblem(file, IMAGEKIT)
  if (problem) {
    if (typeof file?.filePath === 'string' && file.filePath.startsWith(`${REEL_FOLDER}/`)) await removeReelFile(fileId)
    return res.status(400).json({ error: problem })
  }
  const duration = Number.isFinite(file.duration) && file.duration > 0 ? file.duration : null
  const parsed = parseReelOptions(req.body, duration)
  if (parsed.error) return res.status(400).json({ error: parsed.error, field: parsed.field })
  const options = parsed.value
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    let tagged = []
    if (options.tags.length) {
      tagged = (await client.query('SELECT id FROM users WHERE id = ANY($1::int[]) AND id <> $2 AND blocked_at IS NULL', [options.tags, req.userId])).rows.map((row) => row.id)
    }
    const cover = req.file
      ? (await client.query('INSERT INTO images (user_id, mime, data) VALUES ($1, $2, $3) RETURNING id', [req.userId, coverMime, req.file.buffer])).rows[0].id
      : null
    // Serve the original upload: plain ImageKit video URLs go through its video processing, which has a
    // monthly quota and returns 403 once it is used up. Crop, trim and filters are applied by the player instead.
    const videoUrl = `${IMAGEKIT.endpoint}/tr:orig-true${file.url.slice(IMAGEKIT.endpoint.length).split('?')[0]}`
    const { rows } = await client.query(
      `INSERT INTO reels (user_id, caption, file_id, video_url, mime, file_size, duration, width, height, cover_image_id,
         trim_start, trim_end, crop, filter, audio_muted, hide_counts, comments_off, alt_text, location)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13::jsonb, $14, $15, $16, $17, $18, $19) RETURNING id`,
      [req.userId, caption, fileId, videoUrl, file.mime, file.size, duration,
        Number.isSafeInteger(file.width) ? file.width : null, Number.isSafeInteger(file.height) ? file.height : null, cover,
        options.trimStart, options.trimEnd, JSON.stringify(options.crop), options.filter, options.audioMuted,
        options.hideCounts, options.commentsOff, options.altText, options.location],
    )
    const reelId = rows[0].id
    if (tagged.length) {
      await client.query('INSERT INTO reel_tags (reel_id, user_id) SELECT $1::bigint, unnest($2::int[]) ON CONFLICT DO NOTHING', [reelId, tagged])
      await client.query(
        `INSERT INTO notifications (user_id, actor_id, kind, entity_type, entity_id, text)
         SELECT unnest($2::int[]), actor.id, 'reel_tag', 'reel', $3::bigint, actor.name || ' tagged you in their reel'
         FROM users actor WHERE actor.id = $1::int`,
        [req.userId, tagged, reelId],
      )
    }
    await client.query('COMMIT')
    res.status(201).json((await reelOne(req.userId, reelId)).rows[0])
  } catch (err) {
    await client.query('ROLLBACK')
    if (err.code === '23505') return res.status(409).json({ error: 'This video is already shared as a reel' })
    throw err
  } finally {
    client.release()
  }
})

app.patch('/api/reels/:id', auth, writeLimiter, async (req, res) => {
  if (!isPgBigId(req.params.id)) return res.status(404).json({ error: 'Reel not found' })
  const parsed = parseReelSettings(req.body ?? {})
  if (parsed.error) return res.status(400).json({ error: parsed.error, field: parsed.field })
  const sets = []
  const values = [req.params.id, req.userId]
  if (req.body?.caption !== undefined) {
    const captionError = reelCaptionProblem(req.body.caption)
    if (captionError) return res.status(400).json({ error: captionError, field: 'caption' })
    sets.push(`caption = $${values.push(String(req.body.caption).replace(/\r\n?/g, '\n').trim())}`)
  }
  const columns = { altText: 'alt_text', location: 'location', hideCounts: 'hide_counts', commentsOff: 'comments_off' }
  for (const [key, column] of Object.entries(columns)) if (key in parsed.value) sets.push(`${column} = $${values.push(parsed.value[key])}`)
  if (!sets.length) return res.status(400).json({ error: 'Nothing to change' })
  const { rowCount } = await pool.query(`UPDATE reels SET ${sets.join(', ')} WHERE id = $1 AND user_id = $2`, values)
  if (!rowCount) return res.status(404).json({ error: 'Reel not found' })
  res.json((await reelOne(req.userId, req.params.id)).rows[0])
})

app.post('/api/reels/:id/view', auth, async (req, res) => {
  if (!isPgBigId(req.params.id)) return res.status(404).json({ error: 'Reel not found' })
  await pool.query('UPDATE reels SET view_count = view_count + 1 WHERE id = $1 AND user_id <> $2', [req.params.id, req.userId])
  res.status(204).end()
})

app.put('/api/reels/:id/like', auth, async (req, res) => {
  if (!isPgBigId(req.params.id)) return res.status(404).json({ error: 'Reel not found' })
  if (typeof req.body?.liked !== 'boolean') return res.status(400).json({ error: 'liked must be true or false' })
  const reel = await pool.query('SELECT 1 FROM reels WHERE id = $1', [req.params.id])
  if (!reel.rows[0]) return res.status(404).json({ error: 'Reel not found' })
  if (req.body.liked) {
    await pool.query(`WITH inserted AS (
        INSERT INTO reel_likes (reel_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING RETURNING reel_id, user_id
      ), notified AS (
        INSERT INTO notifications (user_id, actor_id, kind, entity_type, entity_id, text)
        SELECT r.user_id, inserted.user_id, 'reel_like', 'reel', r.id, actor.name || ' liked your reel'
        FROM inserted JOIN reels r ON r.id = inserted.reel_id JOIN users actor ON actor.id = inserted.user_id
        WHERE r.user_id <> inserted.user_id RETURNING id
      ) SELECT reel_id FROM inserted`, [req.params.id, req.userId])
  } else {
    await pool.query('DELETE FROM reel_likes WHERE reel_id = $1 AND user_id = $2', [req.params.id, req.userId])
  }
  const { rows } = await pool.query(
    `SELECT count(*)::int AS like_count, EXISTS (SELECT 1 FROM reel_likes WHERE reel_id = $1 AND user_id = $2) AS liked_by_me
     FROM reel_likes WHERE reel_id = $1`,
    [req.params.id, req.userId],
  )
  res.json(rows[0])
})

app.put('/api/reels/:id/save', auth, async (req, res) => {
  if (!isPgBigId(req.params.id)) return res.status(404).json({ error: 'Reel not found' })
  if (typeof req.body?.saved !== 'boolean') return res.status(400).json({ error: 'saved must be true or false' })
  const reel = await pool.query('SELECT 1 FROM reels WHERE id = $1', [req.params.id])
  if (!reel.rows[0]) return res.status(404).json({ error: 'Reel not found' })
  if (req.body.saved) await pool.query('INSERT INTO reel_saves (reel_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [req.params.id, req.userId])
  else await pool.query('DELETE FROM reel_saves WHERE reel_id = $1 AND user_id = $2', [req.params.id, req.userId])
  res.json({ saved_by_me: req.body.saved })
})

app.get('/api/reels/:id/comments', auth, async (req, res) => {
  if (!isPgBigId(req.params.id)) return res.status(404).json({ error: 'Reel not found' })
  const { rows } = await pool.query(
    `SELECT * FROM (
       SELECT ${REEL_COMMENT_COLUMNS} FROM reel_comments c JOIN users u ON u.id = c.user_id
       WHERE c.reel_id = $1 ORDER BY c.created_at DESC, c.id DESC LIMIT 100
     ) recent ORDER BY created_at, id`,
    [req.params.id],
  )
  res.json(rows)
})

app.post('/api/reels/:id/comments', auth, writeLimiter, async (req, res) => {
  if (!isPgBigId(req.params.id)) return res.status(404).json({ error: 'Reel not found' })
  const body = typeof req.body?.body === 'string' ? req.body.body.trim() : ''
  if (!body || body.length > 2000) return res.status(400).json({ error: 'Comment must be 1-2,000 characters', field: 'body' })
  const target = await pool.query('SELECT user_id, comments_off FROM reels WHERE id = $1', [req.params.id])
  if (!target.rows[0]) return res.status(404).json({ error: 'Reel not found' })
  if (target.rows[0].comments_off && String(target.rows[0].user_id) !== String(req.userId)) {
    return res.status(403).json({ error: 'Commenting is turned off for this reel' })
  }
  const { rows } = await pool.query(`WITH inserted AS (
      INSERT INTO reel_comments (reel_id, user_id, body)
      SELECT $1, $2, $3 WHERE EXISTS (SELECT 1 FROM reels WHERE id = $1 AND (NOT comments_off OR user_id = $2))
      RETURNING id, reel_id, user_id
    ), notified AS (
      INSERT INTO notifications (user_id, actor_id, kind, entity_type, entity_id, text)
      SELECT r.user_id, inserted.user_id, 'reel_comment', 'reel', r.id, actor.name || ' commented on your reel'
      FROM inserted JOIN reels r ON r.id = inserted.reel_id JOIN users actor ON actor.id = inserted.user_id
      WHERE r.user_id <> inserted.user_id RETURNING id
    ) SELECT id FROM inserted`, [req.params.id, req.userId, body])
  if (!rows[0]) return res.status(404).json({ error: 'Reel not found' })
  const comment = await pool.query(`SELECT ${REEL_COMMENT_COLUMNS} FROM reel_comments c JOIN users u ON u.id = c.user_id WHERE c.id = $1`, [rows[0].id])
  res.status(201).json(comment.rows[0])
})

app.delete('/api/reel-comments/:id', auth, async (req, res) => {
  if (!isPgBigId(req.params.id)) return res.status(404).json({ error: 'Comment not found' })
  const { rows } = await pool.query(
    `WITH d AS (
       DELETE FROM reel_comments c USING reels r
       WHERE c.id = $1 AND r.id = c.reel_id AND (c.user_id = $2 OR r.user_id = $2 OR $3)
       RETURNING c.id, c.reel_id, c.user_id, r.user_id AS owner_id
     ), logged AS (
       INSERT INTO audit_logs (actor_id, action, target_type, target_id, details)
       SELECT $2, 'reel_comment.remove', 'reel_comment', d.id::text, jsonb_build_object('reelId', d.reel_id, 'authorId', d.user_id)
       FROM d WHERE d.user_id <> $2 AND d.owner_id <> $2
     )
     SELECT count(*)::int AS n FROM d`,
    [req.params.id, req.userId, isModerator(req)],
  )
  if (!rows[0].n) return res.status(404).json({ error: 'Comment not found' })
  res.status(204).end()
})

app.delete('/api/reels/:id', auth, async (req, res) => {
  if (!isPgBigId(req.params.id)) return res.status(404).json({ error: 'Reel not found' })
  const { rows } = await pool.query(
    `WITH d AS (DELETE FROM reels WHERE id = $1 AND (user_id = $2 OR $3) RETURNING id, user_id, file_id, cover_image_id),
     covers AS (DELETE FROM images WHERE id IN (SELECT cover_image_id FROM d WHERE cover_image_id IS NOT NULL)),
     logged AS (
       INSERT INTO audit_logs (actor_id, action, target_type, target_id, details)
       SELECT $2, 'reel.remove', 'reel', d.id::text, jsonb_build_object('authorId', d.user_id)
       FROM d WHERE d.user_id <> $2
     )
     SELECT file_id FROM d`,
    [req.params.id, req.userId, isModerator(req)],
  )
  if (!rows[0]) return res.status(404).json({ error: 'Reel not found' })
  await removeReelFile(rows[0].file_id)
  res.status(204).end()
})

// Hourly: retry ImageKit deletes that failed, and remove uploads that were never published as a reel
// (cancelled uploads, or reels of deleted accounts). Only files inside the reels folder are touched.
const cleanReelFiles = async () => {
  if (!IMAGEKIT) return
  try {
    const trash = await pool.query('SELECT file_id FROM reel_file_trash ORDER BY created_at LIMIT 50')
    for (const { file_id: fileId } of trash.rows) {
      if (await deleteFile(IMAGEKIT, fileId).catch(() => false)) await pool.query('DELETE FROM reel_file_trash WHERE file_id = $1', [fileId])
    }
    const files = await listReelFiles(IMAGEKIT)
    const stale = files.filter((file) => isFileId(file.fileId) && file.filePath?.startsWith(`${REEL_FOLDER}/`)
      && Date.now() - Date.parse(file.createdAt) > 6 * 60 * 60 * 1000)
    if (!stale.length) return
    const known = await pool.query('SELECT file_id FROM reels WHERE file_id = ANY($1::text[])', [stale.map((file) => file.fileId)])
    const keep = new Set(known.rows.map((row) => row.file_id))
    for (const file of stale) if (!keep.has(file.fileId)) await deleteFile(IMAGEKIT, file.fileId).catch(() => false)
  } catch (err) {
    log('error', 'reel_cleanup_failed', { message: err.message })
  }
}
setInterval(cleanReelFiles, 60 * 60 * 1000).unref()

// SNARP Docs: collaborative research documents (REST here, live editing over the /collaboration WebSocket).
const collaboration = createCollaborationServer({ pool, jwtSecret: JWT_SECRET })
app.use('/api/docs', createDocumentsRouter({ pool, auth, writeLimiter, jwtSecret: JWT_SECRET, collaboration }))

// SNARP Guide: the help assistant. Answers stream back as plain text.
const ASSISTANT = assistantConfig()
// Staff-only pages (moderator dashboard, admin console) are described only to moderators and the Super Admin.
const ASSISTANT_SECTIONS = ASSISTANT ? splitGuide(loadGuide()) : []
const ASSISTANT_STAFF_SECTIONS = ASSISTANT ? [...ASSISTANT_SECTIONS, ...splitGuide(loadGuide(new URL('./assistant-guide-staff.md', import.meta.url)))] : []
// Groq tells us how long to wait when its per-minute token budget is used up; wait once if it is short.
const groqRetryMs = (err) => {
  const match = /try again in ([\d.]+)(ms|s)\b/i.exec(err.detail ?? '')
  const ms = match ? Number(match[1]) * (match[2].toLowerCase() === 'ms' ? 1 : 1000) : NaN
  return err.status === 429 && Number.isFinite(ms) && ms <= 12000 ? Math.ceil(ms) + 250 : null
}
const assistantLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: Number.parseInt(process.env.ASSISTANT_RATE_LIMIT, 10) || 12,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => `assistant:${req.userId}`,
  handler: (_req, res) => res.status(429).json({ error: 'You are asking very quickly. Please wait a minute and try again.' }),
})

app.get('/api/assistant/status', auth, (_req, res) => {
  res.json({ enabled: !!ASSISTANT })
})

app.post('/api/assistant/chat', auth, assistantLimiter, async (req, res) => {
  if (!ASSISTANT) return res.status(503).json({ error: 'The SNARP Guide is not set up on this server yet' })
  const chat = validateChat(req.body?.messages)
  if (chat.error) return res.status(400).json({ error: chat.error })
  const { rows } = await pool.query('SELECT name, role FROM users WHERE id = $1', [req.userId])
  const staff = ['moderator', 'admin'].includes(rows[0]?.role)
  const userTurns = chat.messages.filter((message) => message.role === 'user').slice(-2).map((message) => message.content).join('\n')
  const guide = selectGuide(staff ? ASSISTANT_STAFF_SECTIONS : ASSISTANT_SECTIONS, { question: userTurns, page: req.body?.page })
  const system = systemPrompt({ guide, user: rows[0], page: req.body?.page })
  const controller = new AbortController()
  res.on('close', () => { if (!res.writableEnded) controller.abort() })
  let started = false
  const run = () => streamAnswer({
    config: ASSISTANT,
    system,
    messages: chat.messages,
    signal: controller.signal,
    onText: (text) => {
      if (!started) {
        started = true
        res.status(200).set({ 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store', 'X-Accel-Buffering': 'no' })
      }
      res.write(text)
    },
  })
  try {
    try {
      await run()
    } catch (err) {
      const wait = !started && !controller.signal.aborted ? groqRetryMs(err) : null
      if (!wait) throw err
      await new Promise((resolve) => setTimeout(resolve, wait))
      if (controller.signal.aborted) return
      await run()
    }
    if (!started) res.status(200).type('text/plain').send("Sorry, I couldn't come up with an answer. Please try asking another way.")
    else res.end()
  } catch (err) {
    if (controller.signal.aborted) return
    log('error', 'assistant_failed', { status: err.status ?? null, detail: err.detail ?? err.message })
    if (started) return res.end('\n\n_(The answer was cut off. Please try again.)_')
    const busy = err.status === 429
    res.status(busy ? 429 : 502).json({ error: busy ? 'The guide is busy right now. Please try again in a minute.' : 'The guide could not answer right now. Please try again.' })
  }
})

app.post('/api/views', auth, async (req, res) => {
  const items = Array.isArray(req.body?.items) ? req.body.items.slice(0, 50) : []
  const postIds = [...new Set(items.filter((item) => item?.type === 'post' && isPgId(String(item.id))).map((item) => Number(item.id)))]
  const paperIds = [...new Set(items.filter((item) => item?.type === 'paper' && isPgBigId(String(item.id))).map((item) => String(item.id)))]
  if (postIds.length) {
    await pool.query(
      `INSERT INTO post_views (post_id, user_id)
       SELECT p.id, $2 FROM posts p WHERE p.id = ANY($1::int[]) AND p.user_id <> $2 ON CONFLICT DO NOTHING`,
      [postIds, req.userId],
    )
  }
  if (paperIds.length) {
    await pool.query(
      `INSERT INTO paper_views (paper_id, user_id)
       SELECT p.id, $2 FROM papers p WHERE p.id = ANY($1::bigint[]) AND p.user_id <> $2 AND p.status = 'published' ON CONFLICT DO NOTHING`,
      [paperIds, req.userId],
    )
  }
  res.status(204).end()
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
         u.name AS author_name, CASE WHEN u.role = 'admin' THEN 'author' ELSE u.role END AS author_role,
         CASE WHEN u.profile_image_id IS NULL THEN NULL ELSE '/api/images/' || u.profile_image_id::text END AS author_avatar_url
       FROM comments c JOIN users u ON u.id = c.user_id
       WHERE c.post_id = $1 ORDER BY c.created_at DESC, c.id DESC LIMIT 50
     ) recent_comments ORDER BY created_at, id`,
    [req.params.id]
  )
  res.json(rows)
})

app.post('/api/posts/:id/comments', auth, writeLimiter, async (req, res) => {
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
      u.name AS author_name, CASE WHEN u.role = 'admin' THEN 'author' ELSE u.role END AS author_role,
      CASE WHEN u.profile_image_id IS NULL THEN NULL ELSE '/api/images/' || u.profile_image_id::text END AS author_avatar_url
     FROM comments c JOIN users u ON u.id = c.user_id WHERE c.id = $1`,
    [rows[0].id]
  )
  res.status(201).json(comment.rows[0])
})

app.delete('/api/comments/:id', auth, async (req, res) => {
  if (!isSafeId(req.params.id)) return res.status(404).json({ error: 'Comment not found' })
  const { rows } = await pool.query(
    `WITH d AS (
       DELETE FROM comments c USING posts p
       WHERE c.id = $1 AND p.id = c.post_id AND (c.user_id = $2 OR p.user_id = $2 OR $3)
       RETURNING c.id, c.post_id, c.user_id
     ), logged AS (
       INSERT INTO audit_logs (actor_id, action, target_type, target_id, details)
       SELECT $2, 'comment.remove', 'comment', d.id::text, jsonb_build_object('postId', d.post_id, 'authorId', d.user_id)
       FROM d JOIN posts p ON p.id = d.post_id WHERE d.user_id <> $2 AND p.user_id <> $2
     )
     SELECT count(*)::int AS n FROM d`,
    [req.params.id, req.userId, isModerator(req)]
  )
  if (!rows[0].n) return res.status(404).json({ error: 'Comment not found' })
  res.status(204).end()
})

app.post('/api/posts/:id/report', auth, writeLimiter, async (req, res) => {
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

const analyseLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => `analyse:${req.userId}`,
  handler: (_req, res) => res.status(429).json({ error: 'Too many PDFs analysed. Wait a minute and try again.' }),
})

app.post('/api/papers/analyze', auth, requireAuthor, analyseLimiter, paperUpload.single('pdf'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Choose a PDF to analyse', field: 'pdf' })
  if (!isPdf(req.file.buffer)) return res.status(400).json({ error: 'The selected file is not a valid PDF', field: 'pdf' })
  try {
    res.json(await analysePdf(req.file.buffer))
  } catch (err) {
    if (err.code === 'busy') return res.status(503).json({ error: 'The server is reading other PDFs. Try again in a few seconds.' })
    log('warn', 'pdf_analysis_failed', { reason: err.code ?? 'error', message: err.message })
    const message = err.code === 'timeout'
      ? 'This PDF took too long to read. Fill in the details by hand.'
      : 'We could not read this PDF. It may be damaged or protected; fill in the details by hand.'
    res.status(422).json({ error: message })
  }
})

const fieldError = (message, field) => Object.assign(new Error(message), { field })

async function resolveAuthors(submitterId, authors) {
  const [first, ...rest] = authors
  if (String(first?.user_id) !== String(submitterId)) throw fieldError('You must be the first author of your paper', 'authors')
  const ids = rest.map((a) => a.user_id)
  if (ids.some((id) => !id)) throw fieldError('Co-authors must be chosen from your friends on SNARP', 'authors')
  if (new Set(ids.map(String)).size !== ids.length || ids.some((id) => String(id) === String(submitterId))) {
    throw fieldError('Each co-author can be added only once', 'authors')
  }
  const { rows } = await pool.query(
    `SELECT u.id, u.name FROM users u
     WHERE u.id = $1 OR (u.id = ANY($2::int[])
       AND EXISTS (SELECT 1 FROM follows f WHERE f.follower_id = $1 AND f.followee_id = u.id)
       AND EXISTS (SELECT 1 FROM follows f WHERE f.follower_id = u.id AND f.followee_id = $1))`,
    [submitterId, ids]
  )
  const names = new Map(rows.map((r) => [String(r.id), r.name]))
  if (ids.some((id) => !names.has(String(id)))) {
    throw fieldError('Only friends can be co-authors: people you follow who also follow you back', 'authors')
  }
  return authors.map((a) => ({ user_id: Number(a.user_id), name: names.get(String(a.user_id)), affiliation: a.affiliation }))
}

app.post('/api/papers/submit', auth, requireAuthor, writeLimiter, paperUpload.single('pdf'), async (req, res) => {
  const idempotencyKey = req.get('Idempotency-Key') || null
  if (idempotencyKey && !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(idempotencyKey)) {
    return res.status(400).json({ error: 'Invalid Idempotency-Key' })
  }

  let paper
  try {
    paper = validatePaperSubmission(req.body ?? {}, req.file, MAX_PDF_BYTES)
    paper.authors = await resolveAuthors(req.userId, paper.authors)
  } catch (err) {
    if (err.field) return res.status(400).json({ error: err.message, field: err.field })
    throw err
  }

  // Duplicate detection: the same PDF file, the same text (normalized) or the same DOI cannot be submitted twice.
  const fHash = fileHash(paper.pdfData)
  let cHash = null
  try {
    cHash = contentHash(await extractPdfText(paper.pdfData))
  } catch {
    return res.status(400).json({ error: 'The uploaded PDF is corrupted, password-protected, or unreadable.', field: 'pdf' })
  }
  const duplicate = { status: 409, body: { code: 'DUPLICATE_PAPER', error: 'This research paper has already been submitted to SNARP.', message: 'This research paper has already been submitted to SNARP.' } }
  const dupCheck = await checkDuplicate(pool, { fileHash: fHash, contentHash: cHash, doi: normalizeDoi(paper.doi) })
  if (dupCheck.isDuplicate) return res.status(duplicate.status).json(duplicate.body)

  let inserted
  try {
    inserted = await pool.query(
      `INSERT INTO papers
         (user_id, title, abstract, doi, domain, tags, authors, pdf_data, pdf_filename,
          pdf_content_type, pdf_size, additional_notes, idempotency_key, status, file_hash, content_hash, publication_date)
       VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8, $9, 'application/pdf', $10, $11, $12, $13, $14, $15, $16)
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
        paper.authors.length > 1 ? 'coauthor_check' : 'pending',
        fHash,
        cHash,
        paper.publicationDate,
      ]
    )
  } catch (err) {
    // A concurrent upload of the same paper hits the unique fingerprint indexes.
    if (err.code === '23505' && ['papers_file_hash_uniq', 'papers_content_hash_uniq', 'papers_doi_uniq'].includes(err.constraint)) {
      return res.status(duplicate.status).json(duplicate.body)
    }
    throw err
  }

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

  if (statusCode === 201 && paper.authors.length > 1) {
    await pool.query(
      `INSERT INTO notifications (user_id, actor_id, kind, entity_type, entity_id, text)
       SELECT coauthor, $1::int, 'coauthor', 'paper', $4::bigint, $2::text FROM unnest($3::int[]) AS coauthor`,
      [req.userId, `${paper.authors[0].name} added you as a co-author on "${paper.title.slice(0, 300)}". Check the PDF and approve it.`, paper.authors.slice(1).map((a) => a.user_id), result.id]
    ).catch((err) => log('error', 'coauthor_notify_failed', { paperId: result.id, code: err.code }))
  }

  res.status(statusCode).json({ id: result.id, title: result.title, status: result.status, submittedAt: result.created_at })
})

const likePattern = (q) => `%${q.replace(/[\\%_]/g, '\\$&')}%`
const pageParams = (query, { max = 50, fallback = 20 } = {}) => {
  const page = Math.max(1, Math.min(10000, Number.parseInt(query.page, 10) || 1))
  const limit = Math.max(1, Math.min(max, Number.parseInt(query.limit, 10) || fallback))
  return { page, limit, offset: (page - 1) * limit }
}
const cleanText = (value, max) => (typeof value === 'string' ? value.trim().slice(0, max + 1) : '')
const avatarUrl = (imageId) => (imageId ? `/api/images/${imageId}` : null)

async function inTransaction(work) {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const result = await work(client)
    await client.query(result?.rollback ? 'ROLLBACK' : 'COMMIT')
    return result
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {})
    throw err
  } finally {
    client.release()
  }
}
const fail = (problem) => ({ rollback: true, problem })
const sendProblem = (res, problem) => res.status(problem.status).json({ error: problem.error, ...(problem.field && { field: problem.field }), ...(problem.code && { code: problem.code }) })

const audit = (db, actorId, action, targetType, targetId, details = {}) => db.query(
  'INSERT INTO audit_logs (actor_id, action, target_type, target_id, details) VALUES ($1, $2, $3, $4::text, $5::jsonb)',
  [actorId, action, targetType, String(targetId), JSON.stringify(details)]
)

const notifyPaperAuthors = (db, paper, text, { includeCoauthors = true } = {}) => db.query(
  `INSERT INTO notifications (user_id, actor_id, kind, entity_type, entity_id, text)
   SELECT DISTINCT recipient, NULL::int, 'paper_review', 'paper', $1::bigint, $2::text
   FROM (SELECT $3::int AS recipient
     UNION SELECT (a->>'user_id')::int FROM jsonb_array_elements($4::jsonb) AS a WHERE $5::boolean AND a ? 'user_id') r
   WHERE recipient IS NOT NULL`,
  [paper.id, text.slice(0, 500), paper.user_id, JSON.stringify(paper.authors ?? []), includeCoauthors]
)

const PAPER_LIST_COLUMNS = `p.id, p.title, p.abstract, p.doi, p.domain, p.tags, p.authors, p.status, p.user_id,
  p.created_at, p.updated_at, p.reviewed_at, p.published_at, p.review_started_at, p.rejection_reason, p.round, p.resubmitted_at,
  p.reviewed_by, p.assigned_to, submitter.name AS submitter_name, reviewer.name AS reviewer_name, assignee.name AS assignee_name,
  (SELECT count(*)::int FROM peer_reviews r WHERE r.paper_id = p.id AND r.round = p.round) AS review_count,
  (SELECT round(avg(r.overall_rating), 1)::float FROM peer_reviews r WHERE r.paper_id = p.id AND r.round = p.round) AS avg_rating`
const PAPER_LIST_FROM = `FROM papers p JOIN users submitter ON submitter.id = p.user_id
  LEFT JOIN users reviewer ON reviewer.id = p.reviewed_by LEFT JOIN users assignee ON assignee.id = p.assigned_to`
const NOT_OWN_PAPER = (param) => `p.user_id <> ${param} AND NOT p.authors @> jsonb_build_array(jsonb_build_object('user_id', ${param}::int))`
const MODERATOR_VIEWS = ['queue', 'pending', 'under_review', 'mine', 'reviewed_by_me']
const ADMIN_VIEWS = ['all', ...PAPER_STATUSES, ...MODERATOR_VIEWS]

async function listPapers(req, { admin }) {
  const view = String(req.query.status ?? (admin ? 'all' : 'queue'))
  if (!(admin ? ADMIN_VIEWS : MODERATOR_VIEWS).includes(view)) {
    return { problem: { status: 400, error: `Status must be one of: ${(admin ? ADMIN_VIEWS : MODERATOR_VIEWS).join(', ')}` } }
  }
  const { page, limit, offset } = pageParams(req.query)
  const values = [req.userId]
  const conditions = []
  if (view === 'queue') conditions.push("p.status IN ('pending', 'under_review')")
  else if (view === 'mine') conditions.push("p.status = 'under_review' AND p.assigned_to = $1")
  else if (view === 'reviewed_by_me') {
    conditions.push("EXISTS (SELECT 1 FROM paper_reviews pr WHERE pr.paper_id = p.id AND pr.reviewer_id = $1 AND pr.decision IN ('approved', 'rejected', 'revision_requested'))")
  } else if (view !== 'all') {
    values.push(view)
    conditions.push(`p.status = $${values.length}`)
  }
  if (!admin && view !== 'reviewed_by_me') conditions.push(NOT_OWN_PAPER('$1'))
  const q = cleanText(req.query.q, 100)
  if (q) {
    values.push(likePattern(q))
    conditions.push(`(p.title ILIKE $${values.length} OR p.domain ILIKE $${values.length} OR submitter.name ILIKE $${values.length} OR array_to_string(p.tags, ' ') ILIKE $${values.length})`)
  }
  const domain = cleanText(req.query.domain, 120)
  if (domain) {
    values.push(domain)
    conditions.push(`lower(p.domain) = lower($${values.length})`)
  }
  const where = conditions.length ? conditions.join(' AND ') : 'TRUE'
  const usesActor = where.includes('$1')
  const params = usesActor ? values : values.slice(1)
  const sql = usesActor ? where : where.replace(/\$(\d+)/g, (_m, n) => `$${Number(n) - 1}`)
  const order = ['queue', 'pending', 'under_review', 'mine'].includes(view)
    ? 'COALESCE(p.resubmitted_at, p.created_at) ASC, p.id ASC'
    : 'COALESCE(p.published_at, p.reviewed_at, p.resubmitted_at, p.created_at) DESC, p.id DESC'
  const [{ rows }, count] = await Promise.all([
    pool.query(`SELECT ${PAPER_LIST_COLUMNS} ${PAPER_LIST_FROM} WHERE ${sql} ORDER BY ${order}
      LIMIT $${params.length + 1} OFFSET $${params.length + 2}`, [...params, limit, offset]),
    pool.query(`SELECT count(*)::int AS total ${PAPER_LIST_FROM} WHERE ${sql}`, params),
  ])
  return { papers: rows, page, limit, total: count.rows[0].total, view }
}

async function loadModerationPaper(id, req) {
  const admin = isSuperAdmin(req)
  const { rows } = await pool.query(`
    SELECT p.id, p.user_id, p.title, p.abstract, p.doi, p.domain, p.tags, p.authors, p.pdf_filename, p.pdf_size,
      p.additional_notes, p.status, p.rejection_reason, p.revision_note, p.round, p.draft, p.created_at, p.updated_at,
      p.resubmitted_at, p.reviewed_at, p.reviewed_by, p.review_started_at, p.assigned_to, p.published_at,
      submitter.name AS submitter_name, submitter.email AS submitter_email, reviewer.name AS reviewer_name,
      assignee.name AS assignee_name, publisher.name AS publisher_name
    FROM papers p JOIN users submitter ON submitter.id = p.user_id
    LEFT JOIN users reviewer ON reviewer.id = p.reviewed_by
    LEFT JOIN users assignee ON assignee.id = p.assigned_to
    LEFT JOIN users publisher ON publisher.id = p.published_by
    WHERE p.id = $1`, [id])
  const paper = rows[0]
  if (!paper) return null
  const [{ rows: history }, { rows: notes }, { rows: reviews }] = await Promise.all([
    pool.query(`SELECT pr.id, pr.decision, pr.comment, pr.round, pr.created_at, pr.reviewer_id AS actor_id,
        u.name AS actor_name, u.role AS actor_role
      FROM paper_reviews pr LEFT JOIN users u ON u.id = pr.reviewer_id
      WHERE pr.paper_id = $1 ORDER BY pr.created_at DESC, pr.id DESC`, [id]),
    pool.query(`SELECT n.id, n.body, n.created_at, n.author_id, u.name AS author_name
      FROM paper_notes n LEFT JOIN users u ON u.id = n.author_id
      WHERE n.paper_id = $1 ORDER BY n.created_at, n.id`, [id]),
    pool.query(`${REVIEW_SELECT} WHERE r.paper_id = $1 AND r.round = $2 ORDER BY r.created_at, r.id`, [id, paper.round]),
  ])
  const own = String(paper.user_id) === String(req.userId) || (paper.authors ?? []).some((a) => String(a.user_id) === String(req.userId))
  const allowed = (action) => !moderationProblem({ paper, actorId: req.userId, actorRole: req.userRole, action })
  return {
    ...paper,
    submitter_email: admin ? paper.submitter_email : undefined,
    is_own: own,
    history,
    notes,
    peer_reviews: reviews,
    peer_summary: roundSummary(reviews),
    actions: {
      start_review: allowed('start_review'),
      release: allowed('release'),
      approve: allowed('approve'),
      reject: allowed('reject'),
      request_revision: allowed('request_revision'),
      override: admin,
      note: !own,
    },
  }
}

const MODERATION_ACTIONS = {
  start_review: { decision: 'under_review', audit: 'paper.review_started', textField: null },
  release: { decision: 'released', audit: 'paper.review_released', textField: null },
  approve: { decision: 'approved', audit: 'paper.approved', textField: 'comment', min: 0, max: 2000 },
  reject: { decision: 'rejected', audit: 'paper.rejected', textField: 'reason', min: 5, max: 2000, label: 'Rejection reason' },
  request_revision: { decision: 'revision_requested', audit: 'paper.revision_requested', textField: 'note', min: 10, max: 5000, label: 'Requested changes' },
}

async function moderatePaper(req, res, action) {
  if (!isSafeId(req.params.id)) return res.status(404).json({ error: 'Paper not found' })
  const rule = MODERATION_ACTIONS[action]
  const text = rule.textField ? cleanText(req.body?.[rule.textField], rule.max) : ''
  if (rule.textField && (text.length < rule.min || text.length > rule.max)) {
    return res.status(400).json({
      error: rule.min ? `${rule.label} must be ${rule.min} to ${rule.max.toLocaleString('en-US')} characters` : `Comment must be at most ${rule.max.toLocaleString('en-US')} characters`,
      field: rule.textField,
    })
  }
  const result = await inTransaction(async (db) => {
    const { rows } = await db.query('SELECT id, user_id, title, status, round, authors, assigned_to FROM papers WHERE id = $1 FOR UPDATE', [req.params.id])
    const paper = rows[0]
    const problem = moderationProblem({ paper, actorId: req.userId, actorRole: req.userRole, action })
    if (problem) return fail(problem)
    const to = nextStatus(paper.status, action)
    const updates = {
      start_review: ['assigned_to = $2, review_started_at = now()', [paper.id, req.userId]],
      release: ['assigned_to = NULL, review_started_at = NULL', [paper.id]],
      approve: ['reviewed_by = $2, reviewed_at = now(), rejection_reason = NULL', [paper.id, req.userId]],
      reject: ['reviewed_by = $2, reviewed_at = now(), rejection_reason = $3', [paper.id, req.userId, text]],
      request_revision: ['reviewed_by = $2, reviewed_at = now(), revision_note = $3', [paper.id, req.userId, text]],
    }
    const [set, values] = updates[action]
    await db.query(`UPDATE papers SET status = '${to}', ${set}, updated_at = now() WHERE id = $1`, values)
    await db.query(
      'INSERT INTO paper_reviews (paper_id, reviewer_id, decision, comment, round) VALUES ($1, $2, $3, $4, $5)',
      [paper.id, req.userId, rule.decision, text, paper.round]
    )
    await audit(db, req.userId, rule.audit, 'paper', paper.id, {
      from: paper.status, to, round: paper.round, ...(text && { [rule.textField]: text.slice(0, 500) }),
    })
    const title = paper.title.slice(0, 200)
    if (action === 'start_review') await notifyPaperAuthors(db, paper, `A moderator started verifying "${title}"`, { includeCoauthors: false })
    if (action === 'approve') await notifyPaperAuthors(db, paper, `"${title}" was approved by a moderator. The main author can now publish it from My submissions.`)
    if (action === 'reject') await notifyPaperAuthors(db, paper, `"${title}" was rejected by a moderator: ${text.slice(0, 200)}`)
    if (action === 'request_revision') await notifyPaperAuthors(db, paper, `Changes requested on your paper "${title}"`)
    return { paper }
  })
  if (result.problem) return sendProblem(res, result.problem)
  res.json(await loadModerationPaper(result.paper.id, req))
}

async function moderatorActivity(userId) {
  const [{ rows: counts }, { rows: recent }] = await Promise.all([
    pool.query(`SELECT
        count(*) FILTER (WHERE decision = 'approved')::int AS approved,
        count(*) FILTER (WHERE decision = 'rejected')::int AS rejected,
        count(*) FILTER (WHERE decision = 'revision_requested')::int AS revision_requested,
        count(*) FILTER (WHERE decision = 'under_review')::int AS reviews_started,
        count(*) FILTER (WHERE decision IN ('approved', 'rejected', 'revision_requested') AND created_at > now() - interval '30 days')::int AS decisions_30d,
        max(created_at) AS last_action_at,
        (SELECT count(*)::int FROM papers WHERE assigned_to = $1 AND status = 'under_review') AS in_progress
      FROM paper_reviews WHERE reviewer_id = $1
        AND decision IN ('approved', 'rejected', 'revision_requested', 'under_review', 'released')`, [userId]),
    pool.query(`SELECT pr.id, pr.decision, pr.comment, pr.round, pr.created_at, p.id AS paper_id, p.title, p.status, p.domain
      FROM paper_reviews pr JOIN papers p ON p.id = pr.paper_id
      WHERE pr.reviewer_id = $1 AND pr.decision IN ('approved', 'rejected', 'revision_requested', 'under_review', 'released')
      ORDER BY pr.created_at DESC, pr.id DESC LIMIT 30`, [userId]),
  ])
  return { ...counts[0], recent }
}

app.get('/api/moderation/summary', auth, requireModerator, async (req, res) => {
  const { rows } = await pool.query(`
    SELECT
      count(*) FILTER (WHERE status = 'pending' AND ${NOT_OWN_PAPER('$1')})::int AS pending,
      count(*) FILTER (WHERE status = 'under_review')::int AS under_review,
      count(*) FILTER (WHERE status = 'under_review' AND assigned_to = $1)::int AS mine,
      count(*) FILTER (WHERE status = 'revision_requested')::int AS revision_requested,
      count(*) FILTER (WHERE status = 'approved')::int AS approved,
      (SELECT count(*)::int FROM paper_reviews WHERE reviewer_id = $1 AND decision IN ('approved', 'rejected', 'revision_requested')) AS my_decisions
    FROM papers p`, [req.userId])
  res.json(rows[0])
})

app.get('/api/moderation/activity', auth, requireModerator, async (req, res) => {
  res.json(await moderatorActivity(req.userId))
})

app.get('/api/moderation/papers', auth, requireModerator, async (req, res) => {
  const result = await listPapers(req, { admin: false })
  if (result.problem) return sendProblem(res, result.problem)
  res.json(result)
})

app.get('/api/moderation/papers/:id', auth, requireModerator, async (req, res) => {
  if (!isSafeId(req.params.id)) return res.status(404).json({ error: 'Paper not found' })
  const paper = await loadModerationPaper(req.params.id, req)
  if (!paper) return res.status(404).json({ error: 'Paper not found' })
  res.json(paper)
})

app.patch('/api/moderation/papers/:id/start-review', auth, requireModerator, writeLimiter, (req, res) => moderatePaper(req, res, 'start_review'))
app.patch('/api/moderation/papers/:id/release', auth, requireModerator, writeLimiter, (req, res) => moderatePaper(req, res, 'release'))
app.patch('/api/moderation/papers/:id/approve', auth, requireModerator, writeLimiter, (req, res) => moderatePaper(req, res, 'approve'))
app.patch('/api/moderation/papers/:id/reject', auth, requireModerator, writeLimiter, (req, res) => moderatePaper(req, res, 'reject'))
app.patch('/api/moderation/papers/:id/request-revision', auth, requireModerator, writeLimiter, (req, res) => moderatePaper(req, res, 'request_revision'))

app.post('/api/moderation/papers/:id/notes', auth, requireModerator, writeLimiter, async (req, res) => {
  if (!isSafeId(req.params.id)) return res.status(404).json({ error: 'Paper not found' })
  const body = cleanText(req.body?.body, 2000)
  if (!body || body.length > 2000) return res.status(400).json({ error: 'Note must be 1 to 2,000 characters', field: 'body' })
  const result = await inTransaction(async (db) => {
    const { rows } = await db.query('SELECT id, user_id, authors FROM papers WHERE id = $1', [req.params.id])
    const paper = rows[0]
    if (!paper) return fail({ status: 404, error: 'Paper not found' })
    if (String(paper.user_id) === String(req.userId) || (paper.authors ?? []).some((a) => String(a.user_id) === String(req.userId))) {
      return fail({ status: 403, error: 'You cannot add review notes to your own paper' })
    }
    const { rows: inserted } = await db.query(
      'INSERT INTO paper_notes (paper_id, author_id, body) VALUES ($1, $2, $3) RETURNING id, body, created_at, author_id',
      [paper.id, req.userId, body]
    )
    await audit(db, req.userId, 'paper.note_added', 'paper', paper.id, { noteId: inserted[0].id })
    return { note: inserted[0] }
  })
  if (result.problem) return sendProblem(res, result.problem)
  const { rows } = await pool.query('SELECT name FROM users WHERE id = $1', [req.userId])
  res.status(201).json({ ...result.note, author_name: rows[0]?.name ?? null })
})

app.get('/api/moderation/reports', auth, requirePermission('reports.manage', 'Super Admin access required'), async (req, res) => {
  const status = String(req.query.status ?? 'pending')
  if (!['pending', 'reviewed', 'dismissed'].includes(status)) {
    return res.status(400).json({ error: 'Status must be pending, reviewed, or dismissed' })
  }
  const { page, limit, offset } = pageParams(req.query)
  const [{ rows }, countResult] = await Promise.all([
    pool.query(`SELECT r.id, r.post_id, r.reported_by, r.reason, r.status, r.created_at,
        reporter.name AS reporter_name, post.user_id AS post_author_id,
        author.name AS post_author_name, post.body AS post_body, post.image_id
      FROM reports r JOIN posts post ON post.id = r.post_id
      JOIN users reporter ON reporter.id = r.reported_by
      JOIN users author ON author.id = post.user_id
      WHERE r.status = $1 ORDER BY r.created_at DESC, r.id DESC LIMIT $2 OFFSET $3`,
    [status, limit, offset]),
    pool.query('SELECT count(*)::int AS total FROM reports WHERE status = $1', [status]),
  ])
  res.json({ reports: rows, page, limit, total: countResult.rows[0].total })
})

app.patch('/api/moderation/reports/:id/:decision', auth, requirePermission('reports.manage', 'Super Admin access required'), async (req, res) => {
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

app.get('/api/admin/overview', auth, requireAdmin, async (_req, res) => {
  const [{ rows: totals }, { rows: daily }, { rows: recent }] = await Promise.all([
    pool.query(`SELECT
        (SELECT count(*)::int FROM users) AS users_total,
        (SELECT count(*)::int FROM users WHERE blocked_at IS NULL AND email_verified_at IS NOT NULL
          AND (last_login_at > now() - interval '30 days' OR EXISTS (
            SELECT 1 FROM auth_sessions s WHERE s.user_id = users.id AND s.revoked_at IS NULL AND s.expires_at > now() AND s.last_seen_at > now() - interval '30 days'))) AS users_active,
        (SELECT count(*)::int FROM users WHERE blocked_at IS NOT NULL) AS users_blocked,
        (SELECT count(*)::int FROM users WHERE email_verified_at IS NULL) AS users_unverified,
        (SELECT count(*)::int FROM users WHERE role = 'moderator') AS moderators_total,
        (SELECT count(*)::int FROM users WHERE role = 'moderator' AND blocked_at IS NOT NULL) AS moderators_suspended,
        (SELECT count(*)::int FROM papers) AS papers_total,
        (SELECT count(*)::int FROM papers WHERE status = 'coauthor_check') AS papers_coauthor_check,
        (SELECT count(*)::int FROM papers WHERE status = 'pending') AS papers_pending,
        (SELECT count(*)::int FROM papers WHERE status = 'under_review') AS papers_under_review,
        (SELECT count(*)::int FROM papers WHERE status = 'revision_requested') AS papers_revision_requested,
        (SELECT count(*)::int FROM papers WHERE status = 'approved') AS papers_approved,
        (SELECT count(*)::int FROM papers WHERE status = 'rejected') AS papers_rejected,
        (SELECT count(*)::int FROM papers WHERE status = 'published') AS papers_published,
        (SELECT count(*)::int FROM reports WHERE status = 'pending') AS reports_pending`),
    pool.query(`SELECT d::date AS day,
        (SELECT count(*)::int FROM papers WHERE created_at >= d AND created_at < d + interval '1 day') AS submitted,
        (SELECT count(*)::int FROM users WHERE created_at >= d AND created_at < d + interval '1 day') AS signups
      FROM generate_series(date_trunc('day', now()) - interval '13 days', date_trunc('day', now()), interval '1 day') AS d
      ORDER BY d`),
    pool.query(`SELECT a.id, a.action, a.target_type, a.target_id, a.created_at, a.actor_id, u.name AS actor_name,
        COALESCE(a.actor_role, u.role) AS actor_role
      FROM audit_logs a LEFT JOIN users u ON u.id = a.actor_id ORDER BY a.created_at DESC, a.id DESC LIMIT 8`),
  ])
  res.json({ ...totals[0], daily, recent })
})

const ADMIN_USER_STATUSES = ['active', 'blocked', 'unverified']
app.get('/api/admin/users', auth, requireAdmin, async (req, res) => {
  const role = String(req.query.role ?? '')
  const status = String(req.query.status ?? '')
  if (role && !['admin', 'moderator', 'author', 'user'].includes(role)) return res.status(400).json({ error: 'Unknown role', field: 'role' })
  if (status && !ADMIN_USER_STATUSES.includes(status)) return res.status(400).json({ error: 'Unknown status', field: 'status' })
  const { page, limit, offset } = pageParams(req.query)
  const values = []
  const conditions = []
  const q = cleanText(req.query.q, 100)
  if (q) {
    values.push(likePattern(q))
    conditions.push(`(u.name ILIKE $${values.length} OR u.email ILIKE $${values.length})`)
  }
  if (role) {
    values.push(role)
    conditions.push(`u.role = $${values.length}`)
  }
  if (status === 'blocked') conditions.push('u.blocked_at IS NOT NULL')
  if (status === 'active') conditions.push('u.blocked_at IS NULL AND u.email_verified_at IS NOT NULL')
  if (status === 'unverified') conditions.push('u.email_verified_at IS NULL')
  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : ''
  const [{ rows }, count] = await Promise.all([
    pool.query(`SELECT u.id, u.name, u.email, u.role, u.created_at, u.last_login_at, u.blocked_at, u.blocked_reason,
        u.email_verified_at IS NOT NULL AS email_verified, u.profile_image_id,
        (SELECT count(*)::int FROM papers p WHERE p.user_id = u.id) AS paper_count,
        (SELECT count(*)::int FROM posts WHERE user_id = u.id) AS post_count
      FROM users u ${where}
      ORDER BY CASE u.role WHEN 'admin' THEN 0 WHEN 'moderator' THEN 1 ELSE 2 END, u.created_at DESC, u.id DESC
      LIMIT $${values.length + 1} OFFSET $${values.length + 2}`, [...values, limit, offset]),
    pool.query(`SELECT count(*)::int AS total FROM users u ${where}`, values),
  ])
  res.json({
    users: rows.map(({ profile_image_id, ...user }) => ({ ...user, avatar_url: avatarUrl(profile_image_id) })),
    page, limit, total: count.rows[0].total,
  })
})

app.get('/api/admin/users/:id', auth, requireAdmin, async (req, res) => {
  if (!isPgId(req.params.id)) return res.status(404).json({ error: 'User not found' })
  const { rows } = await pool.query(`
    SELECT u.id, u.name, u.email, u.role, u.created_at, u.last_login_at, u.blocked_at, u.blocked_reason,
      u.email_verified_at, u.profile_image_id, blocker.name AS blocked_by_name,
      COALESCE(up.institution, '') AS institution, COALESCE(up.department, '') AS department,
      COALESCE(up.research_interests, '{}') AS research_interests, COALESCE(up.bio, '') AS bio,
      (SELECT count(*)::int FROM posts WHERE user_id = u.id) AS post_count,
      (SELECT count(*)::int FROM follows WHERE followee_id = u.id) AS follower_count,
      (SELECT count(*)::int FROM auth_sessions s WHERE s.user_id = u.id AND s.revoked_at IS NULL AND s.expires_at > now()) AS active_sessions,
      (SELECT max(s.last_seen_at) FROM auth_sessions s WHERE s.user_id = u.id) AS last_seen_at
    FROM users u LEFT JOIN user_profiles up ON up.user_id = u.id LEFT JOIN users blocker ON blocker.id = u.blocked_by
    WHERE u.id = $1`, [req.params.id])
  if (!rows[0]) return res.status(404).json({ error: 'User not found' })
  const [{ rows: papers }, { rows: activity }, moderation] = await Promise.all([
    pool.query(`SELECT p.id, p.title, p.domain, p.status, p.round, p.created_at, p.reviewed_at, p.published_at,
        p.user_id <> $1 AS coauthored, reviewer.name AS reviewer_name
      FROM papers p LEFT JOIN users reviewer ON reviewer.id = p.reviewed_by
      WHERE p.user_id = $1 OR p.authors @> jsonb_build_array(jsonb_build_object('user_id', $1::int))
      ORDER BY p.created_at DESC LIMIT 50`, [req.params.id]),
    pool.query(`SELECT a.id, a.action, a.target_type, a.target_id, a.details, a.created_at,
        COALESCE(a.actor_role, u.role) AS actor_role, u.name AS actor_name, a.actor_id
      FROM audit_logs a LEFT JOIN users u ON u.id = a.actor_id
      WHERE a.actor_id = $1 OR (a.target_type = 'user' AND a.target_id = $1::text)
      ORDER BY a.created_at DESC, a.id DESC LIMIT 30`, [req.params.id]),
    rows[0].role === 'moderator' ? moderatorActivity(req.params.id) : null,
  ])
  const { profile_image_id, ...user } = rows[0]
  res.json({ ...user, avatar_url: avatarUrl(profile_image_id), papers, activity, moderation })
})

async function releaseAssignedPapers(db, moderatorId, actorId, reason) {
  const { rows } = await db.query(
    `UPDATE papers SET status = 'pending', assigned_to = NULL, review_started_at = NULL, updated_at = now()
     WHERE assigned_to = $1 AND status = 'under_review' RETURNING id, round`, [moderatorId]
  )
  for (const paper of rows) {
    await db.query(
      "INSERT INTO paper_reviews (paper_id, reviewer_id, decision, comment, round) VALUES ($1, $2, 'released', $3, $4)",
      [paper.id, actorId, reason, paper.round]
    )
  }
  return rows.length
}

async function setBlocked(req, res, blocking) {
  if (!isPgId(req.params.id)) return res.status(404).json({ error: 'User not found' })
  const reason = cleanText(req.body?.reason, 500)
  if (blocking && (reason.length < 5 || reason.length > 500)) return res.status(400).json({ error: 'Give a reason of 5 to 500 characters', field: 'reason' })
  const result = await inTransaction(async (db) => {
    const { rows } = await db.query('SELECT id, name, role, blocked_at FROM users WHERE id = $1 FOR UPDATE', [req.params.id])
    const target = rows[0]
    const problem = blockProblem({ actorId: req.userId, actorRole: req.userRole, target, blocking })
    if (problem) return fail(problem)
    let released = 0
    if (blocking) {
      await db.query('UPDATE users SET blocked_at = now(), blocked_reason = $2, blocked_by = $3 WHERE id = $1', [target.id, reason, req.userId])
      await db.query('UPDATE auth_sessions SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL', [target.id])
      if (target.role === 'moderator') released = await releaseAssignedPapers(db, target.id, req.userId, 'Moderator was suspended')
    } else {
      await db.query('UPDATE users SET blocked_at = NULL, blocked_reason = NULL, blocked_by = NULL WHERE id = $1', [target.id])
    }
    const action = target.role === 'moderator'
      ? (blocking ? 'moderator.suspended' : 'moderator.reactivated')
      : (blocking ? 'user.blocked' : 'user.unblocked')
    await audit(db, req.userId, action, 'user', target.id, { role: target.role, ...(blocking && { reason, releasedPapers: released }) })
    return { id: target.id }
  })
  if (result.problem) return sendProblem(res, result.problem)
  const { rows } = await pool.query('SELECT id, name, role, blocked_at, blocked_reason FROM users WHERE id = $1', [result.id])
  res.json(rows[0])
}

app.patch('/api/admin/users/:id/block', auth, requireAdmin, writeLimiter, (req, res) => setBlocked(req, res, true))
app.patch('/api/admin/users/:id/unblock', auth, requireAdmin, writeLimiter, (req, res) => setBlocked(req, res, false))

async function changeRole(req, res, findTarget, nextRole) {
  const result = await inTransaction(async (db) => {
    const target = await findTarget(db)
    const problem = roleChangeProblem({ actorId: req.userId, actorRole: req.userRole, target, nextRole })
    if (problem) return fail(problem)
    await db.query('UPDATE users SET role = $2 WHERE id = $1', [target.id, nextRole])
    let released = 0
    if (target.role === 'moderator') released = await releaseAssignedPapers(db, target.id, req.userId, 'Moderator role was removed')
    const action = nextRole === 'moderator' ? 'moderator.added' : target.role === 'moderator' ? 'moderator.removed' : 'user.role_changed'
    await audit(db, req.userId, action, 'user', target.id, { from: target.role, to: nextRole, releasedPapers: released })
    return { id: target.id }
  })
  if (result.problem) return sendProblem(res, result.problem)
  const { rows } = await pool.query('SELECT id, name, email, role, blocked_at FROM users WHERE id = $1', [result.id])
  res.json(rows[0])
}

const lockUser = (column, value) => async (db) => (await db.query(
  `SELECT id, name, email, role, blocked_at, email_verified_at FROM users WHERE ${column} = $1 FOR UPDATE`, [value]
)).rows[0]

app.put('/api/admin/users/:id/role', auth, requireAdmin, writeLimiter, (req, res) => {
  if (!isPgId(req.params.id)) return res.status(404).json({ error: 'User not found' })
  return changeRole(req, res, lockUser('id', req.params.id), String(req.body?.role ?? ''))
})

app.post('/api/admin/moderators', auth, requireAdmin, writeLimiter, (req, res) => {
  const email = normalizeEmail(req.body?.email)
  if (emailProblem(email)) return res.status(400).json({ error: 'Enter a valid email address', field: 'email' })
  return changeRole(req, res, lockUser('email', email), 'moderator')
})

app.get('/api/admin/moderators', auth, requireAdmin, async (req, res) => {
  const status = String(req.query.status ?? '')
  if (status && !['active', 'suspended'].includes(status)) return res.status(400).json({ error: 'Status must be active or suspended', field: 'status' })
  const values = []
  const conditions = ["u.role = 'moderator'"]
  const q = cleanText(req.query.q, 100)
  if (q) {
    values.push(likePattern(q))
    conditions.push(`(u.name ILIKE $${values.length} OR u.email ILIKE $${values.length})`)
  }
  if (status === 'active') conditions.push('u.blocked_at IS NULL')
  if (status === 'suspended') conditions.push('u.blocked_at IS NOT NULL')
  const { rows } = await pool.query(`
    SELECT u.id, u.name, u.email, u.created_at, u.last_login_at, u.blocked_at, u.blocked_reason, u.profile_image_id,
      count(pr.id) FILTER (WHERE pr.decision = 'approved')::int AS approved,
      count(pr.id) FILTER (WHERE pr.decision = 'rejected')::int AS rejected,
      count(pr.id) FILTER (WHERE pr.decision = 'revision_requested')::int AS revision_requested,
      max(pr.created_at) AS last_action_at,
      (SELECT count(*)::int FROM papers p WHERE p.assigned_to = u.id AND p.status = 'under_review') AS in_progress,
      (SELECT a.created_at FROM audit_logs a WHERE a.action = 'moderator.added' AND a.target_type = 'user' AND a.target_id = u.id::text
        ORDER BY a.created_at DESC LIMIT 1) AS moderator_since
    FROM users u LEFT JOIN paper_reviews pr ON pr.reviewer_id = u.id
      AND pr.decision IN ('approved', 'rejected', 'revision_requested')
    WHERE ${conditions.join(' AND ')}
    GROUP BY u.id ORDER BY u.blocked_at IS NOT NULL, u.name LIMIT 200`, values)
  res.json(rows.map(({ profile_image_id, ...moderator }) => ({ ...moderator, avatar_url: avatarUrl(profile_image_id) })))
})

app.get('/api/admin/moderators/:id/activity', auth, requireAdmin, async (req, res) => {
  if (!isPgId(req.params.id)) return res.status(404).json({ error: 'Moderator not found' })
  const { rows } = await pool.query('SELECT id, name, role FROM users WHERE id = $1', [req.params.id])
  if (!rows[0]) return res.status(404).json({ error: 'Moderator not found' })
  res.json({ ...rows[0], ...(await moderatorActivity(rows[0].id)) })
})

app.get('/api/admin/papers', auth, requireAdmin, async (req, res) => {
  const result = await listPapers(req, { admin: true })
  if (result.problem) return sendProblem(res, result.problem)
  res.json(result)
})

app.patch('/api/admin/papers/:id/status', auth, requireAdmin, writeLimiter, async (req, res) => {
  if (!isSafeId(req.params.id)) return res.status(404).json({ error: 'Paper not found' })
  const status = String(req.body?.status ?? '')
  const reason = cleanText(req.body?.reason, 2000)
  const result = await inTransaction(async (db) => {
    const { rows } = await db.query('SELECT id, user_id, title, status, round, authors FROM papers WHERE id = $1 FOR UPDATE', [req.params.id])
    const paper = rows[0]
    const problem = overrideProblem({ paper, actorRole: req.userRole, status, reason })
    if (problem) return fail(problem)
    const updates = {
      pending: 'assigned_to = NULL, review_started_at = NULL, published_at = NULL, published_by = NULL',
      under_review: 'assigned_to = $2, review_started_at = now(), published_at = NULL, published_by = NULL',
      revision_requested: 'reviewed_by = $2, reviewed_at = now(), revision_note = $3, published_at = NULL, published_by = NULL',
      approved: 'reviewed_by = $2, reviewed_at = now(), rejection_reason = NULL, published_at = NULL, published_by = NULL',
      rejected: 'reviewed_by = $2, reviewed_at = now(), rejection_reason = $3, published_at = NULL, published_by = NULL',
      published: 'published_at = now(), published_by = $2, rejection_reason = NULL',
    }
    await db.query(
      `UPDATE papers SET status = $4, ${updates[status]}, updated_at = now() WHERE id = $1 AND $2::int IS NOT NULL AND $3::text IS NOT NULL`,
      [paper.id, req.userId, reason, status]
    )
    await db.query(
      "INSERT INTO paper_reviews (paper_id, reviewer_id, decision, comment, round) VALUES ($1, $2, 'status_changed', $3, $4)",
      [paper.id, req.userId, `Status changed from ${paper.status.replace('_', ' ')} to ${status.replace('_', ' ')}. ${reason}`, paper.round]
    )
    await audit(db, req.userId, status === 'published' ? 'paper.published' : 'paper.status_changed', 'paper', paper.id, { from: paper.status, to: status, reason: reason.slice(0, 500), override: true })
    const label = { pending: 'moved back to the review queue', under_review: 'is under review', revision_requested: 'needs changes', approved: 'was approved', rejected: 'was rejected', published: 'was published' }[status]
    await notifyPaperAuthors(db, paper, `An administrator updated "${paper.title.slice(0, 200)}": it ${label}. ${reason.slice(0, 200)}`)
    return { id: paper.id }
  })
  if (result.problem) return sendProblem(res, result.problem)
  res.json(await loadModerationPaper(result.id, req))
})

app.get('/api/admin/audit-logs', auth, requirePermission('audit.read', 'Super Admin access required'), async (req, res) => {
  const { page, limit, offset } = pageParams(req.query, { max: 100, fallback: 50 })
  const values = []
  const conditions = []
  const action = cleanText(req.query.action, 80)
  if (action) {
    values.push(`${action.replace(/[\\%_]/g, '\\$&')}%`)
    conditions.push(`a.action LIKE $${values.length}`)
  }
  const q = cleanText(req.query.q, 100)
  if (q) {
    values.push(likePattern(q))
    conditions.push(`(u.name ILIKE $${values.length} OR a.action ILIKE $${values.length} OR a.target_id ILIKE $${values.length})`)
  }
  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : ''
  const [{ rows }, countResult] = await Promise.all([
    pool.query(`SELECT a.id, a.action, a.target_type, a.target_id, a.details, a.created_at, a.actor_id,
        u.name AS actor_name, COALESCE(a.actor_role, u.role) AS actor_role
      FROM audit_logs a LEFT JOIN users u ON u.id = a.actor_id ${where}
      ORDER BY a.created_at DESC, a.id DESC LIMIT $${values.length + 1} OFFSET $${values.length + 2}`, [...values, limit, offset]),
    pool.query(`SELECT count(*)::int AS total FROM audit_logs a LEFT JOIN users u ON u.id = a.actor_id ${where}`, values),
  ])
  res.json({ items: rows, page, limit, total: countResult.rows[0].total })
})

app.get('/api/papers/:id/pdf', auth, async (req, res) => {
  if (!/^\d+$/.test(req.params.id)) return res.status(404).json({ error: 'Paper not found' })
  const { rows } = await pool.query(
    'SELECT id, user_id, status, authors, pdf_data, pdf_filename FROM papers WHERE id = $1',
    [req.params.id]
  )
  const paper = rows[0]
  if (!paper || !canReadPaperPdf(paper, req)) return res.status(404).json({ error: 'Paper not found' })
  sendPdf(res, paper)
})

const OPEN_FOR_REVIEW = ['pending', 'under_review']
const isOpenForReview = (status) => OPEN_FOR_REVIEW.includes(status)

function canReadPaperPdf(paper, req) {
  return paper.status === 'published' || String(paper.user_id) === String(req.userId) || isModerator(req) ||
    (paper.authors ?? []).some((a) => String(a.user_id) === String(req.userId)) ||
    (OPEN_FOR_REVIEW.includes(paper.status) && isReviewer(req))
}

function sendPdf(res, paper) {
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
}

function requireReviewer(req, res, next) {
  if (!isReviewer(req)) return res.status(403).json({ error: 'Peer review is open to authors, moderators and admins' })
  next()
}

const REVIEW_SELECT = `
  SELECT r.id::text AS id, r.paper_id, r.round, r.reviewer_id, u.name AS reviewer_name, r.overall_rating,
    r.originality, r.methodology, r.clarity, r.significance, r.recommendation, r.comments,
    r.confidential_comments, r.created_at, r.updated_at,
    COALESCE((SELECT jsonb_agg(jsonb_build_object('id', s.id::text, 'section', s.section, 'body', s.body,
      'status', s.status, 'author_response', s.author_response) ORDER BY s.position)
      FROM review_suggestions s WHERE s.review_id = r.id), '[]'::jsonb) AS suggestions
  FROM peer_reviews r LEFT JOIN users u ON u.id = r.reviewer_id`

const roundSummary = (reviews) => ({
  count: reviews.length,
  overall: average(reviews.map((r) => r.overall_rating)),
  ...Object.fromEntries(CRITERIA.map((c) => [c, average(reviews.map((r) => r[c]))])),
  recommendations: Object.fromEntries(RECOMMENDATIONS.map((rec) => [rec, reviews.filter((r) => r.recommendation === rec).length])),
})

async function paperVersions(paperId, current) {
  const { rows } = await pool.query(
    'SELECT round, draft, title, pdf_filename, pdf_size, submitted_at FROM paper_versions WHERE paper_id = $1 ORDER BY round, draft',
    [paperId]
  )
  return [...rows, {
    round: current.round, draft: current.draft ?? 1, title: current.title, pdf_filename: current.pdf_filename, pdf_size: current.pdf_size,
    submitted_at: (current.draft ?? 1) > 1 ? current.updated_at : current.resubmitted_at ?? current.created_at, current: true,
  }]
}

app.get('/api/reviews/queue', auth, requireReviewer, async (req, res) => {
  if (req.query.scope === 'mine') {
    const { rows } = await pool.query(`
      SELECT r.id::text AS review_id, r.round, r.overall_rating, r.recommendation, r.updated_at,
        p.id, p.title, p.domain, p.status, p.round AS current_round
      FROM peer_reviews r JOIN papers p ON p.id = r.paper_id
      WHERE r.reviewer_id = $1 ORDER BY r.updated_at DESC LIMIT 100`, [req.userId])
    return res.json(rows)
  }
  const { rows } = await pool.query(`
    SELECT p.id, p.title, p.abstract, p.domain, p.tags, p.round, p.created_at, p.resubmitted_at,
      (SELECT count(*)::int FROM peer_reviews r WHERE r.paper_id = p.id AND r.round = p.round) AS review_count,
      EXISTS (SELECT 1 FROM peer_reviews r WHERE r.paper_id = p.id AND r.round = p.round AND r.reviewer_id = $1) AS reviewed_by_me,
      EXISTS (SELECT 1 FROM peer_reviews r WHERE r.paper_id = p.id AND r.round < p.round AND r.reviewer_id = $1) AS reviewed_earlier
    FROM papers p WHERE p.status IN ('pending', 'under_review') AND p.user_id <> $1 AND NOT p.authors @> jsonb_build_array(jsonb_build_object('user_id', $1::int))
    ORDER BY reviewed_by_me, reviewed_earlier DESC, COALESCE(p.resubmitted_at, p.created_at) LIMIT 100`, [req.userId])
  res.json(rows)
})

app.get('/api/reviews/papers/:id', auth, requireReviewer, async (req, res) => {
  if (!isSafeId(req.params.id)) return res.status(404).json({ error: 'Paper not found' })
  const moderator = isModerator(req)
  const { rows } = await pool.query(`
    SELECT p.id, p.user_id, p.title, p.abstract, p.doi, p.domain, p.tags, p.authors, p.additional_notes,
      p.pdf_filename, p.pdf_size, p.status, p.round, p.draft, p.revision_note, p.rejection_reason, p.created_at, p.updated_at,
      p.resubmitted_at, p.reviewed_at, u.name AS submitter_name, u.email AS submitter_email
    FROM papers p JOIN users u ON u.id = p.user_id WHERE p.id = $1`, [req.params.id])
  const paper = rows[0]
  const reviewedBefore = paper && (await pool.query('SELECT 1 FROM peer_reviews WHERE paper_id = $1 AND reviewer_id = $2', [paper.id, req.userId])).rowCount > 0
  const coauthor = paper && (paper.authors ?? []).some((a) => String(a.user_id) === String(req.userId))
  if (!paper || (!moderator && (String(paper.user_id) === String(req.userId) || coauthor || (!isOpenForReview(paper.status) && !reviewedBefore)))) {
    return res.status(404).json({ error: 'Paper not found' })
  }
  const { rows: reviews } = await pool.query(`${REVIEW_SELECT} WHERE r.paper_id = $1 ORDER BY r.round, r.created_at, r.id`, [paper.id])
  const { rows: history } = await pool.query(`
    SELECT pr.id, pr.decision, pr.comment, pr.round, pr.created_at, u.name AS actor_name
    FROM paper_reviews pr LEFT JOIN users u ON u.id = pr.reviewer_id
    WHERE pr.paper_id = $1 ORDER BY pr.created_at, pr.id`, [paper.id])
  const mine = reviews.find((r) => r.round === paper.round && String(r.reviewer_id) === String(req.userId)) ?? null
  const responseLetter = history.findLast((h) => h.decision === 'resubmitted' && h.round === paper.round)?.comment ?? null
  const base = {
    ...paper,
    submitter_email: moderator ? paper.submitter_email : undefined,
    versions: await paperVersions(paper.id, paper),
    response_letter: responseLetter,
    previous_round: anonymise(reviews).filter((r) => r.round === paper.round - 1),
    my_review: mine,
    can_review: isOpenForReview(paper.status) && String(paper.user_id) !== String(req.userId) && !coauthor,
  }
  if (!moderator) return res.json(base)
  res.json({
    ...base,
    coauthor_checks: await coauthorChecks(paper),
    reviews,
    summary: roundSummary(reviews.filter((r) => r.round === paper.round)),
    history,
  })
})

app.put('/api/reviews/papers/:id', auth, requireReviewer, writeLimiter, async (req, res) => {
  if (!isSafeId(req.params.id)) return res.status(404).json({ error: 'Paper not found' })
  let review
  try {
    review = validateReview(req.body ?? {})
  } catch (err) {
    if (err.field) return res.status(400).json({ error: err.message, field: err.field })
    throw err
  }
  const client = await pool.connect()
  let open = false
  try {
    await client.query('BEGIN')
    open = true
    const stop = async (status, body) => { await client.query('ROLLBACK'); open = false; return res.status(status).json(body) }
    const { rows } = await client.query('SELECT id, user_id, title, status, round, authors FROM papers WHERE id = $1 FOR UPDATE', [req.params.id])
    const paper = rows[0]
    if (!paper || String(paper.user_id) === String(req.userId)) return await stop(404, { error: 'Paper not found' })
    if ((paper.authors ?? []).some((a) => String(a.user_id) === String(req.userId))) return await stop(403, { error: 'Co-authors cannot review their own paper' })
    if (!isOpenForReview(paper.status)) return await stop(409, { error: 'This paper is no longer under review' })
    const { rows: saved } = await client.query(`
      INSERT INTO peer_reviews (paper_id, round, reviewer_id, overall_rating, originality, methodology, clarity,
        significance, recommendation, comments, confidential_comments)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
      ON CONFLICT (paper_id, round, reviewer_id) DO UPDATE SET
        overall_rating = EXCLUDED.overall_rating, originality = EXCLUDED.originality,
        methodology = EXCLUDED.methodology, clarity = EXCLUDED.clarity, significance = EXCLUDED.significance,
        recommendation = EXCLUDED.recommendation, comments = EXCLUDED.comments,
        confidential_comments = EXCLUDED.confidential_comments, updated_at = now()
      RETURNING id, (xmax = 0) AS inserted`,
      [paper.id, paper.round, req.userId, review.overallRating, review.scores.originality, review.scores.methodology,
        review.scores.clarity, review.scores.significance, review.recommendation, review.comments, review.confidential]
    )
    await client.query('DELETE FROM review_suggestions WHERE review_id = $1', [saved[0].id])
    for (const [position, item] of review.suggestions.entries()) {
      await client.query(
        'INSERT INTO review_suggestions (review_id, position, section, body) VALUES ($1, $2, $3, $4)',
        [saved[0].id, position, item.section, item.body]
      )
    }
    if (saved[0].inserted) {
      await client.query(
        `INSERT INTO notifications (user_id, actor_id, kind, entity_type, entity_id, text)
         VALUES ($1, NULL, 'paper_review', 'paper', $2, $3)`,
        [paper.user_id, paper.id, `A reviewer sent feedback on "${paper.title.slice(0, 300)}"`]
      )
    }
    const { rows: ready } = await client.query(`SELECT (p.status IN ('pending', 'under_review')
        AND EXISTS (SELECT 1 FROM peer_reviews r WHERE r.paper_id = p.id AND r.round = p.round)
        AND NOT EXISTS (SELECT 1 FROM peer_reviews r WHERE r.paper_id = p.id AND r.round = p.round AND r.recommendation <> 'accept')) AS ready FROM papers p WHERE p.id = $1`, [paper.id])
    if (ready[0].ready && review.recommendation === 'accept') {
      await client.query(
        `INSERT INTO notifications (user_id, actor_id, kind, entity_type, entity_id, text)
         SELECT $1, NULL, 'paper_review', 'paper', $2::bigint, $3::text
         WHERE NOT EXISTS (SELECT 1 FROM notifications WHERE user_id = $1 AND entity_type = 'paper' AND entity_id = $2::bigint AND text = $3::text)`,
        [paper.user_id, paper.id, `Reviewers recommend accepting "${paper.title.slice(0, 300)}". A moderator will make the final decision.`]
      )
    }
    await client.query('COMMIT')
    open = false
    const { rows: result } = await pool.query(`${REVIEW_SELECT} WHERE r.id = $1`, [saved[0].id])
    res.status(saved[0].inserted ? 201 : 200).json(result[0])
  } catch (err) {
    if (open) await client.query('ROLLBACK')
    throw err
  } finally {
    client.release()
  }
})

app.get('/api/papers/:id/feedback', auth, async (req, res) => {
  if (!isSafeId(req.params.id)) return res.status(404).json({ error: 'Paper not found' })
  const { rows } = await pool.query(`
    SELECT p.id, p.title, p.abstract, p.doi, p.domain, p.tags, p.authors, p.additional_notes, p.pdf_filename, p.pdf_size,
      p.status, p.round, p.draft, p.revision_note, p.rejection_reason, p.created_at, p.resubmitted_at, p.reviewed_at, p.updated_at,
      p.user_id = $2 AS is_owner, u.name AS submitter_name
    FROM papers p JOIN users u ON u.id = p.user_id
    WHERE p.id = $1 AND (p.user_id = $2 OR p.authors @> jsonb_build_array(jsonb_build_object('user_id', $2::int)))`, [req.params.id, req.userId])
  const paper = rows[0]
  if (!paper) return res.status(404).json({ error: 'Paper not found' })
  const { rows: all } = await pool.query(`${REVIEW_SELECT} WHERE r.paper_id = $1 ORDER BY r.round, r.created_at, r.id`, [paper.id])
  const visible = anonymise(all).filter((r) => r.round < paper.round || !isOpenForReview(paper.status))
  const { rows: history } = await pool.query(
    'SELECT id, decision, comment, round, created_at FROM paper_reviews WHERE paper_id = $1 ORDER BY created_at, id',
    [paper.id]
  )
  res.json({
    ...paper,
    coauthor_checks: await coauthorChecks(paper),
    my_check_allowed: !paper.is_owner && paper.status === 'coauthor_check',
    reviews: visible,
    pending_review_count: isOpenForReview(paper.status) ? all.filter((r) => r.round === paper.round).length : 0,
    accept_count: isOpenForReview(paper.status) ? all.filter((r) => r.round === paper.round && r.recommendation === 'accept').length : 0,
    can_publish: paper.is_owner && nextStatus(paper.status, 'publish') === 'published',
    summary: roundSummary(visible.filter((r) => r.round === paper.round)),
    history,
    versions: await paperVersions(paper.id, paper),
  })
})

async function coauthorChecks(paper) {
  const { rows } = await pool.query(
    `SELECT c.round, c.draft, c.user_id, u.name, c.decision, c.comment, c.updated_at
     FROM coauthor_checks c JOIN users u ON u.id = c.user_id WHERE c.paper_id = $1 ORDER BY c.round, c.draft, c.updated_at`,
    [paper.id]
  )
  const coauthors = (paper.authors ?? []).slice(1).filter((a) => a.user_id)
  if (!coauthors.length) return []
  const draft = paper.draft ?? 1
  const keys = [...new Set([...rows.map((r) => `${r.round}:${r.draft}`), `${paper.round}:${draft}`])]
    .map((k) => k.split(':').map(Number)).sort((a, b) => a[0] - b[0] || a[1] - b[1])
  return keys.map(([round, d]) => ({
    round,
    draft: d,
    current: round === paper.round && d === draft,
    checks: coauthors.map((a) => rows.find((r) => r.round === round && r.draft === d && String(r.user_id) === String(a.user_id))
      ?? { round, draft: d, user_id: a.user_id, name: a.name, decision: null, comment: '' }),
  }))
}

async function notifyPreviousReviewers(db, paperId, title, exceptUserId) {
  await db.query(`
    INSERT INTO notifications (user_id, actor_id, kind, entity_type, entity_id, text)
    SELECT DISTINCT reviewer_id, NULL::int, 'review_request', 'paper', $1::bigint, $2
    FROM peer_reviews WHERE paper_id = $1 AND reviewer_id IS NOT NULL AND reviewer_id <> $3`,
  [paperId, `"${title.slice(0, 300)}" was revised and is ready for another review`, exceptUserId])
}

app.post('/api/papers/:id/coauthor-update', auth, writeLimiter, paperUpload.single('pdf'), async (req, res) => {
  if (!isSafeId(req.params.id)) return res.status(404).json({ error: 'Paper not found' })
  const note = typeof req.body?.note === 'string' ? req.body.note.trim() : ''
  if (!req.file) return res.status(400).json({ error: 'Choose the corrected PDF', field: 'pdf' })
  if (!isPdf(req.file.buffer)) return res.status(400).json({ error: 'The selected file is not a valid PDF', field: 'pdf' })
  if (note.length < 5 || note.length > 2000) return res.status(400).json({ error: 'Tell your co-authors what you changed (5 to 2,000 characters)', field: 'note' })
  const filename = String(req.file.originalname || 'paper.pdf').replace(/\\/g, '/').split('/').at(-1).replace(/[\r\n\0]/g, '').slice(0, 255) || 'paper.pdf'
  const client = await pool.connect()
  let open = false
  try {
    await client.query('BEGIN')
    open = true
    const { rows } = await client.query(
      `SELECT p.id, p.title, p.status, p.round, p.draft, p.authors, u.name FROM papers p JOIN users u ON u.id = p.user_id
       WHERE p.id = $1 AND p.user_id = $2 FOR UPDATE OF p`,
      [req.params.id, req.userId]
    )
    const paper = rows[0]
    const stop = async (status, body) => { await client.query('ROLLBACK'); open = false; return res.status(status).json(body) }
    if (!paper) return await stop(404, { error: 'Paper not found' })
    if (paper.status !== 'coauthor_check') return await stop(409, { error: 'You can upload a corrected PDF only while your co-authors are checking the paper' })
    await client.query(`
      INSERT INTO paper_versions (paper_id, round, draft, title, abstract, pdf_data, pdf_filename, pdf_size, submitted_at)
      SELECT id, round, draft, title, abstract, pdf_data, pdf_filename, pdf_size, CASE WHEN draft > 1 THEN updated_at ELSE COALESCE(resubmitted_at, created_at) END
      FROM papers WHERE id = $1`, [paper.id])
    const { rows: updated } = await client.query(
      `UPDATE papers SET pdf_data = $2, pdf_filename = $3, pdf_size = $4, draft = draft + 1, updated_at = now()
       WHERE id = $1 RETURNING round, draft`,
      [paper.id, req.file.buffer, filename, req.file.size]
    )
    await client.query(
      "INSERT INTO paper_reviews (paper_id, reviewer_id, decision, comment, round) VALUES ($1, $2, 'coauthor_update', $3, $4)",
      [paper.id, req.userId, note, paper.round]
    )
    await client.query(`
      INSERT INTO notifications (user_id, actor_id, kind, entity_type, entity_id, text)
      SELECT (a->>'user_id')::int, $3::int, 'coauthor', 'paper', $1::bigint, $2::text
      FROM jsonb_array_elements($4::jsonb) AS a WHERE (a->>'user_id')::int <> $3`,
      [paper.id, `${paper.name} uploaded a corrected PDF of "${paper.title.slice(0, 300)}". Please check it again.`, req.userId, JSON.stringify(paper.authors)]
    )
    await client.query('COMMIT')
    open = false
    res.json(updated[0])
  } catch (err) {
    if (open) await client.query('ROLLBACK')
    throw err
  } finally {
    client.release()
  }
})

app.put('/api/papers/:id/coauthor-check', auth, writeLimiter, async (req, res) => {
  if (!isSafeId(req.params.id)) return res.status(404).json({ error: 'Paper not found' })
  const decision = req.body?.decision
  const comment = typeof req.body?.comment === 'string' ? req.body.comment.trim() : ''
  if (!['approve', 'changes'].includes(decision)) return res.status(400).json({ error: 'Choose approve or request changes', field: 'decision' })
  if (decision === 'changes' && comment.length < 5) return res.status(400).json({ error: 'Explain what should change (at least 5 characters)', field: 'comment' })
  if (comment.length > 3000) return res.status(400).json({ error: 'Comments must be 3,000 characters or fewer', field: 'comment' })
  const { rows } = await pool.query(
    `SELECT p.id, p.user_id, p.title, p.status, p.round, p.draft, p.authors, u.name AS checker
     FROM papers p, users u WHERE p.id = $1 AND u.id = $2
       AND p.authors @> jsonb_build_array(jsonb_build_object('user_id', $2::int)) AND p.user_id <> $2`,
    [req.params.id, req.userId]
  )
  const paper = rows[0]
  if (!paper) return res.status(404).json({ error: 'Paper not found' })
  if (paper.status !== 'coauthor_check') {
    return res.status(409).json({ error: isOpenForReview(paper.status) ? 'All co-authors already approved this version; it is with the reviewers and moderators' : 'Co-author checks are closed for this paper' })
  }
  await pool.query(
    `INSERT INTO coauthor_checks (paper_id, round, draft, user_id, decision, comment) VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (paper_id, round, draft, user_id) DO UPDATE SET decision = EXCLUDED.decision, comment = EXCLUDED.comment, updated_at = now()`,
    [paper.id, paper.round, paper.draft, req.userId, decision, comment]
  )
  await pool.query(
    `INSERT INTO notifications (user_id, actor_id, kind, entity_type, entity_id, text) VALUES ($1, $2, 'paper_review', 'paper', $3, $4)`,
    [paper.user_id, req.userId, paper.id, `${paper.checker} ${decision === 'approve' ? 'approved' : 'asked for changes to'} "${paper.title.slice(0, 300)}"${decision === 'changes' && comment ? `: ${comment.slice(0, 120)}` : ''}`]
  )
  const coauthorIds = paper.authors.slice(1).map((a) => a.user_id).filter(Boolean)
  const { rows: approvals } = await pool.query(
    `SELECT count(*)::int AS n FROM coauthor_checks WHERE paper_id = $1 AND round = $2 AND draft = $3 AND decision = 'approve' AND user_id = ANY($4::int[])`,
    [paper.id, paper.round, paper.draft, coauthorIds]
  )
  let status = paper.status
  if (approvals[0].n === coauthorIds.length) {
    const moved = await pool.query("UPDATE papers SET status = 'pending', updated_at = now() WHERE id = $1 AND status = 'coauthor_check' RETURNING status", [paper.id])
    if (moved.rowCount) {
      status = 'pending'
      await pool.query("INSERT INTO paper_reviews (paper_id, reviewer_id, decision, comment, round) VALUES ($1, NULL, 'coauthors_approved', '', $2)", [paper.id, paper.round])
      await pool.query(
        `INSERT INTO notifications (user_id, actor_id, kind, entity_type, entity_id, text) VALUES ($1, NULL, 'paper_review', 'paper', $2, $3)`,
        [paper.user_id, paper.id, `All co-authors approved "${paper.title.slice(0, 300)}". It is now waiting for moderator verification.`]
      )
      if (paper.round > 1) await notifyPreviousReviewers(pool, paper.id, paper.title, paper.user_id)
    }
  }
  res.json({ round: paper.round, draft: paper.draft, decision, comment, status, checks: await coauthorChecks({ ...paper, status }) })
})

const PUBLISH_BLOCKED = {
  coauthor_check: 'Your co-authors must approve the PDF, then a moderator must verify the paper before it can be published.',
  pending: 'A moderator must verify and approve this paper before you can publish it.',
  under_review: 'A moderator is verifying this paper. You can publish it once it is approved.',
  revision_requested: 'A moderator asked for changes. Revise and resubmit the paper first.',
  rejected: 'Rejected papers cannot be published.',
  published: 'This paper is already published',
}

app.post('/api/papers/:id/publish', auth, writeLimiter, async (req, res) => {
  if (!isSafeId(req.params.id)) return res.status(404).json({ error: 'Paper not found' })
  const result = await inTransaction(async (db) => {
    const { rows } = await db.query(
      'SELECT id, user_id, title, status, round, authors FROM papers WHERE id = $1 AND user_id = $2 FOR UPDATE',
      [req.params.id, req.userId]
    )
    const paper = rows[0]
    if (!paper) return fail({ status: 404, error: 'Paper not found' })
    if (nextStatus(paper.status, 'publish') !== 'published') {
      return fail({ status: 409, error: PUBLISH_BLOCKED[paper.status] ?? 'This paper cannot be published', code: 'not_approved' })
    }
    const { rows: changed } = await db.query(
      `UPDATE papers SET status = 'published', published_at = now(), published_by = $2, updated_at = now()
       WHERE id = $1 RETURNING status, published_at, reviewed_at`,
      [paper.id, req.userId]
    )
    await db.query(
      "INSERT INTO paper_reviews (paper_id, reviewer_id, decision, comment, round) VALUES ($1, $2, 'published', 'Published by the author', $3)",
      [paper.id, req.userId, paper.round]
    )
    await audit(db, req.userId, 'paper.published', 'paper', paper.id, { round: paper.round, from: paper.status })
    await db.query(
      `INSERT INTO notifications (user_id, actor_id, kind, entity_type, entity_id, text)
       SELECT (a->>'user_id')::int, $2::int, 'coauthor', 'paper', $1::bigint, $3::text
       FROM jsonb_array_elements($4::jsonb) AS a WHERE a ? 'user_id' AND (a->>'user_id')::int <> $2`,
      [paper.id, req.userId, `Your co-authored paper "${paper.title.slice(0, 300)}" is now published`, JSON.stringify(paper.authors)]
    )
    return { paper: changed[0] }
  })
  if (result.problem) return sendProblem(res, result.problem)
  res.json(result.paper)
})

app.delete('/api/papers/:id', auth, writeLimiter, async (req, res) => {
  if (!isSafeId(req.params.id)) return res.status(404).json({ error: 'Paper not found' })
  const { rows } = await pool.query(
    `SELECT p.id, p.title, p.status, p.round, p.authors, u.name FROM papers p JOIN users u ON u.id = p.user_id WHERE p.id = $1 AND p.user_id = $2`,
    [req.params.id, req.userId]
  )
  const paper = rows[0]
  if (!paper) return res.status(404).json({ error: 'Paper not found' })
  if (paper.status === 'published') return res.status(409).json({ error: 'Published papers cannot be withdrawn' })
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    await client.query(
      `INSERT INTO notifications (user_id, actor_id, kind, entity_type, entity_id, text)
       SELECT (a->>'user_id')::int, $1::int, 'coauthor', 'user', $1::bigint, $2::text
       FROM jsonb_array_elements($3::jsonb) AS a WHERE (a->>'user_id')::int <> $1`,
      [req.userId, `${paper.name} withdrew "${paper.title.slice(0, 300)}"`, JSON.stringify(paper.authors ?? [])]
    )
    await client.query(
      `INSERT INTO audit_logs (actor_id, action, target_type, target_id, details)
       VALUES ($1, 'paper.withdrawn', 'paper', $2::text, jsonb_build_object('title', $3::text, 'status', $4::text, 'round', $5::int))`,
      [req.userId, paper.id, paper.title, paper.status, paper.round]
    )
    await client.query('DELETE FROM papers WHERE id = $1', [paper.id])
    await client.query('COMMIT')
  } catch (err) {
    await client.query('ROLLBACK')
    throw err
  } finally {
    client.release()
  }
  res.status(204).end()
})

app.post('/api/papers/:id/resubmit', auth, writeLimiter, paperUpload.single('pdf'), async (req, res) => {
  if (!isSafeId(req.params.id)) return res.status(404).json({ error: 'Paper not found' })
  const client = await pool.connect()
  let open = false
  try {
    await client.query('BEGIN')
    open = true
    const stop = async (status, body) => { await client.query('ROLLBACK'); open = false; return res.status(status).json(body) }
    const { rows } = await client.query('SELECT id, title, status, round, authors FROM papers WHERE id = $1 AND user_id = $2 FOR UPDATE', [req.params.id, req.userId])
    const paper = rows[0]
    if (!paper) return await stop(404, { error: 'Paper not found' })
    if (paper.status !== 'revision_requested') return await stop(409, { error: 'Only papers with requested changes can be resubmitted' })

    const { rows: openRows } = await client.query(`
      SELECT s.id::text AS id FROM review_suggestions s JOIN peer_reviews r ON r.id = s.review_id
      WHERE r.paper_id = $1 AND r.round = $2 AND s.status = 'open'`, [paper.id, paper.round])
    let revision
    let details
    try {
      revision = validateResubmission(req.body ?? {}, openRows.map((r) => r.id))
      details = validatePaperSubmission(req.body ?? {}, req.file, MAX_PDF_BYTES, { requireFile: false })
    } catch (err) {
      if (err.field) return await stop(400, { error: err.message, field: err.field })
      throw err
    }

    await client.query(`
      INSERT INTO paper_versions (paper_id, round, draft, title, abstract, pdf_data, pdf_filename, pdf_size, submitted_at)
      SELECT id, round, draft, title, abstract, pdf_data, pdf_filename, pdf_size, CASE WHEN draft > 1 THEN updated_at ELSE COALESCE(resubmitted_at, created_at) END
      FROM papers WHERE id = $1`, [paper.id])
    for (const answer of revision.responses) {
      await client.query(
        'UPDATE review_suggestions SET status = $2, author_response = $3, responded_at = now() WHERE id = $1',
        [answer.id, answer.status, answer.response]
      )
    }
    const { rows: updated } = await client.query(`
      UPDATE papers SET title = $2, abstract = $3, doi = $4, domain = $5, tags = $6, authors = $7::jsonb,
        additional_notes = $8,
        pdf_data = COALESCE($9, pdf_data), pdf_filename = COALESCE($10, pdf_filename), pdf_size = COALESCE($11, pdf_size),
        round = round + 1, draft = 1, status = $12, resubmitted_at = now(), updated_at = now()
      WHERE id = $1 RETURNING id, title, status, round, resubmitted_at`,
      [paper.id, details.title, details.abstract, details.doi, details.domain, details.tags,
        JSON.stringify(paper.authors.map((author, i) => ({ ...author, affiliation: details.authors[i]?.affiliation ?? author.affiliation }))),
        details.additionalNotes, details.pdfData, details.filename, details.pdfSize,
        paper.authors.length > 1 ? 'coauthor_check' : 'pending']
    )
    const next = updated[0]
    await client.query(
      "INSERT INTO paper_reviews (paper_id, reviewer_id, decision, comment, round) VALUES ($1, $2, 'resubmitted', $3, $4)",
      [paper.id, req.userId, revision.responseLetter, next.round]
    )
    if (next.status === 'pending') await notifyPreviousReviewers(client, paper.id, next.title, req.userId)
    await client.query(`
      INSERT INTO notifications (user_id, actor_id, kind, entity_type, entity_id, text)
      SELECT (a->>'user_id')::int, $3::int, 'coauthor', 'paper', $1::bigint, $2::text
      FROM jsonb_array_elements($4::jsonb) AS a WHERE (a->>'user_id')::int <> $3`,
      [paper.id, `Round ${next.round} of "${next.title.slice(0, 300)}" is ready. Check the new PDF and approve it so it can go back to peer review.`, req.userId, JSON.stringify(paper.authors)]
    )
    await client.query(
      "INSERT INTO audit_logs (actor_id, action, target_type, target_id, details) VALUES ($1, 'paper.resubmitted', 'paper', $2::text, jsonb_build_object('round', $3::int, 'newPdf', $4::boolean))",
      [req.userId, paper.id, next.round, !!details.pdfData]
    )
    await client.query('COMMIT')
    open = false
    res.json(next)
  } catch (err) {
    if (open) await client.query('ROLLBACK')
    throw err
  } finally {
    client.release()
  }
})

app.get('/api/papers/:id/versions/:round/pdf', auth, async (req, res) => {
  const draft = /^\d{1,3}$/.test(String(req.query.draft ?? '1')) ? Number(req.query.draft ?? 1) : 0
  if (!isSafeId(req.params.id) || !/^\d{1,2}$/.test(req.params.round) || !draft) return res.status(404).json({ error: 'Version not found' })
  const { rows } = await pool.query(`
    SELECT v.pdf_data, v.pdf_filename, p.user_id, p.status, p.authors FROM paper_versions v JOIN papers p ON p.id = v.paper_id
    WHERE v.paper_id = $1 AND v.round = $2 AND v.draft = $3`, [req.params.id, req.params.round, draft])
  if (!rows[0] || !canReadPaperPdf(rows[0], req)) return res.status(404).json({ error: 'Version not found' })
  sendPdf(res, rows[0])
})

app.delete('/api/posts/:id', auth, async (req, res) => {
  const id = Number(req.params.id)
  if (!Number.isSafeInteger(id) || id <= 0 || id > 2147483647) return res.status(404).json({ error: 'Post not found' })
  const { rows } = await pool.query(
    `WITH d AS (DELETE FROM posts WHERE id = $1 AND (user_id = $2 OR $3) RETURNING id, user_id, image_id),
     di AS (DELETE FROM images WHERE id IN (SELECT image_id FROM d)),
     logged AS (
       INSERT INTO audit_logs (actor_id, action, target_type, target_id, details)
       SELECT $2, 'post.remove', 'post', d.id::text, jsonb_build_object('authorId', d.user_id)
       FROM d WHERE d.user_id <> $2
     )
     SELECT count(*)::int AS n FROM d`,
    [id, req.userId, isModerator(req)]
  )
  if (!rows[0].n) return res.status(404).json({ error: 'Post not found' })
  res.status(204).end()
})

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




// ==========================================
// RESEARCH IMPACT & CITATION NETWORK
// ==========================================

// GET: Citation dashboard
  

// GET: Citation dashboard
app.get('/api/citations/dashboard', auth, async (req, res, next) => {
  try {
    const search = typeof req.query.q === 'string'
      ? req.query.q.trim().slice(0, 100)
      : '';

    const searchPattern = `%${search}%`;

    const [
      summary,
      leaders,
      recent,
      monthly,
      network,
      myPapers,
      discoverable
    ] = await Promise.all([

      // 1. Overall citation statistics
      pool.query(`
        SELECT
          COUNT(*)::int AS total_citations,
          COUNT(DISTINCT pc.cited_paper_id)::int AS cited_papers,
          COUNT(DISTINCT pc.citing_paper_id)::int AS citing_papers
        FROM paper_citations pc
        JOIN papers source
          ON source.id = pc.citing_paper_id
          AND source.status = 'published'
        JOIN papers target
          ON target.id = pc.cited_paper_id
          AND target.status = 'published'
      `),

      // 2. Most cited approved papers
      pool.query(`
        SELECT
          target.id,
          target.title,
          target.domain,
          COUNT(pc.id)::int AS citation_count
        FROM papers target
        LEFT JOIN paper_citations pc
          ON pc.cited_paper_id = target.id
        LEFT JOIN papers source
          ON source.id = pc.citing_paper_id
          AND source.status = 'published'
        WHERE target.status = 'published'
        GROUP BY target.id, target.title, target.domain, target.created_at
        ORDER BY citation_count DESC, target.created_at DESC
        LIMIT 10
      `),

      // 3. Recent valid citations
      pool.query(`
        SELECT
          pc.id,
          pc.created_at,
          source.id AS citing_paper_id,
          target.id AS cited_paper_id,
          source.title AS citing_title,
          target.title AS cited_title
        FROM paper_citations pc
        JOIN papers source
          ON source.id = pc.citing_paper_id
          AND source.status = 'published'
        JOIN papers target
          ON target.id = pc.cited_paper_id
          AND target.status = 'published'
        WHERE
          $1 = ''
          OR source.title ILIKE $2
          OR target.title ILIKE $2
        ORDER BY pc.created_at DESC
        LIMIT 50
      `, [search, searchPattern]),

      // 4. Monthly citation activity for the last six months
      pool.query(`
        SELECT
          TO_CHAR(months.month, 'Mon YYYY') AS month,
          COUNT(pc.id) FILTER (
            WHERE source.id IS NOT NULL
              AND target.id IS NOT NULL
          )::int AS citations
        FROM generate_series(
          date_trunc('month', CURRENT_DATE) - INTERVAL '5 months',
          date_trunc('month', CURRENT_DATE),
          INTERVAL '1 month'
        ) AS months(month)
        LEFT JOIN paper_citations pc
          ON date_trunc('month', pc.created_at) = months.month
        LEFT JOIN papers source
          ON source.id = pc.citing_paper_id
          AND source.status = 'published'
        LEFT JOIN papers target
          ON target.id = pc.cited_paper_id
          AND target.status = 'published'
        GROUP BY months.month
        ORDER BY months.month
      `),

      // 5. Citation network edges
      pool.query(`
        SELECT
          pc.id,
          pc.citing_paper_id,
          pc.cited_paper_id,
          source.title AS citing_title,
          target.title AS cited_title,
          pc.created_at
        FROM paper_citations pc
        JOIN papers source
          ON source.id = pc.citing_paper_id
          AND source.status = 'published'
        JOIN papers target
          ON target.id = pc.cited_paper_id
          AND target.status = 'published'
        ORDER BY pc.created_at DESC
        LIMIT 60
      `),

      // 6. Current user's own approved papers
      pool.query(`
        SELECT id, title, domain
        FROM papers
        WHERE user_id = $1
          AND status = 'published'
        ORDER BY created_at DESC
      `, [req.userId]),

      // 7. Searchable approved research papers
      pool.query(`
        SELECT id, title, domain
        FROM papers
        WHERE status = 'published'
          AND (
            $1 = ''
            OR title ILIKE $2
            OR abstract ILIKE $2
            OR domain ILIKE $2
          )
        ORDER BY title ASC
        LIMIT 100
      `, [search, searchPattern])

    ]);

    res.json({
      summary: summary.rows[0],
      leaders: leaders.rows,
      recent: recent.rows,
      monthly: monthly.rows,
      network: network.rows,
      myPapers: myPapers.rows,
      discoverable: discoverable.rows
    });

  } catch (err) {
    next(err);
  }
});

// POST: Register a citation
app.post('/api/citations', auth, async (req, res, next) => {
  try {
    const { citingPaperId, citedPaperId } =
      validateCitationInput(req.body ?? {});

    const papers = await pool.query(`
      SELECT id, user_id, status
      FROM papers
      WHERE id = ANY($1::bigint[])
    `, [[citingPaperId, citedPaperId]]);

    const citingPaper = papers.rows.find(
      paper => String(paper.id) === String(citingPaperId)
    );

    const citedPaper = papers.rows.find(
      paper => String(paper.id) === String(citedPaperId)
    );

    if (!citingPaper || !citedPaper ||
        citingPaper.status !== 'published' ||
        citedPaper.status !== 'published') {
      return res.status(404).json({
        error: 'Both papers must exist and be published.'
      });
    }

    if (String(citingPaper.user_id) !== String(req.userId)) {
      return res.status(403).json({
        error: 'You can only register citations from your own papers.'
      });
    }

    const result = await pool.query(`
      INSERT INTO paper_citations
        (citing_paper_id, cited_paper_id, created_by)
      VALUES ($1, $2, $3)
      RETURNING id, citing_paper_id, cited_paper_id, created_at
    `, [citingPaperId, citedPaperId, req.userId]);

    res.status(201).json({
      message: 'Citation registered successfully.',
      citation: result.rows[0]
    });
  } catch (err) {
    if (err.code === '23505') {
      return res.status(409).json({
        error: 'This citation already exists.'
      });
    }

    if (err.status === 400 || err.field) {
      return res.status(400).json({ error: err.message });
    }

    next(err);
  }
});

/* =========================================
   AUTOMATIC PDF CITATION DETECTION
========================================= */

// Scan an author's approved PDF for references to other
// approved papers already available in SNARP.
app.post('/api/papers/:id/scan-references', auth, requireAuthor, async (req, res, next) => {
  try {
    if (!isPgBigId(req.params.id)) {
      return res.status(404).json({ error: 'Paper not found.' });
    }

    const { rows: sourceRows } = await pool.query(
      `SELECT id, user_id, title, status, pdf_data
       FROM papers
       WHERE id = $1`,
      [req.params.id]
    );

    const source = sourceRows[0];

    if (!source) {
      return res.status(404).json({ error: 'Paper not found.' });
    }

    if (String(source.user_id) !== String(req.userId)) {
      return res.status(403).json({
        error: 'You can only scan your own papers.'
      });
    }

    if (source.status !== 'published') {
      return res.status(409).json({
        error: 'Your paper must be published before scanning references.'
      });
    }

    const { rows: approvedPapers } = await pool.query(
      `SELECT p.id, p.title, p.doi
       FROM papers p
       WHERE p.status = 'published'
         AND p.id <> $1
         AND NOT EXISTS (
           SELECT 1
           FROM paper_citations pc
           WHERE pc.citing_paper_id = $1
             AND pc.cited_paper_id = p.id
         )
         AND NOT EXISTS (
           SELECT 1
           FROM citation_suggestions cs
           WHERE cs.citing_paper_id = $1
             AND cs.cited_paper_id = p.id
         )
       ORDER BY p.created_at DESC
       LIMIT 500`,
      [source.id]
    );

    const scan = await extractReferenceMatches(
      source.pdf_data,
      approvedPapers
    );

    let insertedCount = 0;

    for (const match of scan.matches) {
      const inserted = await pool.query(
        `INSERT INTO citation_suggestions (
           citing_paper_id,
           cited_paper_id,
           created_by,
           match_type,
           confidence,
           evidence_text
         )
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (citing_paper_id, cited_paper_id)
         DO NOTHING
         RETURNING id`,
        [
          source.id,
          match.citedPaperId,
          req.userId,
          match.matchType,
          match.confidence,
          match.evidenceText
        ]
      );

      if (inserted.rows[0]) insertedCount++;
    }

    const { rows: suggestions } = await pool.query(
      `SELECT
         cs.id,
         cs.match_type,
         cs.confidence,
         cs.evidence_text,
         cs.created_at,
         source.id AS citing_paper_id,
         source.title AS citing_title,
         target.id AS cited_paper_id,
         target.title AS cited_title
       FROM citation_suggestions cs
       JOIN papers source ON source.id = cs.citing_paper_id
       JOIN papers target ON target.id = cs.cited_paper_id
       WHERE cs.created_by = $1
         AND cs.citing_paper_id = $2
         AND cs.status = 'pending'
         AND source.status = 'published'
         AND target.status = 'published'
       ORDER BY cs.confidence DESC, cs.created_at DESC`,
      [req.userId, source.id]
    );

    res.json({
      message: scan.referenceSectionFound
        ? `${scan.matches.length} possible match(es) found. ${insertedCount} new suggestion(s) added.`
        : scan.message,
      referenceSectionFound: scan.referenceSectionFound,
      matchedCount: scan.matches.length,
      insertedCount,
      suggestions
    });

  } catch (err) {
    next(err);
  }
});


// Get pending citation suggestions for the logged-in author.
app.get('/api/citations/suggestions', auth, requireAuthor, async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      `SELECT
         cs.id,
         cs.match_type,
         cs.confidence,
         cs.evidence_text,
         cs.created_at,
         source.id AS citing_paper_id,
         source.title AS citing_title,
         target.id AS cited_paper_id,
         target.title AS cited_title
       FROM citation_suggestions cs
       JOIN papers source ON source.id = cs.citing_paper_id
       JOIN papers target ON target.id = cs.cited_paper_id
       WHERE cs.created_by = $1
         AND cs.status = 'pending'
         AND source.user_id = $1
         AND source.status = 'published'
         AND target.status = 'published'
       ORDER BY cs.confidence DESC, cs.created_at DESC
       LIMIT 50`,
      [req.userId]
    );

    res.json({ suggestions: rows });

  } catch (err) {
    next(err);
  }
});


// Accept a detected citation.
// Only now is a real paper_citations record created.
app.post('/api/citations/suggestions/:id/accept', auth, requireAuthor, async (req, res, next) => {
  if (!isPgBigId(req.params.id)) {
    return res.status(404).json({ error: 'Suggestion not found.' });
  }

  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const { rows } = await client.query(
      `SELECT
         cs.id,
         cs.citing_paper_id,
         cs.cited_paper_id,
         source.user_id AS source_owner,
         source.status AS source_status,
         target.status AS target_status
       FROM citation_suggestions cs
       JOIN papers source ON source.id = cs.citing_paper_id
       JOIN papers target ON target.id = cs.cited_paper_id
       WHERE cs.id = $1
         AND cs.created_by = $2
         AND cs.status = 'pending'
       FOR UPDATE OF cs`,
      [req.params.id, req.userId]
    );

    const suggestion = rows[0];

    if (!suggestion) {
      await client.query('ROLLBACK');
      return res.status(404).json({
        error: 'Pending citation suggestion not found.'
      });
    }

    if (
      String(suggestion.source_owner) !== String(req.userId) ||
      suggestion.source_status !== 'published' ||
      suggestion.target_status !== 'published'
    ) {
      await client.query('ROLLBACK');
      return res.status(409).json({
        error: 'Both papers must remain published and the citing paper must belong to you.'
      });
    }

    const inserted = await client.query(
      `INSERT INTO paper_citations (
         citing_paper_id,
         cited_paper_id,
         created_by
       )
       VALUES ($1, $2, $3)
       ON CONFLICT (citing_paper_id, cited_paper_id)
       DO NOTHING
       RETURNING id`,
      [
        suggestion.citing_paper_id,
        suggestion.cited_paper_id,
        req.userId
      ]
    );

    let citationId = inserted.rows[0]?.id;

    // Handle a citation that was registered manually in the meantime.
    if (!citationId) {
      const existing = await client.query(
        `SELECT id
         FROM paper_citations
         WHERE citing_paper_id = $1
           AND cited_paper_id = $2`,
        [suggestion.citing_paper_id, suggestion.cited_paper_id]
      );

      citationId = existing.rows[0]?.id;
    }

    await client.query(
      `UPDATE citation_suggestions
       SET status = 'accepted',
           citation_id = $2,
           updated_at = NOW()
       WHERE id = $1`,
      [suggestion.id, citationId]
    );

    await client.query('COMMIT');

    res.json({
      message: inserted.rows[0]
        ? 'Detected citation accepted and registered.'
        : 'This citation was already registered.',
      citationId
    });

  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    next(err);
  } finally {
    client.release();
  }
});


// Dismiss an incorrect detected citation.
app.post('/api/citations/suggestions/:id/dismiss', auth, requireAuthor, async (req, res, next) => {
  try {
    if (!isPgBigId(req.params.id)) {
      return res.status(404).json({ error: 'Suggestion not found.' });
    }

    const { rows } = await pool.query(
      `UPDATE citation_suggestions cs
       SET status = 'dismissed',
           updated_at = NOW()
       WHERE cs.id = $1
         AND cs.created_by = $2
         AND cs.status = 'pending'
         AND EXISTS (
           SELECT 1
           FROM papers p
           WHERE p.id = cs.citing_paper_id
             AND p.user_id = $2
         )
       RETURNING cs.id`,
      [req.params.id, req.userId]
    );

    if (!rows[0]) {
      return res.status(404).json({
        error: 'Pending suggestion not found.'
      });
    }

    res.json({ message: 'Citation suggestion dismissed.' });

  } catch (err) {
    next(err);
  }
});

// DELETE: Remove a citation registered from your own paper
app.delete('/api/citations/:id', auth, async (req, res, next) => {
  try {
    if (!isPgBigId(req.params.id)) {
      return res.status(404).json({ error: 'Citation not found.' });
    }

    const result = await pool.query(`
      DELETE FROM paper_citations pc
      USING papers p
      WHERE pc.id = $1
        AND p.id = pc.citing_paper_id
        AND p.user_id = $2
      RETURNING pc.id
    `, [req.params.id, req.userId]);

    if (!result.rowCount) {
      return res.status(404).json({
        error: 'Citation not found or you do not have permission to delete it.'
      });
    }

    res.status(204).end();
  } catch (err) {
    next(err);
  }
});


app.use('/api', (_req, res) => res.status(404).json({ error: 'Not found' }))

if (SERVE_FRONTEND) {
  app.use(express.static(FRONTEND_DIST, {
    index: false,
    setHeaders: (res, path) => res.set('Cache-Control', /[\\/]assets[\\/]/.test(path) ? 'public, max-age=31536000, immutable' : 'no-cache'),
  }))
  app.get('/{*splat}', (_req, res) => res.set('Cache-Control', 'no-cache').sendFile('index.html', { root: FRONTEND_DIST }))
}

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

const server = app.listen(PORT, (err) => {
  if (err) {
    log('error', 'api_listen_failed', { port: PORT, code: err.code ?? 'unknown' })
    if (err.code === 'EADDRINUSE') console.error(`Port ${PORT} is already in use. Stop the other SNARP server or set PORT to a free port.`)
    pool.end().finally(() => process.exit(1))
    return
  }
  log('info', 'api_listening', { port: PORT, poolMax: PG_POOL_MAX, servesFrontend: SERVE_FRONTEND })
  if (REQUIRE_EMAIL_VERIFICATION && IS_PRODUCTION && !APP_URL) {
    log('warn', 'app_url_not_set', { message: `Emailed links point to http://localhost:${PORT}. Set APP_URL to the public address of the site.` })
  }
  if (mailer.configured) {
    mailer.verify()
      .then(() => log('info', 'smtp_ready', { message: 'SMTP login works; emails will be sent.' }))
      .catch((err) => log('error', 'smtp_login_failed', { code: err.code ?? null, message: err.message }))
  }
  if (REQUIRE_EMAIL_VERIFICATION && !mailer.configured) {
    log('warn', 'smtp_not_configured', { message: 'Verification emails are written to this log instead of being sent. Set SMTP_URL or SMTP_HOST to send them.' })
  }
})
const docsSocket = attachCollaborationWebSocket(server, collaboration, log)

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
  // Live editors are disconnected first and their unsaved changes written before the database closes.
  flushCollaboration(collaboration, docsSocket).catch((err) => log('error', 'docs_flush_failed', { message: err.message })).finally(() => server.close(async (err) => {
    clearTimeout(timeout)
    try {
      await pool.end()
      log(err ? 'error' : 'info', 'shutdown_complete', err ? { code: err.code ?? 'unknown' } : {})
      if (err) process.exitCode = 1
    } catch (closeError) {
      log('error', 'database_pool_close_failed', { code: closeError.code ?? 'unknown' })
      process.exitCode = 1
    }
  }))
  server.closeIdleConnections?.()
}
process.on('SIGTERM', () => shutdown('SIGTERM'))
process.on('SIGINT', () => shutdown('SIGINT'))

import { appendFileSync } from 'node:fs'
import { randomBytes } from 'node:crypto'
import express from 'express'
import pg from 'pg'
import bcrypt from 'bcryptjs'
import jwt from 'jsonwebtoken'
import multer from 'multer'
import { sniffImage } from './image.js'
import { DEFAULT_MAX_PDF_BYTES, validatePaperSubmission } from './paper.js'

// Connection settings come from the standard PG* env vars (PGHOST, PGPORT, PGUSER, PGPASSWORD), see .env.example
const DB_NAME = process.env.PGDATABASE || 'snarp'
const PORT = process.env.PORT || 5000
const configuredMaxPdfBytes = Number(process.env.PAPER_MAX_PDF_BYTES || '')
const MAX_PDF_BYTES = Number.isSafeInteger(configuredMaxPdfBytes) && configuredMaxPdfBytes > 0
  ? Math.min(configuredMaxPdfBytes, DEFAULT_MAX_PDF_BYTES)
  : DEFAULT_MAX_PDF_BYTES

// First run: generate a JWT secret and save it so logins survive restarts
if (!process.env.JWT_SECRET) {
  process.env.JWT_SECRET = randomBytes(48).toString('hex')
  appendFileSync(new URL('.env', import.meta.url), `\nJWT_SECRET=${process.env.JWT_SECRET}\n`)
  console.log('Generated JWT_SECRET in backend/.env')
}
const JWT_SECRET = process.env.JWT_SECRET

// Creates the database and tables on first run; no-op when they already exist
async function setupDb() {
  const admin = new pg.Client({ database: 'postgres' })
  await admin.connect()
  const { rowCount } = await admin.query('SELECT 1 FROM pg_database WHERE datname = $1', [DB_NAME])
  if (!rowCount) {
    await admin.query(`CREATE DATABASE "${DB_NAME.replaceAll('"', '""')}"`)
    console.log(`Created database ${DB_NAME}`)
  }
  await admin.end()

  const pool = new pg.Pool({ database: DB_NAME })
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id            SERIAL PRIMARY KEY,
      name          VARCHAR(100) NOT NULL,
      email         VARCHAR(255) NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      role          VARCHAR(20) NOT NULL DEFAULT 'user' CHECK (role IN ('admin', 'moderator', 'author', 'user')),
      created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    -- Post images live in Postgres as BYTEA
    CREATE TABLE IF NOT EXISTS images (
      id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      mime       VARCHAR(20) NOT NULL,
      data       BYTEA NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE TABLE IF NOT EXISTS posts (
      id         SERIAL PRIMARY KEY,
      user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      body       TEXT NOT NULL DEFAULT '',
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS posts_created_at_idx ON posts (created_at DESC);
    -- Upgrades posts tables created before image support
    ALTER TABLE posts ADD COLUMN IF NOT EXISTS image_id UUID REFERENCES images(id) ON DELETE SET NULL;
    ALTER TABLE posts DROP CONSTRAINT IF EXISTS posts_body_check;
    DO $$ BEGIN
      ALTER TABLE posts ADD CONSTRAINT posts_content_check
        CHECK (length(body) <= 5000 AND (length(trim(body)) > 0 OR image_id IS NOT NULL));
    EXCEPTION WHEN duplicate_object THEN NULL;
    END $$;
    CREATE TABLE IF NOT EXISTS papers (
      id                 BIGSERIAL PRIMARY KEY,
      user_id            INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      title              VARCHAR(300) NOT NULL,
      abstract           TEXT NOT NULL,
      doi                VARCHAR(255),
      domain             VARCHAR(120) NOT NULL,
      tags               TEXT[] NOT NULL DEFAULT '{}',
      authors            JSONB NOT NULL,
      pdf_data           BYTEA NOT NULL,
      pdf_filename       VARCHAR(255) NOT NULL,
      pdf_content_type   VARCHAR(100) NOT NULL DEFAULT 'application/pdf' CHECK (pdf_content_type = 'application/pdf'),
      pdf_size           INTEGER NOT NULL CHECK (pdf_size > 0 AND pdf_size <= 10485760),
      additional_notes   TEXT,
      status             VARCHAR(20) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
      idempotency_key    UUID,
      created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
      UNIQUE (user_id, idempotency_key)
    );
    ALTER TABLE papers ADD COLUMN IF NOT EXISTS reviewed_by INTEGER REFERENCES users(id) ON DELETE SET NULL;
    ALTER TABLE papers ADD COLUMN IF NOT EXISTS reviewed_at TIMESTAMPTZ;
    ALTER TABLE papers ADD COLUMN IF NOT EXISTS rejection_reason TEXT;
    CREATE INDEX IF NOT EXISTS papers_status_created_at_idx ON papers (status, created_at DESC);`)
  return pool
}

const pool = await setupDb().catch((err) => {
  console.error(`Could not set up PostgreSQL: ${err.message}\nCheck PGHOST/PGPORT/PGUSER/PGPASSWORD in backend/.env`)
  process.exit(1)
})

const app = express()
app.use(express.json({ limit: '100kb' }))

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024, files: 1 } })
const paperUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: MAX_PDF_BYTES, files: 1 } })

const publicUser = ({ id, name, email, role, created_at }) => ({ id, name, email, role, created_at })
const issue = (user) => ({ token: jwt.sign({ sub: user.id }, JWT_SECRET, { expiresIn: '7d' }), user: publicUser(user) })

function auth(req, res, next) {
  const token = req.headers.authorization?.replace(/^Bearer /, '')
  try {
    req.userId = jwt.verify(token, JWT_SECRET).sub
    next()
  } catch {
    res.status(401).json({ error: 'Please log in again' })
  }
}

async function requireModerator(req, res, next) {
  try {
    const { rows } = await pool.query('SELECT role FROM users WHERE id = $1', [req.userId])
    if (!['admin', 'moderator'].includes(rows[0]?.role)) return res.status(403).json({ error: 'Moderator or Admin access required' })
    req.userRole = rows[0].role
    next()
  } catch (err) {
    next(err)
  }
}

app.post('/api/auth/signup', async (req, res) => {
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
    res.status(201).json(issue(rows[0]))
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'An account with this email already exists' })
    throw err
  }
})

// ponytail: no login rate limit yet, add express-rate-limit before deploying publicly
app.post('/api/auth/login', async (req, res) => {
  const email = String(req.body?.email ?? '').trim().toLowerCase()
  const password = String(req.body?.password ?? '')
  const { rows } = await pool.query('SELECT * FROM users WHERE email = $1', [email])
  if (!rows[0] || !(await bcrypt.compare(password, rows[0].password_hash))) {
    return res.status(401).json({ error: 'Incorrect email or password' })
  }
  res.json(issue(rows[0]))
})

app.get('/api/auth/me', auth, async (req, res) => {
  const { rows } = await pool.query(
    'SELECT u.*, (SELECT count(*)::int FROM posts WHERE user_id = u.id) AS post_count FROM users u WHERE id = $1',
    [req.userId]
  )
  if (!rows[0]) return res.status(401).json({ error: 'Please log in again' })
  res.json({ ...publicUser(rows[0]), post_count: rows[0].post_count })
})

const POST_SELECT = `
  SELECT p.id, p.body, p.image_id, p.created_at, p.user_id, u.name AS author_name, u.role AS author_role
  FROM posts p JOIN users u ON u.id = p.user_id`

// Mixed feed: social posts plus approved papers, newest first. Paper metadata is always read from PostgreSQL.
app.get('/api/posts', auth, async (req, res) => {
  const { rows } = await pool.query(`
    SELECT * FROM (
      SELECT 'post'::text AS type, p.id::text AS id, p.body, p.image_id::text AS image_id,
        p.created_at, p.user_id, u.name AS author_name, u.role AS author_role,
        NULL::text AS title, NULL::text AS abstract, NULL::jsonb AS authors,
        NULL::text AS domain, NULL::text[] AS tags, NULL::text AS doi
      FROM posts p JOIN users u ON u.id = p.user_id
      UNION ALL
      SELECT 'paper'::text AS type, rp.id::text AS id, NULL::text AS body, NULL::text AS image_id,
        COALESCE(rp.reviewed_at, rp.created_at) AS created_at, rp.user_id, u.name AS author_name, u.role AS author_role,
        rp.title, rp.abstract, rp.authors, rp.domain, rp.tags, rp.doi
      FROM papers rp JOIN users u ON u.id = rp.user_id
      WHERE rp.status = 'approved'
    ) feed ORDER BY created_at DESC LIMIT 50`)
  res.json(rows)
})

app.get('/api/papers/search', auth, async (req, res) => {
  const q = String(req.query.q ?? '').trim().slice(0, 200)
  const pattern = `%${q.replace(/[\\%_]/g, '\\$&')}%`
  const { rows } = await pool.query(`
    SELECT p.id, p.title, p.abstract, p.domain, p.tags, p.authors, p.doi,
      p.reviewed_at, p.created_at, u.name AS submitter_name
    FROM papers p JOIN users u ON u.id = p.user_id
    WHERE p.status = 'approved'
      AND (p.title ILIKE $1 OR p.abstract ILIKE $1 OR p.domain ILIKE $1 OR p.doi ILIKE $1
        OR array_to_string(p.tags, ' ') ILIKE $1 OR p.authors::text ILIKE $1)
    ORDER BY COALESCE(p.reviewed_at, p.created_at) DESC LIMIT 50`, [pattern])
  res.json(rows)
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
  const created = await pool.query(`${POST_SELECT} WHERE p.id = $1`, [rows[0].id])
  res.status(201).json(created.rows[0])
})

app.post('/api/papers/submit', auth, paperUpload.single('pdf'), async (req, res) => {
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

app.get('/api/moderation/papers/:id', auth, requireModerator, async (req, res) => {
  if (!/^\d+$/.test(req.params.id)) return res.status(404).json({ error: 'Paper not found' })
  const { rows } = await pool.query(`
    SELECT p.id, p.title, p.abstract, p.doi, p.domain, p.tags, p.authors, p.pdf_filename,
      p.pdf_size, p.additional_notes, p.status, p.rejection_reason, p.created_at, p.reviewed_at,
      submitter.name AS submitter_name, submitter.email AS submitter_email,
      reviewer.name AS reviewer_name
    FROM papers p JOIN users submitter ON submitter.id = p.user_id
    LEFT JOIN users reviewer ON reviewer.id = p.reviewed_by WHERE p.id = $1`, [req.params.id])
  if (!rows[0]) return res.status(404).json({ error: 'Paper not found' })
  res.json(rows[0])
})

app.patch('/api/moderation/papers/:id/approve', auth, requireModerator, async (req, res) => {
  if (!/^\d+$/.test(req.params.id)) return res.status(404).json({ error: 'Paper not found' })
  const { rows } = await pool.query(`UPDATE papers SET status = 'approved', reviewed_by = $2,
    reviewed_at = now(), rejection_reason = NULL, updated_at = now()
    WHERE id = $1 AND status = 'pending' RETURNING id, status, reviewed_by, reviewed_at`, [req.params.id, req.userId])
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
  const { rows } = await pool.query(`UPDATE papers SET status = 'rejected', reviewed_by = $2,
    reviewed_at = now(), rejection_reason = $3, updated_at = now()
    WHERE id = $1 AND status = 'pending' RETURNING id, status, reviewed_by, reviewed_at, rejection_reason`,
  [req.params.id, req.userId, reason])
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
  if (!Number.isInteger(id)) return res.status(404).json({ error: 'Post not found' })
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

// Express only treats 4-arg middleware as an error handler
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, _next) => {
  if (err instanceof multer.MulterError) {
    const error = err.code === 'LIMIT_FILE_SIZE'
      ? (err.field === 'pdf' ? `PDF must be ${Math.floor(MAX_PDF_BYTES / 1024 / 1024)} MB or smaller` : 'Image must be 5 MB or smaller')
      : err.message
    return res.status(400).json({ error, ...(err.field === 'pdf' ? { field: 'pdf' } : {}) })
  }
  console.error(err)
  res.status(err.status || 500).json({ error: err.status ? err.message : 'Server error' })
})

app.listen(PORT, () => console.log(`API running on http://localhost:${PORT}`))
hiii
import express from 'express'
import { closeUserConnections, DOC_ID_PATTERN, signDocTicket } from './collaboration.js'

// SNARP Docs REST API: documents, sharing by invitation, and tickets for the live editor.
export const DOC_TITLE_MAX = 300
export const DOC_DESCRIPTION_MAX = 5000
export const DOC_PERMISSIONS = ['editor', 'viewer']

const AVATAR = (alias) => `CASE WHEN ${alias}.profile_image_id IS NULL THEN NULL ELSE '/api/images/' || ${alias}.profile_image_id::text END`

export function docDetailsProblem({ title, description }) {
  if (typeof title !== 'string' || !title.trim() || title.trim().length > DOC_TITLE_MAX) return { error: `Title must be 1 to ${DOC_TITLE_MAX} characters`, field: 'title' }
  if (description != null && typeof description !== 'string') return { error: 'Description must be text', field: 'description' }
  if ((description ?? '').trim().length > DOC_DESCRIPTION_MAX) return { error: `Description must be ${DOC_DESCRIPTION_MAX.toLocaleString('en')} characters or fewer`, field: 'description' }
  return null
}

export async function getDocumentAccess(db, documentId, userId) {
  const { rows } = await db.query(
    `SELECT d.id, d.owner_id, d.title, d.description, d.created_at, d.updated_at, owner.name AS owner_name,
       CASE WHEN d.owner_id = $2 THEN 'owner' ELSE m.permission END AS permission
     FROM research_documents d
     JOIN users owner ON owner.id = d.owner_id
     LEFT JOIN research_document_members m ON m.document_id = d.id AND m.user_id = $2
     WHERE d.id = $1 AND (d.owner_id = $2 OR m.user_id = $2)`,
    [documentId, userId],
  )
  return rows[0] ?? null
}

export function createDocumentsRouter({ pool, auth, writeLimiter, jwtSecret, collaboration }) {
  const router = express.Router()
  const validId = (param) => (req, res, next) => (DOC_ID_PATTERN.test(req.params[param]) ? next() : res.status(404).json({ error: param === 'documentId' ? 'Document not found' : 'Invitation not found' }))
  const ownerOnly = async (req, res, next) => {
    const document = await getDocumentAccess(pool, req.params.documentId, req.userId)
    if (!document) return res.status(404).json({ error: 'Document not found' })
    if (document.permission !== 'owner') return res.status(403).json({ error: 'Only the owner can do that' })
    req.document = document
    next()
  }

  // Owners and editors can invite people (like shared docs elsewhere); only the owner changes or removes access.
  const canShare = async (req, res, next) => {
    const document = await getDocumentAccess(pool, req.params.documentId, req.userId)
    if (!document) return res.status(404).json({ error: 'Document not found' })
    if (document.permission === 'viewer') return res.status(403).json({ error: 'Only the owner and editors can invite people' })
    req.document = document
    next()
  }

  router.get('/', auth, async (req, res) => {
    const q = typeof req.query.q === 'string' ? req.query.q.trim().slice(0, 120) : ''
    const { rows } = await pool.query(
      `SELECT d.id, d.title, d.description, d.owner_id, d.created_at, d.updated_at, owner.name AS owner_name,
         CASE WHEN d.owner_id = $1 THEN 'owner' ELSE m.permission END AS permission,
         (SELECT count(*)::int FROM research_document_members x WHERE x.document_id = d.id) AS member_count
       FROM research_documents d
       JOIN users owner ON owner.id = d.owner_id
       LEFT JOIN research_document_members m ON m.document_id = d.id AND m.user_id = $1
       WHERE (d.owner_id = $1 OR m.user_id = $1)
         AND ($2 = '' OR strpos(lower(d.title), lower($2)) > 0 OR strpos(lower(d.description), lower($2)) > 0)
       ORDER BY d.updated_at DESC, d.created_at DESC
       LIMIT 200`,
      [req.userId, q],
    )
    res.json(rows)
  })

  router.post('/', auth, writeLimiter, async (req, res) => {
    const problem = docDetailsProblem(req.body ?? {})
    if (problem) return res.status(400).json(problem)
    const { rows } = await pool.query(
      `INSERT INTO research_documents (owner_id, title, description) VALUES ($1, $2, $3)
       RETURNING id, title, description, owner_id, created_at, updated_at`,
      [req.userId, req.body.title.trim(), (req.body.description ?? '').trim()],
    )
    res.status(201).json({ ...rows[0], permission: 'owner', member_count: 0 })
  })

  // Invitations sent to me.
  router.get('/invitations', auth, async (req, res) => {
    const { rows } = await pool.query(
      `SELECT i.id, i.document_id, d.title AS document_title, i.permission, i.created_at,
         inviter.id AS inviter_id, inviter.name AS inviter_name, ${AVATAR('inviter')} AS inviter_avatar_url
       FROM research_document_invitations i
       JOIN research_documents d ON d.id = i.document_id
       JOIN users inviter ON inviter.id = i.inviter_id
       WHERE i.invitee_id = $1 AND i.status = 'pending'
       ORDER BY i.created_at DESC LIMIT 100`,
      [req.userId],
    )
    res.json(rows)
  })

  router.post('/invitations/:invitationId/respond', auth, writeLimiter, validId('invitationId'), async (req, res) => {
    const action = req.body?.action
    if (!['accept', 'reject'].includes(action)) return res.status(400).json({ error: 'Choose accept or reject' })
    const client = await pool.connect()
    try {
      await client.query('BEGIN')
      const { rows } = await client.query(
        `SELECT i.id, i.document_id, i.invitee_id, i.permission, i.status, d.owner_id, d.title
         FROM research_document_invitations i JOIN research_documents d ON d.id = i.document_id
         WHERE i.id = $1 AND i.invitee_id = $2 FOR UPDATE OF i`,
        [req.params.invitationId, req.userId],
      )
      const invitation = rows[0]
      if (!invitation) {
        await client.query('ROLLBACK')
        return res.status(404).json({ error: 'Invitation not found' })
      }
      if (invitation.status !== 'pending') {
        await client.query('ROLLBACK')
        return res.status(409).json({ error: invitation.status === 'cancelled' ? 'The owner cancelled this invitation' : 'This invitation was already answered' })
      }
      const status = action === 'accept' ? 'accepted' : 'rejected'
      if (status === 'accepted') {
        await client.query(
          `INSERT INTO research_document_members (document_id, user_id, permission) VALUES ($1, $2, $3)
           ON CONFLICT (document_id, user_id) DO UPDATE SET permission = EXCLUDED.permission, added_at = now()`,
          [invitation.document_id, req.userId, invitation.permission],
        )
        await client.query(
          `INSERT INTO notifications (user_id, actor_id, kind, entity_type, entity_id, text)
           SELECT $1, actor.id, 'doc_joined', 'document', NULL, actor.name || ' joined your document "' || left($3, 120) || '"'
           FROM users actor WHERE actor.id = $2`,
          [invitation.owner_id, req.userId, invitation.title],
        )
      }
      await client.query('UPDATE research_document_invitations SET status = $2, responded_at = now() WHERE id = $1', [invitation.id, status])
      await client.query('COMMIT')
      res.json({ id: invitation.id, document_id: invitation.document_id, status })
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {})
      throw err
    } finally {
      client.release()
    }
  })

  router.get('/:documentId', auth, validId('documentId'), async (req, res) => {
    const document = await getDocumentAccess(pool, req.params.documentId, req.userId)
    if (!document) return res.status(404).json({ error: 'Document not found' })
    res.json(document)
  })

  router.patch('/:documentId', auth, writeLimiter, validId('documentId'), ownerOnly, async (req, res) => {
    const next = {
      title: Object.hasOwn(req.body ?? {}, 'title') ? req.body.title : req.document.title,
      description: Object.hasOwn(req.body ?? {}, 'description') ? req.body.description : req.document.description,
    }
    const problem = docDetailsProblem(next)
    if (problem) return res.status(400).json(problem)
    const { rows } = await pool.query(
      `UPDATE research_documents SET title = $2, description = $3, updated_at = now() WHERE id = $1
       RETURNING id, title, description, owner_id, created_at, updated_at`,
      [req.params.documentId, next.title.trim(), (next.description ?? '').trim()],
    )
    res.json({ ...rows[0], owner_name: req.document.owner_name, permission: 'owner' })
  })

  router.delete('/:documentId', auth, validId('documentId'), ownerOnly, async (req, res) => {
    collaboration.closeConnections(req.params.documentId)
    await pool.query('DELETE FROM research_documents WHERE id = $1', [req.params.documentId])
    res.status(204).end()
  })

  // Owner, members and (for the owner) pending invitations. Emails are never shown.
  router.get('/:documentId/members', auth, validId('documentId'), async (req, res) => {
    const document = await getDocumentAccess(pool, req.params.documentId, req.userId)
    if (!document) return res.status(404).json({ error: 'Document not found' })
    const [owner, members, pending] = await Promise.all([
      pool.query(`SELECT u.id, u.name, ${AVATAR('u')} AS avatar_url FROM users u WHERE u.id = $1`, [document.owner_id]),
      pool.query(
        `SELECT u.id AS user_id, u.name, ${AVATAR('u')} AS avatar_url, m.permission, m.added_at
         FROM research_document_members m JOIN users u ON u.id = m.user_id
         WHERE m.document_id = $1 ORDER BY lower(u.name)`,
        [req.params.documentId],
      ),
      document.permission !== 'viewer'
        ? pool.query(
          `SELECT i.id, i.permission, i.created_at, i.inviter_id, inviter.name AS inviter_name,
             u.id AS user_id, u.name, ${AVATAR('u')} AS avatar_url
           FROM research_document_invitations i JOIN users u ON u.id = i.invitee_id JOIN users inviter ON inviter.id = i.inviter_id
           WHERE i.document_id = $1 AND i.status = 'pending' ORDER BY i.created_at DESC`,
          [req.params.documentId],
        )
        : { rows: [] },
    ])
    res.json({ owner: owner.rows[0], members: members.rows, pending: pending.rows, permission: document.permission })
  })

  router.post('/:documentId/invitations', auth, writeLimiter, validId('documentId'), canShare, async (req, res) => {
    const inviteeId = Number(req.body?.userId)
    const permission = req.body?.permission
    if (!Number.isSafeInteger(inviteeId) || inviteeId < 1) return res.status(400).json({ error: 'Choose someone to invite', field: 'userId' })
    if (!DOC_PERMISSIONS.includes(permission)) return res.status(400).json({ error: 'Choose Can edit or Can view', field: 'permission' })
    if (String(inviteeId) === String(req.userId)) return res.status(400).json({ error: 'You already have access' })
    if (String(inviteeId) === String(req.document.owner_id)) return res.status(400).json({ error: `${req.document.owner_name} owns this document` })
    const { rows: people } = await pool.query(
      'SELECT id, name FROM users WHERE id = $1 AND blocked_at IS NULL AND email_verified_at IS NOT NULL',
      [inviteeId],
    )
    if (!people[0]) return res.status(404).json({ error: 'That person could not be found' })
    const member = await pool.query('SELECT 1 FROM research_document_members WHERE document_id = $1 AND user_id = $2', [req.params.documentId, inviteeId])
    if (member.rowCount) return res.status(409).json({ error: `${people[0].name} already has access` })
    const { rows } = await pool.query(
      `WITH invite AS (
         INSERT INTO research_document_invitations (document_id, inviter_id, invitee_id, permission)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (document_id, invitee_id) WHERE status = 'pending' DO NOTHING
         RETURNING id, permission, created_at
       ), notified AS (
         INSERT INTO notifications (user_id, actor_id, kind, entity_type, entity_id, text)
         SELECT $3, actor.id, 'doc_invite', 'document', NULL,
           actor.name || ' invited you to ' || CASE WHEN $4 = 'editor' THEN 'edit' ELSE 'view' END || ' "' || left($5, 120) || '"'
         FROM invite, users actor WHERE actor.id = $2
       )
       SELECT * FROM invite`,
      [req.params.documentId, req.userId, inviteeId, permission, req.document.title],
    )
    if (!rows[0]) return res.status(409).json({ error: `An invitation is already waiting for ${people[0].name}` })
    res.status(201).json({ ...rows[0], user_id: inviteeId, name: people[0].name })
  })

  // The owner can cancel any waiting invitation; an editor only the ones they sent.
  router.delete('/:documentId/invitations/:invitationId', auth, validId('documentId'), validId('invitationId'), canShare, async (req, res) => {
    const { rowCount } = await pool.query(
      "UPDATE research_document_invitations SET status = 'cancelled', responded_at = now() WHERE id = $1 AND document_id = $2 AND status = 'pending' AND ($3 OR inviter_id = $4)",
      [req.params.invitationId, req.params.documentId, req.document.permission === 'owner', req.userId],
    )
    if (!rowCount) return res.status(404).json({ error: 'Invitation not found' })
    res.status(204).end()
  })

  router.patch('/:documentId/members/:memberId', auth, writeLimiter, validId('documentId'), ownerOnly, async (req, res) => {
    const permission = req.body?.permission
    if (!DOC_PERMISSIONS.includes(permission)) return res.status(400).json({ error: 'Choose Can edit or Can view', field: 'permission' })
    const { rowCount } = await pool.query(
      'UPDATE research_document_members SET permission = $3 WHERE document_id = $1 AND user_id = $2',
      [req.params.documentId, Number(req.params.memberId) || 0, permission],
    )
    if (!rowCount) return res.status(404).json({ error: 'Member not found' })
    closeUserConnections(collaboration, req.params.documentId, req.params.memberId) // they reconnect with the new permission
    res.json({ permission })
  })

  // The owner removes someone, or a member leaves.
  router.delete('/:documentId/members/:memberId', auth, validId('documentId'), async (req, res) => {
    const memberId = Number(req.params.memberId)
    if (!Number.isSafeInteger(memberId) || memberId < 1) return res.status(404).json({ error: 'Member not found' })
    const document = await getDocumentAccess(pool, req.params.documentId, req.userId)
    if (!document) return res.status(404).json({ error: 'Document not found' })
    const leaving = String(memberId) === String(req.userId)
    if (!leaving && document.permission !== 'owner') return res.status(403).json({ error: 'Only the owner can remove people' })
    const { rowCount } = await pool.query('DELETE FROM research_document_members WHERE document_id = $1 AND user_id = $2', [req.params.documentId, memberId])
    if (!rowCount) return res.status(404).json({ error: 'Member not found' })
    closeUserConnections(collaboration, req.params.documentId, memberId)
    res.status(204).end()
  })

  router.post('/:documentId/ws-ticket', auth, validId('documentId'), async (req, res) => {
    const document = await getDocumentAccess(pool, req.params.documentId, req.userId)
    if (!document) return res.status(404).json({ error: 'Document not found' })
    res.set('Cache-Control', 'no-store').json({
      token: signDocTicket({ secret: jwtSecret, documentId: document.id, userId: req.userId }),
      permission: document.permission,
    })
  })

  return router
}

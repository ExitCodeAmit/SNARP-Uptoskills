import crossws from 'crossws/adapters/node'
import { Database } from '@hocuspocus/extension-database'
import { Hocuspocus } from '@hocuspocus/server'
import jwt from 'jsonwebtoken'

// Real-time editing for SNARP Docs (Hocuspocus + Yjs). Browsers connect to /collaboration with a
// two-minute, single-document ticket from POST /api/docs/:id/ws-ticket; access is checked again here.

export const DOC_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
export const WS_TICKET_AUDIENCE = 'snarp-docs-ws'
export const WS_TICKET_ISSUER = 'snarp-api'

export function signDocTicket({ secret, documentId, userId }) {
  return jwt.sign({ documentId }, secret, {
    subject: String(userId),
    audience: WS_TICKET_AUDIENCE,
    issuer: WS_TICKET_ISSUER,
    expiresIn: '2m',
    algorithm: 'HS256',
  })
}

export function readDocTicket({ secret, token, documentId }) {
  const claims = jwt.verify(token, secret, { audience: WS_TICKET_AUDIENCE, issuer: WS_TICKET_ISSUER, algorithms: ['HS256'] })
  const userId = Number(claims?.sub)
  if (claims?.documentId !== documentId || !Number.isSafeInteger(userId) || userId < 1) throw new Error('Document access denied')
  return userId
}

export function createCollaborationServer({ pool, jwtSecret }) {
  return new Hocuspocus({
    name: 'snarp-docs',
    debounce: 2000,
    maxDebounce: 10000,
    quiet: true,
    extensions: [
      new Database({
        fetch: async ({ documentName }) => {
          if (!DOC_ID_PATTERN.test(documentName)) throw new Error('Invalid document')
          const { rows } = await pool.query('SELECT ydoc_state FROM research_documents WHERE id = $1', [documentName])
          return rows[0]?.ydoc_state ?? null
        },
        store: async ({ documentName, state }) => {
          if (!DOC_ID_PATTERN.test(documentName)) throw new Error('Invalid document')
          await pool.query('UPDATE research_documents SET ydoc_state = $2 WHERE id = $1', [documentName, Buffer.from(state)])
        },
      }),
    ],
    async onAuthenticate({ documentName, token, connectionConfig }) {
      if (!DOC_ID_PATTERN.test(documentName)) throw new Error('Document access denied')
      let userId
      try { userId = readDocTicket({ secret: jwtSecret, token, documentId: documentName }) } catch {
        throw new Error('Document access denied')
      }
      const { rows } = await pool.query(
        `SELECT account.name, CASE WHEN d.owner_id = $2 THEN 'owner' ELSE m.permission END AS permission
         FROM research_documents d
         JOIN users account ON account.id = $2 AND account.blocked_at IS NULL
         LEFT JOIN research_document_members m ON m.document_id = d.id AND m.user_id = $2
         WHERE d.id = $1 AND (d.owner_id = $2 OR m.user_id = $2)`,
        [documentName, userId],
      )
      const access = rows[0]
      if (!access) throw new Error('Document access denied')
      connectionConfig.readOnly = access.permission === 'viewer'
      return { user: { id: String(userId), name: access.name }, permission: access.permission }
    },
    async onStoreDocument({ document, documentName }) {
      const { rows } = await pool.query('UPDATE research_documents SET updated_at = now() WHERE id = $1 RETURNING updated_at', [documentName])
      if (rows[0]) document.broadcastStateless(JSON.stringify({ type: 'document-saved', savedAt: rows[0].updated_at }))
    },
  })
}

export function attachCollaborationWebSocket(httpServer, collaboration, log = () => {}) {
  const clients = new WeakMap()
  const adapter = crossws({
    serverOptions: { maxPayload: 5 * 1024 * 1024 },
    hooks: {
      open(peer) {
        clients.set(peer, collaboration.handleConnection(peer.websocket, peer.request))
      },
      message(peer, message) {
        clients.get(peer)?.handleMessage(message.uint8Array())
      },
      close(peer, event) {
        clients.get(peer)?.handleClose({ code: event.code, reason: event.reason })
        clients.delete(peer)
      },
      error(_peer, error) {
        log('error', 'docs_socket_error', { message: error?.message ?? String(error) })
      },
    },
  })

  httpServer.on('upgrade', (request, socket, head) => {
    const url = new URL(request.url ?? '/', 'http://localhost')
    if (url.pathname !== '/collaboration') {
      socket.destroy()
      return
    }
    void adapter.handleUpgrade(request, socket, head)
  })

  return adapter
}

// Disconnects one person from one document (after their access changed); everyone else keeps editing.
// Their editor reconnects with a fresh ticket, which carries the new permission or is refused.
export function closeUserConnections(collaboration, documentName, userId) {
  const document = collaboration.documents.get(documentName)
  if (!document) return 0
  let closed = 0
  document.connections.forEach((_entry, connection) => {
    if (String(connection.context?.user?.id) === String(userId)) {
      connection.close({ code: 4205, reason: 'Reset Connection' })
      closed += 1
    }
  })
  return closed
}

// Before the server stops, write documents that still have unsaved (debounced) changes.
export async function flushCollaboration(collaboration, adapter) {
  collaboration.closeConnections()
  await adapter.close?.(1001, 'Server shutting down')
  const pending = []
  for (const document of collaboration.documents.values()) {
    const storeId = `onStoreDocument-${document.name}`
    if (collaboration.debouncer?.isDebounced(storeId)) pending.push(collaboration.debouncer.executeNow(storeId))
  }
  await Promise.all(pending)
}

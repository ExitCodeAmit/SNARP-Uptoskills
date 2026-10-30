import jwt from 'jsonwebtoken'

export const REMEMBERED_SESSION_SECONDS = 7 * 24 * 60 * 60
export const TEMPORARY_SESSION_SECONDS = 24 * 60 * 60
const SESSION_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export function createSessionToken(userId, sessionId, secret, remember = true) {
  const expiresIn = remember ? REMEMBERED_SESSION_SECONDS : TEMPORARY_SESSION_SECONDS
  return {
    token: jwt.sign({ sub: String(userId) }, secret, { expiresIn, jwtid: sessionId }),
    expiresIn,
  }
}

export function verifySessionToken(token, secret) {
  const payload = jwt.verify(token, secret, { algorithms: ['HS256'] })
  if (typeof payload.sub !== 'string' || !/^\d+$/.test(payload.sub) ||
      typeof payload.jti !== 'string' || !SESSION_ID_PATTERN.test(payload.jti)) {
    throw new Error('Invalid session token')
  }
  return payload
}

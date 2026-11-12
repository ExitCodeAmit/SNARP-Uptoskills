import { test } from 'node:test'
import assert from 'node:assert/strict'
import jwt from 'jsonwebtoken'
import {
  createSessionToken,
  REMEMBERED_SESSION_SECONDS,
  TEMPORARY_SESSION_SECONDS,
  verifySessionToken,
} from './session.js'

const secret = 'test-secret-with-at-least-thirty-two-bytes-long'
const sessionId = 'f47ac10b-58cc-4372-a567-0e02b2c3d479'

test('creates a session-bound token with the expected expiry', () => {
  for (const [remember, expectedSeconds] of [[true, REMEMBERED_SESSION_SECONDS], [false, TEMPORARY_SESSION_SECONDS]]) {
    const { token, expiresIn } = createSessionToken(42, sessionId, secret, remember)
    const payload = verifySessionToken(token, secret)
    assert.equal(expiresIn, expectedSeconds)
    assert.equal(payload.sub, '42')
    assert.equal(payload.jti, sessionId)
    assert.equal(payload.exp - payload.iat, expectedSeconds)
  }
})

test('rejects expired, unsigned, and malformed session tokens', () => {
  assert.throws(() => verifySessionToken('not-a-token', secret))
  const { token: wrongSecretToken } = createSessionToken(42, sessionId, 'another-secret-with-at-least-thirty-two-bytes')
  assert.throws(() => verifySessionToken(wrongSecretToken, secret))
  assert.throws(() => verifySessionToken(jwt.sign({ sub: '42' }, secret, { expiresIn: -1, jwtid: sessionId }), secret))
  assert.throws(() => verifySessionToken(jwt.sign({ sub: '42' }, secret, { expiresIn: '1h' }), secret))
  assert.throws(() => verifySessionToken(jwt.sign({ sub: 'admin' }, secret, { expiresIn: '1h', jwtid: sessionId }), secret))
})

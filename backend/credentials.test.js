import { test } from 'node:test'
import assert from 'node:assert/strict'
import { describeDevice, emailProblem, nameProblem, normalizeEmail, passwordProblem } from './credentials.js'

test('passwordProblem accepts a reasonable password', () => {
  assert.equal(passwordProblem('quiet-river-42'), null)
  assert.equal(passwordProblem('Gradient descent 9', { email: 'meera@iisc.ac.in', name: 'Meera Iyer' }), null)
})

test('passwordProblem rejects weak passwords', () => {
  assert.match(passwordProblem('short1'), /at least 8/)
  assert.match(passwordProblem('onlyletters'), /mix of letters/)
  assert.match(passwordProblem('1234567890'), /mix of letters/)
  assert.match(passwordProblem('Password123'), /too common/)
  assert.match(passwordProblem('aaaaaaaa'), /mix of letters/)
  assert.match(passwordProblem('meera.iyer-2024', { email: 'meera.iyer@iisc.ac.in' }), /email/)
  assert.match(passwordProblem('Meera Iyer 1!', { email: 'x@y.org', name: 'Meera Iyer' }), /name/)
})

test('passwordProblem counts bytes, not characters, for the bcrypt limit', () => {
  assert.equal(passwordProblem('a1'.repeat(36)), null)
  assert.match(passwordProblem('a1'.repeat(36) + 'x'), /72 bytes/)
  assert.match(passwordProblem('é1'.repeat(25)), /72 bytes/)
})

test('email and name rules', () => {
  assert.equal(normalizeEmail('  Someone@Example.ORG '), 'someone@example.org')
  assert.equal(emailProblem('someone@example.org'), null)
  assert.ok(emailProblem('someone@example'))
  assert.ok(emailProblem('some one@example.org'))
  assert.equal(nameProblem('Ana Lima'), null)
  assert.ok(nameProblem(' '))
  assert.ok(nameProblem('raj2@gmail.com'))
  assert.ok(nameProblem('12345'))
  assert.ok(nameProblem('Bad\u0007Name'))
})

test('describeDevice labels common browsers', () => {
  assert.equal(describeDevice('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36 Edg/130.0'), 'Edge on Windows')
  assert.equal(describeDevice('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1'), 'Safari on iOS')
  assert.equal(describeDevice(''), 'Unknown device')
})

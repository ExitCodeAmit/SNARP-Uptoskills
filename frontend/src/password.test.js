import { test } from 'node:test'
import assert from 'node:assert/strict'
import { passwordProblem, passwordStrength, safeNext } from './password.js'

test('password rules match the server', () => {
  assert.equal(passwordProblem('quiet-river-42'), null)
  assert.match(passwordProblem('short1'), /at least 8/)
  assert.match(passwordProblem('onlyletters'), /mix/)
  assert.match(passwordProblem('Password123'), /common/)
  assert.match(passwordProblem('priyasharma9', { name: 'Priya Sharma' }), /name or email/)
})

test('strength grows with length and variety', () => {
  assert.equal(passwordStrength('').score, 0)
  assert.equal(passwordStrength('abc').score, 1)
  assert.ok(passwordStrength('Quiet-River-Delta-42').score > passwordStrength('quietriv1').score)
})

test('safeNext only allows in-app paths', () => {
  assert.equal(safeNext('/articles/4?tab=x'), '/articles/4?tab=x')
  assert.equal(safeNext('//evil.example'), '/')
  assert.equal(safeNext('/\\evil.example'), '/')
  assert.equal(safeNext('https://evil.example'), '/')
  assert.equal(safeNext('/login'), '/')
  assert.equal(safeNext(null), '/')
})

import { test } from 'node:test'
import assert from 'node:assert/strict'
import jwt from 'jsonwebtoken'
import { readDocTicket, signDocTicket } from './collaboration.js'
import { docDetailsProblem } from './documents.js'

const DOC = '0f8fad5b-d9cb-469f-a165-70867728950e'
const OTHER = '7c9e6679-7425-40de-944b-e07fc1f90ae7'

test('a document ticket opens only its own document', () => {
  const token = signDocTicket({ secret: 's3cret', documentId: DOC, userId: 42 })
  assert.equal(readDocTicket({ secret: 's3cret', token, documentId: DOC }), 42)
  assert.throws(() => readDocTicket({ secret: 's3cret', token, documentId: OTHER }), /access denied/)
  assert.throws(() => readDocTicket({ secret: 'wrong', token, documentId: DOC }))
})

test('a normal session token is not accepted as a document ticket', () => {
  const session = jwt.sign({ sub: '42', documentId: DOC }, 's3cret', { expiresIn: '1h' })
  assert.throws(() => readDocTicket({ secret: 's3cret', token: session, documentId: DOC }))
})

test('document tickets expire after two minutes', () => {
  const token = signDocTicket({ secret: 's3cret', documentId: DOC, userId: 1 })
  const { exp, iat } = jwt.decode(token)
  assert.equal(exp - iat, 120)
})

test('docDetailsProblem checks title and description', () => {
  assert.equal(docDetailsProblem({ title: 'Literature review', description: '' }), null)
  assert.equal(docDetailsProblem({ title: '  ' }).field, 'title')
  assert.equal(docDetailsProblem({ title: 'x'.repeat(301) }).field, 'title')
  assert.equal(docDetailsProblem({ title: 'ok', description: 'x'.repeat(5001) }).field, 'description')
  assert.equal(docDetailsProblem({ title: 'ok', description: 5 }).field, 'description')
})

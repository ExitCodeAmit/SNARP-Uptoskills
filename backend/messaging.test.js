import { test } from 'node:test'
import assert from 'node:assert/strict'
import { validateMessageBody, validateRecipientId } from './messaging.js'

test('normalizes message text and recipient ids', () => {
  assert.equal(validateMessageBody('  Hello researcher  '), 'Hello researcher')
  assert.equal(validateRecipientId('24', 12), 24)
})

test('rejects empty or oversized messages and invalid/self recipients', () => {
  assert.throws(() => validateMessageBody('  '), { field: 'body' })
  assert.throws(() => validateMessageBody('x'.repeat(5001)), { field: 'body' })
  assert.throws(() => validateRecipientId('12', 12), { field: 'userId' })
  assert.throws(() => validateRecipientId('012', 12), { field: 'userId' })
  assert.throws(() => validateRecipientId('0', 12), { field: 'userId' })
})

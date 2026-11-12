import { test } from 'node:test'
import assert from 'node:assert/strict'
import { validateCommunity, validateCommunityPost } from './community.js'

test('validates and normalizes community fields', () => {
  assert.deepEqual(validateCommunity({ name: '  AI Circle ', description: ' Research group ', category: ' AI ' }), {
    name: 'AI Circle', description: 'Research group', category: 'AI',
  })
  assert.equal(validateCommunityPost({ body: '  Looking for collaborators?  ' }), 'Looking for collaborators?')
})

test('rejects missing and overlong community input', () => {
  assert.throws(() => validateCommunity({ name: '', category: 'AI' }), { field: 'name' })
  assert.throws(() => validateCommunity({ name: 'AI', category: '' }), { field: 'category' })
  assert.throws(() => validateCommunity({ name: 'AI', category: 'AI', description: 'x'.repeat(2001) }), { field: 'description' })
  assert.throws(() => validateCommunityPost({ body: ' ' }), { field: 'body' })
  assert.throws(() => validateCommunityPost({ body: 'x'.repeat(5001) }), { field: 'body' })
})

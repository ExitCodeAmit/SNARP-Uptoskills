import { test } from 'node:test'
import assert from 'node:assert/strict'
import { MAX_REPLY_LENGTH, validateStoryReply } from './validator.js'

test('MAX_REPLY_LENGTH is 500', () => {
  assert.equal(MAX_REPLY_LENGTH, 500)
})

test('validateStoryReply accepts valid text and trims leading/trailing whitespace', () => {
  const result = validateStoryReply('   Great story! Keep it up.   ')
  assert.equal(result, 'Great story! Keep it up.')
})

test('validateStoryReply accepts maximum 500 character text', () => {
  const maxText = 'A'.repeat(500)
  const result = validateStoryReply(maxText)
  assert.equal(result, maxText)
})

test('validateStoryReply rejects empty or whitespace-only text with 400', () => {
  const invalid = ['', '   ', '\n\t  ', null, undefined, 123, {}, []]
  for (const item of invalid) {
    assert.throws(
      () => validateStoryReply(item),
      (err) => err.status === 400 && err.field === 'text'
    )
  }
})

test('validateStoryReply rejects text exceeding 500 characters with 400', () => {
  const tooLong = 'A'.repeat(501)
  assert.throws(
    () => validateStoryReply(tooLong),
    (err) => err.status === 400 && err.field === 'text' && err.message.includes('500')
  )
})

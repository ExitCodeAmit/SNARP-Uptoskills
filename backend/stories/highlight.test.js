import { test } from 'node:test'
import assert from 'node:assert/strict'
import { MAX_HIGHLIGHT_TITLE_LENGTH, validateHighlightTitle } from './validator.js'

test('MAX_HIGHLIGHT_TITLE_LENGTH is 60', () => {
  assert.equal(MAX_HIGHLIGHT_TITLE_LENGTH, 60)
})

test('validateHighlightTitle accepts valid title and trims whitespace', () => {
  assert.equal(validateHighlightTitle('   Summer Vacation   '), 'Summer Vacation')
  assert.equal(validateHighlightTitle('A'.repeat(60)), 'A'.repeat(60))
})

test('validateHighlightTitle rejects empty, non-string, or >60 chars title', () => {
  const invalid = ['', '   ', '\t\n', null, undefined, 123, {}, []]
  for (const item of invalid) {
    assert.throws(
      () => validateHighlightTitle(item),
      (err) => err.status === 400 && err.field === 'title'
    )
  }

  assert.throws(
    () => validateHighlightTitle('A'.repeat(61)),
    (err) => err.status === 400 && err.field === 'title' && err.message.includes('60')
  )
})
